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

async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-announcements-')),dbPath=join(temp,'db.sqlite');let child:ChildProcess|undefined;
 const password=randomBytes(32).toString('base64url');let result;
 try{
  const db=openDatabase(dbPath);try{const {user}=await register(db,{email:'admin@example.test',password,nickname:'관리자',termsAccepted:true});db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);}finally{db.close();}
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
  const origin=`http://127.0.0.1:${port}`;
  const req=(path:string,method='GET',data?:unknown,cookie?:string)=>fetch(origin+path,{method,headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads')},stdio:'ignore'});
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('Next exited before readiness');try{if((await req('/api/health')).ok){ready=true;break;}}catch{/* server startup */}await delay(100);}assert.ok(ready);
  const login=await req('/api/auth/login','POST',{email:'admin@example.test',password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  for(const name of ['coffee','earbuds','tablet']){const image=await req(`/event/review-2026-09/icon-${name}.webp`);assert.equal(image.status,200);const bytes=Buffer.from(await image.arrayBuffer());assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WEBP');}
  const created=await req('/api/admin/announcements','POST',{title:'Runtime banner',body:'Runtime content',type:'event',status:'published',metadata:{image:'/banner.png',exactPath:'/event',ctaLabel:'보러 가기'}},cookie);assert.equal(created.status,201);const a=(await created.json()).data;
  const response=await req('/api/announcements?target=landing');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const data=await response.json();assert.equal(data.announcements[0].id,a.id);assert.equal(data.announcements[0].content,'Runtime content');assert.equal(data.announcements[0].type,'event');
  const page=await req('/event');assert.equal(page.status,200);assert.ok((await page.text()).includes('Runtime banner'),'SSR carries banner props');
  const changed=await req(`/api/admin/announcements/${a.id}`,'PATCH',{version:1,target:'dashboard',type:'feature',metadata:{display:'ticker',exactPath:'/dashboard'},body:'보상 [coffee]'},cookie);assert.equal(changed.status,200);
  assert.deepEqual(await(await req('/api/announcements?target=landing')).json(),{announcements:[]});
  assert.equal((await req('/api/announcements?target=dashboard')).status,401);
  const memberNotice=(await(await req('/api/announcements?target=dashboard','GET',undefined,cookie)).json()).announcements[0];assert.equal(memberNotice.type,'feature');assert.equal(memberNotice.metadata.display,'ticker');assert.equal(memberNotice.content,'보상 [coffee]');
  assert.equal((await req(`/api/admin/announcements/${a.id}`,'DELETE',{version:2},cookie)).status,200);
  assert.deepEqual(await(await req('/api/announcements?target=dashboard','GET',undefined,cookie)).json(),{announcements:[]});
  result={verifiedAt:new Date().toISOString(),checks:['Admin login and create','Public REA field mapping and no-store','Event SSR includes banner props','Update audience/type/ticker metadata reflected immediately','All three ticker WebP assets served with valid signatures','Anonymous dashboard denied, authenticated dashboard allowed','Delete removes API record'],browserVerified:false,externalWrites:false,temporaryDataRemoved:true};
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const processToStop=child,exited=new Promise<void>(r=>processToStop.once('exit',()=>r()));processToStop.kill('SIGTERM');const timer=setTimeout(()=>processToStop.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  rmSync(temp,{recursive:true,force:true});
 }
 writeFileSync(resolve(process.argv[2]||'docs/fullstack/evidence/announcements-runtime.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
