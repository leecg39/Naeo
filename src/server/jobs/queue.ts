import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';
import {paginationInput} from '../validation';
import {JOB_SELECT,toJob,type JobRow,type ScanJob} from './records';

export {LEASE_MS,backoffMs} from './timing';
const enqueueInput=z.object({blogId:z.uuid(),idempotencyKey:z.string().trim().min(1).max(100).optional()}).strict();
const retryInput=z.object({idempotencyKey:z.string().trim().min(1).max(100).optional()}).strict();
const listInput=paginationInput.extend({blogId:z.uuid().optional(),state:z.enum(['queued','running','succeeded','failed','canceled']).optional()});

const rowById=(db:Database,id:string)=>db.prepare(`${JOB_SELECT} WHERE id=?`).get(id) as JobRow|undefined;
function ownedRow(db:Database,ownerId:string,id:string):JobRow{
 const r=db.prepare(`${JOB_SELECT} WHERE id=? AND owner_id=?`).get(id,ownerId) as JobRow|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','진단 작업을 찾을 수 없습니다.');
 return r;
}
function assertOwnBlog(db:Database,ownerId:string,blogId:string){
 if(!db.prepare('SELECT 1 FROM blogs WHERE id=? AND owner_id=?').get(blogId,ownerId))throw new AppError(404,'BLOG_NOT_FOUND','블로그를 찾을 수 없습니다.');
}
function assertNoActive(db:Database,blogId:string){
 if(db.prepare("SELECT 1 FROM scan_jobs WHERE blog_id=? AND state IN ('queued','running')").get(blogId))throw new AppError(409,'SCAN_IN_PROGRESS','이 블로그는 이미 진단 중입니다. 끝난 뒤 다시 시도해주세요.');
}
function insertJob(db:Database,ownerId:string,blogId:string,key:string|null,retryOf:string|null,now:number):ScanJob{
 const id=randomUUID();
 db.prepare('INSERT INTO scan_jobs(id,owner_id,blog_id,state,run_after,idempotency_key,retry_of,created_at,updated_at) VALUES(?,?,?,\'queued\',?,?,?,?,?)').run(id,ownerId,blogId,now,key,retryOf,now,now);
 return toJob(rowById(db,id)!);
}

export function enqueueScan(db:Database,ownerId:string,input:unknown,now=Date.now()):ScanJob{
 const v=enqueueInput.parse(input);
 return transaction(db,()=>{
  assertOwnBlog(db,ownerId,v.blogId);
  if(v.idempotencyKey){
   const same=db.prepare(`${JOB_SELECT} WHERE owner_id=? AND idempotency_key=?`).get(ownerId,v.idempotencyKey) as JobRow|undefined;
   if(same)return toJob(same);
  }
  assertNoActive(db,v.blogId);
  return insertJob(db,ownerId,v.blogId,v.idempotencyKey??null,null,now);
 });
}

export const getScan=(db:Database,ownerId:string,id:string)=>toJob(ownedRow(db,ownerId,id));
export function listScans(db:Database,ownerId:string,query:unknown){
 const {page,pageSize,blogId,state}=listInput.parse(query);
 const where=['owner_id=?'],params:(string|number)[]=[ownerId];
 if(blogId){where.push('blog_id=?');params.push(blogId);}
 if(state){where.push('state=?');params.push(state);}
 const sql=`WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total FROM scan_jobs ${sql}`).get(...params) as {total:number};
 const rows=db.prepare(`${JOB_SELECT} ${sql} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as JobRow[];
 return{data:rows.map(toJob),pagination:{page,pageSize,total}};
}

/** 대기 작업은 바로 취소, 실행 중 작업은 취소 요청만 남기고 작업자가 다음 보고 때 멈춘다. */
export function cancelJob(db:Database,r:JobRow,now=Date.now()):ScanJob{
 if(r.state==='queued')db.prepare("UPDATE scan_jobs SET state='canceled',completed_at=?,updated_at=? WHERE id=? AND state='queued'").run(now,now,r.id);
 else if(r.state==='running')db.prepare("UPDATE scan_jobs SET cancel_requested=1,updated_at=? WHERE id=? AND state='running'").run(now,r.id);
 else throw new AppError(409,'SCAN_FINISHED','이미 끝난 작업입니다.');
 return toJob(rowById(db,r.id)!);
}
export const cancelScan=(db:Database,ownerId:string,id:string,now=Date.now())=>transaction(db,()=>cancelJob(db,ownedRow(db,ownerId,id),now));

/** 실패·취소된 작업만 새 작업으로 다시 시작한다(원래 작업은 기록으로 남는다). */
export function retryJob(db:Database,r:JobRow,key:string|null,now=Date.now()):ScanJob{
 if(r.state!=='failed'&&r.state!=='canceled')throw new AppError(409,'SCAN_NOT_RETRYABLE','실패하거나 취소된 작업만 다시 시도할 수 있습니다.');
 assertNoActive(db,r.blog_id);
 return insertJob(db,r.owner_id,r.blog_id,key,r.id,now);
}
export function retryScan(db:Database,ownerId:string,id:string,input:unknown,now=Date.now()):ScanJob{
 const {idempotencyKey}=retryInput.parse(input);
 return transaction(db,()=>retryJob(db,ownedRow(db,ownerId,id),idempotencyKey??null,now));
}

export {claimNextScan,reportProgress,completeScan,failScan,isCancelRequested} from './lease';
