import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {AppError} from '../errors';
import {deleteInput} from '../validation';
import {audit} from '../audit';
import {assertVersion,inquiryRow} from './records';
import {encryptMail,decryptMail,MailError,resendSender,type MailConfig,type MailSender} from '../mail/provider';
export function queueReplyMail(db:Database,actorId:string,id:string,replyId:string,input:unknown,config:MailConfig|null){
 requireAdmin(userById(db,actorId));const {version}=deleteInput.parse(input);
 if(!config)throw new AppError(503,'MAIL_NOT_CONFIGURED','현재 메일 발송을 이용할 수 없습니다.');
 return transaction(db,()=>{
 const inquiry=inquiryRow(db,id);assertVersion(inquiry.version,version);
 const reply=db.prepare('SELECT body FROM inquiry_messages WHERE id=? AND inquiry_id=?').get(replyId,id) as {body:string}|undefined;
 if(!reply)throw new AppError(404,'REPLY_NOT_FOUND','답변을 찾을 수 없습니다.');
 if(db.prepare('SELECT 1 FROM inquiry_mail WHERE reply_id=?').get(replyId))return;
 const key=randomUUID(),now=Date.now();
 const message={from:config.from,to:[inquiry.email],subject:'NAEO 문의 답변',text:`문의하신 내용에 답변드립니다.\n\n${reply.body}\n\n문의 번호: ${id}`};
 db.prepare("INSERT INTO inquiry_mail(id,reply_id,payload,state,run_after,expires_at,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?,?)").run(key,replyId,encryptMail(message,key,config.key),now,now+23*3600_000,now,now);
 db.prepare('UPDATE inquiries SET version=version+1,updated_at=? WHERE id=?').run(now,id);
 audit(db,actorId,'inquiry.mail.request','inquiry',id,{replyId});
 });
}
export async function runInquiryMailOnce(db:Database,config:MailConfig|null,sender?:MailSender){
 const now=Date.now();
 db.prepare("UPDATE inquiry_mail SET state='failed',payload=NULL,error_code='EXPIRED',updated_at=? WHERE expires_at<=? AND state IN ('queued','retry','sending')").run(now,now);
 db.prepare("UPDATE inquiry_mail SET state='failed',payload=NULL,error_code='RETRIES_EXHAUSTED',updated_at=? WHERE state='sending' AND lease_until<=? AND attempt>=5").run(now,now);
 if(!config)return false;
 const job=transaction(db,()=>{
 const row=db.prepare("SELECT id,payload,attempt,expires_at FROM inquiry_mail WHERE expires_at>? AND attempt<5 AND ((state IN ('queued','retry') AND run_after<=?) OR (state='sending' AND lease_until<=?)) ORDER BY created_at LIMIT 1").get(now,now,now) as {id:string;payload:string;attempt:number;expires_at:number}|undefined;
 if(!row)return null;const lease=randomUUID();db.prepare("UPDATE inquiry_mail SET state='sending',attempt=attempt+1,lease=?,lease_until=?,updated_at=? WHERE id=?").run(lease,now+60000,now,row.id);return{...row,lease};
 });
 if(!job)return false;
 try{
 const msg=decryptMail(job.payload,job.id,config.key);if(msg.from!==config.from)throw new MailError('MAIL_CONFIG_CHANGED',false);
 await(sender??resendSender(config))(msg,job.id);
 db.prepare("UPDATE inquiry_mail SET state='accepted',payload=NULL,error_code='',updated_at=? WHERE id=? AND state='sending' AND lease=? AND expires_at>?").run(Date.now(),job.id,job.lease,Date.now());
 }catch(e){const error=e instanceof MailError?e:new MailError('PROVIDER_UNREACHABLE',true),at=Date.now(),retryAt=at+Math.max(error.retryAfter,Math.min(300000,15000*2**job.attempt));const retry=error.retryable&&job.attempt+1<5&&retryAt<job.expires_at;
 db.prepare("UPDATE inquiry_mail SET state=?,payload=CASE WHEN ? THEN payload ELSE NULL END,error_code=?,run_after=?,updated_at=? WHERE id=? AND state='sending' AND lease=?").run(retry?'retry':'failed',retry?1:0,error.code,retryAt,at,job.id,job.lease);
 }
 return true;
}
