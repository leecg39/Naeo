import {z} from 'zod';
import type {Database} from '../database';
import {requireAdmin,type User} from '../auth';
import {body,json,rateLimit} from '../http';
import {grantCredits,ledger} from '../credits/ledger';
import {cancelGeneration,getGeneration,listGenerations,providerConfig,requestGeneration} from './generation';
import {activeTemplates,createWritingTemplate,deleteWritingTemplate,listAdminTemplates,updateWritingTemplate} from './templates';
import {adminCancelGeneration,listAdminGenerations} from './admin-generations';

const ID='([a-f0-9-]{36})';
const anyJson=z.unknown();
const grantInput=z.object({userId:z.uuid(),delta:z.number(),note:z.string()}).strict();

/** 토큰 잔액·원장, 관리자 지급, AI 글 생성 요청·조회·취소. */
export async function generationApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 if(path==='/api/credits'&&method==='GET')return json(ledger(db,user.id,Object.fromEntries(searchParams)));
 if(path==='/api/writing-templates'&&method==='GET')return json({data:activeTemplates(db)});
 const admin=await adminWritingRoutes(db,request,user,path,method,searchParams);
 if(admin)return admin;
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

/** /admin/writing: 글쓰기 템플릿 CRUD, 전체 생성 작업 조회·취소. */
async function adminWritingRoutes(db:Database,request:Request,user:User,path:string,method:string,params:URLSearchParams):Promise<Response|null>{
 if(!path.startsWith('/api/admin/writing-templates')&&!path.startsWith('/api/admin/generations'))return null;
 requireAdmin(user);
 if(path==='/api/admin/writing-templates'){
  if(method==='GET')return json({data:listAdminTemplates(db,user.id)});
  if(method==='POST')return json({data:createWritingTemplate(db,user.id,await body(request,anyJson))},201);
 }
 const tpl=path.match(new RegExp(`^/api/admin/writing-templates/${ID}$`));
 if(tpl&&method==='PATCH')return json({data:updateWritingTemplate(db,user.id,tpl[1],await body(request,anyJson))});
 if(tpl&&method==='DELETE')return json({data:deleteWritingTemplate(db,user.id,tpl[1],await body(request,anyJson))});
 if(path==='/api/admin/generations'&&method==='GET')return json(listAdminGenerations(db,user.id,Object.fromEntries(params)));
 const cancel=path.match(new RegExp(`^/api/admin/generations/${ID}/cancel$`));
 if(cancel&&method==='POST')return json({data:adminCancelGeneration(db,user.id,cancel[1])});
 return null;
}
