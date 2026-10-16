import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {encryptMail,decryptMail,MailError,resendSender,type MailConfig,type MailSender} from './provider';

/**
 * 회원 알림 메일 아웃박스(스키마 43). preference 동의(scan_email/marketing_email)를 보내는 시점이 아니라
 * 넣는 시점에 확인하고, 같은 대상(kind+ref_id)은 한 번만 넣는다. 공급자 미설정이면 넣지 않는다.
 */
export type NotifyKind='scan_done'|'benefit';
const PREF:Record<NotifyKind,string>={scan_done:'scan_email',benefit:'marketing_email'};
const EXPIRES_MS=24*3600_000,MAX_ATTEMPTS=5,LEASE_MS=60_000;

type UserRow={email:string;pref:number;status:string};
function recipient(db:Database,userId:string,kind:NotifyKind):UserRow|null{
 const r=db.prepare(`SELECT u.email,u.status,coalesce(p.${PREF[kind]},0) AS pref FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id WHERE u.id=?`).get(userId) as UserRow|undefined;
 return r&&r.status==='active'&&r.pref?r:null;
}

/** 알림 메일을 넣는다(트랜잭션 안 호출 가능). 설정·동의·중복을 모두 검사하고 넣었으면 id를 돌려준다. */
export function queueNotifyMail(db:Database,userId:string,kind:NotifyKind,refId:string,subject:string,text:string,config:MailConfig|null,now=Date.now()):string|null{
 if(!config)return null;
 const user=recipient(db,userId,kind);
 if(!user)return null;
 const id=randomUUID();
 const message={from:config.from,to:[user.email],subject:subject.slice(0,200),text:`${text.slice(0,4000)}\n\n알림 수신 설정은 계정 설정에서 바꿀 수 있습니다.`};
 const r=db.prepare("INSERT OR IGNORE INTO notify_mail(id,user_id,kind,ref_id,payload,state,run_after,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?,?,?)")
  .run(id,userId,kind,refId.slice(0,100),encryptMail(message,id,config.key),now,now+EXPIRES_MS,now,now);
 return r.changes?id:null;
}

/** 대기 중인 혜택 알림을 거둔다(리워드 회수 등). 이미 보낸 건 건드리지 않는다. */
export function retractNotifyMail(db:Database,kind:NotifyKind,refId:string,now=Date.now()){
 return Number(db.prepare("UPDATE notify_mail SET state='failed',payload=NULL,error_code='RETRACTED',updated_at=? WHERE kind=? AND ref_id=? AND state IN ('queued','retry','sending')").run(now,kind,refId).changes);
}

export function cleanupNotifyMail(db:Database,now=Date.now()){
 return Number(db.prepare("DELETE FROM notify_mail WHERE expires_at<=? OR (state IN ('accepted','failed') AND updated_at<?)").run(now,now-7*86_400_000).changes);
}

/** 알림 메일 하나를 보낸다. 처리했으면 true. */
export async function runNotifyMailOnce(db:Database,config:MailConfig|null,sender?:MailSender,now=Date.now()){
 db.prepare("UPDATE notify_mail SET state='failed',payload=NULL,error_code='EXPIRED',updated_at=? WHERE expires_at<=? AND state IN ('queued','retry','sending')").run(now,now);
 db.prepare("UPDATE notify_mail SET state='failed',payload=NULL,error_code='RETRIES_EXHAUSTED',updated_at=? WHERE state='sending' AND lease_until<=? AND attempt>=?").run(now,now,MAX_ATTEMPTS);
 if(!config)return false;
 const job=transaction(db,()=>{
  const row=db.prepare("SELECT m.id,m.user_id AS userId,m.kind,m.payload,m.attempt,m.expires_at AS expiresAt FROM notify_mail m JOIN users u ON u.id=m.user_id AND u.status='active' WHERE m.expires_at>? AND m.attempt<? AND ((m.state IN ('queued','retry') AND m.run_after<=?) OR (m.state='sending' AND m.lease_until<=?)) ORDER BY m.created_at LIMIT 1").get(now,MAX_ATTEMPTS,now,now) as {id:string;userId:string;kind:NotifyKind;payload:string;attempt:number;expiresAt:number}|undefined;
  if(!row)return null;
  const lease=randomUUID();
  db.prepare("UPDATE notify_mail SET state='sending',attempt=attempt+1,lease=?,lease_until=?,updated_at=? WHERE id=?").run(lease,now+LEASE_MS,now,row.id);
  // 발송 전에 동의를 거둔 회원에게는 보내지 않고 큐에서 지운다(리워드 회수와 같은 규칙).
  if(!(db.prepare(`SELECT coalesce(${PREF[row.kind]},0) AS p FROM notification_preferences WHERE user_id=?`).get(row.userId) as {p:number}|undefined)?.p){
   db.prepare('DELETE FROM notify_mail WHERE id=?').run(row.id);return null;
  }
  return{...row,lease};
 });
 if(!job)return false;
 try{
  const msg=decryptMail(job.payload,job.id,config.key);
  if(msg.from!==config.from)throw new MailError('MAIL_CONFIG_CHANGED',false);
  const providerId=await (sender??resendSender(config,'notify-mail'))(msg,job.id);
  db.prepare("UPDATE notify_mail SET state='accepted',payload=NULL,error_code='',provider_id=?,lease=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state='sending' AND lease=? AND expires_at>?").run(providerId,now,job.id,job.lease,now);
 }catch(e){
  const error=e instanceof MailError?e:new MailError('PROVIDER_UNREACHABLE',true);
  const retryAt=now+Math.max(error.retryAfter,Math.min(300_000,15_000*2**job.attempt));
  const retry=error.retryable&&job.attempt+1<MAX_ATTEMPTS&&retryAt<job.expiresAt;
  db.prepare("UPDATE notify_mail SET state=?,payload=CASE WHEN ? THEN payload ELSE NULL END,error_code=?,run_after=?,lease=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state='sending' AND lease=?").run(retry?'retry':'failed',retry?1:0,error.code,retryAt,now,job.id,job.lease);
 }
 return true;
}
