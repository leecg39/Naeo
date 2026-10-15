/** Production Next HTTP verification using an isolated database; no external writes. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {load} from 'cheerio';
import {applySeeds,applyPageSettingSeeds} from '../../src/server/content/seed';

async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-preview-audit-')),dbPath=join(temp,'db.sqlite');let child:ChildProcess|undefined;
 const password=randomBytes(32).toString('base64url');let result;
 try{
  const db=openDatabase(dbPath);try{const {user}=await register(db,{email:'admin@example.test',password,nickname:'관리자',termsAccepted:true});db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
   await register(db,{email:'member@example.test',password,nickname:'회원',termsAccepted:true});
   applySeeds(db);await applyPageSettingSeeds(db);
  }finally{db.close();}
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
  const origin=`http://127.0.0.1:${port}`;
  const req=(path:string,method='GET',data?:unknown,cookie?:string)=>fetch(origin+path,{method,redirect:'manual',headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads')},stdio:'ignore'});
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('Next exited before readiness');try{if((await req('/api/health')).ok){ready=true;break;}}catch{/* server startup */}await delay(100);}assert.ok(ready);
  const signIn=async(email:string)=>{const r=await req('/api/auth/login','POST',{email,password});assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0];};
  const admin=await signIn('admin@example.test'),member=await signIn('member@example.test');
  const categories=await req('/api/admin/article-categories','GET',undefined,admin);assert.equal(categories.status,200);const category=(await categories.json()).data[0];
  const textOf=(html:string)=>{const $=load(html);$('script,style').remove();return $.text();};
  const scenarios=[
   {kind:'document',api:'/api/admin/documents',preview:'/admin/pages/preview/',public:'/preview-audit-policy',field:'body',body:{path:'/preview-audit-policy',title:'Preview document',body:'PREVIEW_DOC_INITIAL',status:'draft'}},
   {kind:'article',api:'/api/admin/articles',preview:'/admin/blog/preview/',public:`/blog/${category.slug}/preview-audit-article`,field:'bodyMarkdown',body:{categoryId:category.id,slug:'preview-audit-article',title:'Preview article',bodyMarkdown:'PREVIEW_ARTICLE_INITIAL',status:'draft'}},
   {kind:'update',api:'/api/admin/updates',preview:'/admin/updates/preview/',public:'/updates',field:'bodyMarkdown',body:{slug:'preview-audit-update',versionLabel:'v9.99.0',types:['fix'],title:'Preview update',summary:'preview test',bodyMarkdown:'PREVIEW_UPDATE_INITIAL',publishedOn:'2026-10-15',status:'draft'}},
  ];
  const results=[];
  for(const scenario of scenarios){
   const created=await req(scenario.api,'POST',scenario.body,admin);assert.equal(created.status,201,scenario.kind);const item=(await created.json()).data,path=scenario.preview+item.id;
   assert.equal((await req(path)).status,307);
   assert.equal((await req(path,'GET',undefined,member)).status,403);
   const preview=await req(path,'GET',undefined,admin);assert.equal(preview.status,200);const html=await preview.text();
   assert.ok(textOf(html).includes(String(scenario.body[scenario.field as keyof typeof scenario.body])));
   assert.ok(load(html)('meta[name="robots"]').attr('content')?.includes('noindex'));
   const before=await req(scenario.public);const beforeBody=await before.text();
   if(scenario.kind==='update')assert.ok(!textOf(beforeBody).includes('PREVIEW_UPDATE_INITIAL'));else assert.ok(before.status===404||beforeBody.includes('NEXT_HTTP_ERROR_FALLBACK;404'));
   const marker=`PREVIEW_${scenario.kind.toUpperCase()}_EDITED`;
   const edit=await req(scenario.api+'/'+item.id,'PATCH',{[scenario.field]:marker,version:item.version},admin);assert.equal(edit.status,200);const updated=(await edit.json()).data;
   assert.ok(textOf(await (await req(path,'GET',undefined,admin)).text()).includes(marker));
   assert.equal((await req(scenario.api+'/'+item.id,'PATCH',{title:'stale',version:item.version},admin)).status,409);
   const publish=await req(scenario.api+'/'+item.id,'PATCH',{status:'published',version:updated.version},admin);assert.equal(publish.status,200);const published=(await publish.json()).data;
   const publicPage=await req(scenario.public);assert.equal(publicPage.status,200);assert.ok(textOf(await publicPage.text()).includes(marker));
   assert.equal((await req(scenario.api+'/'+item.id,'DELETE',{version:published.version},admin)).status,200);
   for(const id of [item.id,'00000000-0000-4000-8000-000000000000','invalid-id']){
    const missing=await req(scenario.preview+id,'GET',undefined,admin),body=await missing.text();assert.ok(missing.status===404||body.includes('NEXT_HTTP_ERROR_FALLBACK;404'));
   }
   const after=await req(scenario.public),afterBody=await after.text();if(scenario.kind==='update')assert.ok(!textOf(afterBody).includes(marker));else assert.ok(after.status===404||afterBody.includes('NEXT_HTTP_ERROR_FALLBACK;404'));
   results.push({kind:scenario.kind,create:true,previewDraft:true,editReflected:true,staleVersionRejected:true,publishReflected:true,deleteReflected:true,anonymousRedirect:true,memberDenied:true,invalidIdsNotFound:true,noindex:true});
  }
  result={verifiedAt:new Date().toISOString(),results,browserVerified:false,temporaryDataRemoved:true};

 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const processToStop=child,exited=new Promise<void>(r=>processToStop.once('exit',()=>r()));processToStop.kill('SIGTERM');const timer=setTimeout(()=>processToStop.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  rmSync(temp,{recursive:true,force:true});
 }
 writeFileSync(resolve(process.argv[2]||'docs/fullstack/evidence/preview-crud-runtime.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
