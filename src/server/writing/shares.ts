import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import type {Database} from '../database';
import {AppError} from '../errors';
import {ownedDraft} from './drafts';
import {readStoredFile,type ImageMime} from './media';

const DAY=86_400_000;
const createInput=z.object({days:z.number().int().min(1).max(30).default(7)}).strict();
export type ShareLink={token:string;draftId:string;expiresAt:number;revokedAt:number|null;createdAt:number};
const SELECT='SELECT token,draft_id AS draftId,expires_at AS expiresAt,revoked_at AS revokedAt,created_at AS createdAt FROM share_links';
const notFound=()=>new AppError(404,'NOT_FOUND','공유 링크를 찾을 수 없습니다.');

/** 글의 사진 묶음을 기간 한정(1~30일)으로 공유한다. 토큰은 22자 무작위라 추측·나열할 수 없다. */
export function createShareLink(db:Database,ownerId:string,draftId:string,input:unknown,now=Date.now()):ShareLink{
 const {days}=createInput.parse(input);
 ownedDraft(db,ownerId,draftId);
 const token=randomBytes(16).toString('base64url');
 db.prepare('INSERT INTO share_links(token,owner_id,draft_id,expires_at,created_at) VALUES(?,?,?,?,?)').run(token,ownerId,draftId,now+days*DAY,now);
 return{...(db.prepare(`${SELECT} WHERE token=?`).get(token) as ShareLink)};
}
export function listShareLinks(db:Database,ownerId:string,draftId:string):ShareLink[]{
 ownedDraft(db,ownerId,draftId);
 return (db.prepare(`${SELECT} WHERE draft_id=? ORDER BY created_at DESC,rowid DESC`).all(draftId) as ShareLink[]).map(r=>({...r}));
}
export function revokeShareLink(db:Database,ownerId:string,token:string,now=Date.now()){
 const r=db.prepare('UPDATE share_links SET revoked_at=? WHERE token=? AND owner_id=? AND revoked_at IS NULL').run(now,token,ownerId);
 if(r.changes===0)throw notFound();
 return{revoked:true};
}

type SharedView={title:string;expiresAt:number;images:{publicId:string;mime:ImageMime;size:number}[]};
type SharedFile={mime:ImageMime;bytes:Buffer};
/** 공유 링크로 글 제목·사진 목록을 보거나(publicId 없음) 그 글의 사진 하나를 읽는다. */
export function readShared(db:Database,token:string,now:number):SharedView;
export function readShared(db:Database,token:string,now:number,publicId:string,dir:string):SharedFile;
export function readShared(db:Database,token:string,now=Date.now(),publicId?:string,dir?:string):SharedView|SharedFile{
 const link=/^[A-Za-z0-9_-]{22}$/.test(token)?db.prepare('SELECT draft_id,expires_at,revoked_at FROM share_links WHERE token=?').get(token) as {draft_id:string;expires_at:number;revoked_at:number|null}|undefined:undefined;
 if(!link||link.revoked_at!==null)throw notFound();
 if(link.expires_at<=now)throw new AppError(404,'SHARE_EXPIRED','공유 기간이 끝난 링크입니다.');
 if(publicId!==undefined){
  const m=db.prepare('SELECT mime,size,storage_key FROM media_files WHERE public_id=? AND draft_id=?').get(publicId,link.draft_id) as {mime:ImageMime;size:number;storage_key:string}|undefined;
  if(!m||!dir)throw new AppError(404,'NOT_FOUND','사진을 찾을 수 없습니다.');
  return{mime:m.mime,bytes:readStoredFile(dir,m.storage_key,{mime:m.mime,size:m.size})};
 }
 const {title}=db.prepare('SELECT title FROM drafts WHERE id=?').get(link.draft_id) as {title:string};
 const images=(db.prepare('SELECT public_id AS publicId,mime,size FROM media_files WHERE draft_id=? ORDER BY created_at,rowid').all(link.draft_id) as SharedView['images']).map(i=>({...i}));
 return{title,expiresAt:link.expires_at,images};
}
