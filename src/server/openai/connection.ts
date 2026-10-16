import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Database} from '../database';
import {transaction} from '../database';
import {AppError} from '../errors';
import {audit} from '../audit';
import {openAIConnectionConfig,type OpenAIConnectionConfig} from './config';
import {decryptOpenAIToken,encryptOpenAIToken} from './crypto';
import {exchangeOpenAICode,revokeOpenAISession,verifyOpenAIIdentity,type FetchLike} from './oauth-provider';

const STATE_TTL=10*60_000;
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const token=(bytes=32)=>randomBytes(bytes).toString('base64url');
const callbackInput=z.object({code:z.string().min(1).max(4000).optional(),state:z.string().min(1).max(300),error:z.string().max(200).optional()}).strict();
export type OpenAIConnectionView={connected:true;email:string;name:string;scope:string[];connectedAt:number;updatedAt:number}|{connected:false};

type StateRow={userId:string;bindingHash:string;verifier:string;nonce:string;redirectUri:string;expiresAt:number};
type ConnectionRow={id:string;user_id:string;issuer:string;subject:string;client_id:string;email:string;display_name:string;scope:string;access_token_encrypted:string;refresh_token_encrypted:string;id_token_encrypted:string;access_expires_at:number;earliest_refresh_at:number|null;revision:number;token_version:number;connected_at:number;updated_at:number};

export function openAIConnection(db:Database,userId:string):OpenAIConnectionView{
 const row=db.prepare('SELECT email,display_name AS name,scope,connected_at AS connectedAt,updated_at AS updatedAt FROM openai_connections WHERE user_id=?').get(userId) as {email:string;name:string;scope:string;connectedAt:number;updatedAt:number}|undefined;
 return row?{connected:true,...row,scope:row.scope.split(' ').filter(Boolean)}:{connected:false};
}

export function startOpenAIConnection(db:Database,userId:string,config=openAIConnectionConfig(),now=Date.now()){
 if(!config)throw new AppError(503,'OPENAI_NOT_CONFIGURED','배포 서비스용 ChatGPT 연결 클라이언트가 아직 설정되지 않았습니다.');
 const state=token(),binding=token(),verifier=token(48),nonce=token(24),challenge=createHash('sha256').update(verifier).digest('base64url');
 transaction(db,()=>{
  db.prepare('DELETE FROM openai_connection_states WHERE expires_at<=? OR user_id=?').run(now,userId);
  db.prepare('INSERT INTO openai_connection_states(state_hash,user_id,binding_hash,code_verifier,nonce,redirect_uri,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)')
   .run(sha(state),userId,sha(binding),verifier,nonce,config.redirectUri,now+STATE_TTL,now);
 });
 const params=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:config.redirectUri,scope:config.scopes,resource:config.resource,state,nonce,code_challenge:challenge,code_challenge_method:'S256'});
 return{url:`${config.authorizeEndpoint}?${params}`,binding};
}

function takeState(db:Database,userId:string,state:string,binding:string|undefined,now:number):StateRow{
 return transaction(db,()=>{
  const row=db.prepare('SELECT user_id AS userId,binding_hash AS bindingHash,code_verifier AS verifier,nonce,redirect_uri AS redirectUri,expires_at AS expiresAt FROM openai_connection_states WHERE state_hash=?').get(sha(state)) as StateRow|undefined;
  if(!row||row.userId!==userId||!binding||row.bindingHash!==sha(binding))throw new AppError(400,'OPENAI_STATE_INVALID','ChatGPT 연결 요청이 만료되었거나 올바르지 않습니다. 다시 시도해주세요.');
  db.prepare('DELETE FROM openai_connection_states WHERE state_hash=?').run(sha(state));
  if(row.expiresAt<=now)throw new AppError(400,'OPENAI_STATE_INVALID','ChatGPT 연결 요청이 만료되었거나 올바르지 않습니다. 다시 시도해주세요.');
  return row;
 });
}
const absoluteTime=(value:number|null,now:number)=>value===null?null:value>1_000_000_000_000?value:value>1_000_000_000?value*1000:now+value*1000;

export async function completeOpenAIConnection(db:Database,userId:string,input:unknown,binding:string|undefined,config=openAIConnectionConfig(),now=Date.now(),fetchImpl:FetchLike=fetch):Promise<OpenAIConnectionView>{
 const value=callbackInput.parse(input),pending=takeState(db,userId,value.state,binding,now);
 if(value.error||!value.code)throw new AppError(400,'OPENAI_DENIED','ChatGPT 연결을 취소했거나 필요한 권한을 허용하지 않았습니다.');
 if(!config||pending.redirectUri!==config.redirectUri)throw new AppError(503,'OPENAI_NOT_CONFIGURED','ChatGPT 연결 설정이 변경되었습니다. 다시 시도해주세요.');
 const tokens=await exchangeOpenAICode(config,{code:value.code,verifier:pending.verifier},fetchImpl);
 try{
  const identity=await verifyOpenAIIdentity(config,tokens.idToken,pending.nonce,fetchImpl,now);
  transaction(db,()=>{
   const other=db.prepare('SELECT user_id AS userId FROM openai_connections WHERE issuer=? AND subject=?').get(config.issuer,identity.subject) as {userId:string}|undefined;
   if(other&&other.userId!==userId)throw new AppError(409,'OPENAI_ALREADY_LINKED','이 ChatGPT 계정은 이미 다른 NAEO 계정에 연결되어 있습니다.');
   const current=db.prepare('SELECT id,issuer,subject,revision,token_version AS tokenVersion FROM openai_connections WHERE user_id=?').get(userId) as {id:string;issuer:string;subject:string;revision:number;tokenVersion:number}|undefined;
   if(current&&(current.issuer!==config.issuer||current.subject!==identity.subject))throw new AppError(409,'OPENAI_ACCOUNT_MISMATCH','다른 ChatGPT 계정이 이미 연결되어 있습니다. 먼저 기존 연결을 해제해주세요.');
   const id=current?.id??randomUUID(),revision=(current?.revision??0)+1,tokenVersion=(current?.tokenVersion??0)+1;
   const encrypted={access:encryptOpenAIToken(tokens.accessToken,`${id}:access:${tokenVersion}`,config.encryptionKey),refresh:encryptOpenAIToken(tokens.refreshToken,`${id}:refresh:${tokenVersion}`,config.encryptionKey),id:encryptOpenAIToken(tokens.idToken,`${id}:id:${tokenVersion}`,config.encryptionKey)};
   if(current)db.prepare(`UPDATE openai_connections SET issuer=?,subject=?,client_id=?,email=?,display_name=?,scope=?,access_token_encrypted=?,refresh_token_encrypted=?,id_token_encrypted=?,access_expires_at=?,earliest_refresh_at=?,revision=?,token_version=?,refresh_started_at=NULL,updated_at=?,last_refreshed_at=NULL WHERE user_id=?`)
    .run(config.issuer,identity.subject,config.clientId,identity.email,identity.name,tokens.scope,encrypted.access,encrypted.refresh,encrypted.id,now+tokens.expiresIn*1000,absoluteTime(tokens.earliestRefreshAt,now),revision,tokenVersion,now,userId);
   else db.prepare(`INSERT INTO openai_connections(id,user_id,issuer,subject,client_id,email,display_name,scope,access_token_encrypted,refresh_token_encrypted,id_token_encrypted,access_expires_at,earliest_refresh_at,revision,token_version,connected_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,userId,config.issuer,identity.subject,config.clientId,identity.email,identity.name,tokens.scope,encrypted.access,encrypted.refresh,encrypted.id,now+tokens.expiresIn*1000,absoluteTime(tokens.earliestRefreshAt,now),revision,tokenVersion,now,now);
   audit(db,userId,current?'account.openai.reconnect':'account.openai.connect','user',userId,{issuer:config.issuer});
  });
 }catch(error){
  // 교환 뒤 서명·소유권 검증이 실패하면 저장하지 않은 refresh token도 즉시 폐기한다.
  await revokeOpenAISession(config,tokens.refreshToken,fetchImpl).catch(()=>false);
  throw error;
 }
 return openAIConnection(db,userId);
}

export async function disconnectOpenAI(db:Database,userId:string,config=openAIConnectionConfig(),fetchImpl:FetchLike=fetch){
 const row=db.prepare('SELECT * FROM openai_connections WHERE user_id=?').get(userId) as ConnectionRow|undefined;
 if(!row)throw new AppError(404,'NOT_FOUND','연결된 ChatGPT 계정이 없습니다.');
 let confirmed=false;
 if(config&&config.clientId===row.client_id&&config.issuer===row.issuer){
  try{
   const refresh=decryptOpenAIToken(row.refresh_token_encrypted,`${row.id}:refresh:${row.token_version}`,config.encryptionKey);
   confirmed=await revokeOpenAISession(config,refresh,fetchImpl);
  }catch{
   // 키 교체·손상으로 토큰을 읽지 못해도 회원의 로컬 연결 해제 권리는 보장한다.
   confirmed=false;
  }
 }
 transaction(db,()=>{db.prepare('DELETE FROM openai_connections WHERE user_id=? AND id=?').run(userId,row.id);audit(db,userId,'account.openai.disconnect','user',userId,{remoteRevocationConfirmed:confirmed});});
 return{disconnected:true,remoteRevocationConfirmed:confirmed};
}

export const openAIConnectionStatus=(db:Database,userId:string,config:OpenAIConnectionConfig|null=openAIConnectionConfig())=>({configured:config!==null,connection:openAIConnection(db,userId)});
