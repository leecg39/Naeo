import { randomUUID } from 'node:crypto';
import { transaction, type Database } from './database';
import { createSession, hashPassword, userById, verifyPassword, tokenHash, requireAdmin, type User } from './auth';
import { AppError } from './errors';
import { audit } from './audit';
import { changePasswordInput, deleteAccountInput, acceptTermsInput } from './validation';

export async function reauthenticate(db:Database,userId:string,password:string) {
  const row=db.prepare('SELECT password_hash,status FROM users WHERE id=?').get(userId) as {password_hash:string;status:string}|undefined;
  if(!row||row.status!=='active'||!await verifyPassword(password,row.password_hash)) throw new AppError(403,'REAUTHENTICATION_FAILED','현재 비밀번호가 일치하지 않습니다.');
  return row.password_hash;
}
// Recheck inside the write transaction after every asynchronous password operation.
export function assertReauthenticated(db:Database,userId:string,passwordHash:string,admin=false) {
  const current=db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId);
  if(!current||current.password_hash!==passwordHash) throw new AppError(401,'SESSION_CHANGED','계정이 변경되었습니다. 다시 로그인해주세요.');
  const user=userById(db,userId);
  if(user.status!=='active') throw new AppError(401,'UNAUTHENTICATED','다시 로그인해주세요.');
  return admin?requireAdmin(user):user;
}
export function protectLastAdmin(db:Database,user:User,nextRole?:string,nextStatus?:string) {
  if(user.role!=='admin'||user.status!=='active'||!user.termsAcceptedAt||(nextRole==='admin'&&nextStatus==='active')) return;
  const {count}=db.prepare("SELECT count(*) AS count FROM users WHERE role='admin' AND status='active' AND terms_accepted_at>0").get() as {count:number};
  if(count<=1) throw new AppError(409,'LAST_ADMIN','마지막 활성 관리자는 삭제·정지하거나 권한을 변경할 수 없습니다. 다른 관리자를 먼저 지정해주세요.');
}
export function eraseAccount(db:Database,userId:string,actorId:string|null) {
  // Account-owned records cascade. Operational audit remains without actor identity or personal payloads.
  audit(db,actorId,'account.delete','user',userId);
  db.prepare('DELETE FROM users WHERE id=?').run(userId);
}
export async function changePassword(db:Database,userId:string,input:unknown) {
  const valid=changePasswordInput.parse(input);
  const previous=await reauthenticate(db,userId,valid.currentPassword);
  const next=await hashPassword(valid.newPassword);
  return transaction(db,()=>{
    assertReauthenticated(db,userId,previous);
    db.prepare('UPDATE users SET password_hash=?,version=version+1,updated_at=? WHERE id=?').run(next,Date.now(),userId);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    audit(db,userId,'password.change','user',userId);
    return createSession(db,userId);
  });
}
export async function deleteAccount(db:Database,userId:string,input:unknown) {
  const valid=deleteAccountInput.parse(input),previous=await reauthenticate(db,userId,valid.currentPassword);
  return transaction(db,()=>{
    const user=assertReauthenticated(db,userId,previous);
    if(user.version!==valid.version) throw new AppError(409,'VERSION_CONFLICT','계정이 변경되었습니다. 최신 정보를 다시 불러와주세요.');
    if(user.email!==valid.confirmEmail) throw new AppError(400,'EMAIL_MISMATCH','탈퇴할 계정의 이메일을 정확히 입력해주세요.');
    protectLastAdmin(db,user);eraseAccount(db,userId,userId);return {deleted:true};
  });
}
export type SessionInfo={id:string;createdAt:number;expiresAt:number;current:boolean};
export function listSessions(db:Database,userId:string,currentToken:string):SessionInfo[] {
  const rows=db.prepare('SELECT public_id AS id,created_at AS createdAt,expires_at AS expiresAt,(token_hash=?) AS current FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC,public_id').all(tokenHash(currentToken),userId,Date.now()) as (Omit<SessionInfo,'current'>&{current:number})[];
  return rows.map(row=>({...row,current:Boolean(row.current)}));
}
export function revokeSession(db:Database,userId:string,id:string,currentToken:string) {
  return transaction(db,()=>{
    const row=db.prepare('SELECT token_hash FROM sessions WHERE user_id=? AND public_id=?').get(userId,id) as {token_hash:string}|undefined;
    if(!row) throw new AppError(404,'NOT_FOUND','로그인 세션을 찾을 수 없습니다.');
    db.prepare('DELETE FROM sessions WHERE user_id=? AND public_id=?').run(userId,id);
    audit(db,userId,'session.revoke','session',id);
    return {revoked:true,current:row.token_hash===tokenHash(currentToken)};
  });
}
export function revokeOtherSessions(db:Database,userId:string,currentToken:string) {
  return transaction(db,()=>{
    const result=db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(userId,tokenHash(currentToken));
    audit(db,userId,'session.revoke_others','user',userId,{count:Number(result.changes)});
    return {revoked:Number(result.changes)};
  });
}
export function acceptTerms(db:Database,userId:string,input:unknown) {
  acceptTermsInput.parse(input);
  return transaction(db,()=>{
    const current=userById(db,userId);
    if(!current.termsAcceptedAt) {
      const now=Date.now();
      db.prepare('UPDATE users SET terms_accepted_at=?,version=version+1,updated_at=? WHERE id=?').run(now,now,userId);
      db.prepare("INSERT INTO consent_history VALUES(?,?,'terms',1,?)").run(randomUUID(),userId,now);
      audit(db,userId,'terms.accept','user',userId);
    }
    return userById(db,userId);
  });
}
