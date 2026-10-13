import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,readdirSync,readFileSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {audit} from '../audit';
import {AppError} from '../errors';
import {getProject} from './projects';
import {parsePng} from './png';
import {buildPdf} from './pdf';
import {buildZip} from './zip';

export const COLLECT_TTL=30*60_000,KEEP_TTL=7*86_400_000,MAX_PAGE_BYTES=12*1024*1024;
export type ExportJob={id:string;projectId:string;format:'pdf'|'zip';state:'collecting'|'succeeded'|'failed';slideCount:number;received:number;error:string;fileSize:number|null;expiresAt:number;createdAt:number};
const SELECT=`SELECT j.id,j.project_id AS projectId,j.format,j.state,j.slide_count AS slideCount,(SELECT count(*) FROM export_pages p WHERE p.job_id=j.id) AS received,j.error,j.file_size AS fileSize,j.expires_at AS expiresAt,j.created_at AS createdAt FROM export_jobs j`;
const KEY=/^[a-f0-9]{32}\.(png|pdf|zip)$/;
/** 저장 경로는 무작위 키만 쓰고 형식을 확인해 경로 조작을 막는다. */
const pathOf=(dir:string,key:string)=>{if(!KEY.test(key))throw new Error('bad export key');return join(dir,'exports',key);};
const remove=(dir:string,key:string|null)=>{if(!key)return;try{unlinkSync(pathOf(dir,key));}catch{/* 이미 없음 */}};
function save(dir:string,ext:'png'|'pdf'|'zip',bytes:Buffer):string{
 mkdirSync(join(dir,'exports'),{recursive:true,mode:0o700});
 const key=`${randomBytes(16).toString('hex')}.${ext}`;
 writeFileSync(pathOf(dir,key),bytes,{flag:'wx',mode:0o600});
 return key;
}
function ownJob(db:Database,ownerId:string,id:string){
 const j=db.prepare('SELECT id,project_id AS projectId,owner_id AS ownerId,format,state,slide_count AS slideCount,width,height,file_key AS fileKey,expires_at AS expiresAt FROM export_jobs WHERE id=?').get(id) as {id:string;projectId:string;ownerId:string;format:'pdf'|'zip';state:string;slideCount:number;width:number;height:number;fileKey:string|null;expiresAt:number}|undefined;
 if(!j||j.ownerId!==ownerId)throw new AppError(404,'NOT_FOUND','내보내기 작업을 찾을 수 없습니다.');
 return j;
}
const jobView=(db:Database,id:string):ExportJob=>({...(db.prepare(`${SELECT} WHERE j.id=?`).get(id) as ExportJob)});
const pageKeys=(db:Database,id:string)=>(db.prepare('SELECT storage_key AS k FROM export_pages WHERE job_id=? ORDER BY position').all(id) as {k:string}[]).map(r=>r.k);
/** 실패 기록: 이유를 남기고 받은 페이지 파일은 바로 지운다. */
function fail(db:Database,dir:string,id:string,reason:string,now:number){
 for(const k of pageKeys(db,id))remove(dir,k);
 db.prepare("DELETE FROM export_pages WHERE job_id=?").run(id);
 db.prepare("UPDATE export_jobs SET state='failed',error=?,expires_at=?,updated_at=? WHERE id=?").run(reason.slice(0,300),now+86_400_000,now,id);
}

const startInput=z.object({format:z.enum(['pdf','zip'])}).strict();
/** 내보내기 시작: 지금의 슬라이드 수·크기를 고정한다. 30분 안에 모든 장을 올려야 한다. */
export function startExport(db:Database,ownerId:string,projectId:string,input:unknown,now=Date.now()):ExportJob{
 const {format}=startInput.parse(input);
 return transaction(db,()=>{
  const p=getProject(db,ownerId,projectId);
  const id=randomUUID();
  db.prepare('INSERT INTO export_jobs(id,project_id,owner_id,format,slide_count,width,height,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,p.id,ownerId,format,p.slides.length,p.width,p.height,now+COLLECT_TTL,now,now);
  audit(db,ownerId,'creative.export.start','export_job',id,{format,slides:p.slides.length});
  return jobView(db,id);
 });
}
/** 페이지 한 장(브라우저가 그린 PNG): 서명·CRC·크기를 검증하고, 실패하면 작업을 실패로 남긴다. 같은 자리는 다시 올리면 바뀐다. */
export function addPage(db:Database,dir:string,ownerId:string,jobId:string,position:number,bytes:Buffer,now=Date.now()){
 const j=ownJob(db,ownerId,jobId);
 if(j.state!=='collecting')throw new AppError(409,'EXPORT_CLOSED','이미 끝난 내보내기입니다.');
 if(now>=j.expiresAt){transaction(db,()=>fail(db,dir,j.id,'시간이 지나 내보내기를 취소했습니다.',now));throw new AppError(409,'EXPORT_EXPIRED','내보내기 시간이 지났습니다. 다시 시작해주세요.');}
 if(!Number.isInteger(position)||position<0||position>=j.slideCount)throw new AppError(400,'BAD_POSITION','슬라이드 번호가 올바르지 않습니다.');
 if(bytes.length>MAX_PAGE_BYTES)throw new AppError(413,'PAGE_TOO_LARGE','페이지 이미지가 너무 큽니다.');
 try{
  const img=parsePng(bytes);
  if(img.width!==j.width||img.height!==j.height)throw new AppError(400,'SIZE_MISMATCH',`이미지 크기가 ${j.width}×${j.height}이어야 합니다(받은 크기 ${img.width}×${img.height}).`);
 }catch(e){if(e instanceof AppError)transaction(db,()=>fail(db,dir,j.id,e.message,now));throw e;}
 const key=save(dir,'png',bytes);
 return transaction(db,()=>{
  const old=db.prepare('SELECT storage_key AS k FROM export_pages WHERE job_id=? AND position=?').get(j.id,position) as {k:string}|undefined;
  db.prepare('INSERT INTO export_pages(job_id,position,storage_key,size) VALUES(?,?,?,?) ON CONFLICT(job_id,position) DO UPDATE SET storage_key=excluded.storage_key,size=excluded.size').run(j.id,position,key,bytes.length);
  db.prepare('UPDATE export_jobs SET updated_at=? WHERE id=?').run(now,j.id);
  if(old)remove(dir,old.k);
  return jobView(db,j.id);
 });
}
/** 모든 장이 모이면 PDF(장마다 한 페이지) 또는 ZIP(slide-01.png…)을 만들고 7일 보관한다. */
export function completeExport(db:Database,dir:string,ownerId:string,jobId:string,now=Date.now()):ExportJob{
 const j=ownJob(db,ownerId,jobId);
 if(j.state!=='collecting')throw new AppError(409,'EXPORT_CLOSED','이미 끝난 내보내기입니다.');
 const keys=pageKeys(db,j.id);
 if(keys.length<j.slideCount)throw new AppError(409,'PAGES_MISSING',`${j.slideCount}장 중 ${keys.length}장만 받았습니다.`);
 const title=(db.prepare('SELECT title FROM creative_projects WHERE id=?').get(j.projectId) as {title:string}).title;
 const pages=keys.map(k=>readFileSync(pathOf(dir,k)));
 const file=j.format==='pdf'?buildPdf(pages.map(parsePng),title):buildZip(pages.map((data,i)=>({name:`slide-${String(i+1).padStart(2,'0')}.png`,data})),now);
 const key=save(dir,j.format,file);
 return transaction(db,()=>{
  db.prepare("UPDATE export_jobs SET state='succeeded',file_key=?,file_size=?,expires_at=?,updated_at=? WHERE id=?").run(key,file.length,now+KEEP_TTL,now,j.id);
  for(const k of keys)remove(dir,k);
  db.prepare('DELETE FROM export_pages WHERE job_id=?').run(j.id);
  audit(db,ownerId,'creative.export.complete','export_job',j.id,{format:j.format,bytes:file.length});
  return jobView(db,j.id);
 });
}
export function readExportFile(db:Database,dir:string,ownerId:string,jobId:string,now=Date.now()){
 const j=ownJob(db,ownerId,jobId);
 if(j.state!=='succeeded'||!j.fileKey)throw new AppError(404,'NOT_FOUND','완성된 파일이 없습니다.');
 if(now>=j.expiresAt)throw new AppError(410,'EXPORT_EXPIRED','보관 기간(7일)이 지났습니다. 다시 내보내주세요.');
 const title=(db.prepare('SELECT title FROM creative_projects WHERE id=?').get(j.projectId) as {title:string}).title.replace(/[\\/:*?"<>|\r\n]/g,'_');
 return{bytes:readFileSync(pathOf(dir,j.fileKey)),mime:j.format==='pdf'?'application/pdf':'application/zip',filename:`${title}.${j.format}`};
}
export const listExports=(db:Database,ownerId:string,projectId:string):ExportJob[]=>(db.prepare(`${SELECT} WHERE j.owner_id=? AND j.project_id=? ORDER BY j.created_at DESC LIMIT 10`).all(ownerId,projectId) as ExportJob[]).map(j=>({...j}));
/**
 * 어떤 작업도 가리키지 않는 파일 정리: 프로젝트 삭제·회원 탈퇴로 작업 행이 연쇄 삭제되면 파일만 남는다.
 * 올리는 중인 파일을 지우지 않도록 수집 시간의 두 배보다 오래된 것만 지운다.
 */
function sweepOrphans(db:Database,dir:string,now:number):number{
 let names:string[];
 try{names=readdirSync(join(dir,'exports'));}catch{return 0;}
 const used=new Set([...(db.prepare('SELECT file_key AS k FROM export_jobs WHERE file_key IS NOT NULL').all() as {k:string}[]),...(db.prepare('SELECT storage_key AS k FROM export_pages').all() as {k:string}[])].map(r=>r.k));
 let removed=0;
 for(const name of names){
  if(!KEY.test(name)||used.has(name))continue;
  if(now-statSync(pathOf(dir,name)).mtimeMs<=2*COLLECT_TTL)continue;
  remove(dir,name);removed++;
 }
 return removed;
}
/** 보관 기간이 지난 작업과 파일, 주인 없는 파일 정리(작업자가 주기 실행). 지운 작업·파일 수를 돌려준다. */
export function cleanupExports(db:Database,dir:string,now=Date.now()):number{
 const due=db.prepare('SELECT id,file_key AS fileKey FROM export_jobs WHERE expires_at<=? LIMIT 200').all(now) as {id:string;fileKey:string|null}[];
 for(const j of due){for(const k of pageKeys(db,j.id))remove(dir,k);remove(dir,j.fileKey);db.prepare('DELETE FROM export_jobs WHERE id=?').run(j.id);}
 return due.length+sweepOrphans(db,dir,now);
}
