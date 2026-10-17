import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {createPlan} from '../../src/server/billing/plans';
import {startTrial} from '../../src/server/billing/subscriptions';
import {createKeyword,addKeywordMetric} from '../../src/server/keywords/admin-keywords';
import {getRecommendationFeed,rebuildLocalRecommendations,refreshRecommendationFeed,updateRecommendation,loadRecommendationCompetition} from '../../src/server/keywords/discovery-feed';
import {relatedKeywordStats,keywordStats} from '../../src/server/keywords/searchad';
import {newsSearch,blogSearch} from '../../src/server/competitors/naver-search';
import type {FetchLike} from '../../src/server/generation/provider';
import type {RecommendationFeed} from '../../src/lib/recommendation-feed';

const NOW=Date.parse('2026-10-17T06:00:00Z'),DAY=86_400_000;
const ads={apiKey:'test-ads-key',secret:'test-secret',customerId:'12345',baseUrl:'http://127.0.0.1:9999'};
const search={clientId:'test-client-long',clientSecret:'test-secret-long',baseUrl:'http://127.0.0.1:9998'};
const all=(feed:RecommendationFeed)=>[...feed.goldenItems,...feed.items];
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const a=(await register(db,{email:'owner@example.test',password:'recommendation-long',nickname:'회원',termsAccepted:true})).user.id;
 const b=(await register(db,{email:'other@example.test',password:'recommendation-long',nickname:'타인',termsAccepted:true})).user.id;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(b);
 const blog=createBlog(db,a,{naverId:'mine_blog',title:'내 여행 블로그'}),other=createBlog(db,b,{naverId:'other_blog',title:'타인 금융 블로그'});
 const post=addPost(db,blog.id,'제주 여행 산책 후기',['제주 여행']);addPost(db,other.id,'비공개 금융 노하우',['대출 정보']);
 return{db,a,b,blog,other,post};
}
function addPost(db:Database,blogId:string,title:string,tags:string[]){
 const id=randomUUID();db.prepare('INSERT INTO blog_posts(id,blog_id,external_id,url,title,tags_json,category,collected_at) VALUES(?,?,?,?,?,?,?,?)').run(id,blogId,id,`https://blog.naver.com/mine_blog/${id}`,title,JSON.stringify(tags),'여행',NOW);return id;
}
function paid(db:Database,admin:string,owner:string){createPlan(db,admin,{code:'recommendation',name:'베이직',price:9900,trialDays:30});return startTrial(db,owner,{planCode:'recommendation'},NOW);}
function catalog(db:Database,admin:string,phrase:string,total=2000,docs=1000){const k=createKeyword(db,admin,{phrase,category:'여행'},NOW);addKeywordMetric(db,admin,k.id,{pcVolume:total,mobileVolume:0,documentCount:docs},NOW);return k;}
function citation(db:Database,ownerId:string,blogId:string,postId:string,keyword:string,at:number,{rank=null,status='checked',exposed=1}:{rank?:number|null;status?:'checked'|'error';exposed?:number}={}){
 const run=randomUUID();db.prepare("INSERT INTO citation_runs(id,owner_id,blog_id,state,source,provider,post_limit,run_after,created_at,updated_at,completed_at) VALUES(?,?,?,'succeeded','member','test',1,?,?,?,?)").run(run,ownerId,blogId,at,at,at,at);
 db.prepare('INSERT INTO citation_results(id,run_id,owner_id,blog_id,post_id,keyword,keyword_source,status,briefing,exposed,text_rank,evidence_json,checked_at) VALUES(?,?,?,?,?,?,\'tag\',?,?,?,?,\'{}\',?)').run(randomUUID(),run,ownerId,blogId,postId,keyword,status,status==='error'?0:1,status==='error'?0:exposed,rank,at);
}

test('discovery explains genuinely new owned-blog candidates without inventing demand; unrelated catalog is excluded',async t=>{
 const {db,a,b,blog,other}=await fixture(t);catalog(db,b,'대출 정보 금리');
 const feed=rebuildLocalRecommendations(db,a,blog.id,NOW),rows=all(feed);
 assert.equal(feed.status,'ready');assert.equal(rows.length,3);assert.equal(feed.plan.cycleDays,30);assert.equal(feed.cap.used,3);
 assert.ok(rows.every(r=>r.source==='blog_analysis'&&r.phrase!=='제주 여행'&&r.phrase.includes('제주 여행')));
 assert.ok(rows.every(r=>r.total===null&&r.saturation===null&&!r.golden&&!r.opportunity&&r.history.length===0));
 assert.match(rows[0].reason,/로컬 규칙으로 추론/);assert.equal(rows[0].sourcePost?.title,'제주 여행 산책 후기');
 assert.equal(getRecommendationFeed(db,b,{blogId:other.id},NOW).summary.total,0);
 assert.throws(()=>getRecommendationFeed(db,a,{blogId:other.id},NOW),{code:'BLOG_NOT_FOUND'});
 assert.throws(()=>updateRecommendation(db,b,rows[0].id,{written:true,version:1}),{status:404});
});

test('golden uses raw ratio, zero demand is unknown saturation, zero documents never gives opportunity, no invented upper volume cap',async t=>{
 const {db,a,b,blog}=await fixture(t);paid(db,b,a);
 catalog(db,b,'제주 여행 경계 초과',1000,1001);catalog(db,b,'제주 여행 정확 경계',1000,1000);catalog(db,b,'제주 여행 검색 없음',0,0);catalog(db,b,'제주 여행 문서 없음',2000,0);catalog(db,b,'제주 여행 대형 수요',200001,50000);
 const feed=rebuildLocalRecommendations(db,a,blog.id,NOW),rows=all(feed),by=(name:string)=>rows.find(r=>r.phrase===name)!;
 assert.equal(by('제주 여행 경계 초과').saturation,1.001);assert.equal(by('제주 여행 경계 초과').golden,false);
 assert.equal(by('제주 여행 정확 경계').golden,true);assert.equal(by('제주 여행 정확 경계').opportunity,true);
 assert.equal(by('제주 여행 검색 없음').saturation,null);assert.equal(by('제주 여행 검색 없음').golden,false);
 assert.equal(by('제주 여행 문서 없음').golden,true);assert.equal(by('제주 여행 문서 없음').opportunity,false);
 assert.equal(by('제주 여행 대형 수요').golden,true);
 assert.ok(feed.items.every(r=>!feed.goldenItems.some(g=>g.id===r.id)));
});

test('saving and writing keep recommendation visible; explicit dismiss removes it, versions and cascade protect private state',async t=>{
 const {db,a,b,blog}=await fixture(t);catalog(db,b,'제주 여행 항공 비교');
 let row=all(rebuildLocalRecommendations(db,a,blog.id,NOW))[0];assert.equal(row.golden,true);
 row=updateRecommendation(db,a,row.id,{version:row.version,saved:true,written:true},NOW+1);
 assert.equal(row.saved,true);assert.equal(row.written,true);assert.equal(row.golden,false);
 assert.equal(getRecommendationFeed(db,a,{blogId:blog.id},NOW+1).items.some(r=>r.id===row.id),true);
 assert.equal(db.prepare('SELECT count(*) AS n FROM member_keywords WHERE owner_id=?').get(a)?.n,1);
 assert.throws(()=>updateRecommendation(db,a,row.id,{version:1,written:false}),{code:'VERSION_CONFLICT'});
 row=updateRecommendation(db,a,row.id,{version:row.version,dismissed:true},NOW+2);
 assert.ok(!all(getRecommendationFeed(db,a,{blogId:blog.id},NOW+2)).some(r=>r.id===row.id));
 db.prepare('DELETE FROM users WHERE id=?').run(a);
 assert.equal(db.prepare('SELECT count(*) AS n FROM member_recommendations').get()?.n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM recommendation_builds').get()?.n,0);
});

test('monthly quota is shared between owned blogs and a due refresh revisits uncompleted recommendations without duplicating them',async t=>{
 const {db,a,blog}=await fixture(t),first=rebuildLocalRecommendations(db,a,blog.id,NOW),ids=all(first).map(r=>r.id);
 const second=createBlog(db,a,{naverId:'mine_second',title:'두 번째'});addPost(db,second.id,'제주 여행 두 번째 후기',['제주 여행']);
 assert.equal(rebuildLocalRecommendations(db,a,second.id,NOW).summary.total,0,'free month allowance is per member');
 const again=await refreshRecommendationFeed(db,a,{blogId:blog.id},{ads:null,search:null},NOW+31*DAY);
 assert.equal(again.summary.revisit,3);assert.equal(all(again).filter(r=>ids.includes(r.id)).length,3);assert.equal(again.summary.total,3,'same normalized candidates are not reinserted');
 const used=again.cap.used;await refreshRecommendationFeed(db,a,{blogId:blog.id},{ads:null,search:null,fetchImpl:async()=>{throw new Error('must not run');}},NOW+31*DAY+1);
 assert.equal(getRecommendationFeed(db,a,{blogId:blog.id},NOW+31*DAY+1).cap.used,used);
});

test('citation loss compares actual successful AI ranks, ignores error results, and applies within cadence',async t=>{
 const {db,a,blog,post}=await fixture(t);
 citation(db,a,blog.id,post,'제주 여행',NOW-3000,{rank:null});
 let feed=rebuildLocalRecommendations(db,a,blog.id,NOW),row=all(feed).find(r=>r.phrase==='제주 여행')!;
 assert.equal(row.signal,'new');assert.match(row.reason,/AI 인용이 확인되지/);
 citation(db,a,blog.id,post,'제주 여행',NOW+1000,{rank:2,exposed:1});
 citation(db,a,blog.id,post,'제주 여행',NOW+2000,{status:'error'});
 feed=rebuildLocalRecommendations(db,a,blog.id,NOW+2000);row=all(feed).find(r=>r.id===row.id)!;assert.equal(row.signal,'new','transport errors are not citation loss');
 citation(db,a,blog.id,post,'제주 여행',NOW+3000,{rank:null,exposed:1});
 feed=rebuildLocalRecommendations(db,a,blog.id,NOW+3000);row=all(feed).find(r=>r.id===row.id)!;
 assert.equal(row.signal,'rewritten');assert.equal(feed.summary.revisit,1);assert.equal(feed.summary.rewritten,1);assert.equal(feed.cap.used,3);
 assert.equal(getRecommendationFeed(db,a,{blogId:blog.id,filter:'revisit'},NOW+3000).items[0].id,row.id);
});

test('post keyword override prevents attributing a different query citation history to the new phrase',async t=>{
 const {db,a,blog,post}=await fixture(t);
 citation(db,a,blog.id,post,'제주 여행',NOW-2000,{rank:1});citation(db,a,blog.id,post,'제주 여행',NOW-1000,{rank:null});
 db.prepare('INSERT INTO post_keywords(post_id,owner_id,keyword,updated_at) VALUES(?,?,?,?)').run(post,a,'제주 교통',NOW);
 const feed=rebuildLocalRecommendations(db,a,blog.id,NOW);assert.equal(feed.summary.rewritten,0);assert.ok(all(feed).some(r=>r.phrase.includes('제주 교통')));
});

test('first provider enrichment after local bootstrap preserves quota and history, missing documents stay unknown',async t=>{
 const {db,a,blog}=await fixture(t),initial=rebuildLocalRecommendations(db,a,blog.id,NOW),phrases=all(initial).map(r=>r.phrase);let calls=0;
 const fetchImpl:FetchLike=async url=>{calls++;assert.ok(url.includes('keywordstool'));return Response.json({keywordList:phrases.map(phrase=>({relKeyword:phrase,monthlyPcQcCnt:500,monthlyMobileQcCnt:1500}))});};
 const feed=await refreshRecommendationFeed(db,a,{blogId:blog.id},{ads,search:null,fetchImpl},NOW+1);
 assert.equal(calls,1);assert.equal(feed.cap.used,3);assert.equal(feed.summary.total,3);
 assert.ok(all(feed).every(r=>r.total===2000&&r.documentCount===null&&!r.golden&&r.history.at(-1)?.total===2000));
 assert.ok(all(feed).some(r=>r.related.some(v=>v.source==='naver_searchad')));
 await refreshRecommendationFeed(db,a,{blogId:blog.id},{ads,search:null,fetchImpl},NOW+2);assert.equal(calls,1,'repeat same-cycle provider requests are skipped');
});

test('provider failure never erases complete measurements or combines fresh volumes with stale documents',async t=>{
 const {db,a,b,blog}=await fixture(t);catalog(db,b,'제주 여행 보존할 키워드',2000,3000);
 const original=all(rebuildLocalRecommendations(db,a,blog.id,NOW)).find(r=>r.source==='catalog')!;
 const fetchImpl:FetchLike=async url=>url.includes('keywordstool')?Response.json({keywordList:[{relKeyword:original.phrase,monthlyPcQcCnt:10000,monthlyMobileQcCnt:20000}]}):new Response('failure',{status:500});
 const after=all(await refreshRecommendationFeed(db,a,{blogId:blog.id},{ads,search,fetchImpl},NOW+1)).find(r=>r.id===original.id)!;
 assert.equal(after.total,2000);assert.equal(after.documentCount,3000);assert.equal(after.golden,false);assert.equal(after.history.at(-1)?.documentCount,3000);assert.match(getRecommendationFeed(db,a,{blogId:blog.id},NOW+1).notice??'',/분석/);
 const failed=await refreshRecommendationFeed(db,a,{blogId:blog.id},{ads,search,fetchImpl:async()=>new Response('failure',{status:500})},NOW+31*DAY);
 const still=all(failed).find(r=>r.id===original.id)!;assert.equal(still.total,2000);assert.equal(still.documentCount,3000);
 const recovered=await refreshRecommendationFeed(db,a,{blogId:blog.id},{ads,search,fetchImpl:async url=>url.includes('keywordstool')?fetchImpl(url):Response.json({total:3000,items:[]})},NOW+31*DAY+1);
 const measured=all(recovered).find(r=>r.id===original.id)!;assert.equal(measured.total,30000);assert.equal(measured.documentCount,3000);assert.equal(measured.history.length,2,'failed provider attempt can be retried immediately');
});

test('concurrent refresh is locked across asynchronous providers and blog changes cannot overwrite results',async t=>{
 const {db,a,blog}=await fixture(t);let release!:(response:Response)=>void;let entered!:()=>void;
 const gate=new Promise<void>(resolve=>{entered=resolve;}),pending=refreshRecommendationFeed(db,a,{blogId:blog.id},{ads,search:null,fetchImpl:()=>{entered();return new Promise<Response>(resolve=>{release=resolve;});}},NOW);
 await gate;
 await assert.rejects(refreshRecommendationFeed(db,a,{blogId:blog.id},{ads:null},NOW),{code:'RECOMMENDATION_BUILDING'});
 db.prepare('UPDATE blogs SET version=version+1 WHERE id=?').run(blog.id);release(Response.json({keywordList:[]}));
 await assert.rejects(pending,{code:'VERSION_CONFLICT'});assert.equal(getRecommendationFeed(db,a,{blogId:blog.id},NOW).summary.total,0);
 assert.equal(db.prepare("SELECT count(*) AS n FROM recommendation_builds WHERE state='running'").get()?.n,0);
});

test('manual refresh collects only the registered owner RSS when posts are absent',async t=>{
 const {db,a,blog}=await fixture(t);db.prepare('DELETE FROM blog_posts WHERE blog_id=?').run(blog.id);
 assert.equal(getRecommendationFeed(db,a,{blogId:blog.id},NOW).status,'needs_scan');
 const urls:string[]=[],feed=await refreshRecommendationFeed(db,a,{blogId:blog.id},{ads:null,search:null,fetchImpl:async url=>{urls.push(url);return new Response('<?xml version="1.0"?><rss version="2.0"><channel><title>내 여행 블로그</title><item><title>제주 여행 준비</title><link>https://blog.naver.com/mine_blog/222222222</link><category>제주 여행</category><description>직접 정리한 여행 정보</description></item></channel></rss>',{headers:{'Content-Type':'application/rss+xml'}});}},NOW);
 assert.equal(urls.length,1);assert.match(urls[0],/\/mine_blog\.xml$/);assert.equal(feed.status,'ready');assert.equal(feed.summary.total,3);
});

test('competition is subscription-gated, owns and versions results, preserves partial failure data, sanitizes external URLs',async t=>{
 const {db,a,b,blog}=await fixture(t);let row=all(rebuildLocalRecommendations(db,a,blog.id,NOW))[0];
 await assert.rejects(loadRecommendationCompetition(db,a,row.id,{version:row.version},{search},NOW),{code:'PAID_PLAN_REQUIRED'});paid(db,b,a);
 const fetchImpl:FetchLike=async url=>Response.json({total:1,items:url.includes('news.json')?[{title:'<b>뉴스</b>',link:'https://news.example/a',originallink:'https://paper.example/a',pubDate:'Fri, 16 Oct 2026 09:00:00 +0900'},{title:'악성',link:'javascript:alert(1)'}]:[{title:'<b>경쟁 글</b>',link:'https://blog.naver.com/rival/1',bloggername:'경쟁 블로그',postdate:'20261016'}]});
 row=await loadRecommendationCompetition(db,a,row.id,{version:row.version},{search,fetchImpl},NOW);assert.equal(row.competition.blogs[0].title,'경쟁 글');assert.equal(row.competition.news.length,1);assert.equal(row.competition.news[0].url,'https://paper.example/a');
 await assert.rejects(loadRecommendationCompetition(db,b,row.id,{version:row.version},{search,fetchImpl},NOW),{status:404});
 await assert.rejects(loadRecommendationCompetition(db,a,row.id,{version:1},{search,fetchImpl},NOW),{code:'VERSION_CONFLICT'});
 const prev=row.competition.blogs;row=await loadRecommendationCompetition(db,a,row.id,{version:row.version},{search,fetchImpl:async url=>url.includes('blog.json')?new Response('failure',{status:500}):fetchImpl(url)},NOW+1);
 assert.deepEqual(row.competition.blogs,prev);assert.match(row.competition.error??'',/일부/);
});

test('related search preserves provider terms while legacy exact lookups remain exact; malformed document totals are never zero metrics',async()=>{
 const fetchImpl:FetchLike=async()=>Response.json({keywordList:[{relKeyword:'제주 여행',monthlyPcQcCnt:100,monthlyMobileQcCnt:200},{relKeyword:'제주 교통',monthlyPcQcCnt:300,monthlyMobileQcCnt:400}]});
 assert.equal((await relatedKeywordStats(ads,['제주 여행'],fetchImpl)).size,2);assert.equal((await keywordStats(ads,['제주 여행'],fetchImpl)).size,1);
 await assert.rejects(blogSearch(search,'제주 여행',{},async()=>Response.json({items:[]})),{code:'NAVER_SEARCH_RESPONSE'});
 await assert.rejects(newsSearch(search,'제주 여행',{},async()=>Response.json({total:null,items:[]})),{code:'NAVER_SEARCH_RESPONSE'});
});

test('golden limit does not hide overflow recommendations and sorting/filtering cover records before pagination',async t=>{
 const {db,a,b,blog}=await fixture(t);paid(db,b,a);
 for(let i=0;i<14;i++)catalog(db,b,`제주 여행 황금 ${i}`,2000+i*100,1000);
 const feed=rebuildLocalRecommendations(db,a,blog.id,NOW);assert.equal(feed.goldenItems.length,10);assert.equal(feed.summary.golden,14);
 assert.equal(new Set(all(feed).map(r=>r.id)).size,feed.summary.total);
 const filtered=getRecommendationFeed(db,a,{blogId:blog.id,filter:'golden',sort:'total',direction:'desc',pageSize:2,page:2},NOW);
 assert.equal(filtered.pagination.total,14);assert.equal(filtered.items[0].total,3100);assert.equal(filtered.items[1].total,3000);
 const feb=Date.parse('2026-11-01T00:01:00+09:00');assert.equal(getRecommendationFeed(db,a,{blogId:blog.id,period:'month'},feb).summary.total,0,'month starts at KST calendar boundary');
});

test('published posts and citation candidates are excluded from golden even after real metrics arrive',async t=>{
 const {db,a,b,blog}=await fixture(t);catalog(db,b,'제주 여행 숙박 비교');
 const before=rebuildLocalRecommendations(db,a,blog.id,NOW),keyword=before.goldenItems[0];assert.ok(keyword);
 addPost(db,blog.id,'제주 여행 숙박 비교 직접 다녀온 후기',['제주 여행 숙박 비교']);
 const after=getRecommendationFeed(db,a,{blogId:blog.id},NOW+1);assert.equal(after.goldenItems.some(r=>r.id===keyword.id),false);
 assert.equal(after.items.find(r=>r.id===keyword.id)?.alreadyPublished,true);assert.equal(after.items.find(r=>r.id===keyword.id)?.written,false,'actual published evidence does not rewrite the manual workflow checkbox');
});

test('paid builds enforce 25 per cycle and 100 across all owned blogs in one KST month',async t=>{
 const {db,a,b,blog}=await fixture(t);paid(db,b,a);
 for(let i=0;i<40;i++)catalog(db,b,`제주 여행 전문 주제 ${i}`,2000,20000);
 const first=rebuildLocalRecommendations(db,a,blog.id,NOW);assert.equal(first.summary.total,25);assert.equal(first.plan.cycleDays,7);assert.equal(first.cap.used,25);
 for(let i=0;i<4;i++){
  const next=createBlog(db,a,{naverId:`topic_blog_${i}`,title:`연결 블로그 ${i}`});addPost(db,next.id,'제주 여행 계획',['제주 여행']);
  const feed=rebuildLocalRecommendations(db,a,next.id,NOW+i+1);assert.equal(feed.summary.total,i<3?25:0);
 }
 assert.equal(getRecommendationFeed(db,a,{blogId:blog.id},NOW+10).cap.used,100);
});
