/** Local-only production acceptance: no external mail or production credentials. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {load} from 'cheerio';
import {migrations} from '../../src/server/migrations';
import {openDatabase} from '../../src/server/database';
async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-account-mail-http-')),children:ChildProcess[]=[];
 const inbox=new Map<string,{body:string;message:{to:string[];text:string;subject:string}}>();let attempts=0,first=true;
 const provider=createServer((q,r)=>{let body='';q.on('data',chunk=>body+=chunk);q.on('end',()=>{try{
  assert.equal(q.url,'/emails');assert.equal(q.method,'POST');const key=String(q.headers['idempotency-key']);assert.ok(key.startsWith('account-mail/'));attempts++;
  if(inbox.has(key))assert.equal(inbox.get(key)!.body,body);else inbox.set(key,{body,message:JSON.parse(body)});
  r.writeHead(first?503:200,{'Content-Type':'application/json'});r.end(first?'{}':JSON.stringify({id:'local-'+key}));first=false;
 }catch{r.writeHead(400);r.end('{}');}});});
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));const mailPort=(provider.address() as {port:number}).port;
 const probe=tcpServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
 const origin=`http://127.0.0.1:${port}`,password=randomBytes(24).toString('base64url'),nextPassword=randomBytes(24).toString('base64url');
 const env={...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:join(temp,'db.sqlite'),NAEO_UPLOAD_DIR:join(temp,'uploads'),NAEO_WORKER_IDLE_MS:'100',NAEO_EMAIL_PROVIDER:'resend',NAEO_RESEND_API_KEY:randomBytes(16).toString('hex'),NAEO_MAIL_FROM:'local-sender@example.test',NAEO_MAIL_ENCRYPTION_KEY:randomBytes(32).toString('hex'),NAEO_MAIL_API_BASE:`http://127.0.0.1:${mailPort}`};
 const launch=(args:string[])=>{const p=spawn(process.execPath,args,{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});p.stdout!.on('data',()=>{});p.stderr!.on('data',()=>{});children.push(p);return p;};
 const wait=async<T>(check:()=>Promise<T|false>)=>{const end=Date.now()+45000;while(Date.now()<end){const result=await check();if(result!==false)return result;await delay(150);}throw new Error('Acceptance timeout');};
 const req=(path:string,method='GET',data?:unknown,cookie?:string)=>fetch(origin+path,{method,headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 let result:Record<string,unknown>|undefined;
 try{
  launch(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)]);
  await wait(async()=>{try{return(await req('/api/health')).ok;}catch{return false;}});
  const signup=await req('/api/auth/register','POST',{email:'account-mail-local@example.test',password,nickname:'메일 검증',termsAccepted:true});assert.equal(signup.status,201);const cookie=signup.headers.get('set-cookie')!.split(';')[0];
  const pages=['/login','/auth/forgot-password','/auth/reset-password','/auth/verify-email','/dashboard/settings'];let passwordForms=0;
  for(const path of pages){const page=await req(path,'GET',undefined,path.includes('settings')?cookie:undefined);assert.equal(page.status,200);const html=await page.text(),$=load(html);$('form').each((_,form)=>{if($(form).find('input[type=password]').length){passwordForms++;assert.equal($(form).attr('method'),'post');}});assert.ok(!html.includes(env.NAEO_MAIL_ENCRYPTION_KEY));}
  assert.ok(passwordForms>=4);
  assert.equal((await req('/api/auth/email/request','POST',{},cookie)).status,202);
  const queued=(await(await req('/api/auth/email/status','GET',undefined,cookie)).json()).data;assert.equal(queued.latest.state,'queued');assert.equal(queued.verified,false);
  launch(['--import','tsx','scripts/worker.ts']);
  await wait(async()=>((await(await req('/api/auth/email/status','GET',undefined,cookie)).json()).data.latest?.state==='accepted'));
  assert.equal(attempts,2);assert.equal(inbox.size,1);
  const verifyLink=new URL([...inbox.values()][0].message.text.match(/http[^\s]+/)![0]);assert.equal(verifyLink.search,'');const verifyToken=new URLSearchParams(verifyLink.hash.slice(1)).get('token')!;
  assert.equal((await fetch(verifyLink)).status,200);assert.equal((await(await req('/api/auth/email/status','GET',undefined,cookie)).json()).data.verified,false);
  assert.equal((await req('/api/auth/email/verify','POST',{token:verifyToken})).status,200);assert.equal((await req('/api/auth/email/verify','POST',{token:verifyToken})).status,400);
  const known=await req('/api/auth/password/forgot','POST',{email:'account-mail-local@example.test'}),unknown=await req('/api/auth/password/forgot','POST',{email:'absent-mail@example.test'});assert.equal(known.status,202);assert.deepEqual((await known.json()).data,(await unknown.json()).data);
  await wait(async()=>inbox.size===2);const resetLink=new URL([...inbox.values()][1].message.text.match(/http[^\s]+/)![0]);const resetToken=new URLSearchParams(resetLink.hash.slice(1)).get('token')!;
  assert.equal((await fetch(resetLink)).status,200);assert.equal((await req('/api/auth/me','GET',undefined,cookie)).status,200);
  assert.equal((await req('/api/auth/password/reset','POST',{token:resetToken,newPassword:nextPassword})).status,200);
  assert.equal((await req('/api/auth/me','GET',undefined,cookie)).status,401);assert.equal((await req('/api/auth/password/reset','POST',{token:resetToken,newPassword:password})).status,400);
  assert.equal((await req('/api/auth/login','POST',{email:'account-mail-local@example.test',password})).status,401);assert.equal((await req('/api/auth/login','POST',{email:'account-mail-local@example.test',password:nextPassword})).status,200);
  const ownedDb=openDatabase(env.NAEO_DATABASE_PATH);try{ownedDb.prepare("UPDATE users SET role='admin' WHERE email=?").run('account-mail-local@example.test');}finally{ownedDb.close();}
  const adminLogin=await req('/api/auth/login','POST',{email:'account-mail-local@example.test',password:nextPassword});assert.equal(adminLogin.status,200);const adminCookie=adminLogin.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await req('/api/inquiries','POST',{email:'guest-inquiry@example.test',type:'etc',message:'Local acceptance inquiry'})).status,201);
  const list=(await(await req('/api/admin/inquiries','GET',undefined,adminCookie)).json()).data;const inquiry=list.find((q:{email:string})=>q.email==='guest-inquiry@example.test');assert.ok(inquiry);
  const answered=(await(await req(`/api/admin/inquiries/${inquiry.id}/replies`,'POST',{body:'Local acceptance reply',version:inquiry.version},adminCookie)).json()).data;
  const reply=answered.replies[0];assert.equal((await req(`/api/admin/inquiries/${inquiry.id}/replies/${reply.id}/send`,'POST',{version:answered.version},adminCookie)).status,202);
  await wait(async()=>{const detail=(await(await req(`/api/admin/inquiries/${inquiry.id}`,'GET',undefined,adminCookie)).json()).data;return detail.replies[0].mailState==='accepted';});
  const delivered=[...inbox.values()].find(v=>v.message.to[0]==='guest-inquiry@example.test');assert.ok(delivered?.message.text.includes('Local acceptance reply'));
  result={verifiedAt:new Date().toISOString(),schemaVersion:migrations.at(-1)!.version,passwordFormsChecked:passwordForms,providerRequests:attempts,uniqueLocalMessages:inbox.size,checks:['Production SSR routes and native POST password forms','Actual HTTP Resend adapter and encrypted persistent worker queue','503 after local acceptance then same-key same-payload retry without duplicate local message','GET link does not consume; explicit verification POST succeeds once','Existing and unknown account recovery responses match','Reset invalidates old session/password/link; new password login succeeds','Guest inquiry, admin reply and explicit email dispatch over production Next HTTP and actual worker'],externalInboxVerified:false,browserHydrationVerified:false,externalMailSent:false,temporaryDataRemoved:true};
 }finally{
  for(const p of children){if(p.exitCode!==null||p.signalCode!==null)continue;const exited=new Promise<void>(r=>p.once('exit',()=>r()));p.kill('SIGTERM');const timer=setTimeout(()=>p.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  await new Promise<void>(r=>{provider.close(()=>r());provider.closeAllConnections();});rmSync(temp,{recursive:true,force:true});
 }
 const output=resolve(process.argv[2]||'docs/fullstack/evidence/account-mail-runtime.json');writeFileSync(output,JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
