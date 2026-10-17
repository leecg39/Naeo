import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {savePreferences,getPreferences} from '../../src/server/preferences';
import {queueNotifyMail,runNotifyMailOnce,retractNotifyMail,cleanupNotifyMail} from '../../src/server/mail/notify';
import {enqueueAutoscans,AUTOSCAN_INTERVAL_MS} from '../../src/server/jobs/autoscan';
import {enqueueScan,getScan} from '../../src/server/jobs/queue';
import {runWorkerOnce} from '../../src/server/jobs/worker';
import {scanHandler} from '../../src/server/analysis/scan-handler';
import {issueReward,cancelReward,rewardById} from '../../src/server/events/rewards';
import type {MailConfig,MailMessage} from '../../src/server/mail/provider';
import {MailError} from '../../src/server/mail/provider';

// 실제 시계 기준 — queueNotifyMail/runNotifyMailOnce의 기본 now는 Date.now()라
// 과거로 고정하면 expires_at(24h)을 넘겨 실제 실행 시점에 만료 실패한다.
const NOW=Date.now();
const config:MailConfig={apiKey:'synthetic-notify-key',from:'notify@example.test',key:Buffer.alloc(32,7),apiBase:'http://127.0.0.1:3000',appOrigin:'http://127.0.0.1:3000'};

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const make=async(email:string)=>(await register(db,{email,password:'notify-long-password',nickname:'알림',termsAccepted:true})).user;
 const owner=await make('notify-owner@example.test'),other=await make('notify-other@example.test');
 const blog=createBlog(db,owner.id,{naverId:'notify_blog',title:'알림 블로그',category:'',isPrimary:true});
 const sent:{message:MailMessage;id:string}[]=[];
 const sender=async(message:MailMessage,id:string)=>{sent.push({message,id});return 'mail-'+id;};
 const setPref=(userId:string,patch:Partial<{marketingEmail:boolean;scanEmail:boolean;autoscan:boolean}>)=>{
  const p=getPreferences(db,userId);
  return savePreferences(db,userId,{marketingEmail:p.marketingEmail,scanEmail:p.scanEmail,autoscan:p.autoscan,...patch,version:p.version});
 };
 return{db,owner:owner.id,other:other.id,blog:blog.id,sent,sender,setPref};
}
const rows=(db:ReturnType<typeof openDatabase>)=>db.prepare('SELECT * FROM notify_mail').all() as {id:string;user_id:string;kind:string;ref_id:string;state:string;payload:string|null;error_code:string}[];
/** mailConfig()가 env를 읽으므로 이 테스트 프로세스에만 유효한 값을 넣고 되돌린다. */
function mailEnv(t:TestContext){
 const prev={p:process.env.NAEO_EMAIL_PROVIDER,k:process.env.NAEO_RESEND_API_KEY,f:process.env.NAEO_MAIL_FROM,e:process.env.NAEO_MAIL_ENCRYPTION_KEY,u:process.env.NAEO_APP_URL};
 t.after(()=>{for(const [n,v] of [['NAEO_EMAIL_PROVIDER',prev.p],['NAEO_RESEND_API_KEY',prev.k],['NAEO_MAIL_FROM',prev.f],['NAEO_MAIL_ENCRYPTION_KEY',prev.e],['NAEO_APP_URL',prev.u]] as const){if(v===undefined)delete process.env[n];else process.env[n]=v;}});
 process.env.NAEO_EMAIL_PROVIDER='resend';process.env.NAEO_RESEND_API_KEY='synthetic-notify-key';process.env.NAEO_MAIL_FROM='notify@example.test';process.env.NAEO_APP_URL='http://127.0.0.1:3000';
 process.env.NAEO_MAIL_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('hex');
}
const rss=(n:number)=>`<?xml version="1.0"?><rss version="2.0"><channel><title>알림</title>${Array.from({length:n},(_,i)=>`<item><title>제주 여행 코스 ${i+1}편</title><link>https://blog.naver.com/notify_blog/1000${i}</link><category>여행</category><description>본문 ${i}</description><pubDate>${new Date(NOW-i*2*86_400_000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;

test('scan-complete mail queues only with consent and config, dedupes per scan, and worker sends it',async t=>{
 const {db,owner,blog,sent,sender,setPref}=await fixture(t);
 const job=enqueueScan(db,owner,{blogId:blog});
 // 동의 없음 + 공급자 미설정: 넣지 않는다
 assert.equal(queueNotifyMail(db,owner,'scan_done',job.id,'제목','본문',null),null);
 assert.equal(rows(db).length,0);
 setPref(owner,{scanEmail:true});
 assert.equal(queueNotifyMail(db,owner,'scan_done',job.id,'제목','본문',null),null,'no provider config → nothing queued');
 const id=queueNotifyMail(db,owner,'scan_done',job.id,'NAEO 분석 완료','점수 80',config);
 assert.ok(id);assert.equal(queueNotifyMail(db,owner,'scan_done',job.id,'다른 제목','다른 본문',config),null,'same ref queued once');
 assert.equal(rows(db).length,1);
 // 본문은 암호화되어 저장된다
 const stored=rows(db)[0];
 assert.ok(stored.payload&&!stored.payload.includes('점수 80')&&!stored.payload.includes('notify-owner@example.test'),'payload is encrypted');
 assert.equal(await runNotifyMailOnce(db,config,sender),true);
 assert.equal(sent.length,1);
 assert.equal(sent[0].id,id,'provider gets the mail id as idempotency key');
 assert.equal(sent[0].message.to[0],'notify-owner@example.test');
 assert.match(sent[0].message.text,/점수 80/);assert.match(sent[0].message.text,/수신 설정/);
 const done=rows(db)[0];assert.equal(done.state,'accepted');assert.equal(done.payload,null);
});

test('turning the preference off between queue and send drops the mail without sending',async t=>{
 const {db,owner,sent,sender,setPref}=await fixture(t);
 setPref(owner,{scanEmail:true});
 queueNotifyMail(db,owner,'scan_done','ref-1','제목','본문',config);
 setPref(owner,{scanEmail:false});
 assert.equal(await runNotifyMailOnce(db,config,sender),false,'nothing left to send');
 assert.equal(sent.length,0);assert.equal(rows(db).length,0);
});

test('benefit mail follows marketing consent; revoking the reward retracts a queued mail',async t=>{
 const {db,owner,sent,sender,setPref}=await fixture(t);
 mailEnv(t);
 const grant=issueReward(db,{userId:owner,kind:'manual',tokens:50,description:'가입 축하 토큰',actorId:null},NOW)!;
 setPref(owner,{marketingEmail:true});
 const grant2=issueReward(db,{userId:owner,kind:'manual',tokens:10,description:'두 번째 혜택',actorId:null},NOW)!;
 assert.equal(rows(db).length,1,'first grant before consent queued nothing');
 assert.equal(await runNotifyMailOnce(db,config,sender),true);
 assert.match(sent[0].message.text,/두 번째 혜택/);assert.match(sent[0].message.text,/토큰 10개/);
 const grant3=issueReward(db,{userId:owner,kind:'gift',tokens:0,item:'프리미엄 7일',description:'상품 지급',actorId:owner},NOW)!;
 assert.equal(rows(db).filter(r=>r.state==='queued').length,1);
 cancelReward(db,rewardById(db,grant3.id)!,owner,NOW+1000);
 const row=rows(db).find(r=>r.state!=='accepted')!;
 assert.equal(row.state,'failed');assert.equal(row.error_code,'RETRACTED');assert.equal(row.payload,null);
 assert.equal(retractNotifyMail(db,'benefit',grant2.id,NOW+2000),0,'sent mail is untouched');
 void grant;
});

test('provider failures retry with backoff, then fail permanently; suspended owners are not sent',async t=>{
 const {db,owner,sent,sender,setPref}=await fixture(t);
 setPref(owner,{scanEmail:true});
 queueNotifyMail(db,owner,'scan_done','r1','제목','본문',config);
 await runNotifyMailOnce(db,config,async()=>{throw new MailError('RATE_LIMITED',true,0);});
 let row=rows(db)[0];assert.equal(row.state,'retry');assert.ok(row.payload);
 db.prepare('UPDATE notify_mail SET run_after=0').run();
 // 리스 회수 경로: sending 상태로 두고 lease 만료 → 다음 호출이 다시 보낸다
 db.prepare("UPDATE notify_mail SET state='sending',lease='x',lease_until=0").run();
 assert.equal(await runNotifyMailOnce(db,config,sender),true);assert.equal(sent.length,1);
 // 영구 실패
 queueNotifyMail(db,owner,'scan_done','r2','제목','본문',config);
 await runNotifyMailOnce(db,config,async()=>{throw new MailError('PROVIDER_REJECTED',false);});
 row=rows(db).find(r=>r.ref_id==='r2')!;assert.equal(row.state,'failed');assert.equal(row.payload,null);
 // 정지된 회원은 클레임에서 걸러진다
 db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(owner);
 queueNotifyMail(db,owner,'scan_done','r3','제목','본문',config);
 assert.equal(await runNotifyMailOnce(db,config,sender),false);
 db.prepare("UPDATE users SET status='active' WHERE id=?").run(owner);
});

test('expired mail fails and cleanup removes terminal rows',async t=>{
 const {db,owner,setPref}=await fixture(t);
 setPref(owner,{scanEmail:true});
 queueNotifyMail(db,owner,'scan_done','old','제목','본문',config,NOW-30*86_400_000);
 db.prepare("UPDATE notify_mail SET expires_at=?").run(NOW-1000);
 assert.equal(await runNotifyMailOnce(db,config,async()=>{throw new Error('unreachable')},NOW),false);
 assert.equal(rows(db)[0].state,'failed');assert.equal(rows(db)[0].error_code,'EXPIRED');assert.equal(rows(db)[0].payload,null);
 assert.equal(cleanupNotifyMail(db,NOW),1);
});

test('autoscan enqueues the primary blog once a day for consenting owners only',async t=>{
 const {db,owner,other,blog,setPref}=await fixture(t);
 assert.equal(enqueueAutoscans(db,NOW),0,'autoscan off by default');
 setPref(owner,{autoscan:true});setPref(other,{autoscan:true});
 assert.equal(enqueueAutoscans(db,NOW),1,'other has no blog');
 const enqueued=db.prepare('SELECT id FROM scan_jobs').get() as {id:string};
 const job=getScan(db,owner,enqueued.id);
 assert.equal(job.blogId,blog);assert.equal(job.state,'queued');
 assert.equal(enqueueAutoscans(db,NOW+1000),0,'active job blocks another enqueue');
 // 작업이 끝나도 24시간 안에는 다시 예약하지 않는다
 db.prepare("UPDATE scan_jobs SET state='succeeded',completed_at=?").run(NOW);
 assert.equal(enqueueAutoscans(db,NOW+12*3600_000),0,'last request is still fresh');
 assert.equal(enqueueAutoscans(db,NOW+AUTOSCAN_INTERVAL_MS+3600_000),1,'24h later a new day-key job is queued');
 assert.equal(enqueueAutoscans(db,NOW+AUTOSCAN_INTERVAL_MS+7200_000),0,'still fresh');
 // 정지된 회원 제외
 db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(owner);
 db.prepare('DELETE FROM scan_jobs').run();
 assert.equal(enqueueAutoscans(db,NOW+3*AUTOSCAN_INTERVAL_MS),0);
});

test('failed or canceled scans do not retrigger autoscan inside 24h',async t=>{
 const {db,owner,blog,setPref}=await fixture(t);
 setPref(owner,{autoscan:true});
 db.prepare("INSERT INTO scan_jobs(id,owner_id,blog_id,state,run_after,created_at,updated_at) VALUES('j-fail',?,?, 'failed',0,?,?)").run(owner,blog,NOW-1000,NOW-1000);
 assert.equal(enqueueAutoscans(db,NOW),0,'recent failed attempt still counts for the 24h window');
});

test('scan completion enqueues the notification through the real worker path',async t=>{
 const {db,owner,blog,setPref}=await fixture(t);
 mailEnv(t);
 // 동의 전: 스캔은 성공하지만 메일은 안 나간다
 const job1=enqueueScan(db,owner,{blogId:blog});
 await runWorkerOnce(db,'w',scanHandler(db,async()=>new Response(rss(3),{status:200}),()=>NOW));
 assert.equal(getScan(db,owner,job1.id).state,'succeeded');assert.equal(rows(db).length,0);
 // 동의 후: 스캔 한 번 → 메일 한 통(재시도해도 중복 없음)
 setPref(owner,{scanEmail:true});
 const job2=enqueueScan(db,owner,{blogId:blog});
 await runWorkerOnce(db,'w',scanHandler(db,async()=>new Response(rss(3),{status:200}),()=>NOW));
 assert.equal(getScan(db,owner,job2.id).state,'succeeded');
 const queued=rows(db).filter(r=>r.kind==='scan_done'&&r.ref_id===job2.id);
 assert.equal(queued.length,1);assert.match(queued[0].payload!,/^[A-Za-z0-9+/=:_-]+$/,'payload is ciphertext');
});
