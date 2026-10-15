import {randomBytes,randomUUID} from 'node:crypto';
import {closeSync,constants,createReadStream,fstatSync,lstatSync,mkdirSync,openSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {requireUser,tokenHash} from '../auth';
import {reauthenticate,assertReauthenticated} from '../account-security';
import {audit} from '../audit';
import {AppError} from '../errors';
import {ARCHIVE_KEY,archiveDirectory,buildPersonalArchive,checkedDirectory} from './archive';
export const EXPORT_TTL=60*60_000,LEASE_TTL=10*60_000;
export const exportInput=z.object({currentPassword:z.string().min(1).max(128).optional()}).strict();
export type PersonalExport={id:string;state:'queued'|'running'|'succeeded'|'failed';createdAt:number;completedAt:number|null;expiresAt:number;fileSize:number|null;error:string};
const view='id,state,created_at AS createdAt,completed_at AS completedAt,expires_at AS expiresAt,file_size AS fileSize,error';
function session(db:Database,owner:string,token:string,now=Date.now()){
 if(requireUser(db,token).id!==owner)throw new AppError(401,'UNAUTHENTICATED','다시 로그인해주세요.');
 const s=db.prepare('SELECT created_at AS createdAt,expires_at AS expiresAt FROM sessions WHERE user_id=? AND token_hash=? AND expires_at>?').get(owner,tokenHash(token),now) as {createdAt:number;expiresAt:number}|undefined;
 if(!s)throw new AppError(401,'UNAUTHENTICATED','다시 로그인해주세요.');return s;
}
export async function requestPersonalExport(db:Database,owner:string,token:string,input:unknown){
 const v=exportInput.parse(input);session(db,owner,token);
 const hash=db.prepare('SELECT password_hash AS h FROM users WHERE id=?').get(owner)!.h as string;
 const checked=hash.startsWith('scrypt$')?await reauthenticate(db,owner,v.currentPassword??''):hash;
 return transaction(db,()=>{
  const now=Date.now(),s=session(db,owner,token,now);assertReauthenticated(db,owner,checked);
  if(!hash.startsWith('scrypt$')&&now-s.createdAt>10*60_000)throw new AppError(403,'REAUTH_REQUIRED','소셜 계정으로 다시 로그인한 뒤 10분 안에 요청해주세요.');
  db.prepare('DELETE FROM personal_exports WHERE owner_id=? AND expires_at<=?').run(owner,now);
  if(db.prepare("SELECT 1 FROM personal_exports WHERE owner_id=? AND state IN ('queued','running')").get(owner))throw new AppError(409,'EXPORT_EXISTS','이미 자료를 준비 중입니다. 완료를 기다리거나 기존 요청을 취소해주세요.');
  const id=randomUUID();db.prepare('INSERT INTO personal_exports(id,owner_id,session_hash,created_at,expires_at) VALUES(?,?,?,?,?)').run(id,owner,tokenHash(token),now,Math.min(now+EXPORT_TTL,s.expiresAt));
  audit(db,owner,'personal_export.request','personal_export',id);
  return {...db.prepare(`SELECT ${view} FROM personal_exports WHERE id=?`).get(id)} as PersonalExport;
 });
}
export function listPersonalExports(db:Database,owner:string,token:string):PersonalExport[]{
 session(db,owner,token);return db.prepare(`SELECT ${view} FROM personal_exports WHERE owner_id=? AND session_hash=? AND expires_at>? ORDER BY created_at DESC`).all(owner,tokenHash(token),Date.now()).map(r=>({...r})) as PersonalExport[];
}
function ownJob(db:Database,owner:string,token:string,id:string,now=Date.now()){
 session(db,owner,token,now);
 const j=db.prepare(`SELECT ${view},file_key AS fileKey FROM personal_exports WHERE id=? AND owner_id=? AND session_hash=?`).get(id,owner,tokenHash(token)) as PersonalExport&{fileKey:string|null}|undefined;
 if(!j)throw new AppError(404,'NOT_FOUND','내보내기 요청을 찾을 수 없습니다.');return j;
}
export function deletePersonalExport(db:Database,owner:string,token:string,id:string){
 return transaction(db,()=>{ownJob(db,owner,token,id);db.prepare('DELETE FROM personal_exports WHERE id=?').run(id);audit(db,owner,'personal_export.delete','personal_export',id);return{deleted:true};});
}
export function downloadPersonalExport(db:Database,dir:string,owner:string,token:string,id:string,now=Date.now()){
 const j=ownJob(db,owner,token,id,now);
 if(j.expiresAt<=now)throw new AppError(410,'EXPORT_EXPIRED','내려받기 시간이 지났습니다. 다시 요청해주세요.');
 if(j.state!=='succeeded')throw new AppError(409,'EXPORT_NOT_READY','아직 내려받을 수 없습니다. 준비 상태를 확인해주세요.');
 let fd:number;
 try{
  if(!j.fileKey||!ARCHIVE_KEY.test(j.fileKey))throw new Error('INVALID_STORAGE_KEY');
  fd=openSync(join(archiveDirectory(dir),j.fileKey),constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=fstatSync(fd);if(!stat.isFile()||stat.size!==j.fileSize){closeSync(fd);throw new Error('FILE_CHANGED');}
 }catch{throw new AppError(410,'EXPORT_UNAVAILABLE','보관 파일을 읽을 수 없습니다. 기존 요청을 지우고 다시 요청해주세요.');}
 const stream=createReadStream('',{fd,autoClose:true});
 return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{headers:{'Content-Type':'application/x-tar','Content-Length':String(j.fileSize),'Content-Disposition':`attachment; filename="naeo-personal-data-${j.id}.tar"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
function claim(db:Database,now:number){
 return transaction(db,()=>{
  db.prepare("UPDATE personal_exports SET state='failed',error='작업이 반복 중단되었습니다. 다시 요청해주세요.' WHERE state='running' AND lease_until<=? AND attempt>=3").run(now);
  const j=db.prepare(`SELECT e.id,e.owner_id AS ownerId FROM personal_exports e JOIN users u ON u.id=e.owner_id JOIN sessions s ON s.token_hash=e.session_hash AND s.user_id=e.owner_id
   WHERE e.expires_at>? AND u.status='active' AND s.expires_at>? AND (e.state='queued' OR (e.state='running' AND e.lease_until<=? AND e.attempt<3)) ORDER BY e.created_at LIMIT 1`).get(now,now,now) as {id:string;ownerId:string}|undefined;
  if(!j)return null;const lease=randomBytes(32).toString('hex'),key=`${lease}.tar`;
  db.prepare("UPDATE personal_exports SET state='running',attempt=attempt+1,lease_token=?,lease_until=?,file_key=? WHERE id=?").run(lease,now+LEASE_TTL,key,j.id);
  return {...j,lease,key};
 });
}
/** Separate worker process; IO uses fixed 128KiB chunks, DB iterators have no UI pagination caps. */
export function runPersonalExportOnce(db:Database,dir:string){
 const job=claim(db,Date.now());if(!job)return false;
 try{
  mkdirSync(dir,{recursive:true,mode:0o700});checkedDirectory(dir);mkdirSync(join(dir,'personal-exports'),{recursive:true,mode:0o700});archiveDirectory(dir);
  let size:number;db.exec('BEGIN');
  try{size=buildPersonalArchive(db,dir,job.ownerId,job.key,Date.now());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  const now=Date.now();
  const published=transaction(db,()=>db.prepare(`UPDATE personal_exports SET state='succeeded',file_size=?,completed_at=?,lease_until=NULL
   WHERE id=? AND lease_token=? AND state='running' AND expires_at>? AND lease_until>?
    AND EXISTS(SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=personal_exports.owner_id AND u.status='active' AND s.token_hash=personal_exports.session_hash AND s.expires_at>?)`).run(size,now,job.id,job.lease,now,now,now).changes);
  if(!published)throw new Error('EXPORT_INVALIDATED');
 }catch{
  transaction(db,()=>{
   db.prepare("UPDATE personal_exports SET state='failed',file_key=NULL,lease_until=NULL,error=? WHERE id=? AND lease_token=? AND state='running'").run('자료를 만들지 못했습니다. 파일이 변경·누락되었거나 인증·처리 시간이 만료됐을 수 있습니다. 다시 요청해주세요.',job.id,job.lease);
   db.prepare('INSERT INTO personal_export_deletions(file_key) VALUES(?) ON CONFLICT DO NOTHING').run(job.key);
  });
  cleanupPersonalExports(db,dir);
 }
 return true;
}
const ioCode=(error:unknown)=>/^[A-Z0-9_]{1,40}$/.test(String((error as NodeJS.ErrnoException)?.code))?String((error as NodeJS.ErrnoException).code):'IO_ERROR';
export function cleanupPersonalExports(db:Database,dir:string,now=Date.now()){
 db.prepare('DELETE FROM personal_exports WHERE expires_at<=?').run(now);
 let root:string,files:string[];
 try{root=archiveDirectory(dir);files=readdirSync(root);}
 catch(e){const code=ioCode(e);return{removed:0,failed:0,scanError:code==='ENOENT'?null:code};}
 for(const name of files){
  if(!ARCHIVE_KEY.test(name))continue;
  try{const stat=lstatSync(join(root,name));if(!stat.isFile()||now-stat.mtimeMs<EXPORT_TTL)continue;}catch{continue;}
  db.prepare('INSERT INTO personal_export_deletions(file_key) SELECT ? WHERE NOT EXISTS(SELECT 1 FROM personal_exports WHERE file_key=?) ON CONFLICT DO NOTHING').run(name,name);
 }
 let removed=0,failed=0;
 const pending=db.prepare('SELECT file_key AS key FROM personal_export_deletions ORDER BY coalesce(last_attempt_at,0),queued_at LIMIT 100').all() as {key:string}[];
 for(const {key} of pending)transaction(db,()=>{
  let error=!ARCHIVE_KEY.test(key)?'INVALID_STORAGE_KEY':db.prepare('SELECT 1 FROM personal_exports WHERE file_key=?').get(key)?'STILL_REFERENCED':'';
  if(!error)try{unlinkSync(join(root,key));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')error=ioCode(e);}
  if(error){failed++;db.prepare('UPDATE personal_export_deletions SET last_attempt_at=?,attempts=attempts+1,last_error_code=? WHERE file_key=?').run(now,error,key);return;}
  db.prepare('DELETE FROM personal_export_deletions WHERE file_key=?').run(key);removed++;
 });
 return{removed,failed,scanError:null};
}
