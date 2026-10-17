import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {createApi} from '../../src/server/api';
import {buildRecommendationsPage} from '../../src/server/keywords/recommendations-page';
import {datasets} from '../../src/server/privacy/datasets';

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const owner=await register(db,{email:'feed-owner@example.test',password:'recommendation-password',nickname:'추천 회원',termsAccepted:true});
 const other=await register(db,{email:'feed-other@example.test',password:'recommendation-password',nickname:'다른 회원',termsAccepted:true});
 const blog=createBlog(db,owner.user.id,{naverId:'feed_blog',title:'제주 여행 기록'});
 db.prepare('INSERT INTO blog_posts(id,blog_id,external_id,url,title,tags_json,category,collected_at) VALUES(?,?,?,?,?,?,?,?)')
  .run(randomUUID(),blog.id,'10000','https://blog.naver.com/feed_blog/10000','제주 여행 기록',JSON.stringify(['제주여행']),'여행',Date.now());
 const origin='http://127.0.0.1:3000',before=process.env.NAEO_APP_URL;process.env.NAEO_APP_URL=origin;t.after(()=>{if(before===undefined)delete process.env.NAEO_APP_URL;else process.env.NAEO_APP_URL=before;});
 const handler=createApi(()=>db);
 const send=(path:string,method='GET',data?:unknown,token:string|null=owner.session.token,requestOrigin=origin)=>handler(new Request(origin+path,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json',...(token?{Cookie:`naeo_session=${token}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}));
 return{db,owner,other,blog,send};
}

test('SSR bootstraps recommendations from owned posts and the authenticated feed preserves them',async t=>{
 const {db,owner,blog,send}=await fixture(t);
 const page=await buildRecommendationsPage(db,owner.user.id,{});
 assert.equal(page.recommendationFeed?.status,'ready');assert.ok(page.recommendationFeed!.summary.total>0);
 assert.equal(page.recommendationFeed?.selectedBlogId,blog.id);
 const response=await send('/api/recommendations/feed');assert.equal(response.status,200);
 const feed=(await response.json()).data;
 assert.equal(feed.summary.total,page.recommendationFeed!.summary.total);
 assert.ok(feed.items.every((r:{sourcePost:unknown;total:number|null})=>r.sourcePost&&r.total===null));
 assert.equal((await buildRecommendationsPage(db,owner.user.id,{view:'library'})).recommendationView,'library');
});

test('feed HTTP mutations enforce authentication, origin, ownership, versions and persistence',async t=>{
 const {db,owner,other,blog,send}=await fixture(t);
 await buildRecommendationsPage(db,owner.user.id,{});
 assert.equal((await send('/api/recommendations/feed','GET',undefined,null)).status,401);
 assert.equal((await send(`/api/recommendations/feed?blogId=${blog.id}`,'GET',undefined,other.session.token)).status,404);
 assert.equal((await send('/api/recommendations/refresh','POST',{blogId:blog.id},other.session.token)).status,404);
 const feed=(await (await send('/api/recommendations/feed')).json()).data,item=feed.items[0];
 const path=`/api/recommendations/feed/${item.id}`;
 assert.equal((await send(path,'PATCH',{version:item.version,written:true},null)).status,401);
 assert.equal((await send(path,'PATCH',{version:item.version,written:true},owner.session.token,'https://evil.example')).status,403);
 assert.equal((await send(path,'PATCH',{version:item.version,written:true},other.session.token)).status,404);
 assert.equal((await send(path,'PATCH',{version:item.version,phrase:'unsupported'})).status,400);
 const mark=await send(path,'PATCH',{version:item.version,written:true,saved:true});assert.equal(mark.status,200);
 const changed=(await mark.json()).data;assert.equal(changed.written,true);assert.equal(changed.saved,true);
 assert.equal((await send(path,'PATCH',{version:item.version,written:false})).status,409);
 const reloaded=(await (await send('/api/recommendations/feed')).json()).data;
 assert.ok(reloaded.items.some((r:{id:string;written:boolean})=>r.id===item.id&&r.written),'completion does not remove the item from all');
 assert.equal((await send(path,'PATCH',{version:changed.version,dismissed:true})).status,200);
 assert.ok(!(await (await send('/api/recommendations/feed')).json()).data.items.some((r:{id:string})=>r.id===item.id));
 const own=db.prepare(datasets.find(d=>d.name==='member_recommendations')!.sql).all(owner.user.id);
 assert.ok(own.length>0);assert.equal(db.prepare(datasets.find(d=>d.name==='member_recommendations')!.sql).all(other.user.id).length,0);
 assert.ok(db.prepare(datasets.find(d=>d.name==='recommendation_builds')!.sql).all(owner.user.id).length>0);
});
