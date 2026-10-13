import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';

const origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
const password='http-account-test-password';
function fixture(t:TestContext){const db=openDatabase(':memory:');t.after(()=>db.close());const handler=createApi(()=>db);return {db,send:(path:string,method='GET',body?:unknown,cookie?:string)=>handler(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}))};}
const cookieOf=(response:Response)=>response.headers.get('set-cookie')!.split(';')[0];
async function register(send:ReturnType<typeof fixture>['send'],email:string){const response=await send('/api/auth/register','POST',{email,password,nickname:'HTTP 계정',termsAccepted:true});assert.equal(response.status,201);return {cookie:cookieOf(response),...(await response.json()).data};}
test('HTTP admin create/read/update/delete integrates consent, session revocation, permissions and audit',async t=>{
 const {db,send}=fixture(t),a=await register(send,'admin@example.test'),m=await register(send,'member@example.test');
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(a.user.id);
 for(const method of ['GET','POST'])assert.equal((await send('/api/admin/users',method,method==='POST'?{}:undefined,m.cookie)).status,403);
 assert.equal((await send('/api/admin/users','GET')).status,401);
 const createdResponse=await send('/api/admin/users','POST',{email:'new@example.test',password,nickname:'관리 생성',currentPassword:password},a.cookie);
 assert.equal(createdResponse.status,201);assert.equal(createdResponse.headers.get('set-cookie'),null);const created=(await createdResponse.json()).data;
 assert.equal((await send(`/api/admin/users/${created.id}`,'GET',undefined,m.cookie)).status,403);
 assert.equal((await send(`/api/admin/users/${created.id}`,'PATCH',{nickname:'관리 수정',version:1,currentPassword:'bad'},a.cookie)).status,403);
 const updated=await send(`/api/admin/users/${created.id}`,'PATCH',{nickname:'관리 수정',status:'suspended',version:1,currentPassword:password},a.cookie);assert.equal(updated.status,200);
 assert.equal((await send('/api/auth/login','POST',{email:created.email,password})).status,401);
 assert.equal((await send(`/api/admin/users/${created.id}`,'PATCH',{status:'active',version:2,currentPassword:password},a.cookie)).status,200);
 const signed=await send('/api/auth/login','POST',{email:created.email,password});assert.equal(signed.status,200);const memberCookie=cookieOf(signed);
 const blocked=await send('/api/blogs','GET',undefined,memberCookie);assert.equal(blocked.status,403);assert.equal((await blocked.json()).error.code,'TERMS_REQUIRED');
 assert.equal((await send('/api/auth/terms','POST',{termsAccepted:false},memberCookie)).status,400);
 assert.equal((await send('/api/auth/terms','POST',{termsAccepted:true},memberCookie)).status,200);
 const list=(await (await send('/api/admin/users?q='+encodeURIComponent('관리 수정'),'GET',undefined,a.cookie)).json());assert.equal(list.pagination.total,1);assert.equal(list.data[0].id,created.id);
 const detail=(await (await send(`/api/admin/users/${created.id}`,'GET',undefined,a.cookie)).json()).data;
 assert.equal(detail.version,4);assert.equal(detail.sessionCount,1);assert.ok(!JSON.stringify(detail).includes('password_hash'));
 const removed=await send(`/api/admin/users/${created.id}`,'DELETE',{currentPassword:password,confirmEmail:created.email,version:4},a.cookie);assert.equal(removed.status,200);
 assert.equal((await send('/api/auth/me','GET',undefined,memberCookie)).status,401);
 const audit=await send('/api/admin/audit?q=admin.user','GET',undefined,a.cookie);assert.equal(audit.status,200);assert.equal((await audit.json()).pagination.total,3);
 assert.equal((await send(`/api/admin/users/${a.user.id}`,'DELETE',{currentPassword:password,confirmEmail:'admin@example.test',version:1},a.cookie)).status,409);
});
test('HTTP password/session/account endpoints rotate cookies and erase all account data',async t=>{
 const {send}=fixture(t),a=await register(send,'self@example.test');
 const oldSecond=await send('/api/auth/login','POST',{email:a.user.email,password});const secondCookie=cookieOf(oldSecond);
 const sessions=await send('/api/auth/sessions','GET',undefined,a.cookie);assert.equal(sessions.status,200);assert.equal((await sessions.json()).data.length,2);
 assert.equal((await send('/api/auth/sessions','DELETE',undefined,a.cookie)).status,200);assert.equal((await send('/api/auth/me','GET',undefined,secondCookie)).status,401);
 const changed=await send('/api/auth/password','PATCH',{currentPassword:password,newPassword:'updated-http-password'},a.cookie);assert.equal(changed.status,200);const fresh=cookieOf(changed);assert.notEqual(fresh,a.cookie);
 assert.equal((await send('/api/auth/me','GET',undefined,a.cookie)).status,401);
 const me=(await (await send('/api/auth/me','GET',undefined,fresh)).json()).data;
 const removed=await send('/api/auth/account','DELETE',{currentPassword:'updated-http-password',confirmEmail:a.user.email,version:me.user.version},fresh);
 assert.equal(removed.status,200);assert.match(removed.headers.get('set-cookie')!,/Max-Age=0/);
 assert.equal((await send('/api/auth/me','GET',undefined,fresh)).status,401);
 assert.equal((await send('/api/auth/login','POST',{email:a.user.email,password:'updated-http-password'})).status,401);
});
test('HTTP contact and preferences validate CRUD and preserve owner isolation',async t=>{
 const {send}=fixture(t),a=await register(send,'one@example.test'),b=await register(send,'two@example.test');
 const fields={name:'담당자',email:'contact@example.test',phone:'01011112222'};
 assert.equal((await send('/api/contact-details','POST',{...fields,phoneVerifiedAt:123},a.cookie)).status,400);
 const created=await send('/api/contact-details','POST',fields,a.cookie);assert.equal(created.status,201);assert.equal((await created.json()).data.phoneVerifiedAt,null);
 assert.equal((await (await send('/api/contact-details','GET',undefined,b.cookie)).json()).data,null);
 assert.equal((await send('/api/contact-details','PATCH',{...fields,name:'변경',version:1},a.cookie)).status,200);
 assert.equal((await send('/api/contact-details','DELETE',{version:1},a.cookie)).status,409);
 assert.equal((await send('/api/contact-details','DELETE',{version:2},a.cookie)).status,200);
 assert.equal((await (await send('/api/contact-details','GET',undefined,a.cookie)).json()).data,null);
 assert.equal((await send('/api/preferences','PATCH',{version:1,marketingEmail:true,scanEmail:true},a.cookie)).status,200);
 assert.equal((await (await send('/api/preferences','GET',undefined,a.cookie)).json()).data.marketingEmail,true);
 assert.equal((await (await send('/api/preferences','GET',undefined,b.cookie)).json()).data.marketingEmail,false);
});
