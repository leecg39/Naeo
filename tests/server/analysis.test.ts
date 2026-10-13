import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {analyzePosts,METHOD_VERSION,type PostSample} from '../../src/server/analysis/rules';
import {scanHandler} from '../../src/server/analysis/scan-handler';
import {enqueueScan,getScan} from '../../src/server/jobs/queue';
import {runWorkerOnce} from '../../src/server/jobs/worker';
import {listScanResults,latestScanResult} from '../../src/server/analysis/results';

const DAY=86_400_000;
const NOW=Date.parse('2026-10-13T00:00:00Z');
const post=(daysAgo:number,over:Partial<PostSample>={}):PostSample=>({title:'제주 3박4일 여행 코스 총정리 2026',category:'여행',tags:['제주','여행','코스'],publishedAt:NOW-daysAgo*DAY,...over});

test('rules score five criteria out of 20 each with evidence and a new-rule disclosure',()=>{
 const strong=analyzePosts(Array.from({length:12},(_,i)=>post(i*2)),NOW);
 assert.equal(strong.methodVersion,METHOD_VERSION);
 assert.equal(strong.criteria.length,5);
 assert.ok(strong.criteria.every(c=>c.score>=0&&c.score<=20&&c.evidence.length>0));
 assert.equal(strong.score,strong.criteria.reduce((s,c)=>s+c.score,0));
 assert.ok(strong.score>=80,`strong blog scores high (${strong.score})`);
 assert.match(strong.disclosure,/새 규칙/);
 assert.deepEqual(strong.aiCitation,{status:'not_configured'},'AI briefing citations are never invented');
 const weak=analyzePosts([post(120,{title:'안녕',tags:[],category:'잡담'}),post(200,{title:'ㅎㅎ',tags:[],category:'일기'})],NOW);
 assert.ok(weak.score<strong.score);
 assert.ok(weak.actions.length>=3,'weak criteria become action items');
 assert.equal(analyzePosts([],NOW).score,0);
});

test('scores are deterministic and bounded',()=>{
 const posts=Array.from({length:40},(_,i)=>post(i,{title:'가'.repeat(i%60+1),tags:Array.from({length:i%12},(_,j)=>'t'+j),category:['A','B','C'][i%3]}));
 const a=analyzePosts(posts,NOW),b=analyzePosts([...posts].reverse(),NOW);
 assert.deepEqual(a,b,'order independent');
 assert.ok(a.score>=0&&a.score<=100);
});

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const owner=(await register(db,{email:'an@example.test',password:'analysis-long-password',nickname:'분석',termsAccepted:true})).user;
 const other=(await register(db,{email:'other@example.test',password:'analysis-long-password',nickname:'남',termsAccepted:true})).user;
 const blog=createBlog(db,owner.id,{naverId:'qa_blog',title:'QA',category:'',isPrimary:true});
 return{db,owner:owner.id,other:other.id,blog:blog.id};
}
const rss=(n:number)=>`<?xml version="1.0"?><rss version="2.0"><channel><title>QA</title>${Array.from({length:n},(_,i)=>`<item><title>제주 여행 코스 ${i+1}편 총정리</title><link>https://blog.naver.com/qa_blog/1000${i}</link><category>여행</category><tag>제주,여행,코스</tag><description>본문 ${i}</description><pubDate>${new Date(NOW-i*2*DAY).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;

test('the scan handler collects RSS, stores a result with history, and reports progress',async t=>{
 const {db,owner,other,blog}=await fixture(t);
 const job=enqueueScan(db,owner,{blogId:blog});
 const handler=scanHandler(db,async()=>new Response(rss(8),{status:200}),()=>NOW);
 await runWorkerOnce(db,'w',handler);
 const done=getScan(db,owner,job.id);
 assert.equal(done.state,'succeeded');
 const result=done.result as {resultId:string;score:number;postCount:number;collected:{inserted:number}};
 assert.equal(result.postCount,8);assert.equal(result.collected.inserted,8);
 const latest=latestScanResult(db,owner,blog)!;
 assert.equal(latest.id,result.resultId);assert.equal(latest.score,result.score);
 assert.equal(latest.criteria.length,5);assert.equal(latest.methodVersion,METHOD_VERSION);
 assert.throws(()=>latestScanResult(db,other,blog),{status:404},'other members cannot read the report');
 enqueueScan(db,owner,{blogId:blog});
 await runWorkerOnce(db,'w',handler);
 assert.equal(listScanResults(db,owner,blog,{}).pagination.total,2,'history keeps every run');
});

test('a blog with no public posts fails the scan permanently with a clear error',async t=>{
 const {db,owner,blog}=await fixture(t);
 const job=enqueueScan(db,owner,{blogId:blog});
 await runWorkerOnce(db,'w',scanHandler(db,async()=>new Response('<rss><channel><title/></channel></rss>',{status:200}),()=>NOW));
 const s=getScan(db,owner,job.id);
 assert.equal(s.state,'failed');assert.equal(s.errorCode,'BLOG_NOT_FOUND');
 assert.equal(latestScanResult(db,owner,blog),null);
});
