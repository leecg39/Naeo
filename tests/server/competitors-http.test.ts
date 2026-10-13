import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';

const origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const handler=createApi(()=>db);
 const send=(p:string,method='GET',body?:unknown,cookie?:string)=>handler(new Request(origin+p,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}));
 return{db,send};
}
async function account(f:ReturnType<typeof fixture>,email:string){
 const r=await f.send('/api/auth/register','POST',{email,password:'competitor-http-pass',nickname:'C',termsAccepted:true});
 return r.headers.get('set-cookie')!.split(';')[0];
}

test('competitor and action APIs are member-scoped over HTTP',async t=>{
 const f=fixture(t);const a=await account(f,'a@example.test');const b=await account(f,'b@example.test');
 assert.equal((await f.send('/api/competitors')).status,401);
 const created=await f.send('/api/competitors','POST',{blog:'rival_http',note:'메모'},a);
 assert.equal(created.status,201);
 const c=(await created.json()).data;
 assert.equal((await f.send('/api/competitors','POST',{blog:'rival_http'},a)).status,409);
 assert.equal((await f.send('/api/competitors','POST',{blog:'http://evil'},a)).status,400);
 assert.equal((await (await f.send('/api/competitors','GET',undefined,b)).json()).data.data.length,0);
 assert.equal((await f.send(`/api/competitors/${c.id}`,'PATCH',{note:'남',version:1},b)).status,404);
 assert.equal((await (await f.send(`/api/competitors/${c.id}`,'PATCH',{note:'수정',version:1},a)).json()).data.version,2);
 assert.equal((await f.send(`/api/competitors/${c.id}`,'DELETE',{version:2},a)).status,200);
 assert.deepEqual((await (await f.send('/api/actions','GET',undefined,a)).json()).data,[]);
 assert.equal((await f.send('/api/actions/00000000-0000-4000-8000-000000000000','PATCH',{status:'done',version:1},a)).status,404);
});
