import {z} from 'zod';
import type {Database} from '../database';
import {requireAdmin,type User} from '../auth';
import {body,json,rateLimit} from '../http';
import {cancelScan,enqueueScan,getScan,listScans,retryScan} from './queue';
import {latestScanResult,listScanResults} from '../analysis/results';
import {adminCancelScan,adminRetryScan,listAdminScans,scanHealth} from './admin-scans';

const ID='([a-f0-9-]{36})';
const anyJson=z.unknown();

/** 회원 진단 작업 API와 관리자 작업 상태 API. 해당 경로가 아니면 null. */
export async function scanApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 const input=()=>body(request,anyJson);
 if(path.startsWith('/api/admin/scan')){
  requireAdmin(user);
  if(path==='/api/admin/scan-health'&&method==='GET')return json({data:scanHealth(db,user.id)});
  if(path==='/api/admin/scans'&&method==='GET')return json(listAdminScans(db,user.id,Object.fromEntries(searchParams)));
  const action=path.match(new RegExp(`^/api/admin/scans/${ID}/(cancel|retry)$`));
  if(action&&method==='POST')return action[2]==='cancel'?json({data:adminCancelScan(db,user.id,action[1])}):json({data:adminRetryScan(db,user.id,action[1])},201);
  return null;
 }
 const results=path.match(new RegExp(`^/api/blogs/${ID}/scan-results(/latest)?$`));
 if(results&&method==='GET')return results[2]?json({data:latestScanResult(db,user.id,results[1])}):json(listScanResults(db,user.id,results[1],Object.fromEntries(searchParams)));
 if(path!=='/api/scans'&&!path.startsWith('/api/scans/'))return null;
 if(path==='/api/scans'){
  if(method==='GET')return json(listScans(db,user.id,Object.fromEntries(searchParams)));
  if(method==='POST'){rateLimit(db,`scan:${user.id}`,20,60*60*1000);return json({data:enqueueScan(db,user.id,await input())},201);}
 }
 const one=path.match(new RegExp(`^/api/scans/${ID}$`));
 if(one&&method==='GET')return json({data:getScan(db,user.id,one[1])});
 const action=path.match(new RegExp(`^/api/scans/${ID}/(cancel|retry)$`));
 if(action&&method==='POST'){
  if(action[2]==='cancel')return json({data:cancelScan(db,user.id,action[1])});
  rateLimit(db,`scan:${user.id}`,20,60*60*1000);
  return json({data:retryScan(db,user.id,action[1],await input())},201);
 }
 return null;
}
