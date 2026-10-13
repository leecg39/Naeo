import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createDraft,getDraft,listDrafts,updateDraft,deleteDraft,restoreDraftRevision} from '../../src/server/writing/drafts';

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const a=(await register(db,{email:'a@example.test',password:'draft-long-password',nickname:'A',termsAccepted:true})).user.id;
 const b=(await register(db,{email:'b@example.test',password:'draft-long-password',nickname:'B',termsAccepted:true})).user.id;
 return{db,a,b};
}
const audits=(db:Database,action:string)=>(db.prepare('SELECT count(*) AS n FROM audit_logs WHERE action=?').get(action) as {n:number}).n;

test('draft CRUD is owner-scoped with versions and revision history',async t=>{
 const {db,a,b}=await fixture(t);
 const d=createDraft(db,a,{title:'제주 여행 코스',keyword:'제주 여행',category:'여행',body:'## 첫날\n\n공항에서 출발'});
 assert.equal(d.status,'draft');assert.equal(d.version,1);
 assert.throws(()=>getDraft(db,b,d.id),{status:404});
 assert.throws(()=>updateDraft(db,b,d.id,{title:'남의 글',version:1}),{status:404});
 const v2=updateDraft(db,a,d.id,{body:'## 첫날\n\n공항에서 렌터카',version:1});
 assert.equal(v2.version,2);
 assert.throws(()=>updateDraft(db,a,d.id,{title:'오래된 화면',version:1}),{status:409,code:'VERSION_CONFLICT'});
 const detail=getDraft(db,a,d.id);
 assert.deepEqual(detail.revisions.map(r=>r.version),[2,1]);
 const restored=restoreDraftRevision(db,a,d.id,{revision:1,version:2});
 assert.equal(restored.body,'## 첫날\n\n공항에서 출발');assert.equal(restored.version,3);
 assert.throws(()=>deleteDraft(db,a,d.id,{version:1}),{status:409});
 deleteDraft(db,a,d.id,{version:3});
 assert.throws(()=>getDraft(db,a,d.id),{status:404});
 assert.equal((db.prepare('SELECT count(*) AS n FROM draft_revisions').get() as {n:number}).n,0,'revisions removed with the draft');
 for(const x of ['draft.create','draft.update','draft.restore','draft.delete'])assert.ok(audits(db,x)>=1,x);
});

test('status transitions are restricted',async t=>{
 const {db,a}=await fixture(t);
 const d=createDraft(db,a,{title:'글',body:'본문'});
 const ready=updateDraft(db,a,d.id,{status:'ready',version:1});
 assert.equal(ready.status,'ready');
 const published=updateDraft(db,a,d.id,{status:'published',version:2});
 assert.ok(published.publishedAt);
 assert.throws(()=>updateDraft(db,a,d.id,{status:'draft',version:3}),{status:409,code:'INVALID_TRANSITION'},'published cannot go back to draft');
 assert.equal(updateDraft(db,a,d.id,{status:'archived',version:3}).status,'archived');
 const empty=createDraft(db,a,{title:'빈 글',body:''});
 assert.throws(()=>updateDraft(db,a,empty.id,{status:'ready',version:1}),{status:409,code:'DRAFT_EMPTY'},'empty body cannot be marked ready');
});

test('validation, search, status filter and paging',async t=>{
 const {db,a,b}=await fixture(t);
 for(const bad of [{title:''},{title:'x'.repeat(201)},{title:'t',body:'x'.repeat(100001)},{title:'t',keyword:'x'.repeat(61)},{title:'t',extra:1}])
  assert.throws(()=>createDraft(db,a,bad),{name:'ZodError'});
 for(let i=0;i<25;i++)createDraft(db,a,{title:`글 ${String(i).padStart(2,'0')}`,keyword:i%2?'제주':'서울',body:'본문'});
 createDraft(db,b,{title:'B의 글',body:'본문'});
 const page1=listDrafts(db,a,{pageSize:10});
 assert.equal(page1.pagination.total,25);assert.equal(page1.data.length,10);
 assert.equal(listDrafts(db,a,{pageSize:10,page:3}).data.length,5);
 assert.equal(listDrafts(db,a,{q:'제주'}).pagination.total,12,'search title/keyword');
 assert.equal(listDrafts(db,a,{q:'%'}).pagination.total,0,'LIKE escaped');
 assert.equal(listDrafts(db,a,{status:'ready'}).pagination.total,0);
 assert.equal(listDrafts(db,b,{}).pagination.total,1);
 assert.ok(!('body' in page1.data[0]),'list omits bodies');
});
