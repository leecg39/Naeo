import {z} from 'zod';
import type {Database} from '../database';
import {sessionUser,tokenHash,type User} from '../auth';
import {AppError} from '../errors';
import {appOrigin,body,cookieToken,json,rateLimit,sessionCookie,clientPeer} from '../http';
import {completeOAuth,hasPassword,listConnections,setInitialPassword,startOAuth,unlinkProvider} from './oauth';
import {oauthConfig,PROVIDERS,type OAuthProviderName} from './providers';

const BINDING='naeo_oauth';
const bindingCookie=(value:string,maxAge:number)=>`${BINDING}=${value}; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${appOrigin().startsWith('https:')?'; Secure':''}`;
const readBinding=(request:Request)=>(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${BINDING}=`))?.slice(BINDING.length+1);
function redirect(location:string,cookies:string[]=[]):Response{
 const h=new Headers({Location:location,'Cache-Control':'no-store'});
 for(const c of cookies)h.append('Set-Cookie',c);
 return new Response(null,{status:302,headers:h});
}
const providerOf=(v:string):OAuthProviderName=>{if(!(PROVIDERS as string[]).includes(v))throw new AppError(404,'NOT_FOUND','지원하지 않는 로그인 방식입니다.');return v as OAuthProviderName;};
const codeOf=(e:unknown)=>e instanceof AppError?e.code:e instanceof z.ZodError?'OAUTH_STATE_INVALID':'OAUTH_FAILED';

/** 로그인 없이: OAuth 시작(브라우저 묶음 쿠키 발급)과 콜백(로그인·가입·연결 후 이동). 실패는 오류 코드와 함께 돌려보낸다. */
export async function publicOAuthApi(db:Database,request:Request):Promise<Response|null>{
 const url=new URL(request.url);
 const m=url.pathname.match(/^\/api\/auth\/oauth\/([a-z]+)\/(start|callback)$/);
 if(!m||request.method!=='GET')return null;
 const provider=providerOf(m[1]);
 rateLimit(db,`oauth:${clientPeer(request)}`,60,15*60*1000);
 const viewer=sessionUser(db,cookieToken(request));
 const back=(code:string)=>viewer?`/dashboard/settings?oauthError=${code}#connections`:`/login?oauthError=${code}`;
 if(m[2]==='start'){
  const intent=url.searchParams.get('intent')==='link'?'link':'login';
  if(intent==='link'&&!viewer)return redirect('/login?next=%2Fdashboard%2Fsettings');
  try{
   const s=startOAuth(db,provider,{intent,userId:viewer?.id,next:url.searchParams.get('next')??undefined});
   return redirect(s.url,[bindingCookie(s.binding,600)]);
  }catch(e){return redirect(back(codeOf(e)));}
 }
 try{
  const done=await completeOAuth(db,provider,Object.fromEntries(url.searchParams),readBinding(request));
  const clear=bindingCookie('',0);
  if(done.kind==='linked')return redirect(`${done.next.split('#')[0]}${done.next.includes('?')?'&':'?'}oauthLinked=${provider}#connections`,[clear]);
  return redirect(done.needsTerms?`/auth/terms?next=${encodeURIComponent(done.next)}`:done.next,[clear,sessionCookie(done.session!.token)]);
 }catch(e){return redirect(back(codeOf(e)),[bindingCookie('',0)]);}
}

/** 회원: 연결 목록·해제, OAuth 가입 회원의 첫 비밀번호. */
export async function memberOAuthApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path}=new URL(request.url),method=request.method;
 if(path==='/api/account/oauth'&&method==='GET')return json({data:{connections:listConnections(db,user.id),hasPassword:hasPassword(db,user.id),configured:Object.fromEntries(PROVIDERS.map(p=>[p,oauthConfig(p)!==null]))}});
 const unlink=path.match(/^\/api\/account\/oauth\/([a-z]+)$/);
 if(unlink&&method==='DELETE')return json({data:unlinkProvider(db,user.id,providerOf(unlink[1]))});
 if(path==='/api/account/password/initial'&&method==='POST'){
  rateLimit(db,`password-initial:${user.id}`,10,15*60*1000);
  const session=db.prepare('SELECT created_at AS createdAt FROM sessions WHERE token_hash=?').get(tokenHash(cookieToken(request)??'')) as {createdAt:number}|undefined;
  return json({data:await setInitialPassword(db,user.id,session?.createdAt??0,await body(request,z.unknown()))});
 }
 return null;
}
