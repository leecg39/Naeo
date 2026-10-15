import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';
import {applySeeds} from '../../src/server/content/seed';

const origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
const password='content-http-test-password';

test('banner metadata API enforces role/origin, round-trips fields, clears metadata and deletes',async t=>{
 const f=fixture(t),admin=await account(f,'banner-admin@example.test',true),member=await account(f,'banner-member@example.test');
 const body={title:'배너',status:'published',target:'all',metadata:{display:'banner',image:'/banner.png',imageMobile:'/mobile.png',ratio:'16 / 9',ratioMobile:'4 / 5',exactPath:'/event',ctaLabel:'열기'}};
 assert.equal((await f.send('/api/admin/announcements','POST',body,member)).status,403);
 assert.equal((await f.send('/api/admin/announcements','POST',body,admin,{Origin:'https://evil.test'})).status,403);
 const result=await f.send('/api/admin/announcements','POST',body,admin);assert.equal(result.status,201);
 const a=(await result.json()).data;assert.deepEqual(a.metadata,body.metadata);
 const listed=await (await f.send('/api/admin/announcements','GET',undefined,admin)).json();
 assert.deepEqual(listed.data.find((x:{id:string})=>x.id===a.id).metadata,body.metadata);
 assert.equal((await f.send(`/api/admin/announcements/${a.id}`,'PATCH',{version:1,metadata:{ratio:'1/0'}},admin)).status,400);
 const cleared=await f.send(`/api/admin/announcements/${a.id}`,'PATCH',{version:1,metadata:{}},admin);
 assert.equal(cleared.status,200);assert.deepEqual((await cleared.json()).data.metadata,{});
 assert.equal((await f.send(`/api/admin/announcements/${a.id}`,'DELETE',{version:1},admin)).status,409);
 assert.equal((await f.send(`/api/admin/announcements/${a.id}`,'DELETE',{version:2},admin)).status,200);
});
function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());applySeeds(db);
 const handler=createApi(()=>db);
 const send=(path:string,method='GET',body?:unknown,cookie?:string,headers:Record<string,string>={})=>handler(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}));
 return{db,send};
}
async function account(f:ReturnType<typeof fixture>,email:string,admin=false){
 const r=await f.send('/api/auth/register','POST',{email,password,nickname:'콘텐츠',termsAccepted:true});
 assert.equal(r.status,201);
 const id=(await r.json()).data.user.id as string;
 if(admin)f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(id);
 return r.headers.get('set-cookie')!.split(';')[0];
}
const marketingId=(f:ReturnType<typeof fixture>)=>(f.db.prepare("SELECT id FROM article_categories WHERE slug='marketing'").get() as {id:string}).id;

test('content admin API enforces authentication, admin role and origin',async t=>{
 const f=fixture(t);const member=await account(f,'member@example.test');const admin=await account(f,'admin@example.test',true);
 assert.equal((await f.send('/api/admin/articles')).status,401);
 for(const [path,method] of [['/api/admin/articles','GET'],['/api/admin/articles','POST'],['/api/admin/article-categories','GET'],['/api/admin/articles/preview','POST']] as const)
  assert.equal((await f.send(path,method,method==='POST'?{}:undefined,member)).status,403,path+' '+method);
 assert.equal((await f.send('/api/admin/articles','POST',{},admin,{Origin:'https://evil.example'})).status,403);
});

test('article create/read/update/publish/delete over HTTP, including bodies over 32KB',async t=>{
 const f=fixture(t);const admin=await account(f,'admin@example.test',true);
 const big='## 긴 글\n\n'+'가나다라마바사아자차카타파하 '.repeat(4000);
 assert.ok(Buffer.byteLength(JSON.stringify({bodyMarkdown:big}))>32*1024);
 const created=await f.send('/api/admin/articles','POST',{categoryId:marketingId(f),slug:'http-article',title:'HTTP 글',bodyMarkdown:big,status:'draft'},admin);
 assert.equal(created.status,201);
 const a=(await created.json()).data;
 assert.equal(a.url,'/blog/marketing/http-article');assert.ok(a.readMinutes>100);
 const detail=(await (await f.send(`/api/admin/articles/${a.id}`,'GET',undefined,admin)).json()).data;
 assert.deepEqual(detail.revisions.map((r:{version:number})=>r.version),[1]);
 const conflict=await f.send(`/api/admin/articles/${a.id}`,'PATCH',{title:'x',version:9},admin);
 assert.equal(conflict.status,409);assert.equal((await conflict.json()).error.code,'VERSION_CONFLICT');
 const pub=await f.send(`/api/admin/articles/${a.id}`,'PATCH',{status:'published',version:1},admin);
 assert.equal(pub.status,200);assert.equal((await pub.json()).data.status,'published');
 const list=(await (await f.send('/api/admin/articles?status=published&q=HTTP','GET',undefined,admin)).json());
 assert.equal(list.pagination.total,1);
 const unsafe=await f.send('/api/admin/articles','POST',{categoryId:marketingId(f),slug:'unsafe',title:'x',bodyMarkdown:'[x](javascript:alert(1))'},admin);
 assert.equal(unsafe.status,400);const err=(await unsafe.json()).error;assert.equal(err.code,'CONTENT_INVALID');assert.ok(err.details[0].includes('javascript:'));
 assert.equal((await f.send(`/api/admin/articles/${a.id}`,'DELETE',{version:2},admin)).status,200);
 assert.equal((await f.send(`/api/admin/articles/${a.id}`,'GET',undefined,admin)).status,404);
});

test('non-article endpoints keep the 32KB body limit',async t=>{
 const f=fixture(t);const admin=await account(f,'admin@example.test',true);
 const r=await f.send('/api/admin/article-categories','POST',{slug:'big',name:'x'.repeat(40*1024)},admin);
 assert.equal(r.status,413);
});

test('category endpoints and revision restore over HTTP',async t=>{
 const f=fixture(t);const admin=await account(f,'admin@example.test',true);
 const c=(await (await f.send('/api/admin/article-categories','POST',{slug:'tips',name:'팁'},admin)).json()).data;
 assert.equal((await f.send('/api/admin/article-categories','POST',{slug:'tips',name:'팁'},admin)).status,409);
 assert.equal((await f.send(`/api/admin/article-categories/${c.id}`,'PATCH',{name:'블로그 팁',version:1},admin)).status,200);
 const inUse=await f.send(`/api/admin/article-categories/${marketingId(f)}`,'DELETE',{version:1},admin);
 assert.equal(inUse.status,409);assert.equal((await inUse.json()).error.code,'CATEGORY_IN_USE');
 assert.equal((await f.send(`/api/admin/article-categories/${c.id}`,'DELETE',{version:2},admin)).status,200);
 const a=(await (await f.send('/api/admin/articles','POST',{categoryId:marketingId(f),slug:'restore-me',title:'처음'},admin)).json()).data;
 await f.send(`/api/admin/articles/${a.id}`,'PATCH',{title:'두 번째',version:1},admin);
 const restored=await f.send(`/api/admin/articles/${a.id}/restore`,'POST',{revision:1,version:2},admin);
 assert.equal(restored.status,200);assert.equal((await restored.json()).data.title,'처음');
 const preview=(await (await f.send('/api/admin/articles/preview','POST',{bodyMarkdown:'## 제목'},admin)).json()).data;
 assert.deepEqual(preview.headings.map((h:{id:string})=>h.id),['제목']);
});

test('document admin API: permissions, CRUD, path conflicts and restore over HTTP',async t=>{
 const f=fixture(t);const member=await account(f,'member@example.test');const admin=await account(f,'admin@example.test',true);
 assert.equal((await f.send('/api/admin/documents')).status,401);
 assert.equal((await f.send('/api/admin/documents','GET',undefined,member)).status,403);
 const list=await (await f.send('/api/admin/documents','GET',undefined,admin)).json();
 assert.deepEqual(list.data.map((d:{path:string})=>d.path),['/terms','/privacy','/privacy/extension','/refund']);
 const created=await f.send('/api/admin/documents','POST',{path:'/youth-policy',title:'청소년 보호정책',body:'## 목적\n본문'},admin);
 assert.equal(created.status,201);
 const d=(await created.json()).data;
 assert.equal(d.status,'draft');
 const dup=await f.send('/api/admin/documents','POST',{path:'/refund',title:'중복'},admin);
 assert.equal(dup.status,409);assert.equal((await dup.json()).error.code,'PATH_EXISTS');
 const reserved=await f.send('/api/admin/documents','POST',{path:'/pricing',title:'가로채기'},admin);
 assert.equal((await reserved.json()).error.code,'PATH_RESERVED');
 const bad=await f.send('/api/admin/documents','POST',{path:'no-slash',title:'x'},admin);
 assert.equal(bad.status,400);
 const edited=await f.send(`/api/admin/documents/${d.id}`,'PATCH',{title:'바뀐 제목',status:'published',version:1},admin);
 assert.equal((await edited.json()).data.version,2);
 assert.equal((await f.send(`/api/admin/documents/${d.id}`,'PATCH',{title:'x',version:1},admin)).status,409);
 const restored=await f.send(`/api/admin/documents/${d.id}/restore`,'POST',{revision:1,version:2},admin);
 assert.equal((await restored.json()).data.title,'청소년 보호정책');
 assert.equal((await f.send(`/api/admin/documents/${d.id}`,'DELETE',{version:3},admin)).status,200);
 assert.equal((await f.send(`/api/admin/documents/${d.id}`,'GET',undefined,admin)).status,404);
});

test('FAQ admin API: permissions, CRUD, validation and version conflict over HTTP',async t=>{
 const f=fixture(t);const member=await account(f,'member@example.test');const admin=await account(f,'admin@example.test',true);
 assert.equal((await f.send('/api/admin/faq')).status,401);
 assert.equal((await f.send('/api/admin/faq','GET',undefined,member)).status,403);
 const list=await (await f.send('/api/admin/faq?pageSize=100','GET',undefined,admin)).json();
 assert.equal(list.pagination.total,21);assert.equal(list.categories.length,2);
 const created=await f.send('/api/admin/faq','POST',{category:'결제',question:'HTTP 질문',answer:'HTTP 답변'},admin);
 assert.equal(created.status,201);
 const item=(await created.json()).data;
 assert.equal((await f.send('/api/admin/faq','POST',{category:'결제',question:'',answer:'x'},admin)).status,400);
 const edited=await f.send(`/api/admin/faq/${item.id}`,'PATCH',{status:'published',version:1},admin);
 assert.equal((await edited.json()).data.version,2);
 const stale=await f.send(`/api/admin/faq/${item.id}`,'PATCH',{answer:'x',version:1},admin);
 assert.equal(stale.status,409);
 assert.equal((await f.send(`/api/admin/faq/${item.id}`,'DELETE',{version:2},admin)).status,200);
 assert.equal((await f.send(`/api/admin/faq/${item.id}`,'DELETE',{version:2},admin)).status,404);
});

test('updates admin API: permissions, CRUD, unsafe body and slug conflict over HTTP',async t=>{
 const f=fixture(t);const member=await account(f,'member@example.test');const admin=await account(f,'admin@example.test',true);
 assert.equal((await f.send('/api/admin/updates')).status,401);
 assert.equal((await f.send('/api/admin/updates','GET',undefined,member)).status,403);
 const list=await (await f.send('/api/admin/updates?type=feature&pageSize=100','GET',undefined,admin)).json();
 assert.equal(list.pagination.total,14);
 const body={slug:'2026-10-13-http',versionLabel:'v9.9.9',types:['fix'],title:'HTTP 업데이트',bodyMarkdown:'## 변경\n\n내용',publishedOn:'2026-10-13'};
 const created=await f.send('/api/admin/updates','POST',body,admin);
 assert.equal(created.status,201);
 const u=(await created.json()).data;
 assert.equal((await f.send('/api/admin/updates','POST',body,admin)).status,409);
 const unsafe=await f.send('/api/admin/updates','POST',{...body,slug:'unsafe',bodyMarkdown:'<iframe src=x>'},admin);
 assert.equal((await unsafe.json()).error.code,'CONTENT_INVALID');
 assert.equal((await (await f.send(`/api/admin/updates/${u.id}`,'PATCH',{status:'published',version:1},admin)).json()).data.version,2);
 assert.equal((await f.send(`/api/admin/updates/${u.id}`,'PATCH',{title:'x',version:1},admin)).status,409);
 assert.equal((await f.send(`/api/admin/updates/${u.id}`,'DELETE',{version:2},admin)).status,200);
 assert.equal((await f.send(`/api/admin/updates/${u.id}`,'GET',undefined,admin)).status,404);
});

test('announcement admin API: permissions, CRUD, unsafe links and conflicts over HTTP',async t=>{
 const f=fixture(t);const member=await account(f,'member@example.test');const admin=await account(f,'admin@example.test',true);
 assert.equal((await f.send('/api/admin/announcements')).status,401);
 assert.equal((await f.send('/api/admin/announcements','POST',{title:'x'},member)).status,403);
 const created=await f.send('/api/admin/announcements','POST',{title:'HTTP 공지',linkUrl:'/updates',linkLabel:'보기',status:'published'},admin);
 assert.equal(created.status,201);
 const a=(await created.json()).data;
 assert.equal((await f.send('/api/admin/announcements','POST',{title:'x',linkUrl:'javascript:alert(1)',linkLabel:'y'},admin)).status,400);
 assert.equal((await f.send(`/api/admin/announcements/${a.id}`,'PATCH',{linkLabel:'',version:1},admin)).status,400,'link without label after merge');
 assert.equal((await (await f.send(`/api/admin/announcements/${a.id}`,'PATCH',{title:'바뀐 공지',version:1},admin)).json()).data.version,2);
 assert.equal((await f.send(`/api/admin/announcements/${a.id}`,'PATCH',{title:'x',version:1},admin)).status,409);
 assert.equal((await (await f.send('/api/admin/announcements?q=바뀐','GET',undefined,admin)).json()).pagination.total,1);
 assert.equal((await f.send(`/api/admin/announcements/${a.id}`,'DELETE',{version:2},admin)).status,200);
});

test('page settings API: list, edit, hide, restore, permissions over HTTP',async t=>{
 const f=fixture(t);const member=await account(f,'member@example.test');const admin=await account(f,'admin@example.test',true);
 const {applyPageSettingSeeds}=await import('../../src/server/content/seed');
 await applyPageSettingSeeds(f.db);
 assert.equal((await f.send('/api/admin/page-settings')).status,401);
 assert.equal((await f.send('/api/admin/page-settings','GET',undefined,member)).status,403);
 const list=(await (await f.send('/api/admin/page-settings','GET',undefined,admin)).json()).data;
 assert.deepEqual(list.map((p:{path:string})=>p.path),['/features','/guide/extension-publish','/guide/writing']);
 const id=list[0].id;
 assert.equal((await (await f.send(`/api/admin/page-settings/${id}`,'PATCH',{status:'hidden',version:1},admin)).json()).data.status,'hidden');
 assert.equal((await f.send(`/api/admin/page-settings/${id}`,'PATCH',{title:'x',version:1},admin)).status,409);
 assert.equal((await f.send(`/api/admin/page-settings/${id}`,'PATCH',{path:'/x',version:2},admin)).status,400);
 const restored=await f.send(`/api/admin/page-settings/${id}/restore`,'POST',{revision:1,version:2},admin);
 assert.equal((await restored.json()).data.version,3);
});
