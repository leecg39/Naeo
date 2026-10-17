import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {parseBlogInput,diagnoseBlog,getMateReport,listMyMateReports,deleteMateReport,REPORT_TTL_MS} from '../../src/server/mate/mate';
import {createApi} from '../../src/server/api';

const NOW=Date.parse('2026-10-13T03:00:00Z');
const DAY=86_400_000;
const rss=(id:string,n:number)=>`<?xml version="1.0"?><rss version="2.0"><channel><title>QA</title>${Array.from({length:n},(_,i)=>`<item><title>제주 여행 코스 ${i+1}편 총정리 가이드</title><link>https://blog.naver.com/${id}/2000${i}</link><category>여행</category><tag>제주,여행,코스</tag><description>본문</description><pubDate>${new Date(NOW-i*DAY).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
const okFetch=(id:string,n=6)=>async()=>new Response(rss(id,n),{status:200});

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const a=(await register(db,{email:'a@example.test',password:'mate-long-password',nickname:'A',termsAccepted:true})).user;
 const b=(await register(db,{email:'b@example.test',password:'mate-long-password',nickname:'B',termsAccepted:true})).user;
 return{db,a:a.id,b:b.id};
}

test('blog input accepts ids and Naver blog URLs only',()=>{
 for(const [input,id] of [['my_blog','my_blog'],['https://blog.naver.com/My_Blog','my_blog'],['blog.naver.com/my-blog/223000','my-blog'],['m.blog.naver.com/my_blog','my_blog'],['  my_blog  ','my_blog']])assert.equal(parseBlogInput(input),id,input);
 for(const bad of ['','a','https://evil.example/my_blog','http://169.254.169.254','my blog','../x','javascript:alert(1)'])assert.equal(parseBlogInput(bad),null,bad);
});

test('home and server accept desktop/mobile article and legacy query URLs consistently',()=>{
 for(const input of ['https://blog.naver.com/leecg39/224444669929','https://m.blog.naver.com/leecg39/224444669929?ref=home','https://blog.naver.com/PostList.naver?blogId=LEEcg39','https://blog.naver.com/PostView.naver?blogId=leecg39&logNo=224444669929'])assert.equal(parseBlogInput(input),'leecg39');
 assert.equal(parseBlogInput('123blog'),'123blog');
 for(const input of ['https://blog.naver.com/PostView.naver?logNo=123','https://blog.naver.com.evil.example/leecg39','https://user:pass@blog.naver.com/leecg39','https://blog.naver.com:8443/leecg39','https://blog.naver.com/%2fetc','x'.repeat(301)])assert.equal(parseBlogInput(input),null,input);
});

test('anonymous diagnosis returns a real report with a share token and stores it for 30 days',async t=>{
 const {db}=await fixture(t);
 const r=await diagnoseBlog(db,{blog:'blog.naver.com/qa_blog',peer:'1.1.1.1',userId:null},okFetch('qa_blog'),NOW);
 assert.match(r.token,/^[A-Za-z0-9_-]{22}$/);
 assert.equal(r.naverId,'qa_blog');assert.equal(r.report.criteria.length,5);assert.equal(r.postCount,6);
 assert.equal(r.report.aiCitation.status,'not_configured');
 assert.equal(r.saved,false);
 assert.equal(r.source?.title,'QA');
 assert.equal(r.source?.posts[0].url,'https://blog.naver.com/qa_blog/20000');
 assert.equal(r.source?.posts[0].title,'제주 여행 코스 1편 총정리 가이드');
 assert.deepEqual(getMateReport(db,r.token,NOW+1000)?.source,r.source,'shared report preserves the original public evidence');
 assert.equal(getMateReport(db,r.token,NOW+1000)?.report.score,r.report.score);
 assert.equal(getMateReport(db,r.token,NOW+REPORT_TTL_MS+1),null,'expired reports are gone');
 assert.equal(getMateReport(db,'nope',NOW),null);
});

test('an empty but valid blog does not produce a misleading zero-score report',async t=>{
 const {db}=await fixture(t);
 await assert.rejects(diagnoseBlog(db,{blog:'empty_blog',peer:'empty',userId:null},okFetch('empty_blog',0),NOW),{status:422,code:'NO_PUBLIC_POSTS'});
 assert.equal((db.prepare('SELECT count(*) AS n FROM mate_reports').get() as {n:number}).n,0);
});

test('source snapshots are bounded, retained in owner history, and optional on older reports',async t=>{
 const {db,a}=await fixture(t);
 const report=await diagnoseBlog(db,{blog:'qa_blog',peer:'bounded',userId:a},okFetch('qa_blog',40),NOW);
 assert.equal(report.postCount,40);assert.equal(report.source?.posts.length,30);
 assert.deepEqual(listMyMateReports(db,a,{},NOW).data[0].source,report.source);
 db.prepare('UPDATE mate_reports SET source_json=NULL WHERE token=?').run(report.token);
 assert.equal(getMateReport(db,report.token,NOW)?.source,undefined);
 assert.equal(getMateReport(db,report.token,NOW)?.report.score,report.report.score);
});

test('missing blogs and bad input fail clearly; rate limits stop abuse',async t=>{
 const {db}=await fixture(t);
 await assert.rejects(diagnoseBlog(db,{blog:'https://evil.example/x',peer:'2.2.2.2',userId:null},okFetch('x'),NOW),{status:400,code:'INVALID_BLOG'});
 await assert.rejects(diagnoseBlog(db,{blog:'ghost_blog',peer:'2.2.2.2',userId:null},async()=>new Response('<rss><channel><title/></channel></rss>',{status:200}),NOW),{status:404,code:'BLOG_NOT_FOUND'});
 await assert.rejects(diagnoseBlog(db,{blog:'slow_blog',peer:'2.2.2.2',userId:null},async()=>new Response('x',{status:503}),NOW),{status:502,code:'FETCH_FAILED'});
 for(let i=0;i<2;i++)await diagnoseBlog(db,{blog:'qa_blog',peer:'2.2.2.2',userId:null},okFetch('qa_blog'),NOW);
 await assert.rejects(diagnoseBlog(db,{blog:'qa_blog',peer:'2.2.2.2',userId:null},okFetch('qa_blog'),NOW),{status:429},'5 attempts per peer per 10 minutes');
});

test('signed-in diagnoses are listed for the owner, who alone can delete them',async t=>{
 const {db,a,b}=await fixture(t);
 const mine=await diagnoseBlog(db,{blog:'qa_blog',peer:'3.3.3.3',userId:a},okFetch('qa_blog'),NOW);
 await diagnoseBlog(db,{blog:'other_blog',peer:'3.3.3.4',userId:null},okFetch('other_blog'),NOW);
 const list=listMyMateReports(db,a,{},NOW);
 assert.equal(list.pagination.total,1);assert.equal(list.data[0].token,mine.token);
 assert.equal(listMyMateReports(db,b,{},NOW).pagination.total,0);
 assert.throws(()=>deleteMateReport(db,b,mine.token),{status:404});
 deleteMateReport(db,a,mine.token);
 assert.equal(getMateReport(db,mine.token,NOW),null);
});

test('mate HTTP API: public diagnose and read, owner list/delete',async t=>{
 const origin='http://127.0.0.1:3000';process.env.NAEO_APP_URL=origin;
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const handler=createApi(()=>db);
 const send=(p:string,method='GET',body?:unknown,cookie?:string)=>handler(new Request(origin+p,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}));
 const bad=await send('/api/mate/diagnose','POST',{blog:'https://evil.example/x'});
 assert.equal(bad.status,400);
 assert.equal((await send('/api/mate/reports/AAAAAAAAAAAAAAAAAAAAAA')).status,404);
 assert.equal((await send('/api/mate/reports')).status,401,'list requires login');
});
