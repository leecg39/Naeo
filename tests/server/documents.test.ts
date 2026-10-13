import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {applySeeds} from '../../src/server/content/seed';
import {extractDocuments} from '../../scripts/content/extract-documents';
import {parseSections,getPublishedDocument,documentRouteState} from '../../src/server/content/documents';
import {listAdminDocuments,getAdminDocument,createDocument,updateDocument,deleteDocument,restoreDocumentRevision} from '../../src/server/content/admin-documents';
import {buildDocumentPage} from '../../src/server/content/document-pages';
import {isTrackingPixel} from '../../src/server/content/blog-pages';
import type {CapturedNode,CapturedPageData} from '../../src/types/site';

const seed=JSON.parse(readFileSync('src/data/content/documents.seed.json','utf8')) as {documents:ReturnType<typeof extractDocuments>};
const index=JSON.parse(readFileSync('src/data/page-index.json','utf8')) as Record<string,string>;
const captured=(route:string)=>{const p=JSON.parse(readFileSync('src/data/pages/'+index[route],'utf8')) as CapturedPageData;return{...p,body:p.body.filter(n=>!isTrackingPixel(n))};};
const merge=(nodes:CapturedNode[]):CapturedNode[]=>nodes.reduce<CapturedNode[]>((out,n)=>{
 if(typeof n==='string'){const last=out.at(-1);return typeof last==='string'?[...out.slice(0,-1),last+n]:[...out,n];}
 return[...out,{...n,children:merge(n.children)}];
},[]);
const audits=(db:Database,action:string)=>(db.prepare('SELECT count(*) AS n FROM audit_logs WHERE action=?').get(action) as {n:number}).n;

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());applySeeds(db);
 const admin=(await register(db,{email:'admin@example.test',password:'admin-long-password',nickname:'관리자',termsAccepted:true})).user;
 const member=(await register(db,{email:'member@example.test',password:'member-long-password',nickname:'회원',termsAccepted:true})).user;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
 return{db,admin:admin.id,member:member.id};
}
const draft=(over:Record<string,unknown>={})=>({path:'/youth-policy',title:'청소년 보호정책',effectiveLabel:'시행일: 2026년 10월 13일',body:'## 목적\n이 정책은 청소년을 보호합니다.\n\n## 책임자\n운영팀',closingNote:'',status:'draft',...over});

test('committed document seed is up to date with the captured pages',()=>{
 assert.deepEqual(extractDocuments(),seed.documents);
 assert.deepEqual(seed.documents.map(d=>d.path),['/terms','/privacy','/privacy/extension','/refund']);
});

test('section parser splits on "## " lines and round-trips the seed bodies',()=>{
 assert.deepEqual(parseSections('## 가\n본문1\n\n## 나\n본문2'),{preface:'',sections:[{heading:'가',text:'본문1'},{heading:'나',text:'본문2'}]});
 assert.deepEqual(parseSections('머리말\n## 가\n한 줄\n## 나\n'),{preface:'머리말',sections:[{heading:'가',text:'한 줄'},{heading:'나',text:''}]});
 for(const d of seed.documents){
  const {sections}=parseSections(d.body);
  assert.equal(sections.map(s=>`## ${s.heading}\n${s.text}`).join('\n\n'),d.body,d.path);
 }
});

test('every seeded document page is rebuilt from the database identically to the capture',async t=>{
 const {db}=await fixture(t);
 for(const d of seed.documents){
  const doc=getPublishedDocument(db,d.path);
  assert.ok(doc,d.path);
  const built=await buildDocumentPage(doc);
  const want=captured(d.path);
  assert.equal(built.title,want.title,d.path);
  assert.equal(built.css,want.css,d.path);
  assert.equal(JSON.stringify(merge(built.body)),JSON.stringify(merge(want.body)),d.path);
 }
});

test('only admins manage documents',async t=>{
 const {db,member}=await fixture(t);
 assert.throws(()=>listAdminDocuments(db,member,{}),{status:403});
 assert.throws(()=>createDocument(db,member,draft()),{status:403});
});

test('document create → publish → edit → restore → unpublish → delete with versions and audit',async t=>{
 const {db,admin}=await fixture(t);
 const created=createDocument(db,admin,draft());
 assert.equal(created.version,1);assert.equal(created.status,'draft');
 assert.equal(getPublishedDocument(db,'/youth-policy'),null,'drafts are not public');
 assert.equal(documentRouteState(db,'/youth-policy'),'hidden');
 const published=updateDocument(db,admin,created.id,{status:'published',version:1});
 assert.equal(getPublishedDocument(db,'/youth-policy')?.title,'청소년 보호정책');
 assert.equal(documentRouteState(db,'/youth-policy'),'published');
 const edited=updateDocument(db,admin,created.id,{title:'청소년 보호 정책',body:'## 목적\n바뀐 본문',version:published.version});
 assert.equal(edited.version,3);
 assert.throws(()=>updateDocument(db,admin,created.id,{title:'오래된',version:2}),{status:409,code:'VERSION_CONFLICT'});
 const detail=getAdminDocument(db,admin,created.id);
 assert.deepEqual(detail.revisions.map(r=>r.version),[3,2,1]);
 const restored=restoreDocumentRevision(db,admin,created.id,{revision:1,version:3});
 assert.equal(restored.title,'청소년 보호정책');assert.equal(restored.status,'published','restore keeps the current status');
 const hidden=updateDocument(db,admin,created.id,{status:'draft',version:restored.version});
 assert.equal(getPublishedDocument(db,'/youth-policy'),null);
 assert.throws(()=>deleteDocument(db,admin,created.id,{version:1}),{status:409});
 deleteDocument(db,admin,created.id,{version:hidden.version});
 assert.throws(()=>getAdminDocument(db,admin,created.id),{status:404});
 assert.equal((db.prepare("SELECT count(*) AS n FROM content_revisions WHERE resource_type='document' AND resource_id=?").get(created.id) as {n:number}).n,0);
 assert.equal(documentRouteState(db,'/youth-policy'),'none');
 for(const a of ['content.document.create','content.document.update','content.document.restore','content.document.delete'])assert.ok(audits(db,a)>=1,a);
});

test('seeded legal pages stay 404 after unpublish or delete instead of falling back to the capture',async t=>{
 const {db,admin}=await fixture(t);
 const terms=listAdminDocuments(db,admin,{q:'/terms'}).data.find(d=>d.path==='/terms')!;
 deleteDocument(db,admin,terms.id,{version:terms.version});
 assert.equal(documentRouteState(db,'/terms'),'hidden');
 applySeeds(db);
 assert.equal(getPublishedDocument(db,'/terms'),null,'seed does not resurrect deleted documents');
});

test('document paths are validated, unique, and cannot take over other screens',async t=>{
 const {db,admin}=await fixture(t);
 assert.throws(()=>createDocument(db,admin,draft({path:'/terms'})),{status:409,code:'PATH_EXISTS'});
 for(const path of ['/admin/x','/api/terms','/blog/legal','/dashboard','/login','/pricing','/updates/x','/','/Terms','/a//b','/a/'])
  assert.throws(()=>createDocument(db,admin,draft({path})),(e:{status?:number;name?:string})=>e.status===409||e.name==='ZodError',path);
 assert.throws(()=>createDocument(db,admin,draft({body:'x'.repeat(100001)})),{name:'ZodError'});
 assert.throws(()=>createDocument(db,admin,draft({title:''})),{name:'ZodError'});
 assert.throws(()=>createDocument(db,admin,draft({extra:1})),{name:'ZodError'});
 const doc=createDocument(db,admin,draft());
 assert.throws(()=>updateDocument(db,admin,doc.id,{path:'/refund',version:1}),{status:409,code:'PATH_EXISTS'});
});

test('document text is rendered as text nodes, never as HTML',async t=>{
 const {db,admin}=await fixture(t);
 const doc=createDocument(db,admin,draft({status:'published',body:'## <script>alert(1)</script>\n<img src=x onerror=alert(1)>'}));
 const page=await buildDocumentPage(getPublishedDocument(db,doc.path)!);
 const tags=new Set<string>();
 const walk=(n:CapturedNode)=>{if(typeof n!=='string'){tags.add(n.tag);n.children.forEach(walk);}};
 page.body.forEach(walk);
 assert.ok(!tags.has('script'),'no script element created from document text');
 assert.ok(!JSON.stringify(page.body).includes('"onerror"'),'no event handler attribute created');
 assert.ok(JSON.stringify(page.body).includes('<script>alert(1)</script>'),'kept as literal text');
});
