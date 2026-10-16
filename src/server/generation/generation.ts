import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';
import {paginationInput} from '../validation';
import {balance,record} from '../credits/ledger';
import {templateGuidance} from './templates';
import {openAIConnectionConfig} from '../openai/config';
import {openAIGenerationCredential} from '../openai/credentials';

/** 글 1편 생성 비용(원본 화면의 "10토큰"). AI 이미지는 공급자 미설정. */
export const GENERATION_COST=10;
export type ProviderConfig={provider:'anthropic';model:string;apiKey:string;baseUrl:string};
const DEFAULT_BASE='https://api.anthropic.com';
/** 운영자 설정 API 주소(프록시용). https 또는 이 서버 안(localhost) http만 허용하고, 아니면 기본 주소를 쓴다. */
export function safeBaseUrl(value:string|undefined):string{
 if(!value)return DEFAULT_BASE;
 try{const u=new URL(value);const local=u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname);return u.protocol==='https:'||local?u.origin:DEFAULT_BASE;}catch{return DEFAULT_BASE;}
}
export const providerConfig=(env:Record<string,string|undefined>=process.env):ProviderConfig=>({provider:'anthropic',model:env.NAEO_AI_MODEL||'claude-sonnet-4-6',apiKey:env.ANTHROPIC_API_KEY||'',baseUrl:safeBaseUrl(env.NAEO_AI_BASE_URL)});
export type GenerationJob={id:string;state:'queued'|'running'|'succeeded'|'failed'|'canceled';cost:number;draftId:string|null;attempt:number;errorCode:string|null;errorMessage:string|null;cancelRequested:boolean;createdAt:number;updatedAt:number;completedAt:number|null};
export type JobRow={id:string;owner_id:string;draft_id:string|null;state:GenerationJob['state'];cost:number;input_json:string;provider:string;model:string;credential_revision:number|null;attempt:number;max_attempts:number;cancel_requested:number;error_code:string|null;error_message:string|null;created_at:number;updated_at:number;completed_at:number|null;lease_owner:string|null};
export const toJob=(r:JobRow):GenerationJob=>({id:r.id,state:r.state,cost:r.cost,draftId:r.draft_id,attempt:r.attempt,errorCode:r.error_code,errorMessage:r.error_message,cancelRequested:r.cancel_requested===1,createdAt:r.created_at,updatedAt:r.updated_at,completedAt:r.completed_at});
const text=(max:number)=>z.string().trim().max(max);
const requestInput=z.object({keyword:text(60).min(1),category:text(30).default(''),title:text(200).default(''),experience:text(1000).default(''),instructions:text(1000).default(''),
 photoIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{22}$/)).max(20).default([]),aiImages:z.number().int().min(0).max(20).default(0),templateId:z.uuid().optional(),idempotencyKey:text(100).min(1)}).strict();
/** 저장 입력: 템플릿 지침은 요청 시점의 내용을 복사해 둔다(나중에 템플릿을 고쳐도 기존 작업은 그대로). */
export type StoredInput=Omit<z.infer<typeof requestInput>,'idempotencyKey'|'aiImages'|'templateId'>&{guidance:string};

export function ownedJob(db:Database,ownerId:string,id:string):JobRow{
 const r=db.prepare('SELECT * FROM generation_jobs WHERE id=? AND owner_id=?').get(id,ownerId) as JobRow|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','생성 작업을 찾을 수 없습니다.');
 return r;
}

/** 생성 요청: 공급자 확인 → 같은 키면 기존 작업 → 잔액 확인 → 작업 등록과 차감을 한 트랜잭션으로. */
function generationSource(db:Database,ownerId:string,explicit?:ProviderConfig){
 if(explicit){if(!explicit.apiKey)throw new AppError(503,'PROVIDER_NOT_CONFIGURED','AI 글 생성 공급자가 설정되지 않았습니다(미설정). 토큰은 차감되지 않았습니다.');return{provider:explicit.provider,model:explicit.model,credentialRevision:null};}
 const openAI=openAIConnectionConfig(),credential=openAIGenerationCredential(db,ownerId,openAI);
 if(credential)return{provider:'openai_oauth',model:'account-current',credentialRevision:credential.revision};
 const anthropic=providerConfig();if(anthropic.apiKey)return{provider:anthropic.provider,model:anthropic.model,credentialRevision:null};
 if(openAI)throw new AppError(409,'OPENAI_CONNECTION_REQUIRED','설정에서 ChatGPT 계정을 연결한 뒤 다시 시도해주세요. 토큰은 차감되지 않았습니다.');
 throw new AppError(503,'PROVIDER_NOT_CONFIGURED','AI 글 생성 공급자가 설정되지 않았습니다(미설정). 토큰은 차감되지 않았습니다.');
}
export function generationAvailability(db:Database,ownerId:string):'openai_oauth'|'anthropic'|null{
 const openAI=openAIConnectionConfig();if(openAIGenerationCredential(db,ownerId,openAI))return'openai_oauth';return providerConfig().apiKey?'anthropic':null;
}

export function requestGeneration(db:Database,ownerId:string,input:unknown,config?:ProviderConfig,now=Date.now()):GenerationJob{
 const v=requestInput.parse(input);
 if(v.aiImages>0)throw new AppError(503,'IMAGE_PROVIDER_NOT_CONFIGURED','AI 이미지 생성 공급자가 설정되지 않았습니다(미설정). 내 사진만 넣을 수 있습니다.');
 return transaction(db,()=>{
  const same=db.prepare('SELECT * FROM generation_jobs WHERE owner_id=? AND idempotency_key=?').get(ownerId,v.idempotencyKey) as JobRow|undefined;
  if(same)return toJob(same);
  const source=generationSource(db,ownerId,config);
  for(const p of v.photoIds)if(!db.prepare('SELECT 1 FROM media_files WHERE public_id=? AND owner_id=?').get(p,ownerId))throw new AppError(404,'PHOTO_NOT_FOUND','선택한 사진을 찾을 수 없습니다.');
  if(balance(db,ownerId)<GENERATION_COST)throw new AppError(402,'INSUFFICIENT_TOKENS',`토큰이 부족합니다(필요 ${GENERATION_COST}).`);
  const id=randomUUID();
  const guidance=v.templateId?templateGuidance(db,v.templateId):'';
  const stored:StoredInput={keyword:v.keyword,category:v.category,title:v.title,experience:v.experience,instructions:v.instructions,photoIds:v.photoIds,guidance};
  db.prepare("INSERT INTO generation_jobs(id,owner_id,state,cost,input_json,provider,model,credential_revision,idempotency_key,run_after,created_at,updated_at) VALUES(?,?,'queued',?,?,?,?,?,?,?,?,?)")
   .run(id,ownerId,GENERATION_COST,JSON.stringify(stored),source.provider,source.model,source.credentialRevision,v.idempotencyKey,now,now,now);
  record(db,{ownerId,delta:-GENERATION_COST,reason:'generation',refType:'generation',refId:id,note:v.keyword},now);
  return toJob(ownedJob(db,ownerId,id));
 });
}

export const getGeneration=(db:Database,ownerId:string,id:string)=>toJob(ownedJob(db,ownerId,id));
export function listGenerations(db:Database,ownerId:string,query:unknown){
 const {page,pageSize}=paginationInput.parse(query);
 const {total}=db.prepare('SELECT count(*) AS total FROM generation_jobs WHERE owner_id=?').get(ownerId) as {total:number};
 const rows=db.prepare('SELECT * FROM generation_jobs WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?').all(ownerId,pageSize,(page-1)*pageSize) as JobRow[];
 return{data:rows.map(toJob),pagination:{page,pageSize,total}};
}

/** 실패·취소 작업 환급(작업당 1회). 트랜잭션 안에서 호출. */
export function refundJob(db:Database,r:JobRow,now:number){
 if(r.cost>0)record(db,{ownerId:r.owner_id,delta:r.cost,reason:'refund',refType:'generation',refId:r.id},now);
}

/** 대기 작업은 바로 취소·환급, 실행 중이면 취소 요청(작업자가 결과 대신 취소·환급). */
export function cancelGeneration(db:Database,ownerId:string,id:string,now=Date.now()):GenerationJob{
 return transaction(db,()=>{
  const r=ownedJob(db,ownerId,id);
  if(r.state==='queued'){
   db.prepare("UPDATE generation_jobs SET state='canceled',completed_at=?,updated_at=? WHERE id=?").run(now,now,id);
   refundJob(db,r,now);
  }else if(r.state==='running')db.prepare('UPDATE generation_jobs SET cancel_requested=1,updated_at=? WHERE id=?').run(now,id);
  else throw new AppError(409,'GENERATION_FINISHED','이미 끝난 작업입니다.');
  return toJob(ownedJob(db,ownerId,id));
 });
}
