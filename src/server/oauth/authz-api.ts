import {z} from 'zod';
import type {Database} from '../database';
import type {User} from '../auth';
import {AppError} from '../errors';
import {body,clientPeer,json,rateLimit} from '../http';
import {decideAuthorization,exchangeToken,listAuthorizedApps,registerClient,revokeAppForUser,revokeToken} from './authz';

/** 서버 간 호출이라 Origin 검사를 하지 않는 경로(본문의 일회 코드·PKCE·토큰으로 인증). */
export const SERVER_TO_SERVER=['/api/oauth/register','/api/oauth/token','/api/oauth/revoke','/api/mcp'];
const MAX=16*1024;
/** OAuth 요청 본문: application/x-www-form-urlencoded(표준) 또는 JSON. */
async function readForm(request:Request):Promise<Record<string,unknown>>{
 const type=request.headers.get('content-type')||'';
 const text=await request.text();
 if(text.length>MAX)throw new AppError(413,'invalid_request','요청이 너무 큽니다.');
 if(/application\/json/i.test(type)){try{return JSON.parse(text) as Record<string,unknown>;}catch{throw new AppError(400,'invalid_request','JSON이 올바르지 않습니다.');}}
 return Object.fromEntries(new URLSearchParams(text));
}
/** RFC 6749 5.2 형식의 오류 응답. */
function oauthJson(action:()=>unknown,status=200):Response{
 try{return json(action(),status,{Pragma:'no-cache'});}
 catch(e){
  if(e instanceof AppError)return json({error:e.code.toLowerCase(),error_description:e.message},e.status===401?401:400,{Pragma:'no-cache'});
  if(e instanceof z.ZodError)return json({error:'invalid_request',error_description:'입력 형식이 올바르지 않습니다.'},400);
  throw e;
 }
}

export async function publicAuthzApi(db:Database,request:Request):Promise<Response|null>{
 const {pathname:path}=new URL(request.url);
 if(request.method!=='POST'||!['/api/oauth/register','/api/oauth/token','/api/oauth/revoke'].includes(path))return null;
 rateLimit(db,`oauth-server:${clientPeer(request)}`,path==='/api/oauth/register'?20:300,15*60*1000);
 const input=await readForm(request);
 if(path==='/api/oauth/register')return oauthJson(()=>registerClient(db,input),201);
 if(path==='/api/oauth/token')return oauthJson(()=>exchangeToken(db,input));
 return oauthJson(()=>revokeToken(db,input));
}

/** 회원: 동의 화면의 승인/거부(사이트 Origin 필요), 연결된 앱 목록·해제. */
export async function memberAuthzApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path}=new URL(request.url),method=request.method;
 if(path==='/api/oauth/authorize'&&method==='POST'){
  rateLimit(db,`oauth-authorize:${user.id}`,60,15*60*1000);
  return json({data:{redirect:decideAuthorization(db,user.id,await body(request,z.record(z.string(),z.string().max(500))))}});
 }
 if(path==='/api/account/apps'&&method==='GET')return json({data:listAuthorizedApps(db,user.id)});
 const app=path.match(/^\/api\/account\/apps\/([A-Za-z0-9_-]{8,80})$/);
 if(app&&method==='DELETE')return json({data:revokeAppForUser(db,user.id,app[1])});
 return null;
}
