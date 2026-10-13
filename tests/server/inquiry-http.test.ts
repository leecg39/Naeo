import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';

const origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
const password='inquiry-http-test-password';
function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const handler=createApi(()=>db);
 const send=(path:string,method='GET',body?:unknown,cookie?:string,headers:Record<string,string>={})=>handler(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}));
 return {db,send};
}
async function account(f:ReturnType<typeof fixture>,email:string,admin=false){
 const r=await f.send('/api/auth/register','POST',{email,password,nickname:'문의',termsAccepted:true});
 assert.equal(r.status,201);
 const id=(await r.json()).data.user.id as string;
 if(admin)f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(id);
 return r.headers.get('set-cookie')!.split(';')[0];
}
const form={type:'service',email:'guest@example.test',subject:'문의',message:'내용입니다.'};

test('guests can submit without login but receive no stored content back',async t=>{
 const f=fixture(t);
 const r=await f.send('/api/inquiries','POST',form);
 assert.equal(r.status,201);
 assert.deepEqual((await r.json()).data,{received:true});
 assert.equal((f.db.prepare('SELECT count(*) AS n FROM inquiries WHERE owner_id IS NULL').get() as {n:number}).n,1);
 assert.equal((await f.send('/api/inquiries','POST',form,undefined,{Origin:'https://evil.example'})).status,403);
 assert.equal((await f.send('/api/inquiries','GET')).status,401,'listing requires login');
 assert.equal((await f.send('/api/inquiries','POST',{...form,message:''})).status,400);
});

test('submission is rate limited per e-mail address',async t=>{
 const f=fixture(t);
 for(let i=0;i<5;i++)assert.equal((await f.send('/api/inquiries','POST',{...form,email:'flood@example.test'})).status,201);
 const limited=await f.send('/api/inquiries','POST',{...form,email:'flood@example.test'});
 assert.equal(limited.status,429);assert.equal((await limited.json()).error.code,'RATE_LIMITED');
 assert.equal((await f.send('/api/inquiries','POST',{...form,email:'calm@example.test'})).status,201);
});

test('members read, edit and delete only their own inquiries over HTTP',async t=>{
 const f=fixture(t);const member=await account(f,'member@example.test'),other=await account(f,'other@example.test');
 const created=await f.send('/api/inquiries','POST',form,member);
 assert.equal(created.status,201);
 const a=(await created.json()).data;
 assert.equal(a.type,'service');assert.equal(a.version,1);
 assert.equal((await (await f.send('/api/inquiries','GET',undefined,member)).json()).pagination.total,1);
 assert.equal((await (await f.send('/api/inquiries','GET',undefined,other)).json()).pagination.total,0);
 assert.equal((await f.send(`/api/inquiries/${a.id}`,'GET',undefined,other)).status,404);
 assert.equal((await f.send(`/api/inquiries/${a.id}`,'PATCH',{message:'수정',version:1},member)).status,200);
 assert.equal((await f.send(`/api/inquiries/${a.id}`,'PATCH',{message:'충돌',version:1},member)).status,409);
 assert.equal((await f.send(`/api/inquiries/${a.id}`,'DELETE',{version:2},other)).status,404);
 assert.equal((await f.send(`/api/inquiries/${a.id}`,'DELETE',{version:2},member)).status,200);
 assert.equal((await f.send(`/api/inquiries/${a.id}`,'GET',undefined,member)).status,404);
});

test('admin inquiry and template endpoints enforce role and work end to end',async t=>{
 const f=fixture(t);const member=await account(f,'member@example.test'),admin=await account(f,'admin@example.test',true);
 for(const [path,method] of [['/api/admin/inquiries','GET'],['/api/admin/inquiry-templates','GET'],['/api/admin/inquiry-templates','POST']] as const)
  assert.equal((await f.send(path,method,method==='POST'?{}:undefined,member)).status,403,path);
 const mine=(await (await f.send('/api/inquiries','POST',form,member)).json()).data;
 const list=await (await f.send('/api/admin/inquiries?status=open','GET',undefined,admin)).json();
 assert.equal(list.pagination.total,1);assert.equal(list.data[0].ownerEmail,'member@example.test');
 const tpl=(await (await f.send('/api/admin/inquiry-templates','POST',{name:'기본',body:'감사합니다.'},admin)).json()).data;
 assert.equal((await f.send(`/api/admin/inquiry-templates/${tpl.id}`,'PATCH',{name:'기본 답변',version:1},admin)).status,200);
 const replied=await f.send(`/api/admin/inquiries/${mine.id}/replies`,'POST',{body:'감사합니다.',version:1},admin);
 assert.equal(replied.status,201);
 const detail=(await replied.json()).data;
 assert.equal(detail.status,'answered');
 const replyId=detail.replies[0].id;
 assert.equal((await f.send(`/api/admin/inquiries/${mine.id}/replies/${replyId}`,'PATCH',{body:'고침',version:2},admin)).status,200);
 const seen=(await (await f.send(`/api/inquiries/${mine.id}`,'GET',undefined,member)).json()).data;
 assert.equal(seen.replies[0].body,'고침');
 assert.equal((await f.send(`/api/inquiries/${mine.id}`,'PATCH',{message:'답변 뒤',version:3},member)).status,409);
 assert.equal((await f.send(`/api/admin/inquiries/${mine.id}`,'PATCH',{status:'closed',version:3},admin)).status,200);
 assert.equal((await f.send(`/api/admin/inquiries/${mine.id}/replies/${replyId}`,'DELETE',{version:4},admin)).status,200);
 assert.equal((await f.send(`/api/admin/inquiries/${mine.id}`,'DELETE',{version:5},admin)).status,200);
 assert.equal((await f.send(`/api/admin/inquiry-templates/${tpl.id}`,'DELETE',{version:2},admin)).status,200);
});
