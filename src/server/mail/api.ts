import {z} from 'zod';
import type {Database} from '../database';
import type {User} from '../auth';
import {body,clientPeer,json,rateLimit,sessionCookie} from '../http';
import {mailConfig} from './provider';
import {mailStatus,requestReset,requestVerification,resetPassword,verifyEmail,resetRequestInput,resetInput,tokenInput} from './account-mail';
export async function publicMailApi(db:Database,request:Request){
 const path=new URL(request.url).pathname;if(request.method!=='POST')return null;
 if(!['/api/auth/password/forgot','/api/auth/password/reset','/api/auth/email/verify'].includes(path))return null;
 rateLimit(db,`mail:peer:${clientPeer(request)}`,30,15*60_000);
 if(path==='/api/auth/password/forgot'){
  const input=await body(request,resetRequestInput);rateLimit(db,`mail:address:${input.email}`,5,60*60_000);
  return json({data:requestReset(db,input,mailConfig())},202);
 }
 if(path==='/api/auth/password/reset')return json({data:await resetPassword(db,await body(request,resetInput))},200,{'Set-Cookie':sessionCookie('',0)});
 return json({data:verifyEmail(db,await body(request,tokenInput))});
}
export async function memberMailApi(db:Database,request:Request,user:User){
 const path=new URL(request.url).pathname;
 if(path==='/api/auth/email/status'&&request.method==='GET')return json({data:mailStatus(db,user.id,mailConfig())});
 if(path==='/api/auth/email/request'&&request.method==='POST'){
  await body(request,z.object({}).strict());rateLimit(db,`mail:verification:${user.id}`,5,60*60_000);
  return json({data:requestVerification(db,user.id,mailConfig())},202);
 }
 return null;
}
