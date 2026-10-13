import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {audit} from '../audit';
import {AppError} from '../errors';
import {rateLimit} from '../http';
import {deleteInput,version} from '../validation';
import {CollectError,fetchRss,type FetchLike} from '../collect/rss';
import {analyzePosts,type AnalysisReport} from '../analysis/rules';
import {parseBlogInput} from '../mate/mate';

/** 새 규칙(원본 미확인): 회원 1명이 등록할 수 있는 경쟁 블로그 수, 같은 블로그 갱신 간격. */
export const COMPETITOR_LIMIT=10;
export const REFRESH_INTERVAL_MS=10*60_000;
export type Snapshot={blogTitle:string;postCount:number;latestPostAt:number|null;report:AnalysisReport};
export type Competitor={id:string;naverId:string;note:string;snapshot:Snapshot|null;lastCollectedAt:number|null;lastAttemptAt:number|null;lastError:string|null;version:number;createdAt:number;updatedAt:number};
type Row={id:string;naver_id:string;note:string;snapshot_json:string|null;last_collected_at:number|null;last_attempt_at:number|null;last_error:string|null;version:number;created_at:number;updated_at:number};
const SELECT='SELECT id,naver_id,note,snapshot_json,last_collected_at,last_attempt_at,last_error,version,created_at,updated_at FROM competitor_blogs';
const toCompetitor=(r:Row):Competitor=>({id:r.id,naverId:r.naver_id,note:r.note,snapshot:r.snapshot_json?JSON.parse(r.snapshot_json) as Snapshot:null,lastCollectedAt:r.last_collected_at,lastAttemptAt:r.last_attempt_at,lastError:r.last_error,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at});
const note=z.string().trim().max(500);
const addInput=z.object({blog:z.string().max(300),note:note.default('')}).strict();
const updateInput=z.object({note,version}).strict();

function owned(db:Database,ownerId:string,id:string):Row{
 const r=db.prepare(`${SELECT} WHERE id=? AND owner_id=?`).get(id,ownerId) as Row|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','경쟁 블로그를 찾을 수 없습니다.');
 return r;
}

/** 내 경쟁 블로그 목록과 비교 기준(내 대표 블로그의 최신 진단). */
export function listCompetitors(db:Database,ownerId:string){
 const data=(db.prepare(`${SELECT} WHERE owner_id=? ORDER BY created_at,rowid`).all(ownerId) as Row[]).map(toCompetitor);
 const mine=db.prepare(`SELECT r.report_json,r.measured_at,b.naver_id FROM scan_results r JOIN blogs b ON b.id=r.blog_id WHERE r.owner_id=?
  ORDER BY b.is_primary DESC,r.measured_at DESC LIMIT 1`).get(ownerId) as {report_json:string;measured_at:number;naver_id:string}|undefined;
 return{data,limit:COMPETITOR_LIMIT,mine:mine?{naverId:mine.naver_id,measuredAt:mine.measured_at,report:JSON.parse(mine.report_json) as AnalysisReport}:null};
}

export function addCompetitor(db:Database,ownerId:string,input:unknown,now=Date.now()):Competitor{
 const v=addInput.parse(input);
 const naverId=parseBlogInput(v.blog);
 if(!naverId)throw new AppError(400,'INVALID_BLOG','네이버 블로그 주소 또는 아이디를 입력해주세요.');
 return transaction(db,()=>{
  if(db.prepare('SELECT 1 FROM competitor_blogs WHERE owner_id=? AND naver_id=?').get(ownerId,naverId))throw new AppError(409,'COMPETITOR_EXISTS','이미 등록한 경쟁 블로그입니다.');
  const {n}=db.prepare('SELECT count(*) AS n FROM competitor_blogs WHERE owner_id=?').get(ownerId) as {n:number};
  if(n>=COMPETITOR_LIMIT)throw new AppError(409,'COMPETITOR_LIMIT',`경쟁 블로그는 최대 ${COMPETITOR_LIMIT}개까지 등록할 수 있습니다.`);
  const id=randomUUID();
  db.prepare('INSERT INTO competitor_blogs(id,owner_id,naver_id,note,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,ownerId,naverId,v.note,now,now);
  audit(db,ownerId,'competitor.create','competitor',id);
  return toCompetitor(owned(db,ownerId,id));
 });
}

export function updateCompetitor(db:Database,ownerId:string,id:string,input:unknown):Competitor{
 const v=updateInput.parse(input);
 return transaction(db,()=>{
  if(owned(db,ownerId,id).version!==v.version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  db.prepare('UPDATE competitor_blogs SET note=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(v.note,Date.now(),id,v.version);
  audit(db,ownerId,'competitor.update','competitor',id);
  return toCompetitor(owned(db,ownerId,id));
 });
}

export function deleteCompetitor(db:Database,ownerId:string,id:string,input:unknown){
 const {version:expected}=deleteInput.parse(input);
 return transaction(db,()=>{
  if(owned(db,ownerId,id).version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  db.prepare('DELETE FROM competitor_blogs WHERE id=? AND version=?').run(id,expected);
  audit(db,ownerId,'competitor.delete','competitor',id);
  return{deleted:true};
 });
}

/** 경쟁 블로그 공개 RSS를 받아 같은 5가지 기준으로 진단한 스냅숏을 저장한다(블로그당 10분 간격). */
export async function refreshCompetitor(db:Database,ownerId:string,id:string,fetchImpl:FetchLike=fetch,now=Date.now()):Promise<Competitor>{
 const row=owned(db,ownerId,id);
 if(row.last_attempt_at!==null&&now-row.last_attempt_at<REFRESH_INTERVAL_MS)throw new AppError(429,'REFRESH_TOO_SOON','같은 경쟁 블로그는 10분에 한 번 갱신할 수 있습니다.');
 rateLimit(db,`competitor-refresh:${ownerId}`,30,60*60_000,now);
 db.prepare('UPDATE competitor_blogs SET last_attempt_at=? WHERE id=?').run(now,id);
 try{
  const feed=await fetchRss(row.naver_id,fetchImpl);
  const report=analyzePosts(feed.items.map(i=>({title:i.title,category:i.category,tags:i.tags,publishedAt:i.publishedAt})),now);
  const latest=Math.max(0,...feed.items.map(i=>i.publishedAt??0))||null;
  const snapshot:Snapshot={blogTitle:feed.title,postCount:feed.items.length,latestPostAt:latest,report};
  db.prepare('UPDATE competitor_blogs SET snapshot_json=?,last_collected_at=?,last_error=NULL,updated_at=? WHERE id=?').run(JSON.stringify(snapshot),now,now,id);
  return toCompetitor(owned(db,ownerId,id));
 }catch(e){
  if(!(e instanceof CollectError))throw e;
  db.prepare('UPDATE competitor_blogs SET last_error=? WHERE id=?').run(e.code.slice(0,60),id);
  if(e.code==='BLOG_NOT_FOUND')throw new AppError(404,'BLOG_NOT_FOUND',e.message);
  throw new AppError(502,'FETCH_FAILED',e.message);
 }
}
