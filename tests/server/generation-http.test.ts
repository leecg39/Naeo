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
async function account(f:ReturnType<typeof fixture>,email:string,admin=false){
 const r=await f.send('/api/auth/register','POST',{email,password:'generation-http-pass',nickname:'G',termsAccepted:true});
 const id=(await r.json()).data.user.id as string;
 if(admin)f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(id);
 return{cookie:r.headers.get('set-cookie')!.split(';')[0],id};
}

test('credits and generation API: grant, not-configured provider, no charge',async t=>{
 const saved=process.env.ANTHROPIC_API_KEY;delete process.env.ANTHROPIC_API_KEY;t.after(()=>{if(saved!==undefined)process.env.ANTHROPIC_API_KEY=saved;});
 const f=fixture(t);const admin=await account(f,'admin@example.test',true);const a=await account(f,'a@example.test');
 assert.equal((await f.send('/api/admin/credits','POST',{userId:a.id,delta:30,note:'x'},a.cookie)).status,403);
 assert.equal((await (await f.send('/api/admin/credits','POST',{userId:a.id,delta:30,note:'QA 지급'},admin.cookie)).json()).data.balance,30);
 const gen=await f.send('/api/generations','POST',{keyword:'제주',idempotencyKey:'h-1'},a.cookie);
 assert.equal(gen.status,503);assert.equal((await gen.json()).error.code,'PROVIDER_NOT_CONFIGURED');
 const credits=await (await f.send('/api/credits','GET',undefined,a.cookie)).json();
 assert.equal(credits.balance,30,'nothing charged');assert.equal(credits.data.length,1);
 assert.equal((await f.send('/api/generations','GET',undefined,a.cookie)).status,200);
 assert.equal((await f.send('/api/generations/00000000-0000-4000-8000-000000000000','GET',undefined,a.cookie)).status,404);
});
