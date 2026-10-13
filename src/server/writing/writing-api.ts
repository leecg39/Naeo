import {z} from 'zod';
import type {Database} from '../database';
import type {User} from '../auth';
import {AppError} from '../errors';
import {body,json,rateLimit,readRequestBytes} from '../http';
import {createDraft,deleteDraft,getDraft,listDrafts,restoreDraftRevision,updateDraft} from './drafts';
import {MAX_IMAGE_BYTES,attachMedia,deleteMedia,listMedia,readMedia,saveUpload} from './media';
import {createShareLink,listShareLinks,readShared,revokeShareLink} from './shares';
import {exportDraft} from './export';

const ID='([a-f0-9-]{36})',TOKEN='([A-Za-z0-9_-]{22})';
const anyJson=z.unknown();
/** 사진 저장 폴더. 운영에서는 NAEO_UPLOAD_DIR로 웹 루트 밖 경로를 지정한다. */
export const uploadDir=()=>process.env.NAEO_UPLOAD_DIR||'var/uploads';
const DRAFT_BODY_MAX=512*1024;

/** 저장된 사진을 내려줄 때: 형식 고정·스니핑 금지·스크립트 실행 차단. */
function imageResponse(bytes:Buffer,mime:string,cache:string){
 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':mime,'Content-Length':String(bytes.length),'Cache-Control':cache,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'}});
}

async function uploadForm(request:Request){
 if(!/^multipart\/form-data/i.test(request.headers.get('content-type')||''))throw new AppError(415,'MULTIPART_REQUIRED','사진은 multipart/form-data로 올려주세요.');
 const bytes=await readRequestBytes(request,MAX_IMAGE_BYTES+64*1024,new AppError(413,'IMAGE_TOO_LARGE','사진은 10MB 이하만 올릴 수 있습니다.'));
 const form=await new Response(new Uint8Array(bytes),{headers:{'Content-Type':request.headers.get('content-type')!}}).formData().catch(()=>{throw new AppError(400,'INVALID_FORM','업로드 형식을 확인해주세요.');});
 const file=form.get('file');
 if(!(file instanceof File))throw new AppError(400,'FILE_REQUIRED','사진 파일을 선택해주세요.');
 if(file.size>MAX_IMAGE_BYTES)throw new AppError(413,'IMAGE_TOO_LARGE','사진은 10MB 이하만 올릴 수 있습니다.');
 const draftId=form.get('draftId');
 return{bytes:Buffer.from(await file.arrayBuffer()),name:file.name,type:file.type,draftId:typeof draftId==='string'&&draftId?z.uuid().parse(draftId):null};
}

/** 로그인 없이 쓰는 공유 링크 읽기. */
export function publicShareApi(db:Database,request:Request):Response|null{
 const {pathname:path}=new URL(request.url);
 if(request.method!=='GET')return null;
 const view=path.match(new RegExp(`^/api/shares/${TOKEN}$`));
 if(view)return json({data:readShared(db,view[1],Date.now())});
 const file=path.match(new RegExp(`^/api/shares/${TOKEN}/media/${TOKEN}$`));
 if(file){const f=readShared(db,file[1],Date.now(),file[2],uploadDir());return imageResponse(f.bytes,f.mime,'private, max-age=60');}
 return null;
}

async function draftRoutes(db:Database,request:Request,user:User,path:string,method:string,params:URLSearchParams):Promise<Response|null>{
 if(path==='/api/drafts'){
  if(method==='GET')return json(listDrafts(db,user.id,Object.fromEntries(params)));
  if(method==='POST'){rateLimit(db,`draft-write:${user.id}`,300,15*60_000);return json({data:createDraft(db,user.id,await body(request,anyJson,DRAFT_BODY_MAX))},201);}
 }
 const one=path.match(new RegExp(`^/api/drafts/${ID}$`));
 if(one){
  if(method==='GET')return json({data:getDraft(db,user.id,one[1])});
  if(method==='PATCH'){rateLimit(db,`draft-write:${user.id}`,300,15*60_000);return json({data:updateDraft(db,user.id,one[1],await body(request,anyJson,DRAFT_BODY_MAX))});}
  if(method==='DELETE')return json({data:deleteDraft(db,user.id,one[1],await body(request,anyJson))});
 }
 const exp=path.match(new RegExp(`^/api/drafts/${ID}/export$`));
 if(exp&&method==='GET'){
  const format=z.enum(['html','markdown','text']).parse(params.get('format')??'html');
  const out=exportDraft(db,user.id,exp[1],format);
  const headers:Record<string,string>={'Content-Type':out.contentType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; sandbox"};
  if(params.get('download')==='1')headers['Content-Disposition']=`attachment; filename="${out.filename}"`;
  return new Response(out.body,{headers});
 }
 const restore=path.match(new RegExp(`^/api/drafts/${ID}/restore$`));
 if(restore&&method==='POST')return json({data:restoreDraftRevision(db,user.id,restore[1],await body(request,anyJson))});
 const shares=path.match(new RegExp(`^/api/drafts/${ID}/shares$`));
 if(shares&&method==='GET')return json({data:listShareLinks(db,user.id,shares[1])});
 if(shares&&method==='POST')return json({data:createShareLink(db,user.id,shares[1],await body(request,anyJson))},201);
 const revoke=path.match(new RegExp(`^/api/shares/${TOKEN}$`));
 if(revoke&&method==='DELETE')return json({data:revokeShareLink(db,user.id,revoke[1])});
 return null;
}

/** 초안·사진·공유 링크(회원 본인 데이터만). 해당 경로가 아니면 null. */
export async function writingApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 const drafts=await draftRoutes(db,request,user,path,method,searchParams);
 if(drafts)return drafts;
 if(path==='/api/media'){
  if(method==='GET')return json(listMedia(db,user.id,Object.fromEntries(searchParams)));
  if(method==='POST'){rateLimit(db,`upload:${user.id}`,120,60*60_000);return json({data:saveUpload(db,uploadDir(),user.id,await uploadForm(request))},201);}
 }
 const media=path.match(new RegExp(`^/api/media/${TOKEN}$`));
 if(media){
  if(method==='GET'){const m=readMedia(db,uploadDir(),user.id,media[1]);return imageResponse(m.bytes,m.mime,'private, no-store');}
  if(method==='PATCH')return json({data:attachMedia(db,user.id,media[1],await body(request,anyJson))});
  if(method==='DELETE')return json({data:deleteMedia(db,uploadDir(),user.id,media[1])});
 }
 return null;
}
