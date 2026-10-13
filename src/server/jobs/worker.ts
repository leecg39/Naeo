import type {Database} from '../database';
import {AppError} from '../errors';
import {claimNextScan,completeScan,failScan,isCancelRequested,reportProgress,type JobFailure} from './lease';
import type {ScanJob} from './records';

export type JobContext={progress:(value:number)=>Promise<void>;canceled:()=>boolean};
export type ScanHandler=(job:ScanJob,ctx:JobContext)=>Promise<unknown>;
/** 작업 중 취소 요청을 확인하면 이 오류로 중단한다. */
export class JobCanceled extends Error{constructor(){super('canceled');}}

function heartbeat(db:Database,workerId:string,now:number,outcome?:'ok'|'fail'){
 db.prepare(`INSERT INTO worker_heartbeats(worker_id,started_at,last_seen_at,processed,failed) VALUES(?,?,?,?,?)
  ON CONFLICT(worker_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,processed=processed+excluded.processed,failed=failed+excluded.failed`)
  .run(workerId,now,now,outcome==='ok'?1:0,outcome==='fail'?1:0);
}
function failureOf(e:unknown):JobFailure{
 const err=e as {code?:unknown;retryable?:unknown;message?:unknown};
 const code=typeof err.code==='string'?err.code:'INTERNAL_ERROR';
 // 알 수 없는 오류는 일시적일 수 있어 재시도한다. 공급자가 명시한 영구 오류만 바로 실패한다.
 const retryable=typeof err.retryable==='boolean'?err.retryable:true;
 const message=typeof err.message==='string'&&err.message?err.message:'진단 중 오류가 발생했습니다.';
 return{code,message,retryable};
}

/** 대기 작업 하나를 실행한다. 실행한 작업 id, 없으면 null. */
export async function runWorkerOnce(db:Database,workerId:string,handler:ScanHandler,now=Date.now):Promise<string|null>{
 heartbeat(db,workerId,now());
 const job=claimNextScan(db,workerId,now());
 if(!job)return null;
 const ctx:JobContext={
  progress:async value=>{if(isCancelRequested(db,job.id))throw new JobCanceled();reportProgress(db,job.id,workerId,value,now());},
  canceled:()=>isCancelRequested(db,job.id)
 };
 try{
  const result=await handler(job,ctx);
  completeScan(db,job.id,workerId,result,now());
  heartbeat(db,workerId,now(),'ok');
 }catch(e){
  if(e instanceof AppError&&e.code==='LEASE_LOST')return job.id;
  try{failScan(db,job.id,workerId,e instanceof JobCanceled?{code:'CANCELED',message:'취소했습니다.',retryable:false}:failureOf(e),now());}
  catch(inner){if(!(inner instanceof AppError&&inner.code==='LEASE_LOST'))throw inner;}
  heartbeat(db,workerId,now(),'fail');
 }
 return job.id;
}

/** 중지 신호가 올 때까지 작업을 계속 처리한다. 할 일이 없으면 idleMs만큼 쉰다. */
export async function runWorkerLoop(db:Database,workerId:string,handler:ScanHandler,{signal,idleMs=2000}:{signal:AbortSignal;idleMs?:number}){
 while(!signal.aborted){
  const ran=await runWorkerOnce(db,workerId,handler);
  if(!ran)await new Promise<void>(resolve=>{const t=setTimeout(resolve,idleMs);signal.addEventListener('abort',()=>{clearTimeout(t);resolve();},{once:true});});
 }
}
