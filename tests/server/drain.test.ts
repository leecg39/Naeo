import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {enqueueScan,getScan} from '../../src/server/jobs/queue';
import {runAllJobsOnce,type DrainState} from '../../src/server/jobs/drain';
import {scanHandler} from '../../src/server/analysis/scan-handler';
import {buildDashboardPage} from '../../src/server/analysis/dashboard-page';
import type {CapturedNode} from '../../src/types/site';
import type {JobContext} from '../../src/server/jobs/worker';
import type {ScanJob} from '../../src/server/jobs/records';

type El=Exclude<CapturedNode,string>;
const all=(nodes:CapturedNode[],f:(n:El)=>boolean,out:El[]=[]):El[]=>{for(const n of nodes){if(typeof n==='string')continue;if(f(n))out.push(n);all(n.children,f,out);}return out;};
const text=(n:CapturedNode):string=>typeof n==='string'?n:n.children.map(text).join('');
const byClass=(nodes:CapturedNode[],c:string)=>all(nodes,n=>(n.attrs.class??'').split(/\s+/).includes(c));

const RSS=`<?xml version="1.0"?><rss version="2.0"><channel><title>드레인 블로그</title>${Array.from({length:8},(_,i)=>`<item><title>테스트 글 ${i+1}</title><link>https://blog.naver.com/drain_blog/${1000+i}</link><category>테크</category><description>${'내용 '.repeat(40)}</description><pubDate>${new Date(Date.now()-i*86_400_000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
const stubFetch=async()=>new Response(RSS,{status:200,headers:{'content-type':'application/rss+xml'}});

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const user=(await register(db,{email:'drain@example.test',password:'drain-long-password',nickname:'드레인',termsAccepted:true})).user;
 const blog=createBlog(db,user.id,{naverId:'drain_blog',title:'드레인 블로그',category:'테크',isPrimary:true});
 return{db,user:user.id,blog:blog.id};
}
const drain=(db:ReturnType<typeof openDatabase>,scan?:(job:ScanJob,ctx:JobContext)=>Promise<unknown>)=>{
 const state:DrainState={maintained:0,retained:0},logs:string[]=[];
 return runAllJobsOnce(db,'inprocess-test',state,m=>logs.push(m),new AbortController().signal,{scan});
};

test('queued scan is drained in-process end-to-end and the dashboard shows the diagnosis',async t=>{
 const {db,user,blog}=await fixture(t);
 const job=enqueueScan(db,user,{blogId:blog});
 let page=await buildDashboardPage(db,user);
 assert.match(text(byClass(page.body,'mui-4ynyf6')[0]),/첫 진단/,'before processing the dashboard asks for a first scan');
 const ran=await drain(db,scanHandler(db,stubFetch));
 assert.equal(ran,job.id,'the queued job ran inside this process');
 const done=getScan(db,user,job.id);
 assert.equal(done.state,'succeeded');
 assert.equal((db.prepare('SELECT COUNT(*) n FROM scan_results WHERE blog_id=?').get(blog) as {n:number}).n,1,'scan_results row persisted');
 page=await buildDashboardPage(db,user);
 const headline=text(byClass(page.body,'mui-4ynyf6')[0]);
 assert.match(headline,/진단 점수/,'dashboard shows the diagnosis result');
 assert.ok(!/첫 진단|블로그를 연결/.test(headline),'no longer shows the empty-state guidance');
 assert.match(text(byClass(page.body,'mui-zhxvjz')[0]),/마지막 스캔/,'last-scan line shows the measurement');
 assert.match(text(byClass(page.body,'mui-2m8c84')[0]),/분석한 글/,'metrics card renders analyzed-post count');
});

test('runAllJobsOnce is idle when nothing is queued and a failed job leaves the first-scan state',async t=>{
 const {db,user,blog}=await fixture(t);
 assert.ok(!(await drain(db,async()=>({score:1}))),'no queued work returns falsy');
 const job=enqueueScan(db,user,{blogId:blog});
 await drain(db,async()=>{throw Object.assign(new Error('boom'),{code:'FETCH_FAILED',retryable:false});});
 assert.equal(getScan(db,user,job.id).state,'failed');
 const page=await buildDashboardPage(db,user);
 assert.match(text(byClass(page.body,'mui-4ynyf6')[0]),/첫 진단/,'a failed job leaves the first-scan state, not a stale result');
});
