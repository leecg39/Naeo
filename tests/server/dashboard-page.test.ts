import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {createPlan} from '../../src/server/billing/plans';
import {startTrial} from '../../src/server/billing/subscriptions';
import {enqueueScan,claimNextScan,DAILY_SCAN_LIMIT,remainingScansToday} from '../../src/server/jobs/queue';
import {saveScanResult} from '../../src/server/analysis/results';
import {analyzePosts,type PostSample} from '../../src/server/analysis/rules';
import {buildDashboardPage} from '../../src/server/analysis/dashboard-page';
import type {CapturedNode} from '../../src/types/site';

const DAY=86_400_000;
const NOW=Date.parse('2026-10-13T03:00:00Z');
type El=Exclude<CapturedNode,string>;
const all=(nodes:CapturedNode[],f:(n:El)=>boolean,out:El[]=[]):El[]=>{for(const n of nodes){if(typeof n==='string')continue;if(f(n))out.push(n);all(n.children,f,out);}return out;};
const text=(n:CapturedNode):string=>typeof n==='string'?n:n.children.map(text).join('');
const byClass=(nodes:CapturedNode[],c:string)=>all(nodes,n=>(n.attrs.class??'').split(/\s+/).includes(c));

async function fixture(t:TestContext,nickname='진단회원'){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const user=(await register(db,{email:'dash@example.test',password:'dashboard-long-password',nickname,termsAccepted:true})).user;
 return{db,user:user.id};
}
function capturedDataGone(body:CapturedNode[]){
 assert.equal(all(body,n=>(n.attrs['aria-label']??'').endsWith('AI 브리핑 캡처 상세보기')).length,0,'captured AI briefing cards removed');
 assert.equal(all(body,n=>(n.attrs.href??'').includes('naeo_blog')).length,0,'captured feed links removed');
 assert.equal(all(body,n=>(n.attrs.href??'').startsWith('/dashboard/ai-picks?open=')).length,0,'captured to-do links removed');
 assert.ok(!byClass(body,'mui-1c2fwzk').some(n=>/\d/.test(text(n))),'no captured rank numbers');
}
function saveResult(db:Database,user:string,blog:string,posts:PostSample[],at:number){
 const job=enqueueScan(db,user,{blogId:blog},at);
 db.prepare("UPDATE scan_jobs SET state='succeeded',completed_at=? WHERE id=?").run(at,job.id);
 return saveScanResult(db,{ownerId:user,blogId:blog,jobId:job.id,report:analyzePosts(posts,at),postCount:posts.length,measuredAt:at});
}

test('no blog connected: guidance instead of captured data, scan points to settings',async t=>{
 const {db,user}=await fixture(t);
 const page=await buildDashboardPage(db,user,NOW);
 capturedDataGone(page.body);
 assert.equal(page.dashboardOverview?.subject,null);
 assert.equal(page.dashboardOverview?.metrics.cited,null);
 assert.equal(all(page.body,n=>n.attrs['data-naeo-slot']==='dashboard-overview').length,1);
 const scan=all(page.body,n=>n.tag==='button'&&text(n).includes('블로그 스캔'))[0];
 assert.equal(scan.attrs['data-scan-blog'],'');
 assert.equal(text(byClass(page.body,'mui-fga7wp')[0]),'@진단회원');
});

test('blog without results shows first-scan state with the real daily quota',async t=>{
 const {db,user}=await fixture(t);
 const blog=createBlog(db,user,{naverId:'dash_blog',title:'내 여행 블로그',category:'여행',isPrimary:true});
 const page=await buildDashboardPage(db,user,NOW);
 capturedDataGone(page.body);
 assert.equal(text(byClass(page.body,'mui-4b4sse')[0]),'내 여행 블로그');
 assert.equal(text(byClass(page.body,'mui-1m5dz0o')[0]),'여행');
 assert.match(text(byClass(page.body,'mui-zhxvjz')[0]),/아직 스캔 기록이 없습니다/);
 assert.equal(text(byClass(page.body,'mui-tgveqo')[0]),`오늘 ${DAILY_SCAN_LIMIT}회 남음`);
 assert.equal(page.dashboardOverview?.subject?.naverId,'dash_blog');
 assert.equal(page.dashboardOverview?.metrics.checked,null);
 assert.equal(page.dashboard?.history.length,0);
 const scan=all(page.body,n=>n.tag==='button'&&n.attrs['data-scan-blog']!==undefined)[0];
 assert.equal(scan.attrs['data-scan-blog'],blog.id);
});

test('results drive the live overview, diagnosis details, actionable to-dos and change feed',async t=>{
 const {db,user}=await fixture(t);
 const blog=createBlog(db,user,{naverId:'dash_blog',title:'블로그',category:'',isPrimary:true});
 const weak:PostSample[]=[{title:'짧음',category:'일상',tags:[],publishedAt:NOW-40*DAY}];
 const strong:PostSample[]=Array.from({length:10},(_,i)=>({title:'제주 3박4일 여행 코스 총정리 '+i,category:'여행',tags:['a','b','c'],publishedAt:NOW-i*DAY}));
 saveResult(db,user,blog.id,weak,NOW-3*DAY);
 saveResult(db,user,blog.id,strong,NOW-2*3600_000);
 const page=await buildDashboardPage(db,user,NOW);
 capturedDataGone(page.body);
 const latest=analyzePosts(strong,NOW-2*3600_000);
 assert.equal(all(page.body,n=>n.attrs['data-naeo-slot']==='dashboard-overview').length,1);
 assert.equal(page.dashboardOverview?.metrics.cited,null,'diagnosis scores do not masquerade as citation metrics');
 assert.equal(page.dashboard?.history.length,2,'one measurement per scan, for the interactive chart');
 assert.equal(page.dashboard?.history[0].score,latest.score);
 assert.equal(all(page.body,n=>(n.attrs.class??'').includes('recharts-surface')).length,0,'no captured chart values remain');
 const feed=page.dashboardOverview!.changes;
 assert.equal(feed.length,2);
 assert.equal(feed[0].at,NOW-2*3600_000);assert.equal(feed[1].at,NOW-3*DAY);
 assert.match(feed[0].title,new RegExp(`${latest.score}점`));
 assert.match(text(byClass(page.body,'mui-zhxvjz')[0]),/2시간 전/);
 const todo=byClass(page.body,'mui-kz80vq')[0];
 assert.equal(byClass([todo],'mui-oajxy2').length,Math.max(1,latest.actions.length));
 assert.equal(page.dashboardOverview?.citationState,'not_configured');
});

test('running scan is reflected on the scan button for polling',async t=>{
 const {db,user}=await fixture(t);
 const blog=createBlog(db,user,{naverId:'dash_blog',title:'블로그',category:'',isPrimary:true});
 const job=enqueueScan(db,user,{blogId:blog.id},NOW);
 claimNextScan(db,'w',NOW);
 const page=await buildDashboardPage(db,user,NOW);
 const scan=all(page.body,n=>n.attrs['data-scan-blog']!==undefined)[0];
 assert.equal(scan.attrs['data-scan-job'],job.id);
 assert.match(text(scan),/진단 중/);
});

test('daily scan quota (KST day) is enforced and shown',async t=>{
 const {db,user}=await fixture(t);
 const blog=createBlog(db,user,{naverId:'dash_blog',title:'블로그',category:'',isPrimary:true});
 for(let i=0;i<DAILY_SCAN_LIMIT;i++){
  const j=enqueueScan(db,user,{blogId:blog.id},NOW+i);
  db.prepare("UPDATE scan_jobs SET state='canceled' WHERE id=?").run(j.id);
 }
 assert.equal(remainingScansToday(db,user,NOW+100),0);
 assert.throws(()=>enqueueScan(db,user,{blogId:blog.id},NOW+100),{status:429,code:'SCAN_QUOTA_EXCEEDED'});
 const kstMidnight=Date.parse('2026-10-13T15:00:00Z');
 assert.equal(remainingScansToday(db,user,kstMidnight),DAILY_SCAN_LIMIT,'quota resets at KST midnight');
});

test('user-controlled text is never interpreted as HTML',async t=>{
 const {db,user}=await fixture(t,'<img src=x onerror=alert(1)>');
 createBlog(db,user,{naverId:'dash_blog',title:'<script>alert(1)</script>',category:'',isPrimary:true});
 const page=await buildDashboardPage(db,user,NOW);
 assert.equal(all(page.body,n=>n.tag==='script').length,0);
 assert.ok(!JSON.stringify(page.body).includes('"onerror"'));
});

test('ranking cards show my real rank when I opted into the public ranking',async t=>{
 const {db,user}=await fixture(t);
 const blog=createBlog(db,user,{naverId:'dash_blog',title:'블로그',category:'여행',isPrimary:true});
 saveResult(db,user,blog.id,[{title:'제주 3박4일 여행 코스 총정리',category:'여행',tags:['a','b','c'],publishedAt:NOW-DAY}],NOW-3600_000);
 const hidden=await buildDashboardPage(db,user,NOW);
 assert.ok(hidden.dashboardOverview?.rankings[0].cards.every(c=>!c.public&&c.rank===null),'private by default');
 db.prepare('UPDATE profiles SET ranking_public=1 WHERE user_id=?').run(user);
 const page=await buildDashboardPage(db,user,NOW);
 assert.deepEqual(page.dashboardOverview?.rankings[0].cards.map(c=>c.rank),[1,1,1]);
 assert.ok(page.dashboardOverview?.rankings[0].cards.every(c=>c.participants===1));
});


test('header reflects the active trial and removes D-day after expiry',async t=>{
 const {db,user}=await fixture(t);
 createBlog(db,user,{naverId:'trial_blog',title:'체험 블로그',isPrimary:true});
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user);
 createPlan(db,user,{code:'basic',name:'베이직',price:9900,monthlyTokens:750,trialDays:7});
 const trial=startTrial(db,user,{planCode:'basic'},NOW);
 const page=await buildDashboardPage(db,user,NOW);
 assert.equal(text(byClass(page.body,'mui-1j3i02f')[0]),`${trial.planName} 체험`);
 assert.equal(text(byClass(page.body,'mui-h0mlsf')[0]),`D-${Math.ceil((trial.currentPeriodEnd-NOW)/DAY)}`);
 const expired=await buildDashboardPage(db,user,trial.currentPeriodEnd);
 assert.equal(text(byClass(expired.body,'mui-1j3i02f')[0]),'무료 이용');
 assert.equal(byClass(expired.body,'mui-h0mlsf').length,0);
});
