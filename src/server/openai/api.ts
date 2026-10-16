import {z} from 'zod';
import type {Database} from '../database';
import {sessionUser,type User} from '../auth';
import {AppError} from '../errors';
import {appOrigin,clientPeer,cookieToken,json,rateLimit} from '../http';
import {completeOpenAIConnection,disconnectOpenAI,openAIConnectionStatus,startOpenAIConnection} from './connection';

const BINDING='naeo_openai';
const bindingCookie=(value:string,maxAge:number)=>`${BINDING}=${value}; Path=/api/account/openai; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${appOrigin().startsWith('https:')?'; Secure':''}`;
const readBinding=(request:Request)=>(request.headers.get('cookie')||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(`${BINDING}=`))?.slice(BINDING.length+1);
const redirect=(location:string,cookies:string[]=[]):Response=>{
 const headers=new Headers({Location:location,'Cache-Control':'no-store'});
 for(const cookie of cookies)headers.append('Set-Cookie',cookie);
 return new Response(null,{status:302,headers});
};
const errorCode=(error:unknown)=>error instanceof AppError?error.code:error instanceof z.ZodError?'OPENAI_STATE_INVALID':'OPENAI_FAILED';
const settings=(query:string)=>`/dashboard/settings?${query}#openai`;

/** OpenAI가 호출하는 GET 콜백. 로그인 세션과 브라우저 바인딩을 다시 확인한다. */
export async function publicOpenAIApi(db:Database,request:Request):Promise<Response|null>{
 const url=new URL(request.url);
 if(url.pathname!=='/api/account/openai/callback'||request.method!=='GET')return null;
 rateLimit(db,`openai-callback:${clientPeer(request)}`,60,15*60*1000);
 const user=sessionUser(db,cookieToken(request)),clear=bindingCookie('',0);
 if(!user)return redirect(`/login?next=${encodeURIComponent('/dashboard/settings#openai')}&openaiError=OPENAI_LOGIN_REQUIRED`,[clear]);
 try{
  await completeOpenAIConnection(db,user.id,{code:url.searchParams.get('code')??undefined,state:url.searchParams.get('state')??undefined,error:url.searchParams.get('error')??undefined},readBinding(request));
  return redirect(settings('openaiConnected=1'),[clear]);
 }catch(error){
  return redirect(settings(`openaiError=${encodeURIComponent(errorCode(error))}`),[clear]);
 }
}

/** 로그인 회원의 연결 상태, 연결 시작, 연결 해제 API. */
export async function memberOpenAIApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path}=new URL(request.url),method=request.method;
 if(path==='/api/account/openai'&&method==='GET')return json({data:openAIConnectionStatus(db,user.id)});
 if(path==='/api/account/openai/start'&&method==='GET'){
  rateLimit(db,`openai-start:${user.id}`,20,15*60*1000);
  const started=startOpenAIConnection(db,user.id);
  return redirect(started.url,[bindingCookie(started.binding,600)]);
 }
 if(path==='/api/account/openai'&&method==='DELETE'){
  rateLimit(db,`openai-disconnect:${user.id}`,10,15*60*1000);
  return json({data:await disconnectOpenAI(db,user.id)});
 }
 return null;
}
