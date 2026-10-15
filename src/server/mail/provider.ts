import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {z} from 'zod';
export type MailConfig={apiKey:string;from:string;key:Buffer;apiBase:string;appOrigin:string};
export type MailMessage={from:string;to:string[];subject:string;text:string};
export type MailSender=(message:MailMessage,idempotencyKey:string)=>Promise<string>;
export class MailError extends Error{constructor(public code:string,public retryable:boolean,public retryAfter=0){super(code);}}
const loopback=(u:URL)=>u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname);
/** No guessed provider: all four mail variables are required. Override endpoint is loopback-only for isolated tests. */
export function mailConfig():MailConfig|null{
 try{
  const e=process.env;if(e.NAEO_EMAIL_PROVIDER!=='resend'||!e.NAEO_RESEND_API_KEY||!z.email().safeParse(e.NAEO_MAIL_FROM).success||! /^[a-f0-9]{64}$/i.test(e.NAEO_MAIL_ENCRYPTION_KEY??''))return null;
  const app=new URL(e.NAEO_APP_URL??''),api=new URL(e.NAEO_MAIL_API_BASE??'https://api.resend.com');
  if(app.username||app.password||app.search||app.hash||app.pathname!=='/'||!(app.protocol==='https:'||loopback(app)))return null;
  if(api.username||api.password||api.search||api.hash||api.pathname!=='/'||!(api.origin==='https://api.resend.com'||loopback(api)))return null;
  return{apiKey:e.NAEO_RESEND_API_KEY,from:e.NAEO_MAIL_FROM!,key:Buffer.from(e.NAEO_MAIL_ENCRYPTION_KEY!,'hex'),apiBase:api.origin,appOrigin:app.origin};
 }catch{return null;}
}
export function encryptMail(message:MailMessage,id:string,key:Buffer){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(id));const bytes=Buffer.concat([cipher.update(JSON.stringify(message),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');}
export function decryptMail(encoded:string,id:string,key:Buffer):MailMessage{
 try{const b=Buffer.from(encoded,'base64'),decipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));decipher.setAAD(Buffer.from(id));decipher.setAuthTag(b.subarray(12,28));return z.object({from:z.email(),to:z.array(z.email()).length(1),subject:z.string().max(200),text:z.string().max(8000)}).strict().parse(JSON.parse(Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString()));}
 catch{throw new MailError('PAYLOAD_UNREADABLE',false);}
}
async function responseJson(response:Response){
 if(!response.body)return{};const reader=response.body.getReader(),parts:Uint8Array[]=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>16*1024){await reader.cancel();throw new MailError('PROVIDER_RESPONSE_INVALID',true);}parts.push(value);}try{return JSON.parse(Buffer.concat(parts).toString()) as {id?:unknown;name?:unknown};}catch{return{};}}
 finally{reader.releaseLock();}
}
/** Same immutable body + idempotency key on retry; all token TTLs are shorter than the provider's 24-hour deduplication window. */
export function resendSender(config:MailConfig):MailSender{return async(message,id)=>{
 try{
  const r=await fetch(config.apiBase+'/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json','Idempotency-Key':`account-mail/${id}`},body:JSON.stringify(message)});
  const data=await responseJson(r);
  if(!r.ok){const retry=r.status===429||r.status>=500||(r.status===409&&data.name==='concurrent_idempotent_requests');throw new MailError(r.status===429?'RATE_LIMITED':'PROVIDER_REJECTED',retry,Math.min(3600_000,Math.max(0,Number(r.headers.get('retry-after'))||0)*1000));}
  if(typeof data.id!=='string'||data.id.length<1||data.id.length>200)throw new MailError('PROVIDER_RESPONSE_INVALID',true);
  return data.id;
 }catch(e){if(e instanceof MailError)throw e;throw new MailError('PROVIDER_UNREACHABLE',true);}
};}
