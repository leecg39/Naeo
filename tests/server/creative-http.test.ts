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

test('export API: raw PNG pages, progress, completion and an attachment download',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {solidPng}=await import('./helpers/png-fixture');
 const dir=mkdtempSync(join(tmpdir(),'naeo-export-http-'));const before=process.env.NAEO_UPLOAD_DIR;process.env.NAEO_UPLOAD_DIR=dir;
 t.after(()=>{if(before===undefined)delete process.env.NAEO_UPLOAD_DIR;else process.env.NAEO_UPLOAD_DIR=before;rmSync(dir,{recursive:true,force:true});});
 const db=(await import('../../src/server/database')).openDatabase(':memory:');t.after(()=>db.close());
 const handler=(await import('../../src/server/api')).createApi(()=>db);
 const req=(p:string,init:RequestInit&{cookie?:string}={})=>handler(new Request(origin+p,{...init,headers:{Origin:origin,...(init.headers as Record<string,string>??{}),...(init.cookie?{Cookie:init.cookie}:{})}}));
 const jsonReq=(p:string,method:string,body:unknown,cookie:string)=>req(p,{method,body:JSON.stringify(body),headers:{'Content-Type':'application/json'},cookie});
 const reg=await jsonReq('/api/auth/register','POST',{email:'e@example.test',password:'export-http-pass',nickname:'E',termsAccepted:true},'');
 const cookie=reg.headers.get('set-cookie')!.split(';')[0];
 const other=(await jsonReq('/api/auth/register','POST',{email:'o@example.test',password:'export-http-pass',nickname:'O',termsAccepted:true},'')).headers.get('set-cookie')!.split(';')[0];
 const p=(await (await jsonReq('/api/creative/projects','POST',{kind:'ad',title:'HTTP 내보내기'},cookie)).json()).data;
 const job=(await (await jsonReq(`/api/creative/projects/${p.id}/exports`,'POST',{format:'pdf'},cookie)).json()).data;
 const put=(body:Buffer,type='image/png',c=cookie)=>req(`/api/creative/exports/${job.id}/pages/0`,{method:'PUT',body:new Uint8Array(body),headers:{'Content-Type':type},cookie:c});
 assert.equal((await put(solidPng(1080,1350),'application/json')).status,415);
 assert.equal((await put(solidPng(1080,1350),'image/png',other)).status,404);
 const ok=await put(solidPng(1080,1350));
 assert.equal(ok.status,200);assert.equal((await ok.json()).data.received,1);
 assert.equal((await jsonReq(`/api/creative/exports/${job.id}/complete`,'POST',{},cookie)).status,200);
 const file=await req(`/api/creative/exports/${job.id}/file`,{cookie});
 assert.equal(file.headers.get('content-type'),'application/pdf');
 assert.match(file.headers.get('content-disposition')!,/^attachment; filename="naeo-export\.pdf"; filename\*=UTF-8''HTTP%20%EB%82%B4%EB%B3%B4%EB%82%B4%EA%B8%B0\.pdf$/);
 assert.ok(Buffer.from(await file.arrayBuffer()).subarray(0,8).toString('latin1').startsWith('%PDF'));
 assert.equal((await req(`/api/creative/exports/${job.id}/file`,{cookie:other})).status,404);
});
