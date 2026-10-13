import {randomUUID} from 'node:crypto';
import {transaction,type Database} from './database';
import {hashPassword,userById,requireAdmin,type User} from './auth';
import {getProfile} from './profiles';
import {audit} from './audit';
import {AppError} from './errors';
import {createUserInput,updateUserInput,deleteUserInput,userQueryInput,paginationInput} from './validation';
import {reauthenticate,assertReauthenticated,protectLastAdmin,eraseAccount} from './account-security';
import {revokeUserGrants} from './oauth/grants';

export type ManagedUser=User&{nickname:string;blogCount:number;sessionCount:number};
function authorize(db:Database,actorId:string){return requireAdmin(userById(db,actorId));}
export function managedUser(db:Database,actorId:string,id:string):ManagedUser {
  authorize(db,actorId);
  const user=userById(db,id),profile=getProfile(db,id);
  const {blogCount}=db.prepare('SELECT count(*) AS blogCount FROM blogs WHERE owner_id=?').get(id) as {blogCount:number};
  const {sessionCount}=db.prepare('SELECT count(*) AS sessionCount FROM sessions WHERE user_id=? AND expires_at>?').get(id,Date.now()) as {sessionCount:number};
  return {...user,nickname:profile.nickname,blogCount,sessionCount};
}
export function listUsers(db:Database,actorId:string,query:unknown) {
  authorize(db,actorId);
  const {page,pageSize,q,role,status}=userQueryInput.parse(query);
  const escaped=`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`,params:(string|number)[]=[escaped,escaped];
  let where="(u.email LIKE ? ESCAPE '\\' OR p.nickname LIKE ? ESCAPE '\\')";
  if(role){where+=' AND u.role=?';params.push(role);}if(status){where+=' AND u.status=?';params.push(status);}
  const {total}=db.prepare(`SELECT count(*) AS total FROM users u JOIN profiles p ON p.user_id=u.id WHERE ${where}`).get(...params) as {total:number};
  const rows=db.prepare(`SELECT u.id FROM users u JOIN profiles p ON p.user_id=u.id WHERE ${where} ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as {id:string}[];
  return {data:rows.map(row=>managedUser(db,actorId,row.id)),pagination:{page,pageSize,total}};
}
export async function createUser(db:Database,actorId:string,input:unknown) {
  authorize(db,actorId);const valid=createUserInput.parse(input);
  const proof=await reauthenticate(db,actorId,valid.currentPassword),passwordHash=await hashPassword(valid.password);
  return transaction(db,()=>{
    assertReauthenticated(db,actorId,proof,true);
    if(db.prepare('SELECT id FROM users WHERE email=?').get(valid.email))throw new AppError(409,'EMAIL_EXISTS','이미 가입한 이메일입니다.');
    const id=randomUUID(),now=Date.now();
    db.prepare('INSERT INTO users(id,email,password_hash,role,terms_accepted_at,created_at,updated_at) VALUES(?,?,?,?,0,?,?)').run(id,valid.email,passwordHash,valid.role,now,now);
    db.prepare('INSERT INTO profiles(user_id,nickname,updated_at) VALUES(?,?,?)').run(id,valid.nickname,now);
    db.prepare('INSERT INTO notification_preferences(user_id,updated_at) VALUES(?,?)').run(id,now);
    audit(db,actorId,'admin.user.create','user',id,{role:valid.role});
    return managedUser(db,actorId,id);
  });
}
export async function updateUser(db:Database,actorId:string,id:string,input:unknown) {
  authorize(db,actorId);const valid=updateUserInput.parse(input),proof=await reauthenticate(db,actorId,valid.currentPassword);
  return transaction(db,()=>{
    assertReauthenticated(db,actorId,proof,true);const current=userById(db,id);
    if(valid.version!==current.version)throw new AppError(409,'VERSION_CONFLICT','계정 정보가 변경되었습니다. 다시 불러와주세요.');
    const role=valid.role??current.role,status=valid.status??current.status;
    protectLastAdmin(db,current,role,status);
    db.prepare('UPDATE users SET role=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(role,status,Date.now(),id,valid.version);
    if(valid.nickname!==undefined)db.prepare('UPDATE profiles SET nickname=?,version=version+1,updated_at=? WHERE user_id=?').run(valid.nickname,Date.now(),id);
    if(role!==current.role||status!==current.status){db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);revokeUserGrants(db,id);}
    audit(db,actorId,'admin.user.update','user',id,{fields:Object.keys(valid).filter(k=>!['currentPassword','version'].includes(k)),role,status});
    return {...userById(db,id),nickname:getProfile(db,id).nickname};
  });
}
export async function removeUser(db:Database,actorId:string,id:string,input:unknown) {
  authorize(db,actorId);const valid=deleteUserInput.parse(input),proof=await reauthenticate(db,actorId,valid.currentPassword);
  return transaction(db,()=>{
    assertReauthenticated(db,actorId,proof,true);const current=userById(db,id);
    if(current.version!==valid.version)throw new AppError(409,'VERSION_CONFLICT','계정 정보가 변경되었습니다. 다시 불러와주세요.');
    if(current.email!==valid.confirmEmail)throw new AppError(400,'EMAIL_MISMATCH','삭제할 계정의 이메일을 정확히 입력해주세요.');
    protectLastAdmin(db,current);eraseAccount(db,id,actorId);return {deleted:true};
  });
}
export function listAudit(db:Database,actorId:string,query:unknown) {
  authorize(db,actorId);const {page,pageSize,q}=paginationInput.parse(query),pattern=`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;
  const {total}=db.prepare("SELECT count(*) AS total FROM audit_logs WHERE action LIKE ? ESCAPE '\\'").get(pattern) as {total:number};
  const data=db.prepare("SELECT id,actor_id AS actorId,action,entity_type AS entityType,entity_id AS entityId,metadata,created_at AS createdAt FROM audit_logs WHERE action LIKE ? ESCAPE '\\' ORDER BY created_at DESC,id LIMIT ? OFFSET ?").all(pattern,pageSize,(page-1)*pageSize);
  return {data:data.map(row=>({...row})),pagination:{page,pageSize,total}};
}
