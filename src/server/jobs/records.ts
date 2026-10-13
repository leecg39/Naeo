export type ScanState='queued'|'running'|'succeeded'|'failed'|'canceled';
export type ScanJob={
 id:string;blogId:string;state:ScanState;attempt:number;maxAttempts:number;progress:number;runAfter:number;cancelRequested:boolean;
 errorCode:string|null;errorMessage:string|null;result:unknown;retryOf:string|null;createdAt:number;updatedAt:number;startedAt:number|null;completedAt:number|null;
};
export type JobRow={id:string;owner_id:string;blog_id:string;state:ScanState;attempt:number;max_attempts:number;progress:number;lease_owner:string|null;lease_until:number|null;run_after:number;
 cancel_requested:number;idempotency_key:string|null;retry_of:string|null;error_code:string|null;error_message:string|null;result_json:string|null;created_at:number;updated_at:number;started_at:number|null;completed_at:number|null};
export const JOB_SELECT='SELECT * FROM scan_jobs';
/** 회원 응답에는 작업자 식별자·임대 정보를 넣지 않는다. */
export const toJob=(r:JobRow):ScanJob=>({
 id:r.id,blogId:r.blog_id,state:r.state,attempt:r.attempt,maxAttempts:r.max_attempts,progress:r.progress,runAfter:r.run_after,cancelRequested:r.cancel_requested===1,
 errorCode:r.error_code,errorMessage:r.error_message,result:r.result_json===null?null:JSON.parse(r.result_json),retryOf:r.retry_of,
 createdAt:r.created_at,updatedAt:r.updated_at,startedAt:r.started_at,completedAt:r.completed_at
});
