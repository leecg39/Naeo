import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';
import {applySeeds} from '../../src/server/content/seed';

const origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
const password='content-http-test-password';
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
