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
import {saveUpload} from '../../src/server/writing/media';

async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-image-pagination-')),dbPath=join(temp,'db.sqlite');let child:ChildProcess|undefined;
 const password=randomBytes(32).toString('base64url');let result;
 try{
  const db=openDatabase(dbPath);try{const {user}=await register(db,{email:'admin@example.test',password,nickname:'관리자',termsAccepted:true});db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
   const bytes=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
   for(let i=0;i<101;i++)saveUpload(db,join(temp,'uploads'),user.id,{bytes,name:`photo-${i}.png`,type:'image/png'},Date.now()-i);
  }finally{db.close();}
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
  const origin=`http://127.0.0.1:${port}`;
  const req=(path:string,method='GET',data?:unknown,cookie?:string)=>fetch(origin+path,{method,headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads')},stdio:'ignore'});
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('Next exited before readiness');try{if((await req('/api/health')).ok){ready=true;break;}}catch{/* server startup */}await delay(100);}assert.ok(ready);
  const login=await req('/api/auth/login','POST',{email:'admin@example.test',password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const get=async(path:string)=>{const r=await req(path,'GET',undefined,cookie);assert.equal(r.status,200);return r.json();};
  const first=await get('/api/media?page=1&pageSize=100'),last=await get('/api/media?page=2&pageSize=100');
  assert.equal(first.pagination.total,101);assert.equal(last.data.length,1);
  assert.equal(new Set([...first.data,...last.data].map((r:{publicId:string})=>r.publicId)).size,101);
  const photo=last.data[0];assert.equal(photo.originalName,'photo-100.png');
  const download=await req(`/api/media/${photo.publicId}`,'GET',undefined,cookie);assert.equal(download.status,200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),Buffer.from('89504e470d0a1a0a0000000d49484452','hex'));
  assert.equal((await req(`/api/media/${photo.publicId}`)).status,401);
  assert.equal((await req(`/api/media/${photo.publicId}`,'DELETE',undefined,cookie)).status,200);
  const after=await get('/api/media?page=2&pageSize=100');assert.equal(after.pagination.total,100);assert.equal(after.data.length,0);
  assert.equal((await get('/api/media?page=1&pageSize=100')).data.length,100);
  assert.equal((await req(`/api/media/${photo.publicId}`,'GET',undefined,cookie)).status,404);
  result={verifiedAt:new Date().toISOString(),checks:['101 real stored media fixtures','Distinct first and second page records','Second-page owned photo download matches bytes','Anonymous download rejected','Second-page deletion removes photo and updates total','Previous page contains remaining 100 photos'],browserVerified:false,temporaryDataRemoved:true};
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const processToStop=child,exited=new Promise<void>(r=>processToStop.once('exit',()=>r()));processToStop.kill('SIGTERM');const timer=setTimeout(()=>processToStop.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  rmSync(temp,{recursive:true,force:true});
 }
 writeFileSync(resolve(process.argv[2]||'docs/fullstack/evidence/image-pagination-runtime.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
