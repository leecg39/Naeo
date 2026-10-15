import {z} from 'zod';
import type {Database} from '../database';
import {tokenHash,type User} from '../auth';
import {body,clientPeer,cookieToken,json,rateLimit} from '../http';
import {getContact} from '../preferences';
import {smsConfig,normalizedPhone} from './provider';
import {startSms,checkSms,smsStatus} from './service';
export async function smsApi(db:Database,r:Request,u:User){const path=new URL(r.url).pathname;
 if(path==='/api/auth/phone/status'&&r.method==='GET')return json({data:smsStatus(db,u.id,smsConfig())});
 if(!['/api/auth/phone/request','/api/auth/phone/check'].includes(path)||r.method!=='POST')return null;
 rateLimit(db,`sms:peer:${clientPeer(r)}`,30,3600000);
 if(path.endsWith('/request')){await body(r,z.object({}).strict());rateLimit(db,`sms:user:${u.id}`,5,3600000);const phone=getContact(db,u.id)?.phone;if(phone)rateLimit(db,`sms:number:${tokenHash(normalizedPhone(phone))}`,5,3600000);return json({data:await startSms(db,u.id,cookieToken(r)??'',smsConfig())},202);}
 const input=await body(r,z.object({code:z.string().regex(/^\d{4,10}$/)}).strict());rateLimit(db,`sms:check:${u.id}`,20,3600000);return json({data:await checkSms(db,u.id,cookieToken(r)??'',input.code,smsConfig())});
}
