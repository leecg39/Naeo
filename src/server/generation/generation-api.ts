import {z} from 'zod';
import type {Database} from '../database';
import {requireAdmin,type User} from '../auth';
import {body,json,rateLimit} from '../http';
import {grantCredits,ledger} from '../credits/ledger';
import {cancelGeneration,getGeneration,listGenerations,providerConfig,requestGeneration} from './generation';

const ID='([a-f0-9-]{36})';
const anyJson=z.unknown();
const grantInput=z.object({userId:z.uuid(),delta:z.number(),note:z.string()}).strict();

/** 토큰 잔액·원장, 관리자 지급, AI 글 생성 요청·조회·취소. */
export async function generationApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 if(path==='/api/credits'&&method==='GET')return json(ledger(db,user.id,Object.fromEntries(searchParams)));
 if(path==='/api/admin/credits'&&method==='POST'){
  requireAdmin(user);
  const {userId,...rest}=await body(request,grantInput);
  return json({data:grantCredits(db,user.id,userId,rest)});
 }
 if(path==='/api/generations'){
  if(method==='GET')return json(listGenerations(db,user.id,Object.fromEntries(searchParams)));
  if(method==='POST'){rateLimit(db,`generation:${user.id}`,30,60*60_000);return json({data:requestGeneration(db,user.id,await body(request,anyJson),providerConfig())},201);}
 }
 const one=path.match(new RegExp(`^/api/generations/${ID}$`));
 if(one&&method==='GET')return json({data:getGeneration(db,user.id,one[1])});
 const cancel=path.match(new RegExp(`^/api/generations/${ID}/cancel$`));
 if(cancel&&method==='POST')return json({data:cancelGeneration(db,user.id,cancel[1])});
 return null;
}
