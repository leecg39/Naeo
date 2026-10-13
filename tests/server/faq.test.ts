import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {applySeeds} from '../../src/server/content/seed';
import {extractFaq} from '../../scripts/content/extract-faq';
import {listPublishedFaq} from '../../src/server/content/faq';
import {listAdminFaq,createFaq,updateFaq,deleteFaq} from '../../src/server/content/admin-faq';
import {buildFaqPage} from '../../src/server/content/faq-pages';
import {isTrackingPixel} from '../../src/server/content/blog-pages';
import type {CapturedNode,CapturedPageData} from '../../src/types/site';

const seed=JSON.parse(readFileSync('src/data/content/faq.seed.json','utf8')) as {items:ReturnType<typeof extractFaq>};
const index=JSON.parse(readFileSync('src/data/page-index.json','utf8')) as Record<string,string>;
const captured=()=>{const p=JSON.parse(readFileSync('src/data/pages/'+index['/faq'],'utf8')) as CapturedPageData;return{...p,body:p.body.filter(n=>!isTrackingPixel(n))};};
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
const item=(over:Record<string,unknown>={})=>({category:'결제',question:'환불은 어떻게 하나요?',answer:'환불 규정을 확인해주세요.\n둘째 줄',status:'draft',position:100,...over});

test('committed FAQ seed is up to date with the capture',()=>{
 assert.deepEqual(extractFaq(),seed.items);
 assert.equal(seed.items.length,21);
 assert.equal(new Set(seed.items.map(i=>i.category)).size,2);
});

test('the seeded FAQ page is rebuilt from the database identically to the capture',async t=>{
 const {db}=await fixture(t);
 const built=await buildFaqPage(listPublishedFaq(db));
 const want=captured();
 assert.equal(built.title,want.title);
 assert.equal(JSON.stringify(merge(built.body)),JSON.stringify(merge(want.body)));
});

test('only admins manage FAQ',async t=>{
 const {db,member}=await fixture(t);
 assert.throws(()=>listAdminFaq(db,member,{}),{status:403});
 assert.throws(()=>createFaq(db,member,item()),{status:403});
});

test('FAQ create → publish → edit → hide → delete with versions and audit',async t=>{
 const {db,admin}=await fixture(t);
 const created=createFaq(db,admin,item());
 assert.equal(created.version,1);
 assert.ok(!listPublishedFaq(db).some(f=>f.id===created.id),'drafts are hidden');
 const published=updateFaq(db,admin,created.id,{status:'published',version:1});
 const pub=listPublishedFaq(db);
 assert.equal(pub.at(-1)?.id,created.id,'new category goes after existing ones by position');
 const edited=updateFaq(db,admin,created.id,{question:'환불 절차가 궁금해요',version:published.version});
 assert.equal(edited.question,'환불 절차가 궁금해요');assert.equal(edited.version,3);
 assert.throws(()=>updateFaq(db,admin,created.id,{answer:'x',version:2}),{status:409,code:'VERSION_CONFLICT'});
 const page=await buildFaqPage(listPublishedFaq(db));
 assert.ok(JSON.stringify(page.body).includes('환불 절차가 궁금해요'));
 assert.ok(JSON.stringify(page.body).includes('"결제"'),'new category heading rendered');
 updateFaq(db,admin,created.id,{status:'draft',version:3});
 assert.ok(!listPublishedFaq(db).some(f=>f.id===created.id));
 assert.throws(()=>deleteFaq(db,admin,created.id,{version:1}),{status:409});
 deleteFaq(db,admin,created.id,{version:4});
 assert.equal(listAdminFaq(db,admin,{q:'환불 절차'}).pagination.total,0);
 for(const a of ['content.faq.create','content.faq.update','content.faq.delete'])assert.ok(audits(db,a)>=1,a);
});

test('FAQ input is validated and rendered as text only',async t=>{
 const {db,admin}=await fixture(t);
 for(const bad of [item({question:''}),item({answer:''}),item({category:''}),item({category:'x'.repeat(41)}),item({answer:'x'.repeat(5001)}),item({extra:1}),item({status:'archived'})])
  assert.throws(()=>createFaq(db,admin,bad),{name:'ZodError'});
 createFaq(db,admin,item({status:'published',answer:'<img src=x onerror=alert(1)>'}));
 const page=await buildFaqPage(listPublishedFaq(db));
 const json=JSON.stringify(page.body);
 assert.ok(json.includes('<img src=x onerror=alert(1)>'),'kept as literal text');
 assert.ok(!json.includes('"onerror"'));
});

test('admin search and filters, empty FAQ still renders',async t=>{
 const {db,admin}=await fixture(t);
 assert.equal(listAdminFaq(db,admin,{}).pagination.total,21);
 assert.equal(listAdminFaq(db,admin,{q:'%'}).pagination.total,0,'LIKE wildcards escaped');
 const cat=seed.items[0].category;
 assert.equal(listAdminFaq(db,admin,{category:cat}).data.every(f=>f.category===cat),true);
 for(const f of listAdminFaq(db,admin,{pageSize:100}).data)deleteFaq(db,admin,f.id,{version:f.version});
 const page=await buildFaqPage([]);
 assert.ok(JSON.stringify(page.body).includes('mui-1thvpft'));
});
