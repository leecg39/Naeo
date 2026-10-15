/** Isolated production HTTP SMS verification; no real SMS or external credentials. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {migrations} from '../../src/server/migrations';
async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-sms-http-')),children:ChildProcess[]=[];
 const account='AC'+randomBytes(16).toString('hex'),service='VA'+randomBytes(16).toString('hex'),key='SK'+randomBytes(16).toString('hex'),secret=randomBytes(32).toString('hex'),code=String(100000+Math.floor(Math.random()*900000)),sid='VE'+randomBytes(16).toString('hex');let requests=0,phone='';
 const provider=createServer((q,r)=>{let body='';q.on('data',b=>body+=b);q.on('end',()=>{try{assert.equal(q.method,'POST');assert.equal(q.headers.authorization,'Basic '+Buffer.from(key+':'+secret).toString('base64'));const fields=new URLSearchParams(body);requests++;const checking=q.url!.endsWith('/VerificationCheck');assert.ok(q.url!.startsWith(`/v2/Services/${service}/`));if(!checking){phone=fields.get('To')!;assert.equal(fields.get('Channel'),'sms');}else assert.equal(fields.get('VerificationSid'),sid);r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify({sid,to:phone,service_sid:service,account_sid:account,channel:'sms',status:checking&&fields.get('Code')===code?'approved':'pending'}));}catch{r.writeHead(400);r.end('{}');}});});
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));const smsPort=(provider.address() as {port:number}).port;
 const probe=tcpServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));const origin=`http://127.0.0.1:${port}`;
 const env={...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:join(temp,'db.sqlite'),NAEO_UPLOAD_DIR:join(temp,'uploads'),NAEO_SMS_PROVIDER:'twilio-verify',NAEO_TWILIO_ACCOUNT_SID:account,NAEO_TWILIO_VERIFY_SERVICE_SID:service,NAEO_TWILIO_API_KEY:key,NAEO_TWILIO_API_SECRET:secret,NAEO_SMS_API_BASE:`http://127.0.0.1:${smsPort}`};
 const req=(path:string,method='GET',data?:unknown,cookie?:string)=>fetch(origin+path,{method,headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});let result;
 try{
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:['ignore','pipe','pipe']});child.stdout!.on('data',()=>{});child.stderr!.on('data',()=>{});children.push(child);let ready=false;for(let i=0;i<200;i++){try{if((await req('/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready);
 const signup=await req('/api/auth/register','POST',{email:'sms-local@example.test',password:randomBytes(24).toString('base64url'),nickname:'sms',termsAccepted:true});assert.equal(signup.status,201);const cookie=signup.headers.get('set-cookie')!.split(';')[0];
 const contact={name:'sms',email:'sms-local@example.test',phone:'01012345678'};assert.equal((await req('/api/contact-details','POST',contact,cookie)).status,201);
 assert.equal((await req('/api/auth/phone/request','POST',{},cookie)).status,202);assert.equal(phone,'+821012345678');assert.equal((await req('/api/auth/phone/request','POST',{},cookie)).status,429);
 const wrong=await req('/api/auth/phone/check','POST',{code:'000000'},cookie);assert.equal(wrong.status,200);assert.equal((await wrong.json()).data.verified,false);
 const checked=await req('/api/auth/phone/check','POST',{code},cookie);assert.equal(checked.status,200);const verified=(await checked.json()).data;assert.equal(verified.verified,true);assert.ok(verified.contact.phoneVerifiedAt);
 const html=await(await req('/dashboard/settings','GET',undefined,cookie)).text();assert.ok(html.includes('PhoneVerification')||html.includes('휴대폰 번호 인증'));assert.ok(!html.includes(secret));
 assert.equal((await req('/api/auth/phone/check','POST',{code},cookie)).status,409);
 const changed=await req('/api/contact-details','PATCH',{...contact,phone:'01099998888',version:verified.contact.version},cookie);assert.equal(changed.status,200);assert.equal((await changed.json()).data.phoneVerifiedAt,null);
 assert.equal((await req('/api/auth/phone/check','POST',{code},cookie)).status,409);await req('/api/auth/logout','POST',{},cookie);assert.equal((await req('/api/auth/phone/request','POST',{},cookie)).status,401);
 result={verifiedAt:new Date().toISOString(),schemaVersion:migrations.at(-1)!.version,providerRequests:requests,checks:['Production Next registration and contact storage','Explicit SMS request normalizes Korean mobile; cooldown enforced','Wrong code remains unverified; provider-approved code marks current contact','Settings SSR shows phone verification UI without secrets','Replay and changed phone invalidation; logout denies requests'],externalSmsSent:false,realHandsetVerified:false,browserVerified:false,temporaryDataRemoved:true};
 }finally{for(const p of children){if(p.exitCode!==null||p.signalCode!==null)continue;const exited=new Promise<void>(r=>p.once('exit',()=>r()));p.kill('SIGTERM');const timer=setTimeout(()=>p.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}await new Promise<void>(r=>{provider.close(()=>r());provider.closeAllConnections();});rmSync(temp,{recursive:true,force:true});}
 writeFileSync(resolve(process.argv[2]||'docs/fullstack/evidence/sms-runtime.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
