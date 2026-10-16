import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,openSync,closeSync,fstatSync,readSync,constants,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';
import {paginationInput} from '../validation';
import {ownedDraft} from './drafts';
import {deleteStoredMedia} from './media-cleanup';

export const MAX_IMAGE_BYTES=10*1024*1024;
export const MAX_PER_DRAFT=20;
export const MAX_PER_OWNER=500;
export type ImageMime='image/jpeg'|'image/png'|'image/webp';
export type Media={publicId:string;draftId:string|null;mime:ImageMime;size:number;originalName:string;source:'upload'|'ai';createdAt:number;shareToken?:string};
type Row={public_id:string;draft_id:string|null;mime:ImageMime;size:number;original_name:string;source:'upload'|'ai';created_at:number;storage_key:string};
const SELECT='SELECT public_id,draft_id,mime,size,original_name,source,created_at,storage_key FROM media_files';
const toMedia=(r:Row):Media=>({publicId:r.public_id,draftId:r.draft_id,mime:r.mime,size:r.size,originalName:r.original_name,source:r.source,createdAt:r.created_at});
const EXT:Record<ImageMime,string>={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'};
const listInput=paginationInput.extend({draftId:z.uuid().optional()});
const attachInput=z.object({draftId:z.uuid().nullable()}).strict();
export const imageMarkdown=(name:string,url:string)=>`![${(name||'사진').replaceAll('\\','\\\\').replaceAll('[','\\[').replaceAll(']','\\]').replace(/[\r\n]+/g,' ')}](${url})`;

/** 파일 앞부분 서명으로만 형식을 정한다(선언된 MIME·파일명은 믿지 않는다). */
export function sniffImage(bytes:Buffer):ImageMime|null{
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return'image/png';
 if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return'image/jpeg';
 if(bytes.length>=12&&bytes.subarray(0,4).toString('latin1')==='RIFF'&&bytes.subarray(8,12).toString('latin1')==='WEBP')return'image/webp';
 return null;
}
function ownedRow(db:Database,ownerId:string,publicId:string):Row{
 const r=/^[A-Za-z0-9_-]{22}$/.test(publicId)?db.prepare(`${SELECT} WHERE public_id=? AND owner_id=?`).get(publicId,ownerId) as Row|undefined:undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','사진을 찾을 수 없습니다.');
 return r;
}
function assertRoom(db:Database,ownerId:string,draftId:string|null){
 const {n}=db.prepare('SELECT count(*) AS n FROM media_files WHERE owner_id=?').get(ownerId) as {n:number};
 if(n>=MAX_PER_OWNER)throw new AppError(409,'TOO_MANY_IMAGES',`사진은 계정당 최대 ${MAX_PER_OWNER}장까지 보관할 수 있습니다.`);
 if(!draftId)return;
 const {d}=db.prepare('SELECT count(*) AS d FROM media_files WHERE draft_id=?').get(draftId) as {d:number};
 if(d>=MAX_PER_DRAFT)throw new AppError(409,'TOO_MANY_IMAGES',`글 하나에는 사진을 최대 ${MAX_PER_DRAFT}장까지 넣을 수 있습니다.`);
}
const filePath=(dir:string,key:string)=>path.join(dir,path.basename(key));

export function saveUpload(db:Database,dir:string,ownerId:string,input:{bytes:Buffer;name:string;type:string;draftId?:string|null;source?:'upload'|'ai'},now=Date.now()):Media{
 const mime=validateImage(input.bytes);
 if(input.draftId)ownedDraft(db,ownerId,input.draftId);
 return transaction(db,()=>storeMedia(db,dir,ownerId,{...input,mime},now));
}
function validateImage(bytes:Buffer):ImageMime{
 if(bytes.length>MAX_IMAGE_BYTES)throw new AppError(413,'IMAGE_TOO_LARGE','사진은 10MB 이하만 올릴 수 있습니다.');
 const mime=sniffImage(bytes);
 if(!mime)throw new AppError(415,'UNSUPPORTED_IMAGE','JPG, PNG, WEBP 사진만 올릴 수 있습니다.');
 return mime;
}
/** 이미 열린 트랜잭션 안에서 사진 파일과 행을 함께 넣는다(생성 작업 완료처럼 더 큰 원자 단위에서 재사용). */
export function storeMedia(db:Database,dir:string,ownerId:string,input:{bytes:Buffer;name:string;mime:ImageMime;draftId?:string|null;source?:'upload'|'ai'},now:number):Media{
 const draftId=input.draftId??null;
 const publicId=randomBytes(16).toString('base64url'),key=`${randomUUID()}${EXT[input.mime]}`;
 mkdirSync(dir,{recursive:true,mode:0o700});
 assertRoom(db,ownerId,draftId);
 writeFileSync(filePath(dir,key),input.bytes,{flag:'wx',mode:0o600});
 try{
  db.prepare('INSERT INTO media_files(id,public_id,owner_id,draft_id,mime,size,storage_key,original_name,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run(randomUUID(),publicId,ownerId,draftId,input.mime,input.bytes.length,key,input.name.slice(0,120),input.source??'upload',now);
 }catch(e){unlinkSync(filePath(dir,key));throw e;}
 return toMedia(ownedRow(db,ownerId,publicId));
}
/** AI가 만든 바이트를 한 장 저장한다. 형식·크기 검증은 saveUpload와 같다. */
export function saveGeneratedImage(db:Database,dir:string,ownerId:string,input:{bytes:Buffer;name:string;draftId?:string|null},now=Date.now()):Media{
 const mime=validateImage(input.bytes);
 return storeMedia(db,dir,ownerId,{bytes:input.bytes,name:input.name,mime,draftId:input.draftId,source:'ai'},now);
}

export function readMedia(db:Database,dir:string,ownerId:string,publicId:string){
 const r=ownedRow(db,ownerId,publicId);
 return{...toMedia(r),bytes:readStoredFile(dir,r.storage_key,{mime:r.mime,size:r.size})};
}
/** 사진함 마크다운에 쓰는 공개 토큰. 원본 publicId와 분리해 개인 API 주소를 노출하지 않는다. */
export function publishMedia(db:Database,ownerId:string,publicId:string,now=Date.now()):string{
 ownedRow(db,ownerId,publicId);
 const current=db.prepare('SELECT token FROM media_markdown_links WHERE public_id=? AND owner_id=?').get(publicId,ownerId) as {token:string}|undefined;
 if(current)return current.token;
 const token=randomBytes(16).toString('base64url');
 db.prepare('INSERT INTO media_markdown_links(token,public_id,owner_id,created_at) VALUES(?,?,?,?)').run(token,publicId,ownerId,now);
 return token;
}
export function revokePublishedMedia(db:Database,ownerId:string,publicId:string){
 ownedRow(db,ownerId,publicId);
 const removed=db.prepare('DELETE FROM media_markdown_links WHERE public_id=? AND owner_id=?').run(publicId,ownerId);
 if(!removed.changes)throw new AppError(404,'NOT_FOUND','공개 링크를 찾을 수 없습니다.');
 return{revoked:true};
}
/** 무작위 공개 토큰을 가진 사진만 읽는다. 원본 개인 publicId로는 접근할 수 없다. */
export function readPublishedMedia(db:Database,dir:string,token:string){
 const r=/^[A-Za-z0-9_-]{22}$/.test(token)?db.prepare(`SELECT m.public_id,m.draft_id,m.mime,m.size,m.original_name,m.source,m.created_at,m.storage_key FROM media_files m JOIN media_markdown_links l ON l.public_id=m.public_id WHERE l.token=?`).get(token) as Row|undefined:undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','사진을 찾을 수 없습니다.');
 return{...toMedia(r),bytes:readStoredFile(dir,r.storage_key,{mime:r.mime,size:r.size})};
}
/** Read one bounded regular file through a no-follow descriptor; metadata must match its DB row. */
export function readStoredFile(dir:string,storageKey:string,expected?:{mime:ImageMime;size:number}){
 const unavailable=()=>new AppError(404,'MEDIA_UNAVAILABLE','사진 파일을 읽을 수 없습니다. 다시 업로드해주세요.');
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/.test(storageKey))throw unavailable();
 let fd:number|undefined;
 try{
  fd=openSync(path.join(dir,storageKey),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=fstatSync(fd);
  if(!before.isFile()||before.nlink!==1||before.size<1||before.size>MAX_IMAGE_BYTES||(expected&&before.size!==expected.size))throw unavailable();
  const data=Buffer.alloc(before.size+1);let length=0;
  while(length<data.length){const n=readSync(fd,data,length,data.length-length,length);if(!n)break;length+=n;}
  const after=fstatSync(fd),bytes=data.subarray(0,length),mime=sniffImage(bytes);
  if(length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||!mime||(expected&&mime!==expected.mime))throw unavailable();
  return bytes;
 }catch{throw unavailable();}finally{if(fd!==undefined)closeSync(fd);}
}

export function listMedia(db:Database,ownerId:string,query:unknown){
 const {page,pageSize,draftId}=listInput.parse(query);
 const where=draftId?'owner_id=? AND draft_id=?':'owner_id=?',params=draftId?[ownerId,draftId]:[ownerId];
 const {total}=db.prepare(`SELECT count(*) AS total FROM media_files WHERE ${where}`).get(...params) as {total:number};
 const rows=db.prepare(`SELECT public_id,draft_id,mime,size,original_name,source,created_at,storage_key,(SELECT token FROM media_markdown_links l WHERE l.public_id=media_files.public_id) AS share_token FROM media_files WHERE ${where} ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as (Row&{share_token:string|null})[];
 return{data:rows.map(r=>({...toMedia(r),...(r.share_token?{shareToken:r.share_token}:{})})),pagination:{page,pageSize,total}};
}

/** 사진을 다른 글에 연결하거나(draftId) 연결을 푼다(null). */
export function attachMedia(db:Database,ownerId:string,publicId:string,input:unknown):Media{
 const {draftId}=attachInput.parse(input);
 return transaction(db,()=>{
  ownedRow(db,ownerId,publicId);
  if(draftId){ownedDraft(db,ownerId,draftId);const {d}=db.prepare('SELECT count(*) AS d FROM media_files WHERE draft_id=? AND public_id<>?').get(draftId,publicId) as {d:number};if(d>=MAX_PER_DRAFT)throw new AppError(409,'TOO_MANY_IMAGES',`글 하나에는 사진을 최대 ${MAX_PER_DRAFT}장까지 넣을 수 있습니다.`);}
  db.prepare('UPDATE media_files SET draft_id=? WHERE public_id=?').run(draftId,publicId);
  return toMedia(ownedRow(db,ownerId,publicId));
 });
}

/** Access ends immediately; the durable tombstone retries physical deletion if the filesystem is unavailable. */
export function deleteMedia(db:Database,dir:string,ownerId:string,publicId:string){
 const r=ownedRow(db,ownerId,publicId);
 db.prepare('DELETE FROM media_files WHERE public_id=?').run(publicId);
 deleteStoredMedia(db,dir,r.storage_key);
 return{deleted:true};
}
