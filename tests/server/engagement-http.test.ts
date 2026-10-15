import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';

const origin='http://127.0.0.1:3000';process.env.NAEO_APP_URL=origin;
function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());const handler=createApi(()=>db);
 const send=(path:string,method='GET',payload?:unknown,cookie?:string,requestOrigin=origin)=>handler(new Request(origin+path,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(payload!==undefined?{body:JSON.stringify(payload)}:{})}));
 const member=async(email:string)=>{const r=await send('/api/auth/register','POST',{email,password:'engagement-http-password',nickname:'포인트 검사',termsAccepted:true});assert.equal(r.status,201);return{cookie:r.headers.get('set-cookie')!.split(';')[0],id:(await r.json()).data.user.id as string};};
 return{db,send,member,handler};
}
test('engagement HTTP: authentication, origin, strict input, duplicate concurrent claims and isolation',async t=>{
 const f=fixture(t),a=await f.member('one@example.test'),b=await f.member('two@example.test');
 assert.equal((await f.send('/api/points')).status,401);
 assert.equal((await f.send('/api/attendance','POST',undefined,a.cookie,'https://other.example')).status,403);
 for(const payload of [{ownerId:b.id},{date:'2020-01-01'},{amount:999},{step:'blog'}])assert.equal((await f.send('/api/attendance','POST',payload,a.cookie)).status,400);
 const concurrent=await Promise.all(Array.from({length:8},()=>f.send('/api/attendance','POST',undefined,a.cookie).then(r=>r.json())));
 assert.equal(concurrent.reduce((sum,r)=>sum+r.data.awarded,0),5);
 assert.equal((await(await f.send('/api/points','GET',undefined,b.cookie)).json()).data.balance,0);
 assert.equal((await f.send('/api/tutorial/finish','POST',{step:'blog'},a.cookie)).status,409);
 assert.equal((await f.send('/api/blogs','POST',{naverId:'points_http',title:'블로그'},a.cookie)).status,201);
 const claims=await Promise.all(Array.from({length:6},()=>f.send('/api/tutorial/finish','POST',{step:'blog'},a.cookie).then(r=>r.json())));
 assert.equal(claims.reduce((sum,r)=>sum+r.data.awarded,0),30);
 assert.equal((await f.send('/api/tutorial/finish','POST',{step:'verify',verified:true},a.cookie)).status,400);
 assert.equal((await f.send('/api/tutorial/finish','POST',{step:'unknown'},a.cookie)).status,400);
 assert.equal((await f.send('/api/tutorial/finish','POST',{step:'ai_picks'},a.cookie)).status,409);
 const paged=(await(await f.send('/api/points?page=2&pageSize=1','GET',undefined,a.cookie)).json()).data;
 assert.equal(paged.balance,35);assert.equal(paged.entries.length,1);assert.equal(paged.pagination.total,2);
 assert.equal((await f.send('/api/points','DELETE',{},a.cookie)).status,405);
 assert.equal((await f.send('/api/tutorial/sub-topic','PUT',{subTopic:'여행',version:0},a.cookie)).status,200);
 assert.equal((await f.send('/api/tutorial/finish','POST',{step:'ranking'},a.cookie)).status,409);
 assert.equal((await f.send('/api/tutorial/ranking-visit','POST',undefined,a.cookie)).status,200);
 assert.equal((await(await f.send('/api/tutorial/finish','POST',{step:'ranking'},a.cookie)).json()).data.awarded,90);
 assert.equal((await f.send('/api/tutorial/sub-topic','DELETE',{version:1},a.cookie)).status,409);
 f.db.prepare('UPDATE users SET terms_accepted_at=0 WHERE id=?').run(a.id);
 assert.equal((await f.send('/api/points','GET',undefined,a.cookie)).status,403);
 f.db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(b.id);
 assert.equal((await f.send('/api/attendance','POST',undefined,b.cookie)).status,401);
});
test('account changes while reading a streamed request cannot grant points after suspension',async t=>{
 const f=fixture(t),a=await f.member('race@example.test');
 const stream=new ReadableStream({pull(controller){f.db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(a.id);controller.enqueue(new TextEncoder().encode('{}'));controller.close();}},{highWaterMark:0});
 const request=new Request(origin+'/api/attendance',{method:'POST',headers:{Origin:origin,Cookie:a.cookie,'Content-Type':'application/json'},body:stream,duplex:'half'} as RequestInit);
 assert.equal((await f.handler(request)).status,401);
 assert.equal((f.db.prepare('SELECT count(*) n FROM point_ledger').get() as {n:number}).n,0);
});
test('bodyless POST works when Next forwards an empty stream; nonempty and oversized streams remain rejected',async t=>{
 const f=fixture(t),a=await f.member('empty@example.test');
 const request=(text:string)=>new Request(origin+'/api/attendance',{method:'POST',headers:{Origin:origin,Cookie:a.cookie,'Content-Type':'application/json'},body:text});
 assert.equal((await f.handler(request(''))).status,200);
 assert.equal((await f.handler(request('{"amount":1000}'))).status,400);
 assert.equal((await f.handler(request(' '.repeat(2000)))).status,413);
});
