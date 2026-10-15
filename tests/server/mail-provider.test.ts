import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {mailConfig,resendSender,type MailConfig} from '../../src/server/mail/provider';
async function server(t:TestContext,handle:(q:IncomingMessage,r:ServerResponse)=>void){const s=createServer(handle);await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>{s.close(()=>r());s.closeAllConnections();}));return `http://127.0.0.1:${(s.address() as {port:number}).port}`;}
const message={from:'sender@example.test',to:['recipient@example.test'],subject:'검증 메일',text:'내용'},base:MailConfig={apiKey:'local-synthetic-key',from:message.from,key:Buffer.alloc(32),apiBase:'',appOrigin:'http://127.0.0.1:3000'};
test('Resend adapter sends exact immutable payload and stable idempotency key over actual HTTP',async t=>{
 const seen:{headers:IncomingMessage['headers'];body:string;url?:string}[]=[];
 const url=await server(t,(req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{seen.push({headers:req.headers,body,url:req.url});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'provider-message'}));});});
 const send=resendSender({...base,apiBase:url});assert.equal(await send(message,'same-id'),'provider-message');await send(message,'same-id');
 assert.equal(seen[0].url,'/emails');assert.equal(seen[0].headers.authorization,`Bearer ${base.apiKey}`);assert.equal(seen[0].headers['idempotency-key'],'account-mail/same-id');assert.deepEqual(JSON.parse(seen[0].body),message);assert.equal(seen[0].body,seen[1].body);
});
test('rate limit/concurrent conflict retry, permanent mismatch fails, redirect never forwards credentials',async t=>{
 let mode=429,name='',redirectHits=0;
 const elsewhere=await server(t,(_q,r)=>{redirectHits++;r.end('{}');});
 const url=await server(t,(_q,r)=>{r.writeHead(mode,{'Content-Type':'application/json','Retry-After':'2',Location:elsewhere});r.end(JSON.stringify({name}));});
 const send=resendSender({...base,apiBase:url});await assert.rejects(()=>send(message,'key'),{retryable:true,retryAfter:2000});
 mode=409;name='concurrent_idempotent_requests';await assert.rejects(()=>send(message,'key'),{retryable:true});
 name='invalid_idempotent_request';await assert.rejects(()=>send(message,'key'),{retryable:false});
 mode=302;await assert.rejects(()=>send(message,'key'));assert.equal(redirectHits,0);
});
test('malformed and oversized provider success cannot be reported as acceptance',async t=>{
 let huge=false;const url=await server(t,(_q,r)=>{r.writeHead(200);r.end(huge?'x'.repeat(20*1024):'{}');});const send=resendSender({...base,apiBase:url});
 await assert.rejects(()=>send(message,'key'),{code:'PROVIDER_RESPONSE_INVALID'});huge=true;await assert.rejects(()=>send(message,'key'),{code:'PROVIDER_RESPONSE_INVALID'});
});
test('configuration rejects missing encryption, non-loopback overrides and insecure external app URL',t=>{
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);});
 Object.assign(process.env,{NAEO_EMAIL_PROVIDER:'resend',NAEO_RESEND_API_KEY:base.apiKey,NAEO_MAIL_FROM:message.from,NAEO_MAIL_ENCRYPTION_KEY:base.key.toString('hex'),NAEO_APP_URL:'https://app.example.test'});delete process.env.NAEO_MAIL_API_BASE;
 assert.ok(mailConfig());process.env.NAEO_MAIL_API_BASE='https://attacker.example.test';assert.equal(mailConfig(),null);
 process.env.NAEO_MAIL_API_BASE='http://127.0.0.1:1234';assert.ok(mailConfig());process.env.NAEO_APP_URL='http://public.example.test';assert.equal(mailConfig(),null);
 process.env.NAEO_APP_URL='https://app.example.test';delete process.env.NAEO_MAIL_ENCRYPTION_KEY;assert.equal(mailConfig(),null);
});
