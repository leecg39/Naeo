import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {decryptMail,MailError,resendSender,type MailConfig,type MailSender} from './provider';
export const MAIL_LEASE=60_000,MAX_ATTEMPTS=5;
export function cleanupMail(db:Database,now=Date.now()){return Number(db.prepare('DELETE FROM account_mail WHERE expires_at<=?').run(now).changes);}
export async function runMailOnce(db:Database,config:MailConfig|null,sender?:MailSender){
 const now=Date.now();cleanupMail(db,now);if(!config)return false;
 const job=transaction(db,()=>{
  db.prepare("UPDATE account_mail SET state='failed',encrypted_payload=NULL,error_code='RETRIES_EXHAUSTED',updated_at=? WHERE state='sending' AND lease_until<=? AND attempt>=?").run(now,now,MAX_ATTEMPTS);
  const row=db.prepare(`SELECT m.id,m.encrypted_payload AS payload,m.attempt,m.expires_at AS expiresAt FROM account_mail m JOIN users u ON u.id=m.user_id
   WHERE m.expires_at>? AND u.status='active' AND m.email=u.email AND m.attempt<? AND ((m.state IN ('queued','retry') AND m.run_after<=?) OR (m.state='sending' AND m.lease_until<=?)) ORDER BY m.created_at LIMIT 1`).get(now,MAX_ATTEMPTS,now,now) as {id:string;payload:string;attempt:number;expiresAt:number}|undefined;
  if(!row)return null;const lease=randomUUID();db.prepare("UPDATE account_mail SET state='sending',lease_token=?,lease_until=?,attempt=attempt+1,updated_at=? WHERE id=?").run(lease,now+MAIL_LEASE,now,row.id);return{...row,lease};
 });
 if(!job)return false;
 try{
  const message=decryptMail(job.payload,job.id,config.key);
  const link=message.text.match(/https?:\/\/[^\s]+/)?.[0];
  if(message.from!==config.from||!link?.startsWith(config.appOrigin+'/auth/'))throw new MailError('MAIL_CONFIG_CHANGED',false);
  const providerId=await(sender??resendSender(config))(message,job.id);
  db.prepare("UPDATE account_mail SET state='accepted',encrypted_payload=NULL,provider_id=?,accepted_at=?,lease_until=NULL,error_code='',updated_at=? WHERE id=? AND state='sending' AND lease_token=? AND expires_at>?").run(providerId,Date.now(),Date.now(),job.id,job.lease,Date.now());
 }catch(e){
  const error=e instanceof MailError?e:new MailError('PROVIDER_UNREACHABLE',true),at=Date.now();
  const retryAt=at+Math.max(error.retryAfter,Math.min(300_000,15000*2**job.attempt));
  const retry=error.retryable&&job.attempt+1<MAX_ATTEMPTS&&retryAt<job.expiresAt;
  db.prepare("UPDATE account_mail SET state=?,encrypted_payload=CASE WHEN ? THEN encrypted_payload ELSE NULL END,lease_until=NULL,run_after=?,error_code=?,updated_at=? WHERE id=? AND state='sending' AND lease_token=?").run(retry?'retry':'failed',retry?1:0,retryAt,error.code,at,job.id,job.lease);
 }
 return true;
}
