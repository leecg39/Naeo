import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {cleanupExpiredDrafts,createDraft,DRAFT_TTL,getDraft,listDrafts,updateDraft,deleteDraft,restoreDraftRevision} from '../../src/server/writing/drafts';

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

test('saved drafts expire 30 days after the latest save while photos stay in the library',async t=>{
 const {db,a}=await fixture(t),now=Date.parse('2026-10-16T03:00:00Z');
 const expired=createDraft(db,a,{title:'만료 글',body:'본문'},now-DRAFT_TTL);
 const fresh=createDraft(db,a,{title:'유지 글',body:'본문'},now-DRAFT_TTL+1);
 db.prepare("INSERT INTO media_files(id,public_id,owner_id,draft_id,mime,size,storage_key,original_name,source,created_at) VALUES('m1','abcdefghijklmnopqrstuv',?,?, 'image/jpeg',9,'00000000-0000-4000-8000-000000000000.jpg','photo.jpg','upload',?)").run(a,expired.id,now-DRAFT_TTL);
 db.prepare("INSERT INTO media_markdown_links(token,public_id,owner_id,created_at) VALUES('zyxwvutsrqponmlkjihgfe','abcdefghijklmnopqrstuv',?,?)").run(a,now-DRAFT_TTL);
 db.prepare("INSERT INTO share_links(token,owner_id,draft_id,expires_at,created_at) VALUES('aaaaaaaaaaaaaaaaaaaaaa',?,?,?,?)").run(a,expired.id,now+DRAFT_TTL,now-DRAFT_TTL);
 assert.equal(getDraft(db,a,expired.id).expiresAt,now);
 assert.equal(cleanupExpiredDrafts(db,now),1,'the exact 30-day boundary is due');
 assert.throws(()=>getDraft(db,a,expired.id),{status:404});
 assert.equal(getDraft(db,a,fresh.id).id,fresh.id);
 assert.equal((db.prepare('SELECT draft_id AS draftId FROM media_files WHERE id=?').get('m1') as {draftId:string|null}).draftId,null,'photo remains detached');
 assert.equal((db.prepare('SELECT count(*) AS n FROM media_markdown_links').get() as {n:number}).n,1,'independent photo link remains');
 assert.equal((db.prepare('SELECT count(*) AS n FROM share_links').get() as {n:number}).n,0,'draft share link is removed');
 assert.equal((db.prepare('SELECT count(*) AS n FROM draft_revisions WHERE draft_id=?').get(expired.id) as {n:number}).n,0,'revisions are removed');
 assert.equal(cleanupExpiredDrafts(db,now),0,'cleanup is idempotent');
});

test('retention removes every due draft in one run even when more than 500 accumulated',async t=>{
 const {db,a}=await fixture(t),now=Date.parse('2026-10-16T03:00:00Z');
 const insert=db.prepare("INSERT INTO drafts(id,owner_id,title,keyword,category,body,status,version,created_at,updated_at) VALUES(?,?,?,'','','','draft',1,?,?)");
 for(let i=0;i<501;i++)insert.run(`expired-${i}`,a,`만료 글 ${i}`,now-DRAFT_TTL,now-DRAFT_TTL);
 assert.equal(cleanupExpiredDrafts(db,now),501);
 assert.equal((db.prepare('SELECT count(*) AS n FROM drafts').get() as {n:number}).n,0);
});
