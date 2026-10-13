import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';

const origin='http://127.0.0.1:3000';
const registration={email:'http@example.test',password:'a-long-test-password',nickname:'HTTP 테스트',termsAccepted:true};
function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());const api=createApi(()=>db);
 const send=(path:string,method='GET',input?:unknown,cookie?:string,extra:Record<string,string>={})=>api(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},...(input!==undefined?{body:JSON.stringify(input)}:{})}));
 return {db,api,send};
}
async function signUp(send:ReturnType<typeof fixture>['send'],email=registration.email){const response=await send('/api/auth/register','POST',{...registration,email});assert.equal(response.status,201);return {cookie:response.headers.get('set-cookie')!.split(';')[0],result:await response.json()};}
test('HTTP registration, protected reads, CRUD, logout, and cookie flags form an actual session flow',async t=>{
 const {send}=fixture(t);
 assert.equal((await send('/api/auth/me')).status,401);
 const registrationResponse=await send('/api/auth/register','POST',registration);
 assert.equal(registrationResponse.status,201);const cookie=registrationResponse.headers.get('set-cookie')!;
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.match(cookie,/Max-Age=604800/);assert.doesNotMatch(JSON.stringify(await registrationResponse.json()),/password_hash|token_hash/);
 const session=cookie.split(';')[0];
 const me=await send('/api/auth/me','GET',undefined,session);assert.equal(me.status,200);assert.equal(me.headers.get('cache-control'),'no-store');
 const saved=await send('/api/profile','PATCH',{nickname:'HTTP 수정',version:1},session);assert.equal(saved.status,200);
 const created=await send('/api/blogs','POST',{naverId:'http_blog',title:'HTTP 블로그'},session);assert.equal(created.status,201);const {data:blog}=await created.json();
 assert.equal((await send(`/api/blogs/${blog.id}`,'PATCH',{title:'수정 제목',version:1},session)).status,200);
 assert.equal((await send(`/api/blogs/${blog.id}`,'DELETE',{version:1},session)).status,409);
 assert.equal((await send(`/api/blogs/${blog.id}`,'DELETE',{version:2},session)).status,200);
 assert.equal((await send(`/api/blogs/${blog.id}`,'GET',undefined,session)).status,404);
 const out=await send('/api/auth/logout','POST',undefined,session);assert.equal(out.status,200);assert.match(out.headers.get('set-cookie')!,/Max-Age=0/);
 assert.equal((await send('/api/auth/me','GET',undefined,session)).status,401);
});
test('HTTP rejects cross-origin/missing-Origin, invalid bodies, unknown privileged fields, and admin access',async t=>{
 const {send,api}=fixture(t),{cookie}=await signUp(send);
 assert.equal((await send('/api/profile','PATCH',{nickname:'bad',version:1},cookie,{Origin:'https://evil.example'})).status,403);
 assert.equal((await api(new Request(origin+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie}}))).status,403);
 assert.equal((await send('/api/profile','PATCH',{nickname:'bad',version:1,role:'admin'},cookie)).status,400);
 assert.equal((await send('/api/profile','PATCH',{version:1},cookie)).status,400);
 assert.equal((await send('/api/profile','PATCH',{nickname:'bad',version:1},cookie,{'Content-Type':'text/plain'})).status,415);
 assert.equal((await send('/api/admin/users','GET',undefined,cookie)).status,403);
 assert.equal((await api(new Request(origin+'/api/profile',{method:'PATCH',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:'{bad'}))).status,400);
 assert.equal((await send('/api/profile','PATCH',{nickname:'x'.repeat(40000),version:1},cookie)).status,413);
 assert.equal((await send('/api/blogs?pageSize=101','GET',undefined,cookie)).status,400);
});
test('HTTP owner isolation prevents reading/modifying/deleting another user blog',async t=>{
 const {send}=fixture(t),a=await signUp(send),b=await signUp(send,'other@example.test');
 const {data:blog}=await (await send('/api/blogs','POST',{naverId:'private_blog',title:'private'},a.cookie)).json();
 assert.equal((await send(`/api/blogs/${blog.id}`,'GET',undefined,b.cookie)).status,404);
 assert.equal((await send(`/api/blogs/${blog.id}`,'PATCH',{title:'attack',version:1},b.cookie)).status,404);
 assert.equal((await send(`/api/blogs/${blog.id}`,'DELETE',{version:1},b.cookie)).status,404);
 assert.equal((await (await send('/api/blogs','GET',undefined,b.cookie)).json()).pagination.total,0);
});
test('HTTP authentication throttling returns 429 without issuing a session',async t=>{
 const {send}=fixture(t);
 for(let i=0;i<10;i++)assert.equal((await send('/api/auth/login','POST',{email:'missing@example.test',password:'wrong'})).status,401);
 const response=await send('/api/auth/login','POST',{email:'missing@example.test',password:'wrong'});
 assert.equal(response.status,429);assert.ok(response.headers.get('retry-after'));assert.equal(response.headers.get('set-cookie'),null);
});
