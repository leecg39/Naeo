import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {balance} from '../../src/server/credits/ledger';
import {createEvent,updateEvent,deleteEvent,listPublicEvents,getPublicEvent,listAdminEvents,eventBySlug} from '../../src/server/events/events';
import {submitEntry,updateMyEntry,withdrawEntry,myEntries,listEventEntries,reviewEntry} from '../../src/server/events/entries';
import {listRewards,grantReward,revokeReward,grantRankingRewards,eventWinners} from '../../src/server/events/rewards';
import {confirmPeriod,periodRange} from '../../src/server/ranking/ranking';
import {saveScanResult} from '../../src/server/analysis/results';
import {analyzePosts} from '../../src/server/analysis/rules';
import {loadValidPage} from '../../src/components/admin/pagination';

const NOW=Date.parse('2026-10-14T03:00:00Z');
const DAY=86_400_000;
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const mk=async(email:string,nickname:string)=>(await register(db,{email,password:'event-long-password',nickname,termsAccepted:true})).user.id;
 const admin=await mk('admin@example.test','관리자'),a=await mk('a@example.test','A'),b=await mk('b@example.test','B');
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);
 createBlog(db,a,{naverId:'a_blog',title:'A',category:'',isPrimary:true});
 return{db,admin,a,b};
}
const audits=(db:Database,action:string)=>(db.prepare('SELECT count(*) AS n FROM audit_logs WHERE action=?').get(action) as {n:number}).n;
const ev=(over:Record<string,unknown>={})=>({slug:'review-2026-10',title:'사용 후기 이벤트',summary:'후기를 쓰면 토큰을 드려요',status:'published',startsAt:new Date(NOW-DAY).toISOString(),endsAt:new Date(NOW+7*DAY).toISOString(),requiresProof:true,rewardTokens:15,...over});

test('event selection filters before pagination and finds the 101st eligible event behind ineligible rows',async t=>{
 const {db,admin,a}=await fixture(t);
 for(let i=0;i<101;i++){
  createEvent(db,admin,ev({slug:`eligible-${i}`,title:`Eligible ${i}`,startsAt:new Date(NOW-DAY-i).toISOString()}));
  createEvent(db,admin,ev({slug:`ineligible-${i}`,acceptsEntries:false,startsAt:new Date(NOW).toISOString()}));
 }
 const page=listAdminEvents(db,admin,{acceptsEntries:'true',page:6,pageSize:20});assert.equal(page.pagination.total,101);assert.equal(page.data.length,1);assert.equal(page.data[0].slug,'eligible-100');
 assert.equal(eventBySlug(db,'eligible-100')?.id,page.data[0].id);
 assert.equal(listAdminEvents(db,admin,{acceptsEntries:'false'}).pagination.total,101);
 assert.equal(listAdminEvents(db,admin,{acceptsEntries:'true',q:'Eligible 100'}).pagination.total,1);
 assert.throws(()=>listAdminEvents(db,a,{acceptsEntries:'true'}),{status:403});
 assert.throws(()=>listAdminEvents(db,admin,{acceptsEntries:'yes'}),{name:'ZodError'});
 const last=page.data[0];updateEvent(db,admin,last.id,{version:1,title:'Updated'});deleteEvent(db,admin,last.id,{version:2});
 const recovered=await loadValidPage(async p=>listAdminEvents(db,admin,{acceptsEntries:'true',page:p,pageSize:20}),6);
 assert.equal(recovered.pagination.page,5);assert.equal(recovered.pagination.total,100);
});

test('reward page two remains actionable and revoked filter returns to the previous page',async t=>{
 const {db,admin,a}=await fixture(t),before=balance(db,a);
 for(let i=0;i<101;i++)grantReward(db,admin,{email:'a@example.test',tokens:1,description:`pagination-${i}`});
 const fetchPage=async(page:number)=>listRewards(db,admin,{page,pageSize:100,status:'granted',kind:'manual'});
 const first=await fetchPage(1),second=await loadValidPage(fetchPage,2);assert.equal(first.data.length,100);assert.equal(second.data.length,1);
 assert.ok(!first.data.some(r=>r.id===second.data[0].id));
 revokeReward(db,admin,second.data[0].id,{version:second.data[0].version});
 const back=await loadValidPage(fetchPage,2);assert.equal(back.pagination.page,1);assert.equal(back.pagination.total,100);assert.equal(balance(db,a),before+100);
});

test('entry page two can be reviewed and submitted filter recovers without changing another event',async t=>{
 const {db,admin}=await fixture(t);
 createEvent(db,admin,ev({requiresProof:false}));
 createEvent(db,admin,ev({slug:'other-event',requiresProof:false}));
 for(let i=0;i<101;i++){
  const {user}=await register(db,{email:`paging-${i}@example.test`,password:'pagination-password-long',nickname:`회원${i}`,termsAccepted:true});
  submitEntry(db,user.id,'review-2026-10',{note:`참여${i}`},NOW);
 }
 const fetchPage=async(page:number)=>listEventEntries(db,admin,'review-2026-10',{status:'submitted',page,pageSize:100});
 const first=await fetchPage(1),second=await loadValidPage(fetchPage,2);assert.equal(first.data.length,100);assert.equal(second.data.length,1);
 const entry=second.data[0],before=balance(db,entry.userId);
 reviewEntry(db,admin,entry.id,{decision:'approved',note:'확인',version:entry.version});
 const back=await loadValidPage(fetchPage,2);assert.equal(back.pagination.page,1);assert.equal(back.pagination.total,100);assert.equal(balance(db,entry.userId),before+15);
 assert.equal(listEventEntries(db,admin,'other-event',{}).pagination.total,0);
 assert.equal(listEventEntries(db,admin,'review-2026-10',{status:'approved'}).pagination.total,1);
});

test('admin event CRUD with slug uniqueness, versions and public visibility',async t=>{
 const {db,admin,a}=await fixture(t);
 assert.throws(()=>createEvent(db,a,ev()),{status:403});
 const e=createEvent(db,admin,ev({status:'draft'}));
 assert.equal(getPublicEvent(db,'review-2026-10'),null,'drafts are not public');
 assert.throws(()=>createEvent(db,admin,ev()),{status:409,code:'SLUG_EXISTS'});
 assert.throws(()=>createEvent(db,admin,ev({slug:'Bad Slug'})),{name:'ZodError'});
 assert.throws(()=>createEvent(db,admin,ev({slug:'x2',endsAt:new Date(NOW-2*DAY).toISOString()})),{name:'ZodError'},'end before start');
 const pub=updateEvent(db,admin,e.id,{status:'published',version:1});
 assert.equal(pub.version,2);
 assert.equal(listPublicEvents(db,NOW).map(x=>x.slug).join(),'review-2026-10');
 assert.equal(getPublicEvent(db,'review-2026-10',NOW)?.phase,'open');
 assert.throws(()=>updateEvent(db,admin,e.id,{title:'x',version:1}),{status:409,code:'VERSION_CONFLICT'});
 assert.equal(listAdminEvents(db,admin,{}).pagination.total,1);
 deleteEvent(db,admin,e.id,{version:2});
 assert.equal(getPublicEvent(db,'review-2026-10'),null);
 for(const x of ['admin.event.create','admin.event.update','admin.event.delete'])assert.ok(audits(db,x)>=1,x);
});

test('entries: login, period, own-blog proof, one per member, edit/withdraw before review',async t=>{
 const {db,admin,a,b}=await fixture(t);
 createEvent(db,admin,ev());
 assert.throws(()=>submitEntry(db,a,'review-2026-10',{proofUrl:'https://evil.example/x'},NOW),{name:'ZodError'});
 assert.throws(()=>submitEntry(db,a,'review-2026-10',{proofUrl:'https://blog.naver.com/someone_else/223000000001'},NOW),{status:400,code:'PROOF_NOT_OWN_BLOG'});
 assert.throws(()=>submitEntry(db,b,'review-2026-10',{proofUrl:'https://blog.naver.com/b_blog/223000000001'},NOW),{status:400,code:'PROOF_NOT_OWN_BLOG'},'B has no registered blog');
 const entry=submitEntry(db,a,'review-2026-10',{proofUrl:'https://m.blog.naver.com/a_blog/223000000001?x=1',note:'후기 썼어요'},NOW);
 assert.equal(entry.status,'submitted');assert.equal(entry.proofUrl,'https://blog.naver.com/a_blog/223000000001');
 assert.throws(()=>submitEntry(db,a,'review-2026-10',{proofUrl:'https://blog.naver.com/a_blog/223000000002'},NOW),{status:409,code:'ALREADY_ENTERED'});
 assert.equal(updateMyEntry(db,a,entry.id,{note:'고쳤어요',version:1}).version,2);
 assert.throws(()=>updateMyEntry(db,b,entry.id,{note:'x',version:2}),{status:404});
 assert.equal(withdrawEntry(db,a,entry.id,{version:2}).status,'withdrawn');
 const again=submitEntry(db,a,'review-2026-10',{proofUrl:'https://blog.naver.com/a_blog/223000000003'},NOW);
 assert.equal(again.status,'submitted','can re-enter after withdrawing');
 assert.throws(()=>submitEntry(db,a,'review-2026-10',{proofUrl:'https://blog.naver.com/a_blog/1'},NOW+8*DAY),{status:409});
 createEvent(db,admin,ev({slug:'closed-one',status:'closed'}));
 assert.throws(()=>submitEntry(db,a,'closed-one',{proofUrl:'https://blog.naver.com/a_blog/1'},NOW),{status:409,code:'EVENT_NOT_OPEN'});
 createEvent(db,admin,ev({slug:'info-only',acceptsEntries:false,ctaLabel:'랭킹 보기',ctaHref:'/ranking'}));
 assert.throws(()=>submitEntry(db,a,'info-only',{proofUrl:'https://blog.naver.com/a_blog/1'},NOW),{status:409,code:'ENTRIES_DISABLED'});
 assert.throws(()=>createEvent(db,admin,ev({slug:'bad-cta',ctaHref:'//evil.example'})),{name:'ZodError'},'external CTA links rejected');
 assert.throws(()=>createEvent(db,admin,ev({slug:'bad-cta2',ctaHref:'https://evil.example'})),{name:'ZodError'});
 assert.equal(myEntries(db,a).length,2);
});

test('review grants reward tokens exactly once; rejection and re-review are safe; revoke takes tokens back',async t=>{
 const {db,admin,a}=await fixture(t);
 createEvent(db,admin,ev());
 const entry=submitEntry(db,a,'review-2026-10',{proofUrl:'https://blog.naver.com/a_blog/223000000001'},NOW);
 assert.throws(()=>reviewEntry(db,a,entry.id,{decision:'approved',version:1}),{status:403});
 const approved=reviewEntry(db,admin,entry.id,{decision:'approved',note:'확인',version:1});
 assert.equal(approved.status,'approved');
 assert.equal(balance(db,a),15);
 assert.throws(()=>reviewEntry(db,admin,entry.id,{decision:'approved',version:1}),{status:409},'stale review');
 assert.throws(()=>updateMyEntry(db,a,entry.id,{note:'x',version:2}),{status:409,code:'ENTRY_REVIEWED'});
 const rejected=reviewEntry(db,admin,entry.id,{decision:'rejected',note:'중복 글',version:2});
 assert.equal(rejected.status,'rejected');
 assert.equal(balance(db,a),0,'reward revoked when approval is reversed');
 reviewEntry(db,admin,entry.id,{decision:'approved',version:3});
 assert.equal(balance(db,a),15,'re-approval grants again once');
 assert.equal(listEventEntries(db,admin,'review-2026-10',{}).data[0].ownerEmail,'a@example.test');
 const rewards=listRewards(db,admin,{});
 assert.equal(rewards.data.filter(r=>r.status==='granted').length,1);
});

test('manual rewards and idempotent ranking rewards for a confirmed week',async t=>{
 const {db,admin,a,b}=await fixture(t);
 const r=grantReward(db,admin,{userId:b,tokens:5,description:'수동 지급'});
 assert.equal(balance(db,b),5);
 assert.equal(grantReward(db,admin,{email:'B@example.test',tokens:1,description:'이메일 지정'}).userId,b);
 assert.throws(()=>grantReward(db,admin,{email:'none@example.test',tokens:1,description:'x'}),{status:404});
 assert.throws(()=>grantReward(db,admin,{tokens:1,description:'x'}),{name:'ZodError'});
 revokeReward(db,admin,r.id,{version:1});
 assert.equal(balance(db,b),1);
 assert.throws(()=>revokeReward(db,admin,r.id,{version:2}),{status:409});
 db.prepare('UPDATE profiles SET ranking_public=1 WHERE user_id=?').run(a);
 const blogId=(db.prepare('SELECT id FROM blogs WHERE owner_id=?').get(a) as {id:string}).id;
 const last=periodRange('week',-1,NOW);
 db.prepare("INSERT INTO scan_jobs(id,owner_id,blog_id,state,run_after,created_at,updated_at) VALUES('j1',?,?,'succeeded',0,0,0)").run(a,blogId);
 saveScanResult(db,{ownerId:a,blogId,jobId:'j1',report:analyzePosts([],last.start+DAY),postCount:0,measuredAt:last.start+DAY});
 assert.throws(()=>grantRankingRewards(db,admin,{period:'week',offset:-1,top:3,tokens:10},NOW),{status:409,code:'PERIOD_NOT_CONFIRMED'});
 confirmPeriod(db,'week',-1,NOW);
 assert.equal(grantRankingRewards(db,admin,{period:'week',offset:-1,top:3,tokens:10},NOW).granted,1);
 assert.equal(grantRankingRewards(db,admin,{period:'week',offset:-1,top:3,tokens:10},NOW).granted,0,'second run grants nothing');
 assert.equal(balance(db,a),10);
 assert.ok(audits(db,'admin.reward.ranking')>=2);
});

test('clock boundaries: start is inclusive, end is exclusive (KST times stored as instants)',async t=>{
 const {db,admin,a}=await fixture(t);
 const start=Date.parse('2026-10-15T00:00:00+09:00'),end=Date.parse('2026-10-16T00:00:00+09:00');
 createEvent(db,admin,ev({slug:'edge',startsAt:'2026-10-15T00:00:00+09:00',endsAt:'2026-10-16T00:00:00+09:00'}));
 const proof={proofUrl:'https://blog.naver.com/a_blog/9'};
 assert.throws(()=>submitEntry(db,a,'edge',proof,start-1),{code:'EVENT_NOT_OPEN'},'1ms before start');
 assert.equal(getPublicEvent(db,'edge',start-1)?.phase,'upcoming');
 const e=submitEntry(db,a,'edge',proof,start);
 assert.equal(updateMyEntry(db,a,e.id,{note:'막차',version:1},end-1).version,2,'editable until the last millisecond');
 assert.throws(()=>updateMyEntry(db,a,e.id,{note:'늦음',version:2},end),{code:'EVENT_NOT_OPEN'});
 assert.equal(getPublicEvent(db,'edge',end)?.phase,'ended');
});

test('concurrent approvals: the same version approves once and the ledger is written once',async t=>{
 const {db,admin,a}=await fixture(t);
 createEvent(db,admin,ev());
 const e=submitEntry(db,a,'review-2026-10',{proofUrl:'https://blog.naver.com/a_blog/1'},NOW);
 const results=[0,1].map(()=>{try{return reviewEntry(db,admin,e.id,{decision:'approved',version:1},NOW).status;}catch(err){return (err as {code:string}).code;}});
 assert.deepEqual(results,['approved','VERSION_CONFLICT']);
 assert.equal(balance(db,a),15);
 assert.equal((db.prepare("SELECT count(*) AS n FROM credit_ledger WHERE ref_type='reward'").get() as {n:number}).n,1);
 const reward=db.prepare("SELECT * FROM rewards WHERE status='granted'").get() as Record<string,unknown>;
 assert.throws(()=>db.prepare("INSERT INTO rewards(id,user_id,kind,tokens,description,source_key,created_at) VALUES('dup',?, 'event',15,'x',?,0)").run(a,reward.source_key as string),/UNIQUE/,'database refuses a second active reward for the same source');
});

test('gift rewards and public winners list (masked nicknames)',async t=>{
 const {db,admin,a,b}=await fixture(t);
 const event=createEvent(db,admin,ev());
 const gift=grantReward(db,admin,{userId:b,item:'커피 쿠폰',description:'후기 우수상',eventSlug:'review-2026-10'});
 assert.equal(gift.kind,'gift');assert.equal(gift.tokens,0);assert.equal(balance(db,b),0,'gifts do not touch the token ledger');
 assert.throws(()=>grantReward(db,admin,{userId:b,tokens:1,item:'둘 다',description:'x'}),{name:'ZodError'});
 assert.throws(()=>grantReward(db,admin,{userId:b,tokens:1,description:'x',eventSlug:'no-such-event'}),{status:404});
 const e=submitEntry(db,a,'review-2026-10',{proofUrl:'https://blog.naver.com/a_blog/1'},NOW);
 reviewEntry(db,admin,e.id,{decision:'approved',version:1},NOW);
 const list=eventWinners(db,event.id);
 assert.deepEqual(list.map(w=>[w.nickname,w.kind]).sort(),[['A','event'],['B','gift']].map(([n,k])=>[n.length===1?'*':n,k]).sort());
 revokeReward(db,admin,gift.id,{version:1});
 assert.equal(eventWinners(db,event.id).length,1,'revoked rewards leave the winners list');
});
