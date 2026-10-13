import {randomBytes} from 'node:crypto';
import type {Database} from '../database';
import {AppError} from '../errors';
import {rateLimit} from '../http';
import {paginationInput} from '../validation';
import {CollectError,fetchRss,type FetchLike} from '../collect/rss';
import {analyzePosts,type AnalysisReport} from '../analysis/rules';

/** 무료 진단 리포트 보관 기간(공유 링크 유효 기간). */
export const REPORT_TTL_MS=30*86_400_000;
export type MateReport={token:string;naverId:string;report:AnalysisReport;postCount:number;createdAt:number;expiresAt:number;saved?:boolean};
type Row={token:string;naver_id:string;report_json:string;post_count:number;created_at:number;expires_at:number};
const toReport=(r:Row):MateReport=>({token:r.token,naverId:r.naver_id,report:JSON.parse(r.report_json) as AnalysisReport,postCount:r.post_count,createdAt:r.created_at,expiresAt:r.expires_at});
const ID=/^[a-z0-9][a-z0-9_-]{1,49}$/;

/** 블로그 ID 또는 네이버 블로그 주소에서 ID만 꺼낸다. 다른 사이트 주소는 받지 않는다. */
export function parseBlogInput(input:string):string|null{
 const value=input.trim();
 if(ID.test(value.toLowerCase()))return value.toLowerCase();
 let url:URL;
 try{url=new URL(/^https?:\/\//i.test(value)?value:`https://${value}`);}catch{return null;}
 if(url.hostname!=='blog.naver.com'&&url.hostname!=='m.blog.naver.com')return null;
 const id=url.pathname.split('/')[1]?.toLowerCase()??'';
 return ID.test(id)?id:null;
}

function asAppError(e:unknown):never{
 if(e instanceof CollectError){
  if(e.code==='BLOG_NOT_FOUND')throw new AppError(404,'BLOG_NOT_FOUND',e.message);
  if(e.code==='INVALID_BLOG_ID')throw new AppError(400,'INVALID_BLOG',e.message);
  throw new AppError(502,'FETCH_FAILED',e.message);
 }
 throw e;
}

/** RSS를 바로 받아 새 규칙으로 진단하고 공유 토큰과 함께 30일 보관한다. 로그인 상태면 내 기록에 연결한다. */
export async function diagnoseBlog(db:Database,{blog,peer,userId}:{blog:unknown;peer:string;userId:string|null},fetchImpl:FetchLike=fetch,now=Date.now()):Promise<MateReport>{
 rateLimit(db,`mate:peer:${peer}`,5,10*60_000,now);
 rateLimit(db,'mate:global',300,60*60_000,now);
 const naverId=typeof blog==='string'&&blog.length<=300?parseBlogInput(blog):null;
 if(!naverId)throw new AppError(400,'INVALID_BLOG','네이버 블로그 주소 또는 아이디를 입력해주세요.');
 rateLimit(db,`mate:blog:${naverId}`,10,60*60_000,now);
 const feed=await fetchRss(naverId,fetchImpl).catch(asAppError);
 const report=analyzePosts(feed.items.map(i=>({title:i.title,category:i.category,tags:i.tags,publishedAt:i.publishedAt})),now);
 const token=randomBytes(16).toString('base64url');
 db.prepare('INSERT INTO mate_reports(token,owner_id,naver_id,score,report_json,post_count,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
  .run(token,userId,naverId,report.score,JSON.stringify(report),feed.items.length,now,now+REPORT_TTL_MS);
 db.prepare('DELETE FROM mate_reports WHERE expires_at<=?').run(now);
 return{token,naverId,report,postCount:feed.items.length,createdAt:now,expiresAt:now+REPORT_TTL_MS,saved:userId!==null};
}

/** 공유 링크로 읽는다(만료되면 없음). 작성자 정보는 돌려주지 않는다. */
export function getMateReport(db:Database,token:string,now=Date.now()):MateReport|null{
 if(!/^[A-Za-z0-9_-]{22}$/.test(token))return null;
 const r=db.prepare('SELECT token,naver_id,report_json,post_count,created_at,expires_at FROM mate_reports WHERE token=? AND expires_at>?').get(token,now) as Row|undefined;
 return r?toReport(r):null;
}

export function listMyMateReports(db:Database,userId:string,query:unknown,now=Date.now()){
 const {page,pageSize}=paginationInput.parse(query);
 const {total}=db.prepare('SELECT count(*) AS total FROM mate_reports WHERE owner_id=? AND expires_at>?').get(userId,now) as {total:number};
 const rows=db.prepare('SELECT token,naver_id,report_json,post_count,created_at,expires_at FROM mate_reports WHERE owner_id=? AND expires_at>? ORDER BY created_at DESC,token LIMIT ? OFFSET ?').all(userId,now,pageSize,(page-1)*pageSize) as Row[];
 return{data:rows.map(toReport),pagination:{page,pageSize,total}};
}

export function deleteMateReport(db:Database,userId:string,token:string){
 const r=db.prepare('DELETE FROM mate_reports WHERE token=? AND owner_id=?').run(token,userId);
 if(r.changes===0)throw new AppError(404,'NOT_FOUND','진단 기록을 찾을 수 없습니다.');
 return{deleted:true};
}
