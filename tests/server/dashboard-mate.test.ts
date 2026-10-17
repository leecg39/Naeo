import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {diagnoseBlog,deleteMateReport} from '../../src/server/mate/mate';
import {dashboardData} from '../../src/server/analysis/dashboard-data';
import {buildDashboardPage} from '../../src/server/analysis/dashboard-page';
import {buildMateDashboardPage} from '../../src/server/mate/mate-dashboard';
import {saveScanResult} from '../../src/server/analysis/results';
import {analyzePosts} from '../../src/server/analysis/rules';
import {enqueueScan} from '../../src/server/jobs/queue';
import type {CapturedNode} from '../../src/types/site';

const NOW=Date.parse('2026-10-17T03:00:00Z'),DAY=86400000;
const text=(n:CapturedNode):string=>typeof n==='string'?n:n.children.map(text).join('');
const feed=(id:string)=>async()=>new Response(`<rss><channel><title>진단 블로그</title><item><title>짧은 글</title><link>https://blog.naver.com/${id}/123456</link><category>여행</category><pubDate>${new Date(NOW-50*DAY).toUTCString()}</pubDate></item></channel></rss>`);
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const a=(await register(db,{email:'dashboard-mate@example.test',password:'dashboard-mate-password',nickname:'진단 사용자',termsAccepted:true})).user.id;
 const b=(await register(db,{email:'other-mate@example.test',password:'dashboard-mate-password',nickname:'다른 사용자',termsAccepted:true})).user.id;
 const diagnose=(owner:string|null,id='tested_blog',at=NOW)=>diagnoseBlog(db,{blog:id,peer:`${owner}-${id}-${at}`,userId:owner},feed(id),at);
 return{db,a,b,diagnose};
}
function scan(db:Database,owner:string,blog:string,at:number){
 const job=enqueueScan(db,owner,{blogId:blog},at);
 db.prepare("UPDATE scan_jobs SET state='succeeded',completed_at=? WHERE id=?").run(at,job.id);
 return saveScanResult(db,{ownerId:owner,blogId:blog,jobId:job.id,report:analyzePosts([],at),postCount:0,measuredAt:at});
}

test('an actual free diagnosis appears on dashboard without connecting a blog or re-scanning',async t=>{
 const {db,a,diagnose}=await fixture(t);
 const report=await diagnose(a);
 const page=await buildDashboardPage(db,a,NOW+1000),data=page.dashboard!;
 assert.equal(data.connected,false);assert.equal(data.subject?.naverId,report.naverId);
 assert.equal(data.history.length,1);assert.equal(data.history[0].source,'mate');
 assert.equal(data.history[0].score,report.report.score);assert.deepEqual(data.history[0].criteria,report.report.criteria);
 assert.equal(data.history[0].postCount,1);
 const body=page.body.map(text).join('');
 assert.equal(page.dashboardOverview?.subject?.naverId,report.naverId);
 assert.equal(page.dashboardOverview?.metrics.checked,null);
 assert.equal(page.dashboardOverview?.changes[0].title,`무료 진단 ${report.report.score}점`);
 assert.match(body,/마지막 진단:/);assert.match(body,/진단 개선 할 일/);
 assert.ok(!body.includes('모든 기준을 충족했습니다'));
 for(const action of report.report.actions)assert.ok(body.includes(action.title));
 assert.equal((db.prepare('SELECT count(*) AS n FROM blogs').get() as {n:number}).n,0,'reading dashboard never creates or modifies blog connections');
 const history=await buildMateDashboardPage(db,a,NOW);
 assert.ok(JSON.stringify(history).includes(`/dashboard?blog=${report.naverId}`));
});

test('same-blog scans and free reports merge chronologically; newest report controls recommendations',async t=>{
 const {db,a,diagnose}=await fixture(t);
 const blog=createBlog(db,a,{naverId:'tested_blog',title:'연결된 블로그',isPrimary:true});
 const old=scan(db,a,blog.id,NOW-2*DAY);
 const report=await diagnose(a,'tested_blog',NOW-DAY);
 let data=dashboardData(db,a,NOW);
 assert.equal(data.blog?.id,blog.id);assert.deepEqual(data.history.map(p=>p.id),[`mate:${report.token}`,old]);
 assert.equal(data.actions.length,0,'older scan actions must not replace the latest free report recommendations');
 assert.equal(data.posts30,null,'free reports have no saved publication timestamps');
 const newest=scan(db,a,blog.id,NOW);
 data=dashboardData(db,a,NOW);
 assert.deepEqual(data.history.map(p=>p.id),[newest,`mate:${report.token}`,old]);
 assert.ok(data.actions.length>0);assert.ok(data.actions.every(a=>a.resultId===newest));
 assert.equal(data.posts30,0,'a measured empty scan is an actual zero');
});

test('selecting a diagnosed blog isolates records, scan controls, recommendations and AI results',async t=>{
 const {db,a,diagnose}=await fixture(t);
 const primary=createBlog(db,a,{naverId:'primary_blog',title:'대표 블로그',isPrimary:true});
 const secondary=createBlog(db,a,{naverId:'secondary_blog',title:'보조 블로그'});
 const primaryId=scan(db,a,primary.id,NOW-2*DAY);
 const secondaryId=scan(db,a,secondary.id,NOW-DAY);
 const report=await diagnose(a,'free_blog');
 assert.equal(dashboardData(db,a,NOW).history[0].id,primaryId,'default preserves a primary blog with results');
 const secondaryData=dashboardData(db,a,NOW,'secondary_blog');
 assert.equal(secondaryData.blog?.id,secondary.id);assert.equal(secondaryData.history[0].id,secondaryId);
 assert.ok(secondaryData.actions.every(a=>a.resultId===secondaryId));
 const page=await buildDashboardPage(db,a,NOW,'free_blog');
 assert.equal(page.dashboard?.history[0].id,`mate:${report.token}`);assert.equal(page.dashboard?.connected,false);
 assert.equal(page.dashboard?.citations.length,0);assert.equal(page.dashboard?.citedPosts.length,0);
 assert.ok(!JSON.stringify(page.body).includes(`"data-scan-blog":"${primary.id}"`));
 assert.equal(page.dashboard?.subjects.length,3);
 assert.equal(dashboardData(db,a,NOW,'unknown_blog').subject?.naverId,'primary_blog');
});

test('an undiagnosed primary does not hide saved free reports, and selection never changes the primary',async t=>{
 const {db,a,diagnose}=await fixture(t);
 const primary=createBlog(db,a,{naverId:'empty_blog',title:'아직 진단 전',isPrimary:true});
 await diagnose(a);
 assert.equal(dashboardData(db,a,NOW).subject?.naverId,'tested_blog');
 assert.equal(dashboardData(db,a,NOW,'empty_blog').history.length,0);
 assert.equal((db.prepare('SELECT is_primary FROM blogs WHERE id=?').get(primary.id) as {is_primary:number}).is_primary,1);
});

test('anonymous, foreign, expired, future and deleted reports never enter the dashboard',async t=>{
 const {db,a,b,diagnose}=await fixture(t);
 await diagnose(null,'guest_blog');await diagnose(b,'foreign_blog');
 const mine=await diagnose(a,'tested_blog',NOW-DAY);
 await diagnose(a,'future_blog',NOW+DAY);
 // diagnoseBlog cleans expired rows, so use the oldest measurement last to retain it for read-time filtering.
 await diagnose(a,'expired_blog',NOW-31*DAY);
 const data=dashboardData(db,a,NOW,'foreign_blog');
 assert.deepEqual(data.subjects.map(b=>b.naverId),['tested_blog']);
 assert.deepEqual(data.history.map(p=>p.id),[`mate:${mine.token}`]);
 deleteMateReport(db,a,mine.token);
 assert.equal(dashboardData(db,a,NOW).subject,null);assert.equal(dashboardData(db,a,NOW).history.length,0);
});
