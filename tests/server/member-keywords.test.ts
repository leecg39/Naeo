import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../../src/server/database';
import {migrations} from '../../src/server/migrations';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {createApi} from '../../src/server/api';
import {datasets} from '../../src/server/privacy/datasets';
import {createKeyword,addKeywordMetric} from '../../src/server/keywords/admin-keywords';
import {listRecommendations,getRecommendation,setKeywordState} from '../../src/server/keywords/recommendations';
import {createMemberKeyword,updateMemberKeyword,deleteMemberKeyword,keywordSuggestions,measureMemberKeyword,MEMBER_KEYWORD_LIMIT} from '../../src/server/keywords/member-keywords';
const NOW=Date.parse('2026-10-17T06:00:00Z');
const ads={apiKey:'test-api-key-long',secret:'test-secret',customerId:'12345',baseUrl:'http://127.0.0.1:9999'};
const search={clientId:'test-client-long',clientSecret:'test-secret-long',baseUrl:'http://127.0.0.1:9998'};
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const a=await register(db,{email:'owner@example.test',password:'keyword-owner-long',nickname:'내 키워드',termsAccepted:true});
 const b=await register(db,{email:'other@example.test',password:'keyword-other-long',nickname:'다른 회원',termsAccepted:true});
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(b.user.id);
 return{db,a:a.user.id,b:b.user.id,token:a.session.token,otherToken:b.session.token};
}

test('personal CRUD is private, normalized, versioned and included only in the owner export',async t=>{
 const {db,a,b}=await fixture(t);
 const k=createMemberKeyword(db,a,{phrase:'  제주   여행 ',category:'여행',note:'비공개 메모'},NOW);
 assert.equal(k.phrase,'제주 여행');assert.equal(k.scope,'personal');assert.equal(k.total,null);
 assert.throws(()=>createMemberKeyword(db,a,{phrase:'제주여행'},NOW),{code:'KEYWORD_EXISTS'});
 assert.equal(listRecommendations(db,b,{},NOW).pagination.total,0);
 assert.throws(()=>updateMemberKeyword(db,b,k.id,{note:'침입',version:1}),{status:404});
 assert.throws(()=>deleteMemberKeyword(db,b,k.id,{version:1}),{status:404});
 const changed=updateMemberKeyword(db,a,k.id,{note:'작성 계획',favorite:true,version:1});
 assert.equal(changed.version,2);assert.equal(changed.note,'작성 계획');assert.equal(changed.favorite,true);
 assert.throws(()=>updateMemberKeyword(db,a,k.id,{note:'오래된 수정',version:1}),{code:'VERSION_CONFLICT'});
 const dataset=datasets.find(d=>d.name==='member_keywords')!;
 assert.equal(db.prepare(dataset.sql).all(a).length,1);assert.equal(db.prepare(dataset.sql).all(b).length,0);
 deleteMemberKeyword(db,a,k.id,{version:2});assert.equal(listRecommendations(db,a,{},NOW).pagination.total,0);
});

test('favorites and completion are independent for public and personal keywords',async t=>{
 const {db,a,b}=await fixture(t);
 for(const k of [createMemberKeyword(db,a,{phrase:'내 글감'},NOW),createKeyword(db,b,{phrase:'공개 글감'},NOW)]){
  const initial=getRecommendation(db,a,k.id);
  const saved=updateMemberKeyword(db,a,k.id,{favorite:true,version:initial.version});
  const done=updateMemberKeyword(db,a,k.id,{written:true,version:saved.version});
  assert.equal(done.favorite,true);assert.equal(done.written,true);
  const undone=updateMemberKeyword(db,a,k.id,{written:false,version:done.version});assert.equal(undone.favorite,true);
  assert.equal(listRecommendations(db,a,{filter:'saved'},NOW).data.some(r=>r.id===k.id),true);
 }
 const catalog=listRecommendations(db,a,{},NOW).data.find(r=>r.scope==='catalog')!;
 assert.throws(()=>updateMemberKeyword(db,a,catalog.id,{phrase:'전체 이름 변경',version:catalog.version}),{code:'CATALOG_READ_ONLY'});
 assert.throws(()=>deleteMemberKeyword(db,a,catalog.id,{version:catalog.version}),{code:'CATALOG_READ_ONLY'});
 assert.equal(getRecommendation(db,b,catalog.id).favorite,false);
 setKeywordState(db,a,catalog.id,{status:'written'});assert.equal(getRecommendation(db,a,catalog.id).favorite,true,'legacy completion preserves favorite');
});

test('filtering and sorting cover all pages, missing metrics stay last and pages clamp after deletion',async t=>{
 const {db,a,b}=await fixture(t);
 for(let i=0;i<52;i++){
  const k=createKeyword(db,b,{phrase:`공개 키워드 ${i}`,category:i%2?'여행':'요리'},NOW-i*1000);
  addKeywordMetric(db,b,k.id,{pcVolume:100+i*100,mobileVolume:100,documentCount:i===51?50:100000},NOW);
 }
 createMemberKeyword(db,a,{phrase:'지표 없는 개인 글감'},NOW);
 const golden=listRecommendations(db,a,{filter:'golden',pageSize:25},NOW);assert.equal(golden.pagination.total,1);assert.equal(golden.data[0].phrase,'공개 키워드 51');
 const sorted=listRecommendations(db,a,{sort:'total_desc',pageSize:25},NOW);assert.equal(sorted.data[0].phrase,'공개 키워드 51');
 assert.equal(listRecommendations(db,a,{sort:'total_asc',page:3,pageSize:25},NOW).data.at(-1)?.phrase,'지표 없는 개인 글감');
 assert.equal(listRecommendations(db,a,{category:'여행'},NOW).pagination.total,26);
 assert.equal(listRecommendations(db,a,{q:'%'},NOW).pagination.total,0);
 const last=listRecommendations(db,a,{page:999,pageSize:25},NOW);assert.equal(last.pagination.page,3);assert.equal(last.data.length,3);
 const personal=listRecommendations(db,a,{filter:'personal'},NOW).data[0];deleteMemberKeyword(db,a,personal.id,{version:personal.version});
 assert.equal(listRecommendations(db,a,{filter:'personal',page:2},NOW).pagination.page,1);
});

test('blog suggestions use only owned posts and skip keywords already in my list',async t=>{
 const {db,a,b}=await fixture(t);
 const mine=createBlog(db,a,{naverId:'mine_blog',title:'내 블로그'}),other=createBlog(db,b,{naverId:'other_blog',title:'타인'});
 for(const [blog,title,tags] of [[mine.id,'제주 산책 코스 정리',['제주여행','산책']],[mine.id,'제주 산책 두 번째',['제주여행']],[other.id,'비밀 주제 제목',['타인태그']]] as const){
  db.prepare('INSERT INTO blog_posts(id,blog_id,external_id,url,title,tags_json,category,collected_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),blog,randomUUID(),'https://blog.naver.com/mine_blog/1',title,JSON.stringify(tags),'여행',NOW);
 }
 const suggestions=keywordSuggestions(db,a);assert.equal(suggestions[0].phrase,'제주여행');assert.equal(suggestions[0].postCount,2);
 assert.ok(!JSON.stringify(suggestions).includes('타인태그'));
 createMemberKeyword(db,a,{phrase:'제주 여행'},NOW);assert.ok(!keywordSuggestions(db,a).some(s=>s.phrase==='제주여행'));
});

test('real provider adapter stores measured values, keeps missing documents unknown and invalidates metrics on rename',async t=>{
 const {db,a}=await fixture(t);let k=createMemberKeyword(db,a,{phrase:'제주 여행'},NOW);
 await assert.rejects(measureMemberKeyword(db,a,k.id,{version:1},{ads:null}),{code:'SEARCHAD_NOT_CONFIGURED'});
 const fetchImpl=async(url:string)=>new Response(JSON.stringify(url.includes('keywordstool')?{keywordList:[{relKeyword:'제주여행',monthlyPcQcCnt:500,monthlyMobileQcCnt:1500,compIdx:'낮음'}]}:{total:100,items:[]}));
 k=await measureMemberKeyword(db,a,k.id,{version:1},{ads,search:null,fetchImpl},NOW);
 assert.equal(k.total,2000);assert.equal(k.documentCount,null);assert.equal(k.saturation,null);assert.equal(k.golden,false);
 k=await measureMemberKeyword(db,a,k.id,{version:k.version},{ads,search,fetchImpl},NOW);
 assert.equal(k.documentCount,100);assert.equal(k.golden,true);
 const before=k.version;
 await assert.rejects(measureMemberKeyword(db,a,k.id,{version:before},{ads,search:null,fetchImpl:async()=>new Response(JSON.stringify({keywordList:[]}))},NOW),{code:'KEYWORD_METRIC_MISSING'});
 assert.equal(getRecommendation(db,a,k.id).total,2000,'missing results do not erase valid measurements');
 k=updateMemberKeyword(db,a,k.id,{phrase:'부산 여행',version:before});assert.equal(k.total,null);assert.equal(k.measuredAt,null);
});

test('in-flight metrics cannot overwrite a renamed or deleted keyword',async t=>{
 const {db,a}=await fixture(t);
 for(const remove of [false,true]){
  const k=createMemberKeyword(db,a,{phrase:remove?'삭제할 키워드':'바꿀 키워드'},NOW);
  await assert.rejects(measureMemberKeyword(db,a,k.id,{version:1},{ads,search:null,fetchImpl:async()=>{
   if(remove)deleteMemberKeyword(db,a,k.id,{version:1});else updateMemberKeyword(db,a,k.id,{phrase:'바뀐 키워드',version:1});
   return new Response(JSON.stringify({keywordList:[{relKeyword:k.phrase,monthlyPcQcCnt:1000,monthlyMobileQcCnt:1000}]}));
  }},NOW),{code:remove?'NOT_FOUND':'VERSION_CONFLICT'});
 }
});

test('personal quota, input bounds and account deletion cascade are enforced',async t=>{
 const {db,a}=await fixture(t);
 assert.throws(()=>createMemberKeyword(db,a,{phrase:' '.repeat(3)}),{name:'ZodError'});
 assert.throws(()=>createMemberKeyword(db,a,{phrase:'x'.repeat(61)}),{name:'ZodError'});
 const add=db.prepare('INSERT INTO member_keywords(id,owner_id,phrase,phrase_key,created_at,updated_at) VALUES(?,?,?,?,?,?)');
 for(let i=0;i<MEMBER_KEYWORD_LIMIT;i++)add.run(randomUUID(),a,`키워드${i}`,`키워드${i}`,NOW,NOW);
 assert.throws(()=>createMemberKeyword(db,a,{phrase:'초과'}),{code:'KEYWORD_LIMIT'});
 db.prepare('DELETE FROM users WHERE id=?').run(a);assert.equal(db.prepare('SELECT count(*) AS n FROM member_keywords').get()?.n,0);
});

test('member HTTP CRUD rejects other accounts and unauthenticated mutations',async t=>{
 const {db,token,otherToken}=await fixture(t),origin='http://127.0.0.1:3000';process.env.NAEO_APP_URL=origin;
 const handle=createApi(()=>db);
 const send=(path:string,method='GET',data?:unknown,cookie:string|null=token)=>handle(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:`naeo_session=${cookie}`}:{})},...(data?{body:JSON.stringify(data)}:{})}));
 assert.equal((await send('/api/recommendations','POST',{phrase:'내 글감'},null)).status,401);
 const response=await send('/api/recommendations','POST',{phrase:'내 글감'});assert.equal(response.status,201);const k=(await response.json()).data;
 assert.equal((await send(`/api/recommendations/${k.id}`,'PATCH',{favorite:true,version:1},otherToken)).status,404);
 assert.equal((await send(`/api/recommendations/${k.id}`,'PATCH',{favorite:true,written:true,version:1})).status,200);
 assert.equal((await send(`/api/recommendations/${k.id}`,'DELETE',{version:1})).status,409);
 assert.equal((await send(`/api/recommendations/${k.id}`,'DELETE',{version:2})).status,200);
 assert.equal((await send('/api/recommendations/suggestions')).status,200);
});

test('schema 46 upgrade preserves existing saved keyword favorites',async t=>{
 const temp=mkdtempSync(join(tmpdir(),'naeo-keyword-upgrade-')),path=join(temp,'db.sqlite');t.after(()=>rmSync(temp,{recursive:true,force:true}));
 const old=new DatabaseSync(path);old.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL) STRICT;');
 for(const m of migrations.filter(m=>m.version<47)){old.exec(m.sql);old.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(m.version,m.name,createHash('sha256').update(m.sql).digest('hex'),NOW);}
 const user=(await register(old,{email:'upgrade@example.test',password:'keyword-upgrade-long',nickname:'이전 회원',termsAccepted:true})).user.id;
 old.prepare("UPDATE users SET role='admin' WHERE id=?").run(user);const k=createKeyword(old,user,{phrase:'기존 즐겨찾기'},NOW);
 old.prepare("INSERT INTO saved_keywords(id,owner_id,keyword_id,status,note,created_at,updated_at) VALUES(?,?,?,'saved','기존 메모',?,?)").run(randomUUID(),user,k.id,NOW,NOW);old.close();
 const upgraded=openDatabase(path);t.after(()=>upgraded.close());
 const restored=getRecommendation(upgraded,user,k.id);assert.equal(restored.favorite,true);assert.equal(restored.note,'기존 메모');assert.equal(restored.written,false);
});
