import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';

const origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
const DAY=86_400_000;
function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const handler=createApi(()=>db);
 const send=(p:string,method='GET',body?:unknown,cookie?:string)=>handler(new Request(origin+p,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}));
 const member=async(email:string)=>{const r=await send('/api/auth/register','POST',{email,password:'events-http-pass',nickname:email[0],termsAccepted:true});return{cookie:r.headers.get('set-cookie')!.split(';')[0],id:(await r.json()).data.user.id as string};};
 return{db,send,member};
}

test('events API: public read, member entry lifecycle, admin review and rewards over HTTP',async t=>{
 const f=fixture(t);
 const admin=await f.member('admin@example.test'),m=await f.member('m@example.test'),other=await f.member('o@example.test');
 f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
 const event={slug:'http-event',title:'HTTP 이벤트',summary:'요약',status:'published',startsAt:new Date(Date.now()-DAY).toISOString(),endsAt:new Date(Date.now()+DAY).toISOString(),rewardTokens:7};
 assert.equal((await f.send('/api/admin/events','POST',event,m.cookie)).status,403);
 const created=await f.send('/api/admin/events','POST',event,admin.cookie);
 assert.equal(created.status,201);
 assert.equal((await (await f.send('/api/events')).json()).data[0].phase,'open','public list without login');
 assert.equal((await f.send('/api/events/http-event')).status,200);
 assert.equal((await f.send('/api/events/missing-one')).status,404);
 assert.equal((await f.send('/api/events/http-event/entries','POST',{proofUrl:'https://blog.naver.com/m_blog/1'})).status,401,'login required');
 assert.equal((await f.send('/api/events/http-event/entries','POST',{proofUrl:'https://blog.naver.com/m_blog/1'},m.cookie)).status,400,'blog must be registered first');
 await f.send('/api/blogs','POST',{naverId:'m_blog',title:'M',isPrimary:true},m.cookie);
 const entry=await f.send('/api/events/http-event/entries','POST',{proofUrl:'https://blog.naver.com/m_blog/223',note:'참여'},m.cookie);
 assert.equal(entry.status,201);
 const e=(await entry.json()).data;
 assert.equal((await (await f.send('/api/events/http-event/entry','GET',undefined,m.cookie)).json()).data.id,e.id);
 assert.equal((await f.send(`/api/event-entries/${e.id}`,'PATCH',{note:'x',version:1},other.cookie)).status,404,'other members cannot touch my entry');
 assert.equal((await f.send(`/api/admin/event-entries?slug=http-event`,'GET',undefined,m.cookie)).status,403);
 const list=await (await f.send('/api/admin/event-entries?slug=http-event','GET',undefined,admin.cookie)).json();
 assert.equal(list.pagination.total,1);
 const both=await Promise.all([0,1].map(()=>f.send(`/api/admin/event-entries/${e.id}/review`,'POST',{decision:'approved',version:1},admin.cookie)));
 assert.deepEqual(both.map(r=>r.status).sort(),[200,409],'two simultaneous approvals: one wins, one conflicts');
 const mine=await (await f.send('/api/me/events','GET',undefined,m.cookie)).json();
 assert.equal(mine.data.entries[0].status,'approved');assert.equal(mine.data.rewards[0].tokens,7);
 assert.equal((await (await f.send('/api/credits','GET',undefined,m.cookie)).json()).balance,7,'reward shows in the credit balance');
 const manual=await (await f.send('/api/admin/rewards','POST',{userId:other.id,tokens:3,description:'수동'},admin.cookie)).json();
 assert.equal((await f.send(`/api/admin/rewards/${manual.data.id}/revoke`,'POST',{version:1},admin.cookie)).status,200);
 assert.equal((await f.send('/api/admin/rewards/ranking','POST',{period:'week',offset:-1,top:3,tokens:5},admin.cookie)).status,409,'period must be confirmed');
 assert.equal((await (await f.send('/api/admin/rewards?status=revoked','GET',undefined,admin.cookie)).json()).pagination.total,1);
 const ev=(await created.json()).data;
 assert.equal((await f.send(`/api/admin/events/${ev.id}`,'DELETE',{version:ev.version},admin.cookie)).status,409,'events with entries are closed, not deleted');
});
