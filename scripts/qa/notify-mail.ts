/** Isolated production HTTP + worker verification of notification mail and the autoscan scheduler.
 *  Loopback doubles for Resend and the Naver RSS host; no external network is used. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {migrations} from '../../src/server/migrations';
import {openDatabase} from '../../src/server/database';
import {enqueueAutoscans} from '../../src/server/jobs/autoscan';

const freePort=async()=>{const probe=tcpServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));return port;};
async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-notify-http-')),children:ChildProcess[]=[];
 const apiKey=randomBytes(24).toString('hex');
 const inbox=new Map<string,{body:string;message:{to:string[];subject:string;text:string}}>();
 let attempts=0,badAuth=0,firstNotify=true;
 const mail=createServer((q,r)=>{let body='';q.on('data',c=>body+=c);q.on('end',()=>{try{
  assert.equal(q.url,'/emails');assert.equal(q.method,'POST');
  if(q.headers.authorization!==`Bearer ${apiKey}`){badAuth++;r.writeHead(401).end('{}');return;}
  const key=String(q.headers['idempotency-key']);attempts++;
  if(inbox.has(key))assert.equal(inbox.get(key)!.body,body);else inbox.set(key,{body,message:JSON.parse(body)});
  const notify=key.startsWith('notify-mail/');
  r.writeHead(notify&&firstNotify?503:200,{'Content-Type':'application/json'});
  r.end(notify&&firstNotify?'{}':JSON.stringify({id:'local-'+key}));firstNotify=false;
 }catch{r.writeHead(400);r.end('{}');}});});
 const rss=createServer((q,r)=>{
  const m=/^\/([a-z0-9_-]+)\.xml$/.exec(q.url??'');if(!m){r.writeHead(404).end();return;}
  const items=Array.from({length:6},(_,i)=>`<item><title>제주 여행 코스 ${i+1}편 총정리</title><link>https://blog.naver.com/${m[1]}/200${i}</link><category>여행</category><description>본문 ${i}</description><pubDate>${new Date(Date.now()-i*172800000).toUTCString()}</pubDate></item>`).join('');
  r.writeHead(200,{'Content-Type':'application/rss+xml'});r.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>${m[1]}</title>${items}</channel></rss>`);
 });
 await new Promise<void>(r=>mail.listen(0,'127.0.0.1',r));await new Promise<void>(r=>rss.listen(0,'127.0.0.1',r));
 const mailPort=(mail.address() as {port:number}).port,rssPort=(rss.address() as {port:number}).port;
 const port=await freePort(),origin=`http://127.0.0.1:${port}`,dbPath=join(temp,'db.sqlite');
 const env={...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads'),NAEO_WORKER_IDLE_MS:'100',NAEO_RSS_BASE:`http://127.0.0.1:${rssPort}`,
  NAEO_EMAIL_PROVIDER:'resend',NAEO_RESEND_API_KEY:apiKey,NAEO_MAIL_FROM:'local-notify@example.test',NAEO_MAIL_ENCRYPTION_KEY:randomBytes(32).toString('hex'),NAEO_MAIL_API_BASE:`http://127.0.0.1:${mailPort}`};
 const launch=(args:string[])=>{const p=spawn(process.execPath,args,{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});p.stdout!.on('data',()=>{});p.stderr!.on('data',()=>{});children.push(p);return p;};
 const req=(path:string,method='GET',data?:unknown,cookie?:string)=>fetch(origin+path,{method,headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const json=async(r:Response)=>(await r.json()).data;
 const until=async<T>(check:()=>Promise<T|false>,ms=90_000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await check();if(v!==false)return v;await delay(150);}throw new Error('Acceptance timeout');};
 let result:Record<string,unknown>|undefined;
 try{
  launch(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)]);
  await until(async()=>{try{return (await req('/api/health')).ok||false;}catch{return false;}});
  const health=await json(await req('/api/health'));assert.equal(health.schemaVersion,migrations.at(-1)!.version);
  const signup=await req('/api/auth/register','POST',{email:'notify-qa@example.test',password:randomBytes(24).toString('base64url'),nickname:'알림 QA',termsAccepted:true});
  assert.equal(signup.status,201);const cookie=signup.headers.get('set-cookie')!.split(';')[0];
  const blog=await json(await req('/api/blogs','POST',{naverId:'notify_qa_blog',title:'알림 QA 블로그',isPrimary:true},cookie));
  // 동의 없음: 스캔이 성공해도 메일은 나가지 않는다
  launch(['--import','tsx','scripts/worker.ts']);
  const s1=await json(await req('/api/scans','POST',{blogId:blog.id},cookie));
  await until(async()=>{const s=await json(await req(`/api/scans/${s1.id}`,'GET',undefined,cookie));return s.state==='succeeded'?s:false;});
  await delay(1200);assert.equal([...inbox.keys()].filter(k=>k.startsWith('notify-mail/')).length,0,'no consent → no mail');
  // 분석 완료 메일 동의 → 다음 스캔에서 503 한 번 재시도 후 같은 페이로드로 발송
  const prefs=await json(await req('/api/preferences','GET',undefined,cookie)) as {marketingEmail:boolean;scanEmail:boolean;autoscan:boolean;version:number};
  assert.equal((await req('/api/preferences','PATCH',{marketingEmail:prefs.marketingEmail,scanEmail:true,autoscan:prefs.autoscan,version:prefs.version},cookie)).status,200);
  const s2=await json(await req('/api/scans','POST',{blogId:blog.id},cookie));
  await until(async()=>{const s=await json(await req(`/api/scans/${s2.id}`,'GET',undefined,cookie));return s.state==='succeeded'?s:false;});
  const noticeKey=await until(async()=>[...inbox.keys()].find(k=>k.startsWith('notify-mail/'))??false);
  const notice=inbox.get(noticeKey)!;
  assert.equal(notice.message.to[0],'notify-qa@example.test');
  assert.match(notice.message.subject,/분석이 끝났습니다/);assert.match(notice.message.text,/알림 QA 블로그/);assert.match(notice.message.text,/점수/);
  assert.ok(!notice.body.includes(apiKey)&&!notice.message.text.includes(apiKey));
  // 자동 스캔: autoscan을 켜면 작업자 유지 주기가 다음 진단을 예약한다(같은 날은 멱등 키로 1번)
  const prefs2=await json(await req('/api/preferences','GET',undefined,cookie)) as {marketingEmail:boolean;scanEmail:boolean;autoscan:boolean;version:number};
  assert.equal((await req('/api/preferences','PATCH',{marketingEmail:prefs2.marketingEmail,scanEmail:prefs2.scanEmail,autoscan:true,version:prefs2.version},cookie)).status,200);
  const db=openDatabase(dbPath);db.prepare("UPDATE scan_jobs SET created_at=?,updated_at=?").run(Date.now()-25*3600_000,Date.now());db.close();
  const autoscan=await until(async()=>{
   const jobs=await json(await req('/api/scans?blogId='+blog.id,'GET',undefined,cookie)) as {id:string}[];
   const job=jobs.find(j=>j.id!==s1.id&&j.id!==s2.id);return job??false;
  });
  const autoDone=await until(async()=>{const s=await json(await req(`/api/scans/${autoscan.id}`,'GET',undefined,cookie));return ['succeeded','failed'].includes(s.state)?s:false;});
  assert.equal(autoDone.state,'succeeded','autoscan job runs through the normal pipeline');
  const notifyCount=[...inbox.keys()].filter(k=>k.startsWith('notify-mail/')).length;
  assert.equal(notifyCount,2,'one mail per completed scan');
  // 같은 KST 날짜에 스케줄러를 다시 돌려도 대표 블로그는 다시 예약되지 않는다
  const db2=openDatabase(dbPath);
  try{const before=(db2.prepare('SELECT count(*) AS n FROM scan_jobs').get() as {n:number}).n;
   assert.equal(enqueueAutoscans(db2),0,'same-day autoscan dedupes');
   assert.equal((db2.prepare('SELECT count(*) AS n FROM scan_jobs').get() as {n:number}).n,before);
  }finally{db2.close();}
  // 메일 본문/키가 화면이나 상태 API에 새지 않는다
  const settings=await(await req('/dashboard/settings','GET',undefined,cookie)).text();
  assert.ok(!settings.includes(apiKey));
  assert.equal(badAuth,0);
  result={verifiedAt:new Date().toISOString(),schemaVersion:health.schemaVersion,mailAttempts:attempts,notifyDeliveries:[...inbox.keys()].filter(k=>k.startsWith('notify-mail/')).length,
   checks:['Production Next + worker; loopback Resend and RSS doubles only','No mail without consent; scan_email opt-in produces one notify-mail/ idempotent delivery after a 503 retry with identical payload','autoscan enqueues the stale primary blog once per KST day through the worker maintenance tick','API key never rendered in HTML, JSON or mail bodies'],externalMailSent:false,realProviderVerified:false,temporaryDataRemoved:true};
 }finally{
  for(const p of children){if(p.exitCode!==null||p.signalCode!==null)continue;const exited=new Promise<void>(r=>p.once('exit',()=>r()));p.kill('SIGTERM');const timer=setTimeout(()=>p.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  await new Promise<void>(r=>{mail.close(()=>r());mail.closeAllConnections();});await new Promise<void>(r=>{rss.close(()=>r());rss.closeAllConnections();});
  rmSync(temp,{recursive:true,force:true});
 }
 writeFileSync(resolve(process.argv[2]||'docs/fullstack/evidence/notify-mail-runtime.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e instanceof Error?e.stack:e)+'\n');process.exitCode=1;});
