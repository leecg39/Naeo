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
 const member=async(email:string)=>(await send('/api/auth/register','POST',{email,password:'creative-http-pass',nickname:email[0],termsAccepted:true})).headers.get('set-cookie')!.split(';')[0];
 return{send,member};
}

test('creative API: CRUD, reorder and SVG preview are owner-only; SVG cannot run scripts',async t=>{
 const f=fixture(t);
 const a=await f.member('a@example.test'),b=await f.member('b@example.test');
 assert.equal((await f.send('/api/creative/projects')).status,401);
 const p=(await (await f.send('/api/creative/projects','POST',{kind:'ad',title:'<b>광고</b>'},a)).json()).data;
 assert.equal(p.height,1350);
 const s2=(await (await f.send(`/api/creative/projects/${p.id}/slides`,'POST',{heading:'둘째'},a)).json()).data;
 assert.equal((await f.send(`/api/creative/projects/${p.id}/slides/${s2.id}/move`,'POST',{position:0},a)).status,200);
 const after=(await (await f.send(`/api/creative/projects/${p.id}`,'GET',undefined,a)).json()).data;
 assert.deepEqual(after.slides.map((s:{heading:string})=>s.heading),['둘째','<b>광고</b>']);
 const svg=await f.send(`/api/creative/projects/${p.id}/slides/${after.slides[1].id}.svg`,'GET',undefined,a);
 assert.equal(svg.status,200);
 assert.match(svg.headers.get('content-type')!,/image\/svg\+xml/);
 assert.match(svg.headers.get('content-security-policy')!,/sandbox/);
 assert.equal(svg.headers.get('x-content-type-options'),'nosniff');
 assert.ok((await svg.text()).includes('&lt;b&gt;광고&lt;/b&gt;'));
 assert.equal((await f.send(`/api/creative/projects/${p.id}/slides/${s2.id}.svg`,'GET',undefined,b)).status,404,'other members get 404');
 assert.equal((await f.send(`/api/creative/projects/${p.id}`,'PATCH',{title:'x',version:1},b)).status,404);
 assert.equal((await f.send(`/api/creative/projects/${p.id}/duplicate`,'POST',{},a)).status,201);
 assert.equal((await (await f.send('/api/creative/projects','GET',undefined,a)).json()).data.length,2);
 assert.equal((await (await f.send('/api/creative/projects','GET',undefined,b)).json()).data.length,0);
});
