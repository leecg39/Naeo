import {z} from 'zod';
import type {Database} from '../database';
import type {User} from '../auth';
import {body,json,readRequestBytes} from '../http';
import {AppError} from '../errors';
import {checkIn,finishTutorial,points,removeSubTopic,saveSubTopic,subTopic,tutorial,visitRanking} from './service';

const finish=z.object({step:z.enum(['blog','mate','ai_picks','ranking','verify'])}).strict();
const topic=z.object({subTopic:z.string().trim().min(1).max(50),version:z.number().int().min(0)}).strict();
const version=z.object({version:z.number().int().min(0)}).strict();
async function noPayload(request:Request){
 // Endpoints without inputs reject injected member/date/reward fields, including chunked bodies.
 const bytes=await readRequestBytes(request,1024);
 if(bytes.length===0)return;
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw new AppError(415,'JSON_REQUIRED','JSON 형식으로 요청해주세요.');
 let value:unknown;
 try{value=JSON.parse(bytes.toString('utf8'));}catch{throw new AppError(400,'INVALID_JSON','올바른 JSON이 아닙니다.');}
 z.object({}).strict().parse(value);
}
export async function engagementApi(db:Database,request:Request,user:User){
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 if(!['/api/points','/api/attendance','/api/tutorial','/api/tutorial/finish','/api/tutorial/ranking-visit','/api/tutorial/sub-topic'].includes(path))return null;
 if(path==='/api/points'&&method==='GET')return json({data:points(db,user.id,Object.fromEntries(searchParams))});
 if(path==='/api/attendance'&&method==='POST'){await noPayload(request);return json({data:checkIn(db,user.id)});}
 if(path==='/api/tutorial'&&method==='GET')return json({data:tutorial(db,user.id)});
 if(path==='/api/tutorial/finish'&&method==='POST')return json({data:finishTutorial(db,user.id,await body(request,finish))});
 if(path==='/api/tutorial/ranking-visit'&&method==='POST'){await noPayload(request);return json({data:visitRanking(db,user.id)});}
 if(path==='/api/tutorial/sub-topic'){
  if(method==='GET')return json({data:subTopic(db,user.id)});
  if(method==='PUT')return json({data:saveSubTopic(db,user.id,await body(request,topic))});
  if(method==='DELETE')return json({data:removeSubTopic(db,user.id,await body(request,version))});
 }
 throw new AppError(405,'METHOD_NOT_ALLOWED','지원하지 않는 요청 방식입니다.');
}
