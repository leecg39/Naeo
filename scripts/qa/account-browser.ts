/** Local browser acceptance fixture. Only loopback providers; never sends real mail or SMS. */
import {spawn,type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {createWriteStream,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

async function main(){
 const port=Number(process.argv[2]??3299);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Use a local port between 1024 and 65535');
 const probe=tcpServer();
 await new Promise<void>((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'::1',resolve);});
 await new Promise<void>(resolve=>probe.close(()=>resolve()));
 const origin=`http://[::1]:${port}`,temp=mkdtempSync(join(tmpdir(),'naeo-account-browser-'));
 const children:ChildProcess[]=[],inbox:{to:string[];subject:string;text:string}[]=[],messages=new Map<string,{phone:string;code:string}>();
 const seen=new Set<string>(),account='AC'+randomBytes(16).toString('hex'),service='VA'+randomBytes(16).toString('hex'),key='SK'+randomBytes(16).toString('hex'),secret=randomBytes(32).toString('hex'),mailKey=randomBytes(24).toString('hex');
 const credentials={email:'account-browser@example.test',password:randomBytes(24).toString('base64url'),newPassword:randomBytes(24).toString('base64url'),finalPassword:randomBytes(24).toString('base64url')};
 const statePath=join(temp,'context.json');
 const persist=()=>writeFileSync(statePath,JSON.stringify({origin,temp,...credentials,inbox,sms:[...messages.values()]},null,2)+'\n',{mode:0o600});
 const receiver=createServer((request,response)=>{
  let body='';
  request.on('data',chunk=>{body+=chunk;if(body.length>65536)request.destroy();});
  request.on('end',()=>{
   try{
    response.setHeader('Content-Type','application/json');
    if(request.method!=='POST')throw Error('Only POST');
    if(request.url==='/emails'){
     if(request.headers.authorization!==`Bearer ${mailKey}`)throw Error('Invalid mail credentials');
     const message=JSON.parse(body),id=String(request.headers['idempotency-key']??'');
     if(!id||!Array.isArray(message.to)||!message.to.every((address:string)=>address.endsWith('@example.test')))throw Error('Only fixture recipients');
     if(!seen.has(id)){seen.add(id);inbox.push({to:message.to,subject:message.subject,text:message.text});persist();}
     response.end(JSON.stringify({id:`fixture-${seen.size}`}));return;
    }
    if(request.headers.authorization!=='Basic '+Buffer.from(key+':'+secret).toString('base64'))throw Error('Invalid SMS credentials');
    const fields=new URLSearchParams(body);let sid:string,status='pending';
    if(request.url===`/v2/Services/${service}/Verifications`){
     const phone=fields.get('To');if(!phone||!phone.startsWith('+8210')||fields.get('Channel')!=='sms')throw Error('Invalid fixture number');
     sid='VE'+randomBytes(16).toString('hex');messages.set(sid,{phone,code:String(100000+Math.floor(Math.random()*900000))});persist();
    }else if(request.url===`/v2/Services/${service}/VerificationCheck`){
     sid=fields.get('VerificationSid')??'';if(!messages.has(sid))throw Error('Unknown challenge');
     if(fields.get('Code')===messages.get(sid)!.code)status='approved';
    }else throw Error('Unknown route');
    response.end(JSON.stringify({sid,status,to:messages.get(sid)!.phone,channel:'sms',service_sid:service,account_sid:account}));
   }catch{response.statusCode=400;response.end('{}');}
  });
 });
 await new Promise<void>(resolve=>receiver.listen(0,'127.0.0.1',resolve));
 const receiverPort=(receiver.address() as {port:number}).port;
 const env={...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:join(temp,'db.sqlite'),NAEO_UPLOAD_DIR:join(temp,'uploads'),NAEO_WORKER_IDLE_MS:'200',NAEO_EMAIL_PROVIDER:'resend',NAEO_RESEND_API_KEY:mailKey,NAEO_MAIL_FROM:'qa@example.test',NAEO_MAIL_ENCRYPTION_KEY:randomBytes(32).toString('hex'),NAEO_MAIL_API_BASE:`http://127.0.0.1:${receiverPort}`,NAEO_SMS_PROVIDER:'twilio-verify',NAEO_TWILIO_ACCOUNT_SID:account,NAEO_TWILIO_VERIFY_SERVICE_SID:service,NAEO_TWILIO_API_KEY:key,NAEO_TWILIO_API_SECRET:secret,NAEO_SMS_API_BASE:`http://127.0.0.1:${receiverPort}`,NAEO_PHONE_REWARD_KEY:randomBytes(32).toString('hex')};
 // Unrelated integrations are disabled even if the caller has credentials in their environment.
 for(const name of ['ANTHROPIC_API_KEY','NAEO_OPENAI_CLIENT_ID','NAEO_IMAGE_PROVIDER','NAEO_CITATION_PROVIDER','NAEO_TOSS_CLIENT_KEY','NAEO_TOSS_SECRET_KEY','NAEO_GOOGLE_CLIENT_ID','NAEO_NAVER_OAUTH_CLIENT_ID','NAEO_SEARCHAD_API_KEY','NAEO_NAVER_CLIENT_ID'])delete (env as Record<string,string|undefined>)[name];
 const launch=(args:string[],name:string)=>{const child=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']}),log=createWriteStream(join(temp,`${name}.log`),{mode:0o600});child.stdout!.pipe(log);child.stderr!.pipe(log);children.push(child);return child;};
 let stopping=false;
 const stop=async()=>{
  if(stopping)return;stopping=true;
  for(const child of children){if(child.exitCode!==null||child.signalCode!==null)continue;const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await ended;clearTimeout(timer);}
  await new Promise<void>(resolve=>{receiver.close(()=>resolve());receiver.closeAllConnections();});
  rmSync(temp,{recursive:true,force:true});
 };
 process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
 try{
  const web=launch(['node_modules/next/dist/bin/next','start','--hostname','::1','--port',String(port)],'web');
  let ready=false;
  for(let i=0;i<300;i++){if(web.exitCode!==null)throw Error('QA web server exited');try{if((await fetch(`${origin}/api/health`)).ok){ready=true;break;}}catch{/* Starting. */}await delay(200);}
  if(!ready)throw Error('QA web server did not become ready');
  const registration=await fetch(`${origin}/api/auth/register`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:credentials.email,password:credentials.password,nickname:'계정 흐름 확인',termsAccepted:true})});
  if(registration.status!==201)throw Error(`QA registration failed (${registration.status})`);
  persist();launch(['--import','tsx','scripts/worker.ts'],'worker');
  process.stdout.write(JSON.stringify({origin,statePath,externalMailSent:false,externalSmsSent:false})+'\n');
 }catch(error){await stop();throw error;}
}
main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
