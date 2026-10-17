import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {createApi} from '../../src/server/api';
import {rebuildLocalRecommendations,updateRecommendation} from '../../src/server/keywords/discovery-feed';
import {createRecommendationDraft} from '../../src/server/keywords/recommendation-writing';
import {updateDraft,deleteDraft} from '../../src/server/writing/drafts';
import {writingRecommendation,writingRecommendationBody,featuredWritingRecommendations} from '../../src/lib/writing-recommendation';

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const owner=await register(db,{email:'writing-owner@example.test',password:'writing-password-long',nickname:'글감 작성자',termsAccepted:true});
 const other=await register(db,{email:'writing-other@example.test',password:'writing-password-long',nickname:'다른 작성자',termsAccepted:true});
 const blog=createBlog(db,owner.user.id,{naverId:'writing_blog',title:'내 테크 블로그'});
 db.prepare('INSERT INTO blog_posts(id,blog_id,external_id,url,title,tags_json,category,collected_at) VALUES(?,?,?,?,?,?,?,?)')
  .run(randomUUID(),blog.id,'12345','https://blog.naver.com/writing_blog/12345','EvoOntology 설치 가이드','["EvoOntology"]','테크',Date.now());
 const feed=rebuildLocalRecommendations(db,owner.user.id,blog.id),item=feed.items[0];
 const origin='http://127.0.0.1:3000',before=process.env.NAEO_APP_URL;process.env.NAEO_APP_URL=origin;t.after(()=>{if(before===undefined)delete process.env.NAEO_APP_URL;else process.env.NAEO_APP_URL=before;});
 const handler=createApi(()=>db);
 const send=(value:unknown={version:item.version},token:string|null=owner.session.token,requestOrigin=origin)=>handler(new Request(`${origin}/api/recommendations/feed/${item.id}/draft`,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',...(token?{Cookie:`naeo_session=${token}`}:{})},body:JSON.stringify(value)}));
 return{db,owner,other,blog,item,send};
}

test('recommended draft HTTP preserves selected title, real source and owner, without tokens or completion changes',async t=>{
 const {db,owner,item,send}=await fixture(t);
 const ledger=db.prepare('SELECT count(*) AS n FROM credit_ledger WHERE owner_id=?').get(owner.user.id)?.n;
 const response=await send({version:item.version,titleIndex:2});assert.equal(response.status,201);
 const {draft,reused}=(await response.json()).data;
 assert.equal(reused,false);assert.equal(draft.title,writingRecommendation(item).titles[2]);
 assert.equal(draft.keyword,item.phrase);assert.equal(draft.status,'draft');assert.match(draft.body,/## 참고 자료/);assert.ok(draft.body.includes(item.sourcePost!.url));
 assert.equal(db.prepare('SELECT owner_id,recommendation_id FROM drafts WHERE id=?').get(draft.id)?.owner_id,owner.user.id);
 assert.equal(db.prepare('SELECT written FROM member_recommendations WHERE id=?').get(item.id)?.written,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM credit_ledger WHERE owner_id=?').get(owner.user.id)?.n,ledger);
});

test('recommended draft enforces session, same origin, ownership, optimistic version and strict input',async t=>{
 const {item,owner,other,send}=await fixture(t);
 assert.equal((await send(undefined,null)).status,401);
 assert.equal((await send(undefined,owner.session.token,'https://evil.example')).status,403);
 assert.equal((await send(undefined,other.session.token)).status,404);
 assert.equal((await send({version:item.version+1})).status,409);
 for(const value of [{version:item.version,titleIndex:3},{version:item.version,titleIndex:-1},{version:item.version,body:'untrusted body'},{}])assert.equal((await send(value)).status,400);
});

test('repeated starts preserve edits, deleting a draft allows rebuilding, deleting its blog keeps the draft',async t=>{
 const {db,owner,blog,item}=await fixture(t);
 const first=createRecommendationDraft(db,owner.user.id,item.id,{version:item.version});
 const edited=updateDraft(db,owner.user.id,first.draft.id,{version:first.draft.version,title:'직접 고친 제목',body:'직접 작성한 내용'});
 const again=createRecommendationDraft(db,owner.user.id,item.id,{version:item.version,titleIndex:1});
 assert.equal(again.reused,true);assert.equal(again.draft.id,edited.id);assert.equal(again.draft.body,edited.body);assert.equal(again.draft.title,edited.title);
 assert.equal(db.prepare('SELECT count(*) AS n FROM drafts').get()?.n,1);
 deleteDraft(db,owner.user.id,edited.id,{version:edited.version});
 const rebuilt=createRecommendationDraft(db,owner.user.id,item.id,{version:item.version});assert.notEqual(rebuilt.draft.id,edited.id);
 db.prepare('DELETE FROM blogs WHERE id=?').run(blog.id);
 assert.equal(db.prepare('SELECT recommendation_id FROM drafts WHERE id=?').get(rebuilt.draft.id)?.recommendation_id,null);
});

test('hidden or completed recommendations cannot create a draft',async t=>{
 const {db,owner,item}=await fixture(t);
 let changed=updateRecommendation(db,owner.user.id,item.id,{version:item.version,dismissed:true});
 assert.throws(()=>createRecommendationDraft(db,owner.user.id,item.id,{version:changed.version}),{code:'RECOMMENDATION_INACTIVE'});
 changed=updateRecommendation(db,owner.user.id,item.id,{version:changed.version,dismissed:false,written:true});
 assert.throws(()=>createRecommendationDraft(db,owner.user.id,item.id,{version:changed.version}),{code:'RECOMMENDATION_INACTIVE'});
 assert.equal(db.prepare('SELECT count(*) AS n FROM drafts').get()?.n,0);
});

test('plans distinguish FAQ, checklist and revision; featured topics are diverse and source content stays text',async t=>{
 const {item}=await fixture(t);
 assert.equal(writingRecommendation({...item,phrase:'EvoOntology 자주 묻는 질문'}).format,'질문과 답변');
 assert.equal(writingRecommendation({...item,phrase:'EvoOntology 체크리스트'}).format,'실전 체크리스트');
 assert.equal(writingRecommendation({...item,signal:'rewritten'}).format,'기존 글 보완');
 assert.equal(writingRecommendation({...item,alreadyPublished:true}).format,'기존 글 보완');
 const sample=(phrase:string,id:string,written=false)=>({...item,phrase,id,written});
 const featured=featuredWritingRecommendations([sample('첫글 정리','a'),sample('EvoOntology 정리','b'),sample('EvoOntology 체크리스트','c'),sample('데이터 분석 정리','d',true),sample('온톨로지 정리','e')]);
 assert.deepEqual(featured.map(r=>r.id),['b','e']);
 const body=writingRecommendationBody({...item,sourcePost:{...item.sourcePost!,title:'[실행](javascript:alert(1))\n## 주입'}});
 assert.ok(!body.includes('[실행](javascript:'));assert.ok(!body.includes('\n## 주입'));assert.ok(body.includes(item.sourcePost!.url));
});
