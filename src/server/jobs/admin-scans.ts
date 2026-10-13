import {z} from 'zod';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {paginationInput} from '../validation';
import {cancelJob,retryJob} from './queue';
import {JOB_SELECT,toJob,type JobRow,type ScanJob} from './records';
import {LEASE_MS} from './timing';

/** 마지막 신호가 이 시간 안이면 작업자가 살아 있다고 본다. */
export const WORKER_ALIVE_MS=30_000;
const listInput=paginationInput.extend({state:z.enum(['queued','running','succeeded','failed','canceled']).optional()});
export type AdminScanJob=ScanJob&{ownerEmail:string;naverId:string;leaseOwner:string|null;leaseUntil:number|null};
type AdminRow=JobRow&{owner_email:string;naver_id:string};
const ADMIN_SELECT=`SELECT j.*,u.email AS owner_email,b.naver_id FROM scan_jobs j JOIN users u ON u.id=j.owner_id JOIN blogs b ON b.id=j.blog_id`;
const toAdmin=(r:AdminRow):AdminScanJob=>({...toJob(r),ownerEmail:r.owner_email,naverId:r.naver_id,leaseOwner:r.lease_owner,leaseUntil:r.lease_until});
const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));

export function scanHealth(db:Database,actorId:string,now=Date.now()){
 authorize(db,actorId);
 const counts=Object.fromEntries(['queued','running','succeeded','failed','canceled'].map(s=>[s,(db.prepare('SELECT count(*) AS n FROM scan_jobs WHERE state=?').get(s) as {n:number}).n]));
 const oldest=db.prepare("SELECT min(run_after) AS t FROM scan_jobs WHERE state='queued' AND run_after<=?").get(now) as {t:number|null};
 const overdue=(db.prepare("SELECT count(*) AS n FROM scan_jobs WHERE state='running' AND lease_until<?").get(now) as {n:number}).n;
 const workers=(db.prepare('SELECT worker_id AS workerId,started_at AS startedAt,last_seen_at AS lastSeenAt,processed,failed FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 20').all() as {workerId:string;startedAt:number;lastSeenAt:number;processed:number;failed:number}[])
  .map(w=>({...w,alive:now-w.lastSeenAt<=WORKER_ALIVE_MS}));
 const day=now-86_400_000;
 const lastDay=db.prepare("SELECT sum(state='succeeded') AS ok,sum(state='failed') AS failed FROM scan_jobs WHERE completed_at>=?").get(day) as {ok:number|null;failed:number|null};
 return{
  counts,oldestQueuedMs:oldest.t===null?null:now-oldest.t,overdueLeases:overdue,leaseMs:LEASE_MS,workers,aliveWorkers:workers.filter(w=>w.alive).length,
  lastDay:{succeeded:lastDay.ok??0,failed:lastDay.failed??0},
  recentFailures:(db.prepare(`${ADMIN_SELECT} WHERE j.state='failed' ORDER BY j.completed_at DESC LIMIT 10`).all() as AdminRow[]).map(toAdmin)
 };
}

export function listAdminScans(db:Database,actorId:string,query:unknown){
 authorize(db,actorId);
 const {page,pageSize,q,state}=listInput.parse(query);
 const like=`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;
 const where=["(u.email LIKE ? ESCAPE '\\' OR b.naver_id LIKE ? ESCAPE '\\' OR j.error_code LIKE ? ESCAPE '\\')"],params:(string|number)[]=[like,like,like];
 if(state){where.push('j.state=?');params.push(state);}
 const sql=`FROM scan_jobs j JOIN users u ON u.id=j.owner_id JOIN blogs b ON b.id=j.blog_id WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total ${sql}`).get(...params) as {total:number};
 const rows=db.prepare(`SELECT j.*,u.email AS owner_email,b.naver_id ${sql} ORDER BY j.created_at DESC,j.id LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as AdminRow[];
 return{data:rows.map(toAdmin),pagination:{page,pageSize,total}};
}

function adminRow(db:Database,id:string):JobRow{
 const r=db.prepare(`${JOB_SELECT} WHERE id=?`).get(id) as JobRow|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','진단 작업을 찾을 수 없습니다.');
 return r;
}
export function adminCancelScan(db:Database,actorId:string,id:string){
 authorize(db,actorId);
 return transaction(db,()=>{const job=cancelJob(db,adminRow(db,id));audit(db,actorId,'admin.scan.cancel','scan_job',id);return job;});
}
export function adminRetryScan(db:Database,actorId:string,id:string){
 authorize(db,actorId);
 return transaction(db,()=>{const job=retryJob(db,adminRow(db,id),null);audit(db,actorId,'admin.scan.retry','scan_job',id,{newJob:job.id});return job;});
}
