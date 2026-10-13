import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import type {Database} from '../database';
import {requireAdmin,type User} from '../auth';
import {appOrigin,body,clientPeer,json,rateLimit} from '../http';
import {analyticsSummary,recordDwell,recordView,shouldTrack} from './analytics';
import {serviceHealth} from './health';

const VISITOR='naeo_vid';
const readVisitor=(request:Request)=>(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${VISITOR}=`))?.slice(VISITOR.length+1);
const visitorCookie=(id:string)=>`${VISITOR}=${id}; Path=/api/analytics; HttpOnly; SameSite=Lax; Max-Age=${365*86400}${appOrigin().startsWith('https:')?'; Secure':''}`;
const viewBody=z.object({path:z.string().max(500),referrer:z.string().max(1000).default('')}).strict();

/** 방문·체류 기록(로그인 불필요). 추적 거부·봇·관리 경로는 기록하지 않고 204. 방문자 id는 서버가 발급한 무작위 쿠키만 쓴다. */
export async function publicAnalyticsApi(db:Database,request:Request):Promise<Response|null>{
 const {pathname:path}=new URL(request.url);
 if(request.method!=='POST'||!['/api/analytics/view','/api/analytics/dwell'].includes(path))return null;
 rateLimit(db,`analytics:${clientPeer(request)}`,600,15*60*1000);
 if(path==='/api/analytics/dwell'){recordDwell(db,await body(request,z.unknown(),2048));return new Response(null,{status:204});}
 const v=await body(request,viewBody,4096);
 if(!shouldTrack({path:v.path,userAgent:request.headers.get('user-agent'),dnt:request.headers.get('dnt'),gpc:request.headers.get('sec-gpc')}))return new Response(null,{status:204});
 const existing=readVisitor(request),visitorId=existing&&/^[A-Za-z0-9_-]{16,64}$/.test(existing)?existing:randomBytes(18).toString('base64url');
 const view=recordView(db,{path:v.path,visitorId,referrer:v.referrer});
 return json({data:{viewId:view.id}},201,existing===visitorId?undefined:{'Set-Cookie':visitorCookie(visitorId)});
}
/** 관리자: 방문 통계와 서비스 상태. */
export function adminOpsApi(db:Database,request:Request,user:User):Response|null{
 const {pathname:path,searchParams}=new URL(request.url);
 if(request.method!=='GET')return null;
 if(path==='/api/admin/analytics'){requireAdmin(user);return json({data:analyticsSummary(db,user.id,Object.fromEntries(searchParams))});}
 if(path==='/api/admin/health'){requireAdmin(user);return json({data:serviceHealth(db,user.id)});}
 return null;
}
