import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';

const origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
function fixture(t:TestContext){
 const dir=mkdtempSync(path.join(tmpdir(),'naeo-upload-'));process.env.NAEO_UPLOAD_DIR=dir;
 t.after(()=>{rmSync(dir,{recursive:true,force:true});delete process.env.NAEO_UPLOAD_DIR;});
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const handler=createApi(()=>db);
 const send=(p:string,method='GET',body?:unknown,cookie?:string)=>handler(new Request(origin+p,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}));
 const upload=(cookie:string,bytes:Buffer,draftId?:string)=>{const form=new FormData();form.set('file',new File([new Uint8Array(bytes)],'photo.png',{type:'image/png'}));if(draftId)form.set('draftId',draftId);return handler(new Request(origin+'/api/media',{method:'POST',headers:{Origin:origin,Cookie:cookie},body:form}));};
 const raw=(p:string,cookie?:string)=>handler(new Request(origin+p,{headers:cookie?{Cookie:cookie}:{}}));
 return{db,send,upload,raw};
}
async function account(f:ReturnType<typeof fixture>,email:string){
 const r=await f.send('/api/auth/register','POST',{email,password:'writing-http-pass',nickname:'W',termsAccepted:true});
 return r.headers.get('set-cookie')!.split(';')[0];
}

test('drafts, media upload/download and share links over HTTP',async t=>{
 const f=fixture(t);const a=await account(f,'a@example.test');const b=await account(f,'b@example.test');
 assert.equal((await f.send('/api/drafts')).status,401);
 const d=(await (await f.send('/api/drafts','POST',{title:'HTTP 글',body:'본문'},a)).json()).data;
 assert.equal((await f.send(`/api/drafts/${d.id}`,'GET',undefined,b)).status,404);
 assert.equal((await (await f.send(`/api/drafts/${d.id}`,'PATCH',{body:'고친 본문',version:1},a)).json()).data.version,2);
 const up=await f.upload(a,PNG,d.id);
 assert.equal(up.status,201);
 const m=(await up.json()).data;
 assert.equal((await f.upload(a,Buffer.from('<svg onload=alert(1)>'))).status,415);
 const img=await f.raw(`/api/media/${m.publicId}`,a);
 assert.equal(img.status,200);assert.equal(img.headers.get('content-type'),'image/png');
 assert.equal(img.headers.get('x-content-type-options'),'nosniff');assert.match(img.headers.get('content-security-policy')??'',/sandbox/);
 assert.deepEqual(Buffer.from(await img.arrayBuffer()),PNG);
 assert.equal((await f.raw(`/api/media/${m.publicId}`,b)).status,404);
 assert.equal((await f.raw(`/api/media/${m.publicId}`)).status,401);
 const link=(await (await f.send(`/api/drafts/${d.id}/shares`,'POST',{days:3},a)).json()).data;
 const view=await f.raw(`/api/shares/${link.token}`);
 assert.equal(view.status,200,'public read without login');
 assert.equal((await view.json()).data.images[0].publicId,m.publicId);
 assert.equal((await f.raw(`/api/shares/${link.token}/media/${m.publicId}`)).status,200);
 assert.equal((await f.send(`/api/shares/${link.token}`,'DELETE',undefined,b)).status,404);
 assert.equal((await f.send(`/api/shares/${link.token}`,'DELETE',undefined,a)).status,200);
 assert.equal((await f.raw(`/api/shares/${link.token}`)).status,404);
 assert.equal((await f.send(`/api/media/${m.publicId}`,'DELETE',undefined,a)).status,200);
 assert.equal((await f.send(`/api/drafts/${d.id}`,'DELETE',{version:2},a)).status,200);
});
