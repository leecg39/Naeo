import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {applySeeds} from '../../src/server/content/seed';
import {extractUpdates} from '../../scripts/content/extract-updates';
import {listPublishedUpdates} from '../../src/server/content/updates';
import {listAdminUpdates,getAdminUpdate,createUpdate,updateUpdate,deleteUpdate} from '../../src/server/content/admin-updates';
import {buildUpdatesPage} from '../../src/server/content/updates-pages';
import {isTrackingPixel} from '../../src/server/content/blog-pages';
import type {CapturedNode,CapturedPageData} from '../../src/types/site';

const seed=JSON.parse(readFileSync('src/data/content/updates.seed.json','utf8')) as {updates:ReturnType<typeof extractUpdates>};
const index=JSON.parse(readFileSync('src/data/page-index.json','utf8')) as Record<string,string>;
const captured=()=>{const p=JSON.parse(readFileSync('src/data/pages/'+index['/updates'],'utf8')) as CapturedPageData;return{...p,body:p.body.filter(n=>!isTrackingPixel(n))};};
/** 텍스트 분할, 속성 순서, 이미지 로딩 클래스, style 공백·세미콜론 표기만 무시한다. */
function normalize(nodes:CapturedNode[]):CapturedNode[]{
 const out:CapturedNode[]=[];
 for(const n of nodes){
  if(typeof n==='string'){if(typeof out.at(-1)==='string')out[out.length-1]+=n;else out.push(n);continue;}
  const attrs=Object.fromEntries(Object.entries(n.attrs).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,k==='class'?v.split(/\s+/).filter(c=>c&&c!=='loaded').join(' '):k==='style'?v.replace(/\s+/g,'').replace(/;$/,''):v]));
  out.push({tag:n.tag,attrs,children:normalize(n.children)});
 }
 return out;
}
function firstDiff(a:unknown,b:unknown){const A=JSON.stringify(a),B=JSON.stringify(b);let i=0;while(i<A.length&&A[i]===B[i])i++;return`\n built: ${A.slice(Math.max(0,i-120),i+120)}\n want:  ${B.slice(Math.max(0,i-120),i+120)}`;}
const audits=(db:Database,action:string)=>(db.prepare('SELECT count(*) AS n FROM audit_logs WHERE action=?').get(action) as {n:number}).n;

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());applySeeds(db);
 const admin=(await register(db,{email:'admin@example.test',password:'admin-long-password',nickname:'관리자',termsAccepted:true})).user;
 const member=(await register(db,{email:'member@example.test',password:'member-long-password',nickname:'회원',termsAccepted:true})).user;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
 return{db,admin:admin.id,member:member.id};
}
const draft=(over:Record<string,unknown>={})=>({slug:'2026-10-13-qa-release',versionLabel:'v1.16.0',types:['fix'],title:'QA 릴리스',summary:'QA 요약',bodyMarkdown:'## 바뀐 점\n\n본문입니다.',publishedOn:'2026-10-13',status:'draft',...over});

test('committed updates seed is up to date with the capture',()=>{
 assert.deepEqual(extractUpdates(),seed.updates);
 assert.equal(seed.updates.length,23);
});

test('the seeded /updates page is rebuilt from the database identically to the capture',async t=>{
 const {db}=await fixture(t);
 const built=await buildUpdatesPage(listPublishedUpdates(db));
 const want=captured();
 assert.equal(built.title,want.title);
 const [x,y]=[normalize(built.body),normalize(want.body)];
 assert.ok(JSON.stringify(x)===JSON.stringify(y),firstDiff(x,y));
});

test('only admins manage updates',async t=>{
 const {db,member}=await fixture(t);
 assert.throws(()=>listAdminUpdates(db,member,{}),{status:403});
 assert.throws(()=>createUpdate(db,member,draft()),{status:403});
});

test('update create → publish → edit → hide → delete, new month group and filter counts',async t=>{
 const {db,admin}=await fixture(t);
 const created=createUpdate(db,admin,draft());
 assert.equal(created.version,1);
 assert.ok(!listPublishedUpdates(db).some(u=>u.id===created.id),'drafts are hidden');
 const published=updateUpdate(db,admin,created.id,{status:'published',version:1});
 assert.equal(listPublishedUpdates(db)[0].id,created.id,'newest first');
 const page=JSON.stringify((await buildUpdatesPage(listPublishedUpdates(db))).body);
 assert.ok(page.includes('"2026년 10월"'),'new month group');
 assert.ok(page.includes('"id":"2026-10-13-qa-release"'));
 assert.ok(page.includes('"버그 수정"," (","1",")"')||page.includes('버그 수정 (1)'),'fix filter count');
 const edited=updateUpdate(db,admin,created.id,{title:'QA 릴리스 수정',version:published.version});
 assert.equal(edited.version,3);
 assert.throws(()=>updateUpdate(db,admin,created.id,{title:'x',version:2}),{status:409,code:'VERSION_CONFLICT'});
 assert.equal(getAdminUpdate(db,admin,created.id).title,'QA 릴리스 수정');
 updateUpdate(db,admin,created.id,{status:'draft',version:3});
 assert.ok(!listPublishedUpdates(db).some(u=>u.id===created.id));
 deleteUpdate(db,admin,created.id,{version:4});
 assert.throws(()=>getAdminUpdate(db,admin,created.id),{status:404});
 for(const a of ['content.update.create','content.update.update','content.update.delete'])assert.ok(audits(db,a)>=1,a);
});

test('update input is validated: slug, unique slug, types, date, unsafe markdown',async t=>{
 const {db,admin}=await fixture(t);
 for(const bad of [draft({slug:'Bad Slug'}),draft({types:[]}),draft({types:['spam']}),draft({types:['fix','fix']}),draft({publishedOn:'2026-13-01'}),draft({title:''}),draft({extra:1})])
  assert.throws(()=>createUpdate(db,admin,bad),{name:'ZodError'});
 assert.throws(()=>createUpdate(db,admin,draft({slug:seed.updates[0].slug})),{status:409,code:'SLUG_EXISTS'});
 assert.throws(()=>createUpdate(db,admin,draft({bodyMarkdown:'[x](javascript:alert(1))'})),{status:400,code:'CONTENT_INVALID'});
 assert.throws(()=>createUpdate(db,admin,draft({bodyMarkdown:'<script>alert(1)</script>'})),{status:400,code:'CONTENT_INVALID'});
});
