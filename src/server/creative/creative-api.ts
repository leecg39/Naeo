import {z} from 'zod';
import type {Database} from '../database';
import type {User} from '../auth';
import {body,json,rateLimit} from '../http';
import {addSlide,createProject,deleteProject,deleteSlide,duplicateProject,duplicateSlide,getProject,listProjects,moveSlide,updateProject,updateSlide} from './projects';
import {slideSvg} from './svg';
import {addPage,completeExport,listExports,MAX_PAGE_BYTES,readExportFile,startExport} from './exports';
import {AppError} from '../errors';
import {uploadDir} from '../writing/writing-api';

/** PNG 본문(최대 12MB)을 그대로 읽는다. */
async function pngBody(request:Request):Promise<Buffer>{
 if(!/^image\/png$/i.test(request.headers.get('content-type')||''))throw new AppError(415,'PNG_REQUIRED','image/png로 보내주세요.');
 if(Number(request.headers.get('content-length')||0)>MAX_PAGE_BYTES)throw new AppError(413,'PAGE_TOO_LARGE','페이지 이미지가 너무 큽니다.');
 const buf=Buffer.from(await request.arrayBuffer());
 if(buf.length>MAX_PAGE_BYTES)throw new AppError(413,'PAGE_TOO_LARGE','페이지 이미지가 너무 큽니다.');
 return buf;
}
const download=(f:{bytes:Buffer;mime:string;filename:string})=>new Response(new Uint8Array(f.bytes),{headers:{'Content-Type':f.mime,'Content-Disposition':`attachment; filename="naeo-export.${f.filename.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});

const ID='([a-f0-9-]{36})';
const m=(path:string,p:string)=>path.match(new RegExp(`^/api/creative/projects${p}$`));
/** SVG 미리보기: 내 슬라이드만, 스크립트 실행을 막는 헤더와 함께. */
function svgResponse(svg:string){return new Response(svg,{headers:{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"}});}

export async function creativeApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path}=new URL(request.url),method=request.method;
 if(!path.startsWith('/api/creative/'))return null;
 if(method!=='GET')rateLimit(db,`creative:${user.id}`,300,15*60*1000);
 const input=()=>body(request,z.unknown());
 if(path==='/api/creative/projects'){
  if(method==='GET')return json({data:listProjects(db,user.id)});
  if(method==='POST')return json({data:createProject(db,user.id,await input())},201);
 }
 let r=m(path,`/${ID}`);
 if(r){
  if(method==='GET')return json({data:getProject(db,user.id,r[1])});
  if(method==='PATCH')return json({data:updateProject(db,user.id,r[1],await input())});
  if(method==='DELETE')return json({data:deleteProject(db,user.id,r[1],await input())});
 }
 if((r=m(path,`/${ID}/exports`))){
  if(method==='GET')return json({data:listExports(db,user.id,r[1])});
  if(method==='POST'){rateLimit(db,`export:${user.id}`,20,60*60*1000);return json({data:startExport(db,user.id,r[1],await input())},201);}
 }
 const page=path.match(new RegExp(`^/api/creative/exports/${ID}/pages/(\\d{1,2})$`));
 if(page&&method==='PUT')return json({data:addPage(db,uploadDir(),user.id,page[1],Number(page[2]),await pngBody(request))});
 const done=path.match(new RegExp(`^/api/creative/exports/${ID}/complete$`));
 if(done&&method==='POST')return json({data:completeExport(db,uploadDir(),user.id,done[1])});
 const file=path.match(new RegExp(`^/api/creative/exports/${ID}/file$`));
 if(file&&method==='GET')return download(readExportFile(db,uploadDir(),user.id,file[1]));
 if((r=m(path,`/${ID}/duplicate`))&&method==='POST')return json({data:duplicateProject(db,user.id,r[1])},201);
 if((r=m(path,`/${ID}/slides`))&&method==='POST')return json({data:addSlide(db,user.id,r[1],await input())},201);
 if((r=m(path,`/${ID}/slides/${ID}`))){
  if(method==='PATCH')return json({data:updateSlide(db,user.id,r[1],r[2],await input())});
  if(method==='DELETE')return json({data:deleteSlide(db,user.id,r[1],r[2])});
 }
 if((r=m(path,`/${ID}/slides/${ID}/move`))&&method==='POST')return json({data:moveSlide(db,user.id,r[1],r[2],await input())});
 if((r=m(path,`/${ID}/slides/${ID}/duplicate`))&&method==='POST')return json({data:duplicateSlide(db,user.id,r[1],r[2])},201);
 if((r=m(path,`/${ID}/slides/${ID}\\.svg`))&&method==='GET'){
  const p=getProject(db,user.id,r[1]),i=p.slides.findIndex(s=>s.id===r![2]);
  if(i<0)return json({error:{code:'NOT_FOUND',message:'슬라이드를 찾을 수 없습니다.'}},404);
  return svgResponse(slideSvg(p,p.slides[i],i,p.slides.length));
 }
 return null;
}
