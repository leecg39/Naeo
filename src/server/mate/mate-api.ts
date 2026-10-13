import {z} from 'zod';
import type {Database} from '../database';
import type {User} from '../auth';
import {AppError} from '../errors';
import {body,clientPeer,json} from '../http';
import {deleteMateReport,diagnoseBlog,getMateReport,listMyMateReports} from './mate';

const TOKEN='([A-Za-z0-9_-]{22})';
const diagnoseInput=z.object({blog:z.string().max(300)}).strict();

/** 로그인 없이 쓰는 무료 진단(생성·공유 읽기). 로그인 회원이면 기록을 연결한다. */
export async function publicMateApi(db:Database,request:Request,user:User|null):Promise<Response|null>{
 const {pathname:path}=new URL(request.url),method=request.method;
 if(path==='/api/mate/diagnose'&&method==='POST'){
  const input=await body(request,diagnoseInput);
  return json({data:await diagnoseBlog(db,{blog:input.blog,peer:clientPeer(request),userId:user?.id??null})},201);
 }
 const read=path.match(new RegExp(`^/api/mate/reports/${TOKEN}$`));
 if(read&&method==='GET'){
  const report=getMateReport(db,read[1]);
  if(!report)throw new AppError(404,'NOT_FOUND','진단 리포트를 찾을 수 없거나 공유 기간(30일)이 지났습니다.');
  return json({data:report});
 }
 return null;
}

/** 내 진단 기록 목록·삭제(로그인 필요). */
export function memberMateApi(db:Database,request:Request,user:User):Response|null{
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 if(path==='/api/mate/reports'&&method==='GET')return json(listMyMateReports(db,user.id,Object.fromEntries(searchParams)));
 const one=path.match(new RegExp(`^/api/mate/reports/${TOKEN}$`));
 if(one&&method==='DELETE')return json({data:deleteMateReport(db,user.id,one[1])});
 return null;
}
