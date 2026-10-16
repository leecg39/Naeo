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
 const uploadMarkdown=(cookie:string,bytes:Buffer)=>{const form=new FormData();form.set('file',new File([new Uint8Array(bytes)],'photo.jpg',{type:'image/jpeg'}));return handler(new Request(origin+'/api/images',{method:'POST',headers:{Origin:origin,Cookie:cookie},body:form}));};
 const raw=(p:string,cookie?:string)=>handler(new Request(origin+p,{headers:cookie?{Cookie:cookie}:{}}));
 return{db,send,upload,uploadMarkdown,raw};
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

test('markdown image upload returns a copyable public URL that deletion revokes',async t=>{
 const f=fixture(t),a=await account(f,'markdown@example.test');
 assert.equal((await f.uploadMarkdown('',PNG)).status,401);
 const response=await f.uploadMarkdown(a,Buffer.from('ffd8ffe000104a464946','hex'));
 assert.equal(response.status,201);
 const image=await response.json() as {url:string;markdown:string;media:{publicId:string;shareToken:string;mime:string;originalName:string}};
 assert.match(image.url,/^http:\/\/127\.0\.0\.1:3000\/api\/images\/[A-Za-z0-9_-]{22}$/);
 assert.equal(image.markdown,`![photo.jpg](${image.url})`);
 assert.equal(image.media.mime,'image/jpeg');assert.equal(image.media.originalName,'photo.jpg');
 const publicRead=await f.raw(new URL(image.url).pathname);
 assert.equal(publicRead.status,200);assert.equal(publicRead.headers.get('content-type'),'image/jpeg');
 assert.equal((await f.raw(`/api/images/${image.media.publicId}`)).status,404,'private id cannot replace the share token');
 const listed=(await (await f.send('/api/media','GET',undefined,a)).json()).data;
 assert.equal(listed[0].shareToken,image.media.shareToken);
 assert.equal((await f.send(`/api/media/${image.media.publicId}/publish`,'DELETE',undefined,a)).status,200);
 assert.equal((await f.raw(new URL(image.url).pathname)).status,404,'explicit revocation closes the copied URL');
 const replacement=(await (await f.send(`/api/media/${image.media.publicId}/publish`,'POST',undefined,a)).json()).data;
 assert.notEqual(replacement.token,image.media.shareToken);assert.equal((await f.raw(new URL(replacement.url).pathname)).status,200);
 assert.equal((await f.send(`/api/media/${image.media.publicId}`,'DELETE',undefined,a)).status,200);
 assert.equal((await f.raw(new URL(replacement.url).pathname)).status,404,'deletion revokes the replacement URL');
});

test('export, writing templates and admin generations over HTTP',async t=>{
 const f=fixture(t);const a=await account(f,'a@example.test');const admin=await account(f,'admin@example.test');
 const adminId=(f.db.prepare("SELECT id FROM users WHERE email='admin@example.test'").get() as {id:string}).id;
 f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(adminId);
 const d=(await (await f.send('/api/drafts','POST',{title:'내보내기 <글>',body:'## 소제목\n\n**굵게**'},a)).json()).data;
 const html=await f.raw(`/api/drafts/${d.id}/export?format=html`,a);
 assert.equal(html.status,200);assert.match(html.headers.get('content-type')??'',/text\/html/);
 assert.match(html.headers.get('content-security-policy')??'',/sandbox/);
 assert.match(await html.text(),/<h1>내보내기 &lt;글&gt;<\/h1>/);
 const dl=await f.raw(`/api/drafts/${d.id}/export?format=markdown&download=1`,a);
 assert.match(dl.headers.get('content-disposition')??'',/attachment/);
 assert.equal((await f.raw(`/api/drafts/${d.id}/export?format=pdf`,a)).status,400);
 assert.equal((await f.raw(`/api/drafts/${d.id}/export`,admin)).status,404,'admins cannot export members\' drafts');
 assert.equal((await f.send('/api/admin/writing-templates','POST',{name:'x',guidance:'y'},a)).status,403);
 const tpl=(await (await f.send('/api/admin/writing-templates','POST',{name:'여행 후기',guidance:'날짜별로 정리'},admin)).json()).data;
 const list=(await (await f.send('/api/writing-templates','GET',undefined,a)).json()).data;
 assert.deepEqual(list.map((x:{name:string})=>x.name),['여행 후기']);assert.equal('guidance' in list[0],false,'guidance stays server-side');
 assert.equal((await f.send(`/api/admin/writing-templates/${tpl.id}`,'DELETE',{version:1},admin)).status,200);
 assert.equal((await f.send('/api/admin/generations','GET',undefined,a)).status,403);
 assert.equal((await f.send('/api/admin/generations','GET',undefined,admin)).status,200);
});

test('owner and public share routes never return substituted private files or filesystem paths',async t=>{
 const {readdirSync,writeFileSync,unlinkSync,symlinkSync}=await import('node:fs');const f=fixture(t),a=await account(f,'safe@example.test');const draft=(await(await f.send('/api/drafts','POST',{title:'safe',body:'safe'},a)).json()).data;const media=(await(await f.upload(a,PNG,draft.id)).json()).data;const link=(await(await f.send(`/api/drafts/${draft.id}/shares`,'POST',{days:1},a)).json()).data;
 const dir=process.env.NAEO_UPLOAD_DIR!,key=readdirSync(dir)[0],target=path.join(dir,'private.txt');writeFileSync(target,'not-public-secret');unlinkSync(path.join(dir,key));symlinkSync(target,path.join(dir,key));
 for(const [url,cookie] of [[`/api/media/${media.publicId}`,a],[`/api/shares/${link.token}/media/${media.publicId}`,undefined]] as const){const r=await f.raw(url,cookie);assert.equal(r.status,404);const text=await r.text();assert.ok(text.includes('MEDIA_UNAVAILABLE'));assert.ok(!text.includes('not-public-secret'));assert.ok(!text.includes(dir));}
 assert.equal((await f.send(`/api/media/${media.publicId}`,'DELETE',undefined,a)).status,200);assert.equal((await import('node:fs')).readFileSync(target,'utf8'),'not-public-secret');
});
