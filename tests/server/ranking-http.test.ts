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

test('ranking API: public read, my history requires login, admin confirm',async t=>{
 const f=fixture(t);
 const r=await f.send('/api/auth/register','POST',{email:'m@example.test',password:'ranking-http-pass',nickname:'M',termsAccepted:true});
 const cookie=r.headers.get('set-cookie')!.split(';')[0],id=(await r.json()).data.user.id;
 const pub=await f.send('/api/rankings?period=week');
 assert.equal(pub.status,200,'public without login');
 const body=await pub.json();assert.equal(body.total,0);assert.equal(body.me,null);
 assert.equal((await (await f.send('/api/rankings?period=week',undefined,undefined,cookie)).json()).me.public,false,'new members are private by default');
 assert.equal((await f.send('/api/rankings?period=day')).status,400);
 assert.equal((await f.send('/api/rankings/me')).status,401);
 assert.deepEqual((await (await f.send('/api/rankings/me','GET',undefined,cookie)).json()).data,{history:[],titles:[]});
 assert.equal((await f.send('/api/rankings?period=week&offset=-1')).status,200);
 assert.equal((f.db.prepare('SELECT count(*) AS n FROM ranking_periods').get() as {n:number}).n,1,'finished period confirmed on first read');
 assert.equal((await f.send('/api/admin/rankings/confirm','POST',{period:'week',offset:-2},cookie)).status,403);
 f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(id);
 assert.equal((await (await f.send('/api/admin/rankings/confirm','POST',{period:'week',offset:-2},cookie)).json()).data.entries,0);
 assert.equal((await f.send('/api/admin/rankings/confirm','POST',{period:'week',offset:0},cookie)).status,400,'current period cannot be confirmed');
});
