import {queueReplyMail} from './mail';
import {mailConfig} from '../mail/provider';
import {z} from 'zod';
import type {Database} from '../database';
import {requireAdmin,sessionUser,type User} from '../auth';
import {body,clientPeer,cookieToken,json,rateLimit} from '../http';
import {createInquiry,deleteMyInquiry,getMyInquiry,listMyInquiries,updateMyInquiry} from './inquiries';
import {addReply,deleteInquiry,deleteReply,getAdminInquiry,listAdminInquiries,updateInquiryStatus,updateReply} from './admin-inquiries';
import {createTemplate,deleteTemplate,listTemplates,updateTemplate} from './templates';

const anyJson=z.unknown();
const ID='([a-f0-9-]{36})';
const FIFTEEN_MINUTES=15*60*1000,HOUR=60*60*1000;

/**
 * 로그인 없이 받는 유일한 쓰기 요청이다. 접속 주소별·회신 이메일별로 횟수를 제한한다.
 * 비회원에게는 저장한 내용을 돌려주지 않는다(다른 사람 이메일로 접수해도 내용 확인 불가).
 */
export async function publicInquiryApi(db:Database,request:Request):Promise<Response|null>{
 if(new URL(request.url).pathname!=='/api/inquiries'||request.method!=='POST')return null;
 const input=await body(request,anyJson);
 rateLimit(db,`inquiry:peer:${clientPeer(request)}`,30,FIFTEEN_MINUTES);
 const parsed=z.looseObject({email:z.string()}).safeParse(input);
 if(parsed.success)rateLimit(db,`inquiry:email:${parsed.data.email.trim().toLowerCase()}`,5,HOUR);
 const user=sessionUser(db,cookieToken(request));
 const created=createInquiry(db,user,input);
 return json({data:created.ownerId?created:{received:true}},201);
}

export async function inquiryApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 const input=()=>body(request,anyJson);
 if(path==='/api/inquiries'&&method==='GET')return json(listMyInquiries(db,user.id,Object.fromEntries(searchParams)));
 const mine=path.match(new RegExp(`^/api/inquiries/${ID}$`));
 if(mine){
  if(method!=='GET')rateLimit(db,`inquiry:member:${user.id}`,60,FIFTEEN_MINUTES);
  if(method==='GET')return json({data:getMyInquiry(db,user.id,mine[1])});
  if(method==='PATCH')return json({data:updateMyInquiry(db,user.id,mine[1],await input())});
  if(method==='DELETE')return json({data:deleteMyInquiry(db,user.id,mine[1],await input())});
 }
 if(!path.startsWith('/api/admin/inquiries')&&!path.startsWith('/api/admin/inquiry-templates'))return null;
 requireAdmin(user);
 if(method!=='GET')rateLimit(db,`inquiry:admin:${user.id}`,300,FIFTEEN_MINUTES);
 return adminRoutes(db,path,method,searchParams,user.id,input);
}

async function adminRoutes(db:Database,path:string,method:string,searchParams:URLSearchParams,actorId:string,input:()=>Promise<unknown>):Promise<Response|null>{
 if(path==='/api/admin/inquiries'&&method==='GET')return json(listAdminInquiries(db,actorId,Object.fromEntries(searchParams)));
 const inquiry=path.match(new RegExp(`^/api/admin/inquiries/${ID}$`));
 if(inquiry){
  if(method==='GET')return json({data:getAdminInquiry(db,actorId,inquiry[1])});
  if(method==='PATCH')return json({data:updateInquiryStatus(db,actorId,inquiry[1],await input())});
  if(method==='DELETE')return json({data:deleteInquiry(db,actorId,inquiry[1],await input())});
 }
 const replies=path.match(new RegExp(`^/api/admin/inquiries/${ID}/replies$`));
 if(replies&&method==='POST')return json({data:addReply(db,actorId,replies[1],await input())},201);
 const send=path.match(new RegExp(`^/api/admin/inquiries/${ID}/replies/${ID}/send$`));
 if(send&&method==='POST'){queueReplyMail(db,actorId,send[1],send[2],await input(),mailConfig());return json({data:getAdminInquiry(db,actorId,send[1])},202);}
 const reply=path.match(new RegExp(`^/api/admin/inquiries/${ID}/replies/${ID}$`));
 if(reply){
  if(method==='PATCH')return json({data:updateReply(db,actorId,reply[1],reply[2],await input())});
  if(method==='DELETE')return json({data:deleteReply(db,actorId,reply[1],reply[2],await input())});
 }
 if(path==='/api/admin/inquiry-templates'){
  if(method==='GET')return json({data:listTemplates(db,actorId)});
  if(method==='POST')return json({data:createTemplate(db,actorId,await input())},201);
 }
 const tpl=path.match(new RegExp(`^/api/admin/inquiry-templates/${ID}$`));
 if(tpl){
  if(method==='PATCH')return json({data:updateTemplate(db,actorId,tpl[1],await input())});
  if(method==='DELETE')return json({data:deleteTemplate(db,actorId,tpl[1],await input())});
 }
 return null;
}
