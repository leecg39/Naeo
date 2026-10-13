import {z} from 'zod';
import type {Database} from '../database';
import {requireAdmin,type User} from '../auth';
import {AppError} from '../errors';
import {body,json,rateLimit} from '../http';
import {createEvent,deleteEvent,getPublicEvent,listAdminEvents,listPublicEvents,updateEvent} from './events';
import {listEventEntries,myEntries,myEventEntry,reviewEntry,submitEntry,updateMyEntry,withdrawEntry} from './entries';
import {grantRankingRewards,grantReward,listRewards,myRewards,revokeReward} from './rewards';

const anyJson=z.unknown();
const ID='([a-f0-9-]{36})',SLUG='([a-z0-9][a-z0-9-]{1,59})';
const match=(path:string,pattern:string)=>path.match(new RegExp(`^${pattern}$`));

/** 로그인 없이 보는 이벤트 목록·상세(초안 제외). */
export function publicEventsApi(db:Database,request:Request):Response|null{
 const {pathname:path}=new URL(request.url);
 if(request.method!=='GET')return null;
 if(path==='/api/events')return json({data:listPublicEvents(db)});
 const one=match(path,`/api/events/${SLUG}`);
 if(one){const e=getPublicEvent(db,one[1]);if(!e)throw new AppError(404,'NOT_FOUND','이벤트를 찾을 수 없습니다.');return json({data:e});}
 return null;
}

/** 회원 참여: 내 참여 조회·제출·수정·철회, 내 리워드. */
export async function memberEventsApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path}=new URL(request.url),method=request.method;
 const input=()=>body(request,anyJson);
 if(method!=='GET'&&(path.startsWith('/api/events/')||path.startsWith('/api/event-entries/')))rateLimit(db,`events:${user.id}`,60,15*60*1000);
 if(path==='/api/me/events'&&method==='GET')return json({data:{entries:myEntries(db,user.id),rewards:myRewards(db,user.id)}});
 const mine=match(path,`/api/events/${SLUG}/entry`);
 if(mine&&method==='GET')return json({data:myEventEntry(db,user.id,mine[1])});
 const submit=match(path,`/api/events/${SLUG}/entries`);
 if(submit&&method==='POST')return json({data:submitEntry(db,user.id,submit[1],await input())},201);
 const entry=match(path,`/api/event-entries/${ID}`);
 if(entry&&method==='PATCH')return json({data:updateMyEntry(db,user.id,entry[1],await input())});
 const withdraw=match(path,`/api/event-entries/${ID}/withdraw`);
 if(withdraw&&method==='POST')return json({data:withdrawEntry(db,user.id,withdraw[1],await input())});
 return null;
}

/** 관리자: 이벤트 CRUD, 참여 심사, 리워드 지급·회수, 랭킹 리워드. */
export async function adminEventsApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 if(!['/api/admin/events','/api/admin/event-entries','/api/admin/rewards'].some(p=>path===p||path.startsWith(p+'/')))return null;
 requireAdmin(user);
 if(method!=='GET')rateLimit(db,`admin-events:${user.id}`,300,15*60*1000);
 const query=Object.fromEntries(searchParams),input=()=>body(request,anyJson);
 if(path==='/api/admin/events'){
  if(method==='GET')return json(listAdminEvents(db,user.id,query));
  if(method==='POST')return json({data:createEvent(db,user.id,await input())},201);
 }
 const ev=match(path,`/api/admin/events/${ID}`);
 if(ev){
  if(method==='PATCH')return json({data:updateEvent(db,user.id,ev[1],await input())});
  if(method==='DELETE')return json({data:deleteEvent(db,user.id,ev[1],await input())});
 }
 if(path==='/api/admin/event-entries'&&method==='GET'){const {slug,...rest}=query;return json(listEventEntries(db,user.id,slug??'',rest));}
 const review=match(path,`/api/admin/event-entries/${ID}/review`);
 if(review&&method==='POST')return json({data:reviewEntry(db,user.id,review[1],await input())});
 if(path==='/api/admin/rewards'){
  if(method==='GET')return json(listRewards(db,user.id,query));
  if(method==='POST')return json({data:grantReward(db,user.id,await input())},201);
 }
 if(path==='/api/admin/rewards/ranking'&&method==='POST')return json({data:grantRankingRewards(db,user.id,await input())});
 const revoke=match(path,`/api/admin/rewards/${ID}/revoke`);
 if(revoke&&method==='POST')return json({data:revokeReward(db,user.id,revoke[1],await input())});
 return null;
}
