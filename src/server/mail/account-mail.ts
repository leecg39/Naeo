import {randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {hashPassword,tokenHash,userById} from '../auth';
import {AppError} from '../errors';
import {audit} from '../audit';
import {revokeUserGrants} from '../oauth/grants';
import {email,password} from '../validation';
import {encryptMail,type MailConfig} from './provider';
export const resetRequestInput=z.object({email}).strict();
export const tokenInput=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
export const resetInput=tokenInput.extend({newPassword:password}).strict();
const accepted={accepted:true,message:'이 주소로 이용 가능한 계정이 있으면 재설정 안내를 보냅니다. 잠시 후 받은편지함과 스팸함을 확인해주세요.'};
function configured(config:MailConfig|null):asserts config is MailConfig{if(!config)throw new AppError(503,'MAIL_NOT_CONFIGURED','현재 이메일 안내를 이용할 수 없습니다. 잠시 후 다시 시도하거나 고객 지원에 문의해주세요.');}
function enqueue(db:Database,userId:string,address:string,purpose:'reset'|'verify',config:MailConfig,now:number){
 if(db.prepare('SELECT 1 FROM account_mail WHERE user_id=? AND purpose=? AND created_at>? AND expires_at>?').get(userId,purpose,now-60_000,now))return;
 const id=randomUUID(),token=randomBytes(32).toString('base64url'),minutes=purpose==='reset'?30:60;
 const url=`${config.appOrigin}/auth/${purpose==='reset'?'reset-password':'verify-email'}#token=${token}`;
 const action=purpose==='reset'?'비밀번호 재설정':'이메일 인증';
 const message={from:config.from,to:[address],subject:`NAEO ${action} 안내`,text:`${action}을 요청하셨다면 아래 링크를 열어 직접 확인해주세요. 링크는 ${minutes}분 동안 한 번만 사용할 수 있습니다.\n\n${url}\n\n요청하지 않으셨다면 이 메일을 무시해주세요. 비밀번호와 로그인 상태는 링크를 열기만 해서는 변경되지 않습니다.`};
 db.prepare('INSERT INTO account_mail(id,user_id,purpose,email,token_hash,encrypted_payload,run_after,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,userId,purpose,address,tokenHash(token),encryptMail(message,id,config.key),now,now,now,now+minutes*60_000);
 audit(db,userId,`account_mail.${purpose}.request`,'account_mail',id);
}
export function requestReset(db:Database,input:unknown,config:MailConfig|null,now=Date.now()){
 const {email:address}=resetRequestInput.parse(input);configured(config);
 transaction(db,()=>{const u=db.prepare("SELECT id FROM users WHERE email=? AND status='active'").get(address) as {id:string}|undefined;if(u)enqueue(db,u.id,address,'reset',config,now);});
 return {...accepted};
}
export function requestVerification(db:Database,userId:string,config:MailConfig|null,now=Date.now()){
 configured(config);return transaction(db,()=>{const user=userById(db,userId);if(user.status!=='active')throw new AppError(401,'UNAUTHENTICATED','다시 로그인해주세요.');if(!user.emailVerifiedAt)enqueue(db,userId,user.email,'verify',config,now);return{requested:true,verified:!!user.emailVerifiedAt};});
}
function validLink(db:Database,token:string,purpose:string,now=Date.now()){
 const row=db.prepare(`SELECT m.id,m.user_id AS userId FROM account_mail m JOIN users u ON u.id=m.user_id
 WHERE m.token_hash=? AND m.purpose=? AND m.expires_at>? AND m.email=u.email AND u.status='active'`).get(tokenHash(token),purpose,now) as {id:string;userId:string}|undefined;
 if(!row)throw new AppError(400,'INVALID_EMAIL_LINK','유효하지 않거나 만료된 링크입니다. 안내 메일을 다시 요청해주세요.');return row;
}
export async function resetPassword(db:Database,input:unknown){
 const {token,newPassword}=resetInput.parse(input);validLink(db,token,'reset');const hash=await hashPassword(newPassword);
 return transaction(db,()=>{
  const {userId}=validLink(db,token,'reset'),now=Date.now();
  // 이메일 소유가 아직 확인되지 않은 계정(예: 네이버 가입)은 다른 사람이 같은 이메일로 먼저 만든 것일 수 있다.
  // 재설정 메일로 처음 소유가 증명되는 순간 기존 소셜 연결을 끊어, 미리 걸어 둔 연결로 로그인하지 못하게 한다.
  const unverified=(db.prepare('SELECT email_verified_at AS v FROM users WHERE id=?').get(userId) as {v:number|null}).v===null;
  if(unverified&&db.prepare('DELETE FROM oauth_accounts WHERE user_id=?').run(userId).changes>0)audit(db,userId,'account.oauth.purge_on_reset','user',userId);
  db.prepare('UPDATE users SET password_hash=?,email_verified_at=coalesce(email_verified_at,?),version=version+1,updated_at=? WHERE id=?').run(hash,now,now,userId);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);revokeUserGrants(db,userId,now);
  audit(db,userId,'password.reset','user',userId);return{changed:true};
 });
}
export function verifyEmail(db:Database,input:unknown){
 const {token}=tokenInput.parse(input);return transaction(db,()=>{
  const {userId}=validLink(db,token,'verify'),now=Date.now();
  db.prepare('UPDATE users SET email_verified_at=coalesce(email_verified_at,?),version=version+1,updated_at=? WHERE id=?').run(now,now,userId);
  db.prepare("DELETE FROM account_mail WHERE user_id=? AND purpose='verify'").run(userId);audit(db,userId,'email.verify','user',userId);return{verified:true};
 });
}
export function mailStatus(db:Database,userId:string,config:MailConfig|null){
 const user=userById(db,userId),latest=db.prepare("SELECT state,error_code AS errorCode,created_at AS createdAt,expires_at AS expiresAt FROM account_mail WHERE user_id=? AND purpose='verify' AND expires_at>? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(userId,Date.now());
 return{available:config!==null,verified:!!user.emailVerifiedAt,latest:latest?{...latest} as {state:string;errorCode:string;createdAt:number;expiresAt:number}:null};
}
