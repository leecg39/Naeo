import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {tokenHash} from '../auth';
import {AppError} from '../errors';
import {getContact} from '../preferences';
import {audit} from '../audit';
import {normalizedPhone,twilioProvider,type SmsConfig,type SmsProvider} from './provider';
const fail=()=>new AppError(409,'SMS_STALE','연락처나 로그인 상태가 변경됐거나 인증이 만료됐습니다. 새 인증을 요청해주세요.');
function session(db:Database,user:string,hash:string){if(!db.prepare("SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>? AND u.status='active'").get(hash,user,Date.now()))throw fail();}
function configured(c:SmsConfig|null):asserts c is SmsConfig{if(!c)throw new AppError(503,'SMS_NOT_CONFIGURED','현재 휴대폰 인증을 이용할 수 없습니다.');}
export async function startSms(db:Database,user:string,token:string,c:SmsConfig|null,p?:SmsProvider){
 configured(c);const hash=tokenHash(token),now=Date.now();
 const job=transaction(db,()=>{session(db,user,hash);const contact=getContact(db,user);if(!contact?.phone)throw new AppError(400,'PHONE_REQUIRED','휴대폰 번호를 먼저 저장해주세요.');const phone=normalizedPhone(contact.phone);const old=db.prepare('SELECT created_at FROM sms_challenges WHERE user_id=?').get(user) as {created_at:number}|undefined;if(old&&old.created_at>now-60000)throw new AppError(429,'SMS_COOLDOWN','새 인증은 60초 후 요청해주세요.');const id=randomUUID();db.prepare('DELETE FROM sms_challenges WHERE user_id=?').run(user);db.prepare("INSERT INTO sms_challenges(user_id,id,session_hash,phone,contact_version,service,state,created_at,expires_at) VALUES(?,?,?,?,?,?,'starting',?,?)").run(user,id,hash,phone,contact.version,c.service,now,now+600000);return{id,phone};});
 try{const response=await(p??twilioProvider(c)).start(job.phone);if(response.status!=='pending')throw fail();return transaction(db,()=>{session(db,user,hash);const updated=db.prepare("UPDATE sms_challenges SET state='pending',provider_sid=? WHERE user_id=? AND id=? AND state='starting' AND expires_at>?").run(response.sid,user,job.id,Date.now());if(!updated.changes)throw fail();audit(db,user,'phone.request','contact',user);return{requested:true};});}
 catch(e){db.prepare("UPDATE sms_challenges SET state='failed' WHERE user_id=? AND id=?").run(user,job.id);throw e;}
}
export async function checkSms(db:Database,user:string,token:string,code:string,c:SmsConfig|null,p?:SmsProvider){
 configured(c);if(!/^\d{4,10}$/.test(code))throw new AppError(400,'SMS_CODE','문자로 받은 숫자 코드를 입력해주세요.');const hash=tokenHash(token),now=Date.now();
 const job=transaction(db,()=>{session(db,user,hash);const row=db.prepare("SELECT id,phone,provider_sid,contact_version,attempts FROM sms_challenges WHERE user_id=? AND session_hash=? AND service=? AND expires_at>? AND attempts<5 AND state='pending'").get(user,hash,c.service,now) as {id:string;phone:string;provider_sid:string;contact_version:number;attempts:number}|undefined;if(!row)throw fail();const lease=randomUUID();db.prepare("UPDATE sms_challenges SET state='checking',lease=?,lease_until=?,attempts=attempts+1 WHERE id=?").run(lease,now+30000,row.id);return{...row,lease};});
 try{const response=await(p??twilioProvider(c)).check(job.phone,job.provider_sid,code);return transaction(db,()=>{session(db,user,hash);const row=db.prepare("SELECT 1 FROM sms_challenges WHERE id=? AND lease=? AND state='checking' AND expires_at>? AND lease_until>?").get(job.id,job.lease,Date.now(),Date.now());if(!row)throw fail();
 if(response.status!=='approved'){db.prepare("UPDATE sms_challenges SET state=? WHERE id=?").run(job.attempts+1>=5?'failed':'pending',job.id);return{verified:false,contact:getContact(db,user)};}
 const contact=getContact(db,user);if(!contact||contact.version!==job.contact_version||normalizedPhone(contact.phone)!==job.phone)throw fail();
 db.prepare('UPDATE contact_details SET phone_verified_at=?,version=version+1,updated_at=? WHERE user_id=? AND version=?').run(Date.now(),Date.now(),user,job.contact_version);audit(db,user,'phone.verify','contact',user);return{verified:true,contact:getContact(db,user)};});}
 catch(e){db.prepare("UPDATE sms_challenges SET state='failed' WHERE id=? AND lease=?").run(job.id,job.lease);throw e;}
}
export function smsStatus(db:Database,user:string,c:SmsConfig|null){const r=db.prepare('SELECT state,attempts,expires_at AS expiresAt,created_at AS createdAt FROM sms_challenges WHERE user_id=? AND expires_at>?').get(user,Date.now());return{available:!!c,challenge:r?{...r}:null};}
