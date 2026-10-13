import {transaction,type Database} from '../database';
import {AppError} from '../errors';
import {JOB_SELECT,toJob,type JobRow,type ScanJob} from './records';

import {LEASE_MS,backoffMs as backoff} from './timing';
const leaseLost=()=>new AppError(409,'LEASE_LOST','다른 작업자가 이 작업을 넘겨받았습니다.');
export type JobFailure={code:string;message:string;retryable:boolean};

/**
 * 실행할 작업 하나를 임대한다. 대기 작업(실행 시각 도래) 또는 임대가 끝난 실행 중 작업(작업자 비정상 종료)이 대상이다.
 * 시도 횟수를 다 쓴 작업은 실패로, 취소 요청이 있던 작업은 취소로 정리하고 다음 후보를 찾는다.
 */
export function claimNextScan(db:Database,workerId:string,now=Date.now()):ScanJob|null{
 return transaction(db,()=>{
  for(;;){
   const r=db.prepare(`${JOB_SELECT} WHERE (state='queued' AND run_after<=?) OR (state='running' AND lease_until<?) ORDER BY run_after,created_at LIMIT 1`).get(now,now) as JobRow|undefined;
   if(!r)return null;
   if(r.cancel_requested===1){db.prepare("UPDATE scan_jobs SET state='canceled',lease_owner=NULL,lease_until=NULL,completed_at=?,updated_at=? WHERE id=?").run(now,now,r.id);continue;}
   if(r.state==='running'&&r.attempt>=r.max_attempts){
    db.prepare("UPDATE scan_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,error_code='LEASE_EXPIRED',error_message='작업자가 응답하지 않아 중단했습니다.',completed_at=?,updated_at=? WHERE id=?").run(now,now,r.id);
    continue;
   }
   db.prepare("UPDATE scan_jobs SET state='running',attempt=attempt+1,lease_owner=?,lease_until=?,started_at=coalesce(started_at,?),updated_at=? WHERE id=?").run(workerId,now+LEASE_MS,now,now,r.id);
   return toJob(db.prepare(`${JOB_SELECT} WHERE id=?`).get(r.id) as JobRow);
  }
 });
}

function leased(db:Database,id:string,workerId:string):JobRow{
 const r=db.prepare(`${JOB_SELECT} WHERE id=? AND state='running' AND lease_owner=?`).get(id,workerId) as JobRow|undefined;
 if(!r)throw leaseLost();
 return r;
}

/** 진행률을 기록하고 임대를 연장한다. */
export function reportProgress(db:Database,id:string,workerId:string,progress:number,now=Date.now()){
 const p=Math.max(0,Math.min(99,Math.round(progress)));
 const r=db.prepare("UPDATE scan_jobs SET progress=max(progress,?),lease_until=?,updated_at=? WHERE id=? AND state='running' AND lease_owner=?").run(p,now+LEASE_MS,now,id,workerId);
 if(r.changes===0)throw leaseLost();
}

export const isCancelRequested=(db:Database,id:string)=>(db.prepare('SELECT cancel_requested FROM scan_jobs WHERE id=?').get(id) as {cancel_requested:number}|undefined)?.cancel_requested===1;

function finishCanceled(db:Database,id:string,now:number){
 db.prepare("UPDATE scan_jobs SET state='canceled',lease_owner=NULL,lease_until=NULL,completed_at=?,updated_at=? WHERE id=?").run(now,now,id);
}

/** 결과를 저장한다. 그 사이 취소 요청이 들어왔다면 결과보다 취소를 우선한다. */
export function completeScan(db:Database,id:string,workerId:string,result:unknown,now=Date.now()){
 transaction(db,()=>{
  const r=leased(db,id,workerId);
  if(r.cancel_requested===1)return finishCanceled(db,id,now);
  db.prepare("UPDATE scan_jobs SET state='succeeded',progress=100,result_json=?,error_code=NULL,error_message=NULL,lease_owner=NULL,lease_until=NULL,completed_at=?,updated_at=? WHERE id=?")
   .run(JSON.stringify(result??null),now,now,id);
 });
}

/** 다시 시도할 수 있는 오류는 대기열로 돌려보내고(지수 대기), 아니면 실패로 끝낸다. */
export function failScan(db:Database,id:string,workerId:string,failure:JobFailure,now=Date.now()){
 transaction(db,()=>{
  const r=leased(db,id,workerId);
  if(r.cancel_requested===1)return finishCanceled(db,id,now);
  const message=failure.message.slice(0,500),code=failure.code.slice(0,60);
  if(failure.retryable&&r.attempt<r.max_attempts){
   db.prepare("UPDATE scan_jobs SET state='queued',run_after=?,error_code=?,error_message=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now+backoff(r.attempt),code,message,now,id);
  }else{
   db.prepare("UPDATE scan_jobs SET state='failed',error_code=?,error_message=?,lease_owner=NULL,lease_until=NULL,completed_at=?,updated_at=? WHERE id=?").run(code,message,now,now,id);
  }
 });
}
