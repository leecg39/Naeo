import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import type { Database } from './database';
import { transaction } from './database';
import { AppError } from './errors';
import { audit } from './audit';
import { registerInput, loginInput } from './validation';

export const SESSION_COOKIE = 'naeo_session';
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
export type User = {id:string;email:string;role:'admin'|'member';status:'active'|'suspended';createdAt:number};
type Credentials = User & {password_hash:string};
const userColumns = 'id,email,role,status,created_at AS createdAt';
const derive = (password:string,salt:string) => new Promise<Buffer>((resolve,reject)=>{
  scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key));
});
export async function hashPassword(password:string) {
  const salt=randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password,salt)).toString('hex')}`;
}
export async function verifyPassword(password:string,encoded:string) {
  const [algorithm,salt,hash]=encoded.split('$');
  if(algorithm!=='scrypt'||!salt||!hash||!/^[a-f0-9]{128}$/.test(hash)) return false;
  const expected=Buffer.from(hash,'hex');
  return timingSafeEqual(await derive(password,salt),expected);
}
export const tokenHash = (value:string) => createHash('sha256').update(value).digest('hex');
export function userById(db:Database,id:string):User {
  const user=db.prepare(`SELECT ${userColumns} FROM users WHERE id=?`).get(id) as User|undefined;
  if(!user) throw new AppError(404,'NOT_FOUND','계정을 찾을 수 없습니다.');
  return user;
}
export function createSession(db:Database,userId:string) {
  const token=randomBytes(32).toString('base64url');
  const now=Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(tokenHash(token),userId,now,now+SESSION_TTL);
  return {token,expiresAt:now+SESSION_TTL};
}
export async function register(db:Database,input:z.infer<typeof registerInput>) {
  const valid=registerInput.parse(input);
  const passwordHash=await hashPassword(valid.password);
  return transaction(db,()=>{
    if(db.prepare('SELECT id FROM users WHERE email=?').get(valid.email)) throw new AppError(409,'EMAIL_EXISTS','이미 가입한 이메일입니다.');
    const id=randomUUID(),now=Date.now();
    db.prepare('INSERT INTO users(id,email,password_hash,terms_accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,valid.email,passwordHash,now,now,now);
    db.prepare('INSERT INTO profiles(user_id,nickname,updated_at) VALUES(?,?,?)').run(id,valid.nickname,now);
    const session=createSession(db,id);
    audit(db,id,'account.register','user',id);
    return {user:userById(db,id),session};
  });
}
// Same work factor for unknown emails, without revealing whether an account exists.
const dummyHash='scrypt$00000000000000000000000000000000$'+'0'.repeat(128);
export async function login(db:Database,input:z.infer<typeof loginInput>) {
  const valid=loginInput.parse(input);
  const user=db.prepare(`SELECT ${userColumns},password_hash FROM users WHERE email=?`).get(valid.email) as Credentials|undefined;
  const matches=await verifyPassword(valid.password,user?.password_hash || dummyHash);
  if(!user||!matches||user.status!=='active') throw new AppError(401,'INVALID_CREDENTIALS','이메일 또는 비밀번호를 확인해주세요.');
  return transaction(db,()=>{
    const current=userById(db,user.id);
    if(current.status!=='active') throw new AppError(401,'INVALID_CREDENTIALS','이메일 또는 비밀번호를 확인해주세요.');
    const session=createSession(db,user.id);
    audit(db,user.id,'account.login','user',user.id);
    return {user:current,session};
  });
}
export function sessionUser(db:Database,token:string|undefined):User|null {
  if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session=db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(tokenHash(token),Date.now()) as {user_id:string}|undefined;
  if(!session) return null;
  const user=userById(db,session.user_id);
  return user.status==='active'?user:null;
}
export function logout(db:Database,token:string|undefined) {
  if(token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
}
export function requireUser(db:Database,token:string|undefined):User {
  const user=sessionUser(db,token);
  if(!user) throw new AppError(401,'UNAUTHENTICATED','로그인이 필요합니다.');
  return user;
}
export function requireAdmin(user:User) {
  if(user.role!=='admin') throw new AppError(403,'FORBIDDEN','관리자 권한이 필요합니다.');
  return user;
}
