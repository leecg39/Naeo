import type {Database} from '../database';
import type {User} from '../auth';
import {body,cookieToken,json,rateLimit} from '../http';
import {uploadDir} from '../writing/writing-api';
import {exportInput,requestPersonalExport,listPersonalExports,downloadPersonalExport,deletePersonalExport,cleanupPersonalExports} from './personal-export';
export async function personalExportApi(db:Database,request:Request,user:User){
 const path=new URL(request.url).pathname,token=cookieToken(request)!,method=request.method;
 if(path==='/api/auth/data-exports'){
  if(method==='GET')return json({data:listPersonalExports(db,user.id,token)});
  if(method==='POST'){
   rateLimit(db,`personal-export:${user.id}`,5,60*60_000);
   return json({data:await requestPersonalExport(db,user.id,token,await body(request,exportInput))},202);
  }
 }
 const match=path.match(/^\/api\/auth\/data-exports\/([a-f0-9-]{36})(\/download)?$/);
 if(match){
  if(match[2]&&method==='GET')return downloadPersonalExport(db,uploadDir(),user.id,token,match[1]);
  if(!match[2]&&method==='DELETE'){const data=deletePersonalExport(db,user.id,token,match[1]);cleanupPersonalExports(db,uploadDir());return json({data});}
 }
 return null;
}
