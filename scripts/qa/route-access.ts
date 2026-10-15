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
import {applySeeds,applyPageSettingSeeds} from '../../src/server/content/seed';

async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-route-audit-')),dbPath=join(temp,'db.sqlite');let child:ChildProcess|undefined;
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
  let output='';
  const audit=spawn(process.execPath,['--import','tsx','scripts/route-audit.ts'],{env:{...process.env,NAEO_AUDIT_BASE:origin,NAEO_AUDIT_EMAIL:'admin@example.test',NAEO_AUDIT_PASSWORD:password},stdio:['ignore','pipe','pipe']});
  audit.stdout!.on('data',data=>{output+=String(data);});audit.stderr!.on('data',data=>{output+=String(data);});
  const exitCode=await new Promise<number|null>((resolve,reject)=>{audit.once('error',reject);audit.once('exit',resolve);});
  const signIn=async(email:string)=>{const r=await req('/api/auth/login','POST',{email,password});assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0];};
  const adminCookie=await signIn('admin@example.test'),memberCookie=await signIn('member@example.test');
  const adminPaths=['/admin','/admin/writing','/admin/billing','/admin/event','/admin/pages','/admin/keywords','/admin/events','/admin/users','/admin/blog','/admin/updates','/admin/announcements','/admin/rewards','/admin/faq','/admin/inquiries','/admin/inquiries/templates','/admin/payments','/admin/scan-health'];
  const adminAccess=[];
  for(const path of adminPaths){
   const anon=await req(path);assert.ok([302,303,307,308].includes(anon.status));assert.ok(anon.headers.get('location')?.startsWith('/login'));
   const member=await req(path,'GET',undefined,memberCookie),memberBody=await member.text();assert.ok(member.status===403||(member.status===200&&memberBody.includes('NEXT_HTTP_ERROR_FALLBACK;403')),`${path}: member denied`);
   const admin=await req(path,'GET',undefined,adminCookie);assert.equal(admin.status,200);assert.ok(!(await admin.text()).includes('Internal Server Error'));
   adminAccess.push({path,anonymous:anon.status,member:member.status,memberForbidden:true,admin:admin.status});
  }
  result={verifiedAt:new Date().toISOString(),exitCode,output:output.trim(),adminAccess,browserVerified:false,temporaryDataRemoved:true};
  if(exitCode!==0)process.exitCode=1;

 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const processToStop=child,exited=new Promise<void>(r=>processToStop.once('exit',()=>r()));processToStop.kill('SIGTERM');const timer=setTimeout(()=>processToStop.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  rmSync(temp,{recursive:true,force:true});
 }
 writeFileSync(resolve(process.argv[2]||'docs/fullstack/evidence/route-audit-current.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
