import {z} from 'zod';
import type {Database} from '../database';
import type {User} from '../auth';
import {body,json,rateLimit} from '../http';
import {addSlide,createProject,deleteProject,deleteSlide,duplicateProject,duplicateSlide,getProject,listProjects,moveSlide,updateProject,updateSlide} from './projects';
import {slideSvg} from './svg';

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
