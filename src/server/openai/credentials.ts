import {randomUUID} from 'node:crypto';
import type {Database} from '../database';
import {transaction} from '../database';
import {audit} from '../audit';
import {ProviderError} from '../generation/provider';
import {openAIConnectionConfig,type OpenAIConnectionConfig} from './config';
import {decryptOpenAIToken,encryptOpenAIToken} from './crypto';
import {refreshOpenAITokens,type FetchLike} from './oauth-provider';

const REFRESH_LEASE=60_000;
type Row={id:string;user_id:string;issuer:string;client_id:string;scope:string;access_token_encrypted:string;refresh_token_encrypted:string;id_token_encrypted:string;access_expires_at:number;earliest_refresh_at:number|null;revision:number;token_version:number;refresh_started_at:number|null;refresh_lease:string|null};
const row=(db:Database,userId:string)=>db.prepare('SELECT * FROM openai_connections WHERE user_id=?').get(userId) as Row|undefined;
const absoluteTime=(value:number|null,at:number)=>value===null?null:value>1_000_000_000_000?value:value>1_000_000_000?value*1000:at+value*1000;
const unavailable=()=>new ProviderError('OPENAI_CONNECTION_REQUIRED','ChatGPT 계정을 다시 연결한 뒤 글 생성을 요청해주세요.',false);

export function openAIGenerationCredential(db:Database,userId:string,config:OpenAIConnectionConfig|null=openAIConnectionConfig()):{revision:number}|null{
 if(!config)return null;
 const current=row(db,userId);
 return current&&current.issuer===config.issuer&&current.client_id===config.clientId&&current.scope.split(' ').includes('chatgpt.tokens.use.direct')?{revision:current.revision}:null;
}

/** 작업에 기록된 동일 연결 revision의 access token만 반환하며, 회전 갱신은 DB lease로 직렬화한다. */
export async function openAIAccessToken(db:Database,userId:string,credentialRevision:number,config:OpenAIConnectionConfig,fetchImpl:FetchLike=fetch,now=Date.now()):Promise<string>{
 let current=row(db,userId);
 if(!current||current.revision!==credentialRevision||current.issuer!==config.issuer||current.client_id!==config.clientId)return Promise.reject(unavailable());
 let accessToken:string;
 try{accessToken=decryptOpenAIToken(current.access_token_encrypted,`${current.id}:access:${current.token_version}`,config.encryptionKey);}
 catch{throw unavailable();}
 if(current.access_expires_at>now+60_000)return accessToken;
 if(current.earliest_refresh_at&&current.earliest_refresh_at>now){
  if(current.access_expires_at>now)return accessToken;
  throw Object.assign(new ProviderError('OPENAI_REFRESH_TOO_EARLY','ChatGPT 연결을 갱신할 수 있는 시각까지 기다립니다.',true),{retryAfterMs:current.earliest_refresh_at-now});
 }
 const lease=randomUUID();
 const claimed=transaction(db,()=>db.prepare(`UPDATE openai_connections SET refresh_lease=?,refresh_started_at=? WHERE user_id=? AND revision=? AND (refresh_lease IS NULL OR refresh_started_at<?)`).run(lease,now,userId,credentialRevision,now-REFRESH_LEASE).changes===1);
 if(!claimed)throw Object.assign(new ProviderError('OPENAI_REFRESH_BUSY','다른 작업이 ChatGPT 연결을 갱신하고 있습니다.',true),{retryAfterMs:30_000});
 current=row(db,userId);
 if(!current||current.refresh_lease!==lease||current.revision!==credentialRevision)throw unavailable();
 let refreshToken:string,retainedIdToken:string;
 try{
  refreshToken=decryptOpenAIToken(current.refresh_token_encrypted,`${current.id}:refresh:${current.token_version}`,config.encryptionKey);
  retainedIdToken=decryptOpenAIToken(current.id_token_encrypted,`${current.id}:id:${current.token_version}`,config.encryptionKey);
 }catch{
  db.prepare('UPDATE openai_connections SET refresh_lease=NULL,refresh_started_at=NULL WHERE user_id=? AND refresh_lease=?').run(userId,lease);
  throw unavailable();
 }
 try{
  const tokens=await refreshOpenAITokens(config,refreshToken,fetchImpl),tokenVersion=current.token_version+1,idToken=tokens.idToken??retainedIdToken;
  const encrypted={access:encryptOpenAIToken(tokens.accessToken,`${current.id}:access:${tokenVersion}`,config.encryptionKey),refresh:encryptOpenAIToken(tokens.refreshToken,`${current.id}:refresh:${tokenVersion}`,config.encryptionKey),id:encryptOpenAIToken(idToken,`${current.id}:id:${tokenVersion}`,config.encryptionKey)};
  const saved=transaction(db,()=>{
   const result=db.prepare(`UPDATE openai_connections SET access_token_encrypted=?,refresh_token_encrypted=?,id_token_encrypted=?,scope=?,access_expires_at=?,earliest_refresh_at=?,token_version=?,refresh_lease=NULL,refresh_started_at=NULL,updated_at=?,last_refreshed_at=? WHERE user_id=? AND revision=? AND token_version=? AND refresh_lease=?`)
    .run(encrypted.access,encrypted.refresh,encrypted.id,tokens.scope??current!.scope,now+tokens.expiresIn*1000,absoluteTime(tokens.earliestRefreshAt,now),tokenVersion,now,now,userId,credentialRevision,current!.token_version,lease);
   if(result.changes===1)audit(db,userId,'account.openai.refresh','user',userId);
   return result.changes===1;
  });
  if(!saved)throw Object.assign(new ProviderError('OPENAI_REFRESH_SUPERSEDED','ChatGPT 연결이 다른 작업에서 변경되었습니다.',true),{retryAfterMs:30_000});
  return tokens.accessToken;
 }catch(error){
  const detail=error as {terminal?:unknown;retryable?:unknown;code?:unknown;message?:unknown};
  if(detail.terminal===true){
   transaction(db,()=>{const removed=db.prepare('DELETE FROM openai_connections WHERE user_id=? AND revision=? AND refresh_lease=?').run(userId,credentialRevision,lease);if(removed.changes)audit(db,userId,'account.openai.expire','user',userId,{reason:typeof detail.code==='string'?detail.code:'refresh'});});
   throw new ProviderError('OPENAI_REAUTH_REQUIRED','ChatGPT 연결이 만료되었습니다. 설정에서 다시 연결해주세요.',false);
  }
  db.prepare('UPDATE openai_connections SET refresh_lease=NULL,refresh_started_at=NULL WHERE user_id=? AND refresh_lease=?').run(userId,lease);
  if(error instanceof ProviderError)throw error;
  throw new ProviderError(typeof detail.code==='string'?detail.code:'OPENAI_REFRESH_FAILED',typeof detail.message==='string'?detail.message:'ChatGPT 연결을 갱신하지 못했습니다.',detail.retryable===true);
 }
}
