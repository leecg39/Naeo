import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog,updateBlog} from '../../src/server/blogs';
import {refreshRecommendationFeed,getRecommendationFeed} from '../../src/server/keywords/discovery-feed';
import {endpoint,json} from '../../src/server/http';

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const owner=(await register(db,{email:'refresh-errors@example.test',password:'refresh-error-password',nickname:'추천 오류 검증',termsAccepted:true})).user.id;
 const blog=createBlog(db,owner,{naverId:'qa-admin-blog',title:'테스트 블로그'});
 return{db,owner,blog};
}

for(const [name,response] of [['missing RSS',()=>new Response('',{status:404})],['empty error page',()=>new Response('<html><body>not found</body></html>')],['blog with no public posts',()=>new Response('<rss><channel><title>Empty blog</title></channel></rss>')]] as const){
 test(`refresh gives an actionable source error for ${name} without consuming quota`,async t=>{
  const {db,owner,blog}=await fixture(t);
  const handle=endpoint(async()=>json({data:await refreshRecommendationFeed(db,owner,{blogId:blog.id},{ads:null,search:null,fetchImpl:async()=>response()})}));
  const result=await handle(new Request('http://localhost/api/recommendations/refresh',{method:'POST'})),payload=await result.json();
  assert.equal(result.status,422);assert.equal(payload.error.code,'RECOMMENDATION_BLOG_UNAVAILABLE');
  assert.match(payload.error.message,/qa-admin-blog/);assert.match(payload.error.message,/블로그 ID/);
  assert.equal(payload.error.details.retryable,false);
  assert.equal(getRecommendationFeed(db,owner).cap.used,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM recommendation_builds WHERE state='running'").get()?.n,0);
 });
}

test('temporary RSS outage remains retryable and succeeds immediately after recovery',async t=>{
 const {db,owner,blog}=await fixture(t);
 await assert.rejects(refreshRecommendationFeed(db,owner,{blogId:blog.id},{ads:null,search:null,fetchImpl:async()=>new Response('',{status:503})}),{status:503,code:'RECOMMENDATION_RSS_UNAVAILABLE',details:{retryable:true}});
 const valid=updateBlog(db,owner,blog.id,{version:blog.version,naverId:'my_real_blog'});
 const feed=await refreshRecommendationFeed(db,owner,{blogId:valid.id},{ads:null,search:null,fetchImpl:async url=>{
  assert.ok(url.endsWith('/my_real_blog.xml'));
  return new Response('<rss><channel><title>My blog</title><item><title>제주 여행 준비</title><link>https://blog.naver.com/my_real_blog/123456</link><tag>제주 여행</tag></item></channel></rss>');
 }});
 assert.equal(feed.status,'ready');assert.ok(feed.summary.total>0);assert.equal(feed.cap.used,3);
});
