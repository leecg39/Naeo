import {z} from 'zod';
import type {Database} from '../database';
import type {User} from '../auth';
import {body,json,rateLimit} from '../http';
import {AppError} from '../errors';
import {citationConfig} from './provider';
import {cancelCitationRun,citationDetail,citationOverview,enqueueCitation,getCitationRun,markCitationViewed} from './runs';
import {removePostKeyword,setPostKeyword} from './keywords';

const ID='([a-f0-9-]{36})';
const anyJson=z.unknown();
const overviewQuery=z.object({blogId:z.uuid().optional()}).strict();
const notAllowed=()=>new AppError(405,'METHOD_NOT_ALLOWED','지원하지 않는 요청 방식입니다.');

/** 회원 AI 인용 확인 API. 해당 경로가 아니면 null. 입력 검증은 서비스 함수의 strict 스키마가 맡는다. */
export async function citationApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 if(path!=='/api/citations'&&!path.startsWith('/api/citations/'))return null;
 if(path==='/api/citations'){
  if(method!=='GET')throw notAllowed();
  return json({data:citationOverview(db,user.id,{...overviewQuery.parse(Object.fromEntries(searchParams)),config:citationConfig()})});
 }
 if(path==='/api/citations/runs'){
  if(method!=='POST')throw notAllowed();
  rateLimit(db,`citation:${user.id}`,20,60*60*1000);
  return json({data:enqueueCitation(db,user.id,await body(request,anyJson),{source:'member',config:citationConfig()})},201);
 }
 const run=path.match(new RegExp(`^/api/citations/runs/${ID}(/cancel)?$`));
 if(run){
  if(!run[2]&&method==='GET')return json({data:getCitationRun(db,user.id,run[1])});
  if(run[2]&&method==='POST')return json({data:cancelCitationRun(db,user.id,run[1])});
  throw notAllowed();
 }
 const result=path.match(new RegExp(`^/api/citations/results/${ID}(/viewed)?$`));
 if(result){
  if(!result[2]&&method==='GET')return json({data:citationDetail(db,user.id,result[1])});
  if(result[2]&&method==='POST')return json({data:markCitationViewed(db,user.id,result[1])});
  throw notAllowed();
 }
 const post=path.match(new RegExp(`^/api/citations/keywords/${ID}$`));
 if(post){
  if(method==='PUT')return json({data:setPostKeyword(db,user.id,post[1],await body(request,anyJson))});
  if(method==='DELETE')return json({data:removePostKeyword(db,user.id,post[1],await body(request,anyJson))});
  throw notAllowed();
 }
 throw new AppError(404,'NOT_FOUND','요청한 API를 찾을 수 없습니다.');
}
