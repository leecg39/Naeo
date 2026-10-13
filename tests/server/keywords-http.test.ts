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
 const r=await f.send('/api/auth/register','POST',{email,password:'keyword-http-password',nickname:'K',termsAccepted:true});
 const id=(await r.json()).data.user.id as string;
 if(admin)f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(id);
 return r.headers.get('set-cookie')!.split(';')[0];
}

test('keyword admin and recommendation API over HTTP',async t=>{
 const f=fixture(t);const admin=await account(f,'admin@example.test',true);const member=await account(f,'member@example.test');
 assert.equal((await f.send('/api/admin/keywords','POST',{phrase:'x'},member)).status,403);
 assert.equal((await f.send('/api/recommendations')).status,401);
 const created=await f.send('/api/admin/keywords','POST',{phrase:'제주 맛집',category:'여행'},admin);
 assert.equal(created.status,201);
 const k=(await created.json()).data;
 assert.equal((await f.send('/api/admin/keywords','POST',{phrase:'제주 맛집'},admin)).status,409);
 assert.equal((await f.send(`/api/admin/keywords/${k.id}/metrics`,'POST',{pcVolume:500,mobileVolume:1500,documentCount:900},admin)).status,201);
 assert.equal((await f.send(`/api/admin/keywords/${k.id}/metrics`,'POST',{pcVolume:-5,mobileVolume:0,documentCount:0},admin)).status,400);
 const recs=await (await f.send('/api/recommendations?filter=golden','GET',undefined,member)).json();
 assert.equal(recs.pagination.total,1);assert.equal(recs.data[0].saturation,0.45);assert.equal(recs.data[0].golden,true);
 const mark=await f.send(`/api/recommendations/${k.id}/state`,'PUT',{status:'written'},member);
 assert.equal((await mark.json()).data.status,'written');
 assert.equal((await (await f.send('/api/recommendations?filter=written','GET',undefined,member)).json()).pagination.total,1);
 assert.equal((await f.send(`/api/recommendations/${k.id}/state`,'PUT',{status:'bogus'},member)).status,400);
 const detail=(await (await f.send(`/api/admin/keywords/${k.id}`,'GET',undefined,admin)).json()).data;
 assert.equal(detail.metrics.length,1);
 assert.equal((await f.send(`/api/admin/keywords/${k.id}/metrics/${detail.metrics[0].id}`,'DELETE',undefined,admin)).status,200);
 assert.equal((await f.send(`/api/admin/keywords/${k.id}`,'PATCH',{status:'hidden',version:1},admin)).status,200);
 assert.equal((await (await f.send('/api/recommendations','GET',undefined,member)).json()).pagination.total,0);
 assert.equal((await f.send(`/api/admin/keywords/${k.id}`,'DELETE',{version:2},admin)).status,200);
});
