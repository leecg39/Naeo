import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {diagnoseBlog} from '../../src/server/mate/mate';
import {buildAiPicksPage} from '../../src/server/analysis/ai-picks-page';
import {buildDashboardPage} from '../../src/server/analysis/dashboard-page';
import {analyzePosts} from '../../src/server/analysis/rules';
import {inPeriod,percentage,chartCoordinates,scoreChange} from '../../src/lib/dashboard-visualization';

const NOW=Date.parse('2026-10-17T03:00:00Z'),DAY=86400000;
test('period filters use inclusive Korean calendar dates and keep real time spacing',()=>{
 const start=Date.parse('2026-10-10T15:00:00Z');
 const points=[{measuredAt:start-1,value:20},{measuredAt:start,value:30},{measuredAt:NOW,value:75},{measuredAt:NOW+1,value:90}];
 assert.deepEqual(inPeriod(points,7,NOW).map(p=>p.value),[30,75]);
 assert.equal(inPeriod(points,'all',NOW).length,3);
 assert.equal(inPeriod([{measuredAt:NOW-45*DAY}],30,NOW).length,0);
 assert.equal(inPeriod([{measuredAt:NOW-45*DAY}],90,NOW).length,1);
 const xy=chartCoordinates([{measuredAt:0,value:0},{measuredAt:DAY,value:50},{measuredAt:10*DAY,value:100}]);
 assert.equal(xy[1].x,48+728/10);assert.equal(xy[0].y,208);assert.equal(xy[2].y,28);
 assert.equal(chartCoordinates([{measuredAt:NOW,value:0}])[0].x,400);
});
test('no measurements is distinct from a real zero, and changes require comparable rules',()=>{
 assert.equal(percentage(0,0),null);assert.equal(percentage(0,10),0);assert.equal(percentage(2,8),25);
 const point={...analyzePosts([],NOW),id:'a',postCount:0,measuredAt:NOW};
 assert.equal(scoreChange(point,undefined),null);
 assert.equal(scoreChange({...point,score:70},{...point,score:60}),10);
 assert.equal(scoreChange(point,{...point,methodVersion:'rules-v0'}),null);
});
test('dashboard charts isolate the member and primary blog, ignore failed runs and count only checked results',async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const user=(await register(db,{email:'viz@example.test',password:'visualization-long-password',nickname:'도식화',termsAccepted:true})).user.id;
 const other=(await register(db,{email:'other-viz@example.test',password:'visualization-long-password',nickname:'다른 회원',termsAccepted:true})).user.id;
 const blog=createBlog(db,user,{naverId:'viz_blog',title:'내 블로그',isPrimary:true}).id;
 const secondary=createBlog(db,user,{naverId:'secondary_blog',title:'보조 블로그'}).id;
 const otherBlog=createBlog(db,other,{naverId:'other_blog',title:'타인 블로그',isPrimary:true}).id;
 const run=(owner:string,blogId:string,at:number,state='succeeded',statuses=['checked','checked','checked','error'])=>{
  const id=randomUUID();
  db.prepare('INSERT INTO citation_runs(id,owner_id,blog_id,state,source,provider,post_limit,run_after,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,blogId,state,'member','test',10,at,at,at,at);
  statuses.forEach((status,i)=>{const post=randomUUID();
   db.prepare('INSERT INTO blog_posts(id,blog_id,external_id,url,title,collected_at) VALUES(?,?,?,?,?,?)').run(post,blogId,post,'https://blog.naver.com/viz_blog/1',`${owner} 글 ${i}`,at);
   db.prepare("INSERT INTO citation_results(id,run_id,owner_id,blog_id,post_id,keyword,keyword_source,status,briefing,exposed,text_rank,image_rank,evidence_json,checked_at) VALUES(?,?,?,?,?,?,'title',?,?,?,?,?,'{}',?)").run(randomUUID(),id,owner,blogId,post,'키워드',status,status==='checked'?1:0,status==='checked'&&i<2?1:0,status==='checked'&&i===0?1:null,status==='checked'&&i===1?2:null,at);
  });return id;
 };
 run(user,blog,NOW-DAY);
 run(other,otherBlog,NOW-100);
 const secondaryRun=run(user,secondary,NOW-100);
 run(user,blog,NOW-50,'failed');
 const page=await buildDashboardPage(db,user,NOW),data=page.dashboard!;
 assert.equal(data.citations.length,1);
 assert.deepEqual({checked:data.citations[0].checked,errors:data.citations[0].errors,cited:data.citations[0].cited,exposed:data.citations[0].exposed},{checked:3,errors:1,cited:2,exposed:2});
 assert.equal(data.citationState,'failed');assert.equal(data.citedPosts.length,2);
 assert.ok(data.citedPosts.every(p=>p.title.startsWith(user)));
 assert.equal(data.connected,true);assert.deepEqual(data.history,[]);
 const chosen=(await buildDashboardPage(db,user,NOW,'secondary_blog')).dashboard!;
 assert.equal(chosen.citations.length,1);assert.equal(chosen.citations[0].id,secondaryRun);
 assert.equal(chosen.citationHref,'/dashboard/ai-picks?blog=secondary_blog');
 const details=await buildAiPicksPage(db,user,NOW,'secondary_blog');
 for(const post of chosen.citedPosts)assert.ok(JSON.stringify(details).includes(post.id),'selected blog citation links resolve to the correct detail rows');
 await diagnoseBlog(db,{blog:'free_blog',peer:'test',userId:user},async()=>new Response('<rss><channel><title>무료 진단</title></channel></rss>'),NOW);
 const free=(await buildDashboardPage(db,user,NOW,'free_blog')).dashboard!;
 assert.equal(free.citations.length,0);assert.equal(free.citedPosts.length,0);assert.notEqual(free.citationState,'failed','unconnected report never inherits primary blog citation status');

 run(user,blog,NOW-1,'succeeded',['error']);
 const allErrors=(await buildDashboardPage(db,user,NOW,'viz_blog')).dashboard!;
 assert.equal(allErrors.citations[0].checked,0);assert.equal(allErrors.citations[0].errors,1);assert.equal(allErrors.citedPosts.length,0);
});
