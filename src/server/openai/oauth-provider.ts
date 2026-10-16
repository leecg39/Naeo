import {webcrypto} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../errors';
import type {OpenAIConnectionConfig} from './config';

export type FetchLike=(url:string,init?:RequestInit)=>Promise<Response>;
export type OpenAITokenSet={accessToken:string;refreshToken:string;idToken:string;scope:string;expiresIn:number;earliestRefreshAt:number|null};
export type OpenAIRefreshedTokenSet={accessToken:string;refreshToken:string;idToken:string|null;scope:string|null;expiresIn:number;earliestRefreshAt:number|null};
export type OpenAIIdentity={subject:string;email:string;emailVerified:boolean;name:string};

const fail=(code:string,message:string,status=502)=>new AppError(status,code,message);
async function boundedJson(response:Response,max=64*1024):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)return{};const chunks:Uint8Array[]=[];let total=0;
 try{for(;;){const next=await reader.read();if(next.done)break;total+=next.value.length;if(total>max){await reader.cancel();throw fail('OPENAI_RESPONSE_INVALID','OpenAI 인증 응답이 너무 큽니다.');}chunks.push(next.value);}}
 finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('OPENAI_RESPONSE_INVALID','OpenAI 인증 응답을 해석하지 못했습니다.');}
}
async function requestJson(url:string,init:RequestInit,fetchImpl:FetchLike):Promise<unknown>{
 let response:Response;
 try{response=await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(15_000)});}catch{throw fail('OPENAI_UNAVAILABLE','OpenAI 인증 서비스에 연결하지 못했습니다.');}
 const data=await boundedJson(response);
 if(!response.ok)throw fail('OPENAI_EXCHANGE_FAILED','OpenAI가 인증 요청을 거절했습니다.',response.status>=500?502:400);
 return data;
}

const tokenResponse=z.object({access_token:z.string().min(10).max(20_000),refresh_token:z.string().min(10).max(20_000),id_token:z.string().min(20).max(40_000),token_type:z.string().toLowerCase().pipe(z.literal('bearer')),expires_in:z.number().int().min(60).max(86_400),scope:z.string().min(1).max(500),earliest_refresh_at:z.number().int().positive().optional()});
const refreshResponse=z.object({access_token:z.string().min(10).max(20_000),refresh_token:z.string().min(10).max(20_000),id_token:z.string().min(20).max(40_000).optional(),token_type:z.string().toLowerCase().pipe(z.literal('bearer')),expires_in:z.number().int().min(60).max(86_400),scope:z.string().min(1).max(500).optional(),earliest_refresh_at:z.number().int().positive().optional()});
function auth(config:OpenAIConnectionConfig,form:URLSearchParams):Headers{
 const headers=new Headers({'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'});
 if(config.tokenAuthMethod==='client_secret_post')form.set('client_secret',config.clientSecret);
 if(config.tokenAuthMethod==='client_secret_basic')headers.set('Authorization',`Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`);
 return headers;
}
export async function exchangeOpenAICode(config:OpenAIConnectionConfig,input:{code:string;verifier:string},fetchImpl:FetchLike=fetch):Promise<OpenAITokenSet>{
 const form=new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,code:input.code,code_verifier:input.verifier,redirect_uri:config.redirectUri,resource:config.resource});
 const parsed=tokenResponse.safeParse(await requestJson(config.tokenEndpoint,{method:'POST',headers:auth(config,form),body:form},fetchImpl));
 if(!parsed.success)throw fail('OPENAI_RESPONSE_INVALID','OpenAI 토큰 응답 형식이 올바르지 않습니다.');
 const scopes=new Set(parsed.data.scope.split(/\s+/).filter(Boolean));
 if(!scopes.has('chatgpt.tokens.use.direct')||!scopes.has('offline_access'))throw fail('OPENAI_USAGE_SCOPE_REQUIRED','ChatGPT 사용량 권한이 허용되지 않았습니다.',403);
 return{accessToken:parsed.data.access_token,refreshToken:parsed.data.refresh_token,idToken:parsed.data.id_token,scope:[...scopes].sort().join(' '),expiresIn:parsed.data.expires_in,earliestRefreshAt:parsed.data.earliest_refresh_at??null};
}

const TERMINAL_REFRESH=new Set(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']);
/** 회전형 refresh token을 교환한다. terminal=true면 기존 세션은 다시 사용할 수 없다. */
export async function refreshOpenAITokens(config:OpenAIConnectionConfig,refreshToken:string,fetchImpl:FetchLike=fetch):Promise<OpenAIRefreshedTokenSet>{
 const form=new URLSearchParams({grant_type:'refresh_token',client_id:config.clientId,refresh_token:refreshToken,resource:config.resource});
 let response:Response;
 try{response=await fetchImpl(config.tokenEndpoint,{method:'POST',headers:auth(config,form),body:form,redirect:'error',signal:AbortSignal.timeout(15_000)});}
 catch{throw Object.assign(fail('OPENAI_REFRESH_UNAVAILABLE','ChatGPT 연결 갱신 서비스에 연결하지 못했습니다.'),{retryable:true,terminal:false});}
 const data=await boundedJson(response);
 if(!response.ok){
  const code=z.object({error:z.string().max(100).optional()}).passthrough().safeParse(data).data?.error??'';
  const terminal=TERMINAL_REFRESH.has(code);
  throw Object.assign(fail(terminal?'OPENAI_REAUTH_REQUIRED':'OPENAI_REFRESH_FAILED',terminal?'ChatGPT 연결이 만료되었습니다. 다시 연결해주세요.':'ChatGPT 연결을 갱신하지 못했습니다.',terminal?401:response.status>=500?502:400),{retryable:!terminal&&(response.status===429||response.status>=500),terminal});
 }
 const parsed=refreshResponse.safeParse(data);
 if(!parsed.success)throw Object.assign(fail('OPENAI_RESPONSE_INVALID','OpenAI 갱신 응답 형식이 올바르지 않습니다.'),{retryable:false,terminal:false});
 const scope=parsed.data.scope?[...new Set(parsed.data.scope.split(/\s+/).filter(Boolean))].sort().join(' '):null;
 if(scope&&!scope.split(' ').includes('chatgpt.tokens.use.direct'))throw Object.assign(fail('OPENAI_REAUTH_REQUIRED','ChatGPT 사용량 권한이 더 이상 허용되지 않았습니다.',401),{retryable:false,terminal:true});
 return{accessToken:parsed.data.access_token,refreshToken:parsed.data.refresh_token,idToken:parsed.data.id_token??null,scope,expiresIn:parsed.data.expires_in,earliestRefreshAt:parsed.data.earliest_refresh_at??null};
}

const jwtHeader=z.object({alg:z.literal('RS256'),kid:z.string().min(1).max(200)});
const claimsSchema=z.object({iss:z.string(),aud:z.union([z.string(),z.array(z.string())]),azp:z.string().optional(),sub:z.string().min(1).max(200),exp:z.number(),iat:z.number().optional(),nonce:z.string(),email:z.string().email().max(254).optional(),email_verified:z.boolean().optional(),name:z.string().max(100).optional()});
const jwksSchema=z.object({keys:z.array(z.record(z.string(),z.unknown())).max(20)});
export async function verifyOpenAIIdentity(config:OpenAIConnectionConfig,idToken:string,nonce:string,fetchImpl:FetchLike=fetch,now=Date.now()):Promise<OpenAIIdentity>{
 const parts=idToken.split('.');if(parts.length!==3)throw fail('OPENAI_ID_TOKEN_INVALID','OpenAI ID 토큰 형식이 올바르지 않습니다.',400);
 let header:z.infer<typeof jwtHeader>,claims:z.infer<typeof claimsSchema>;
 try{header=jwtHeader.parse(JSON.parse(Buffer.from(parts[0],'base64url').toString()));claims=claimsSchema.parse(JSON.parse(Buffer.from(parts[1],'base64url').toString()));}
 catch{throw fail('OPENAI_ID_TOKEN_INVALID','OpenAI ID 토큰을 해석하지 못했습니다.',400);}
 const jwks=jwksSchema.safeParse(await requestJson(config.jwksEndpoint,{headers:{Accept:'application/json'}},fetchImpl));
 if(!jwks.success)throw fail('OPENAI_JWKS_INVALID','OpenAI 서명 키 응답이 올바르지 않습니다.');
 const jwk=jwks.data.keys.find(key=>key.kid===header.kid&&key.kty==='RSA');if(!jwk)throw fail('OPENAI_ID_TOKEN_INVALID','OpenAI ID 토큰 서명 키를 찾을 수 없습니다.',400);
 let valid:boolean;
 try{const key=await webcrypto.subtle.importKey('jwk',jwk as JsonWebKey,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);valid=await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5',key,Buffer.from(parts[2],'base64url'),Buffer.from(`${parts[0]}.${parts[1]}`));}catch{valid=false;}
 if(!valid)throw fail('OPENAI_ID_TOKEN_INVALID','OpenAI ID 토큰 서명을 확인하지 못했습니다.',400);
 const audience=Array.isArray(claims.aud)?claims.aud:[claims.aud],seconds=Math.floor(now/1000);
 if(claims.iss!==config.issuer||!audience.includes(config.clientId)||(audience.length>1&&claims.azp!==config.clientId)||claims.exp<=seconds-60||(claims.iat??seconds)>seconds+60||claims.nonce!==nonce)throw fail('OPENAI_ID_TOKEN_INVALID','OpenAI ID 토큰 검증에 실패했습니다.',400);
 return{subject:claims.sub,email:claims.email?.toLowerCase()??'',emailVerified:claims.email_verified===true,name:claims.name??claims.email?.split('@')[0]??''};
}

export async function revokeOpenAISession(config:OpenAIConnectionConfig,refreshToken:string,fetchImpl:FetchLike=fetch):Promise<boolean>{
 const form=new URLSearchParams({token:refreshToken,token_type_hint:'refresh_token',client_id:config.clientId});
 let response:Response;
 try{response=await fetchImpl(config.revocationEndpoint,{method:'POST',headers:auth(config,form),body:form,redirect:'error',signal:AbortSignal.timeout(15_000)});}catch{return false;}
 await response.body?.cancel().catch(()=>{});
 return response.status===200;
}
