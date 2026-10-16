import {transaction,type Database} from '../database';
import {insertDraftRow} from '../writing/drafts';
import {saveGeneratedImage} from '../writing/media';
import {IMAGE_COST,refundJob,type JobRow,type StoredInput} from './generation';
import {record} from '../credits/ledger';
import {ProviderError,type Provider} from './provider';
import {buildImagePrompt,type ImageProvider} from './image-provider';

const LEASE_MS=180_000;
const backoff=(attempt:number)=>60_000*2**Math.max(0,attempt-1);

function claim(db:Database,workerId:string,now:number):JobRow|null{
 return transaction(db,()=>{
  for(;;){
   const r=db.prepare("SELECT * FROM generation_jobs WHERE (state='queued' AND run_after<=?) OR (state='running' AND lease_until<?) ORDER BY run_after,created_at LIMIT 1").get(now,now) as JobRow|undefined;
   if(!r)return null;
   if(r.cancel_requested===1||(r.state==='running'&&r.attempt>=r.max_attempts)){
    const state=r.cancel_requested===1?'canceled':'failed';
    db.prepare("UPDATE generation_jobs SET state=?,lease_owner=NULL,lease_until=NULL,error_code=CASE WHEN ?='failed' THEN 'LEASE_EXPIRED' ELSE error_code END,completed_at=?,updated_at=? WHERE id=?").run(state,state,now,now,r.id);
    refundJob(db,r,now);continue;
   }
   db.prepare("UPDATE generation_jobs SET state='running',attempt=attempt+1,lease_owner=?,lease_until=?,updated_at=? WHERE id=?").run(workerId,now+LEASE_MS,now,r.id);
   return db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(r.id) as JobRow;
  }
 });
}

export type GeneratedImage={bytes:Buffer;failed?:never};
/** AI 이미지 호출은 초안 저장과 분리한다. 한 장이라도 실패하면 나머지는 만들지 않고 요청분 대비 부족한 장수만큼 환급한다(원본 미확인 새 규칙). */
async function makeImages(job:JobRow,input:StoredInput,imageProvider:ImageProvider,db:Database){
 const wanted=input.aiImages??0,images:Buffer[]=[];let failed=0,note='';
 if(!wanted)return{images,failed,note};
 for(let i=0;i<wanted;i++){
  const cancel=db.prepare('SELECT cancel_requested AS c FROM generation_jobs WHERE id=?').get(job.id) as {c:number};
  if(cancel.c)break;
  try{images.push(await imageProvider({prompt:buildImagePrompt(input,i),index:i}));}
  catch(e){failed=wanted-images.length;note=e instanceof ProviderError?e.message.slice(0,200):'AI 이미지 생성에 실패했습니다.';break;}
 }
 return{images,failed,note};
}
/** 결과 저장: 취소 요청이 있으면 초안 없이 취소·환급, 아니면 초안·사진·AI 이미지 연결·미생성분 환급을 한 트랜잭션으로. */
function complete(db:Database,id:string,workerId:string,output:{title:string;body:string},made:{images:Buffer[];failed:number;note:string},dir:string|undefined,now:number){
 transaction(db,()=>{
  const r=db.prepare("SELECT * FROM generation_jobs WHERE id=? AND state='running' AND lease_owner=?").get(id,workerId) as JobRow|undefined;
  if(!r)return;
  if(r.cancel_requested===1){
   db.prepare("UPDATE generation_jobs SET state='canceled',lease_owner=NULL,lease_until=NULL,completed_at=?,updated_at=? WHERE id=?").run(now,now,id);
   refundJob(db,r,now);return;
  }
  const input=JSON.parse(r.input_json) as StoredInput;
  const draft=insertDraftRow(db,r.owner_id,{title:output.title||input.title||`${input.keyword} 정리`,keyword:input.keyword,category:input.category,body:output.body.slice(0,100000)},now,'draft.generate');
  for(const p of input.photoIds.slice(0,20))db.prepare('UPDATE media_files SET draft_id=? WHERE public_id=? AND owner_id=?').run(draft.id,p,r.owner_id);
  let saved=0;
  if(dir)for(const bytes of made.images){try{saveGeneratedImage(db,dir,r.owner_id,{bytes,name:`AI 생성 ${input.keyword}`,draftId:draft.id},now);saved++;}catch{made.failed++;}}
  else made.failed+=made.images.length;
  const unused=(input.aiImages??0)-saved;
  if(unused>0)record(db,{ownerId:r.owner_id,delta:unused*IMAGE_COST,reason:'refund',refType:'generation',refId:id,note:`AI 이미지 ${unused}장 미생성 환급`},now);
  const note=made.failed>0?`${input.aiImages??0}장 중 ${saved}장 생성`:'';
  db.prepare("UPDATE generation_jobs SET state='succeeded',draft_id=?,images_made=?,error_code=CASE WHEN ?>0 THEN 'IMAGE_PARTIAL' ELSE NULL END,error_message=CASE WHEN ?>0 THEN ? ELSE NULL END,lease_owner=NULL,lease_until=NULL,completed_at=?,updated_at=? WHERE id=?").run(draft.id,saved,made.failed,made.failed,`${note}${made.note?` (${made.note})`:''}`.slice(0,500)||null,now,now,id);
 });
}

function fail(db:Database,id:string,workerId:string,e:unknown,now:number){
 const err=e as {code?:unknown;retryable?:unknown;message?:unknown;retryAfterMs?:unknown};
 const code=typeof err.code==='string'?err.code.slice(0,60):'INTERNAL_ERROR',message=(typeof err.message==='string'?err.message:'생성 중 오류가 발생했습니다.').slice(0,500);
 const retryable=err.retryable===true;
 transaction(db,()=>{
  const r=db.prepare("SELECT * FROM generation_jobs WHERE id=? AND state='running' AND lease_owner=?").get(id,workerId) as JobRow|undefined;
  if(!r)return;
  if(retryable&&r.cancel_requested===0&&r.attempt<r.max_attempts){
   const providerDelay=typeof err.retryAfterMs==='number'&&Number.isFinite(err.retryAfterMs)?Math.max(0,Math.min(err.retryAfterMs,7*24*60*60*1000)):0;
   db.prepare("UPDATE generation_jobs SET state='queued',run_after=?,error_code=?,error_message=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now+Math.max(backoff(r.attempt),providerDelay),code,message,now,id);
   return;
  }
  db.prepare("UPDATE generation_jobs SET state=?,error_code=?,error_message=?,lease_owner=NULL,lease_until=NULL,completed_at=?,updated_at=? WHERE id=?").run(r.cancel_requested===1?'canceled':'failed',code,message,now,now,id);
  refundJob(db,r,now);
 });
}

export type GenerationRunOptions={imageProvider?:ImageProvider|null;uploadDir?:string};
/** 생성 작업 하나를 처리한다. 처리한 작업 id, 없으면 null. */
export async function runGenerationOnce(db:Database,workerId:string,provider:Provider,options:GenerationRunOptions|(()=>number)={},now:()=>number=Date.now):Promise<string|null>{
 const opts=typeof options==='function'?{}:options,clock=typeof options==='function'?options:now;
 const job=claim(db,workerId,clock());
 if(!job)return null;
 const input=JSON.parse(job.input_json) as StoredInput;
 try{
  const output=await provider(input,{ownerId:job.owner_id,jobId:job.id,provider:job.provider,model:job.model,credentialRevision:job.credential_revision});
  const made=opts.imageProvider&&opts.uploadDir?await makeImages(job,input,opts.imageProvider,db):{images:[],failed:input.aiImages??0,note:''};
  complete(db,job.id,workerId,output,made,opts.uploadDir,clock());
 }
 catch(e){fail(db,job.id,workerId,e,clock());}
 return job.id;
}
