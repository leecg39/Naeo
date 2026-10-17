import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';
import {kstDayStart} from '../jobs/queue';
import {classify} from '../keywords/records';
import {naverPostRef} from './match';
import type {Briefing,CitationConfig} from './provider';
import type {KeywordSource} from './keywords';

/**
 * 새 규칙(원본 미확인): 한 번에 최근 글 10개, 회원당 하루(KST) 2회까지(블로그 스캔 뒤 자동 확인 포함).
 * 글을 하나도 확인하지 못하고 실패·취소된 작업은 한도에서 빼서 공급자 장애가 회원의 기회를 없애지 않게 한다.
 */
export const CITATION_POSTS=10,DAILY_CITATION_LIMIT=2;
export type RunState='queued'|'running'|'succeeded'|'failed'|'canceled';
export type RunRow={id:string;owner_id:string;blog_id:string;state:RunState;source:'member'|'scan';provider:string;post_limit:number;checked:number;searches:number;progress:number;attempt:number;max_attempts:number;lease_owner:string|null;lease_until:number|null;run_after:number;cancel_requested:number;error_code:string|null;error_message:string|null;created_at:number;updated_at:number;completed_at:number|null};
export type CitationRun={id:string;blogId:string;state:RunState;source:'member'|'scan';checked:number;postLimit:number;progress:number;attempt:number;errorCode:string|null;errorMessage:string|null;cancelRequested:boolean;createdAt:number;updatedAt:number;completedAt:number|null};
export const toRun=(r:RunRow):CitationRun=>({id:r.id,blogId:r.blog_id,state:r.state,source:r.source,checked:r.checked,postLimit:r.post_limit,progress:r.progress,attempt:r.attempt,errorCode:r.error_code,errorMessage:r.error_message,cancelRequested:r.cancel_requested===1,createdAt:r.created_at,updatedAt:r.updated_at,completedAt:r.completed_at});
/** 저장 근거: 출처 목록은 화면 표시용 사본이며 출처 사이트를 다시 요청하지 않는다. */
export type Evidence={briefing:Briefing|null;exposure:{section:string;position:number}|null;searches:number;error?:{code:string;message:string}};

const enqueueInput=z.object({blogId:z.uuid(),idempotencyKey:z.string().trim().min(1).max(100).optional()}).strict();
const runById=(db:Database,id:string)=>db.prepare('SELECT * FROM citation_runs WHERE id=?').get(id) as RunRow|undefined;
function ownedRun(db:Database,ownerId:string,id:string):RunRow{
 const r=/^[a-f0-9-]{36}$/.test(id)?db.prepare('SELECT * FROM citation_runs WHERE id=? AND owner_id=?').get(id,ownerId) as RunRow|undefined:undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','AI 인용 확인 작업을 찾을 수 없습니다.');
 return r;
}
export function remainingCitationsToday(db:Database,ownerId:string,now=Date.now()){
 const {n}=db.prepare("SELECT count(*) AS n FROM citation_runs WHERE owner_id=? AND created_at>=? AND NOT (state IN ('failed','canceled') AND checked=0)").get(ownerId,kstDayStart(now)) as {n:number};
 return Math.max(0,DAILY_CITATION_LIMIT-n);
}

/** 확인 요청: 설정·소유권·진행 중·수집 글·하루 한도를 같은 트랜잭션에서 검사한다. 같은 키는 기존 작업을 돌려준다. */
export function enqueueCitation(db:Database,ownerId:string,input:unknown,{source,config}:{source:'member'|'scan';config:CitationConfig|null},now=Date.now()):CitationRun{
 const v=enqueueInput.parse(input);
 return transaction(db,()=>{
  if(!db.prepare('SELECT 1 FROM blogs WHERE id=? AND owner_id=?').get(v.blogId,ownerId))throw new AppError(404,'BLOG_NOT_FOUND','블로그를 찾을 수 없습니다.');
  if(v.idempotencyKey){const same=db.prepare('SELECT * FROM citation_runs WHERE owner_id=? AND idempotency_key=?').get(ownerId,v.idempotencyKey) as RunRow|undefined;if(same)return toRun(same);}
  if(!config)throw new AppError(503,'CITATION_NOT_CONFIGURED','AI 브리핑 인용 확인 공급자가 설정되지 않았습니다(미설정).');
  if(db.prepare("SELECT 1 FROM citation_runs WHERE blog_id=? AND state IN ('queued','running')").get(v.blogId))throw new AppError(409,'CITATION_IN_PROGRESS','이 블로그는 이미 AI 인용을 확인하고 있습니다. 끝난 뒤 다시 시도해주세요.');
  if(!db.prepare('SELECT 1 FROM blog_posts WHERE blog_id=?').get(v.blogId))throw new AppError(409,'CITATION_POSTS_REQUIRED','먼저 블로그 스캔으로 글을 수집해주세요.');
  if(remainingCitationsToday(db,ownerId,now)<=0)throw new AppError(429,'CITATION_QUOTA_EXCEEDED',`AI 인용 확인은 하루 ${DAILY_CITATION_LIMIT}회까지입니다. 내일 0시(한국 시간)에 다시 채워집니다.`);
  const id=randomUUID();
  db.prepare("INSERT INTO citation_runs(id,owner_id,blog_id,state,source,provider,post_limit,run_after,idempotency_key,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?,?,?,?,?)").run(id,ownerId,v.blogId,source,config.provider,CITATION_POSTS,now,v.idempotencyKey??null,now,now);
  return toRun(runById(db,id)!);
 });
}
export const getCitationRun=(db:Database,ownerId:string,id:string)=>toRun(ownedRun(db,ownerId,id));
/** 대기 작업은 바로 취소, 실행 중이면 취소 요청만 남기고 작업자가 다음 글 전에 멈춘다. */
export function cancelCitationRun(db:Database,ownerId:string,id:string,now=Date.now()):CitationRun{
 return transaction(db,()=>{
  const r=ownedRun(db,ownerId,id);
  if(r.state==='queued')db.prepare("UPDATE citation_runs SET state='canceled',completed_at=?,updated_at=? WHERE id=? AND state='queued'").run(now,now,r.id);
  else if(r.state==='running')db.prepare("UPDATE citation_runs SET cancel_requested=1,updated_at=? WHERE id=? AND state='running'").run(now,r.id);
  else throw new AppError(409,'CITATION_FINISHED','이미 끝난 작업입니다.');
  return toRun(runById(db,r.id)!);
 });
}

type ResultRow={id:string;post_id:string;keyword:string;keyword_source:KeywordSource;status:'checked'|'error';briefing:number;exposed:number;text_rank:number|null;image_rank:number|null;evidence_json:string;checked_at:number;viewed_at:number|null;title:string;url:string;category:string;published_at:number|null};
export type CitationRow={id:string;postId:string;title:string;url:string;category:string;publishedAt:number|null;checkedAt:number;keyword:string;keywordSource:KeywordSource;keywordVersion:number;status:'checked'|'error';briefing:boolean;exposed:boolean;textRank:number|null;imageRank:number|null;bodyCited:number;cited:boolean;volume:number|null;saturation:number|null;viewedAt:number|null};
const RESULT_SELECT='SELECT r.id,r.post_id,r.keyword,r.keyword_source,r.status,r.briefing,r.exposed,r.text_rank,r.image_rank,r.evidence_json,r.checked_at,r.viewed_at,p.title,p.url,p.category,p.published_at FROM citation_results r JOIN blog_posts p ON p.id=r.post_id';
export type KeywordMetricDetail={keyword:string;pcVolume:number|null;mobileVolume:number|null;total:number|null;compIdx:'낮음'|'보통'|'높음'|null;documentCount:number|null;saturation:number|null};
function keywordMetricDetail(db:Database,keyword:string):KeywordMetricDetail{
 const m=db.prepare("SELECT m.pc_volume AS pcVolume,m.mobile_volume AS mobileVolume,m.document_count AS documentCount FROM keywords k JOIN keyword_metrics m ON m.keyword_id=k.id WHERE k.phrase=? AND k.status='active' ORDER BY m.measured_at DESC,m.created_at DESC LIMIT 1").get(keyword) as {pcVolume:number;mobileVolume:number;documentCount:number}|undefined;
 const c=classify(m?{...m}:null);
 const compIdx=c.level==='여유'?'낮음':c.level==='보통'?'보통':c.level==='포화'?'높음':null;
 return{keyword,pcVolume:m?.pcVolume??null,mobileVolume:m?.mobileVolume??null,total:c.total,compIdx,documentCount:m?.documentCount??null,saturation:c.saturation};
}
function metricOf(db:Database,keyword:string){
 const d=keywordMetricDetail(db,keyword);
 return{volume:d.total,saturation:d.saturation};
}
function subKeywordMetrics(db:Database,tagsJson:string|undefined,mainKeyword:string):KeywordMetricDetail[]{
 let raw:unknown;try{raw=tagsJson?JSON.parse(tagsJson):[];}catch{raw=[];}
 if(!Array.isArray(raw))return[];
 const seen=new Set([mainKeyword.trim().toLowerCase()]),out:KeywordMetricDetail[]=[];
 for(const item of raw){
  if(typeof item!=='string')continue;
  const tag=item.replace(/^#+/,'').replace(/\s+/g,' ').trim();
  if(tag.length<2||seen.has(tag.toLowerCase()))continue;
  seen.add(tag.toLowerCase());out.push(keywordMetricDetail(db,tag));
  if(out.length>=5)break;
 }
 return out;
}
function relatedKeywordMetrics(db:Database,mainKeyword:string,category:string):KeywordMetricDetail[]{
 const token=mainKeyword.trim().split(/\s+/)[0]??'';
 const like=token.length>=2?`%${token.replace(/[\\%_]/g,v=>'\\'+v)}%`:'';
 const rows=db.prepare("SELECT DISTINCT k.phrase FROM keywords k JOIN keyword_metrics m ON m.keyword_id=k.id WHERE k.status='active' AND k.phrase<>? AND ((?<>'' AND k.category=?) OR (?<>'' AND k.phrase LIKE ? ESCAPE '\\')) LIMIT 20").all(mainKeyword,category,category,like,like) as {phrase:string}[];
 return rows.map(r=>keywordMetricDetail(db,r.phrase)).sort((a,b)=>(b.total??-1)-(a.total??-1)).slice(0,10);
}
/** 이 글이 브리핑 본문 출처로 인용된 횟수. text_rank는 같은 블로그 다른 글의 출처로도 세므로, 글 번호까지 맞는 참조만 센다. */
const bodyCited=(r:ResultRow)=>{
 if(r.text_rank===null)return 0;
 try{
  const evidence=JSON.parse(r.evidence_json) as Evidence;
  const post=naverPostRef(r.url);
  if(!post)return 0;
  return(evidence.briefing?.references??[]).filter(x=>{const ref=naverPostRef(x.link);return ref?.naverId===post.naverId&&ref?.logNo===post.logNo;}).length;
 }catch{return 1;}
};
const toRow=(db:Database,r:ResultRow):CitationRow=>{
 const version=(db.prepare('SELECT version FROM post_keywords WHERE post_id=?').get(r.post_id) as {version:number}|undefined)?.version??0;
 return{id:r.id,postId:r.post_id,title:r.title,url:r.url,category:r.category,publishedAt:r.published_at,checkedAt:r.checked_at,keyword:r.keyword,keywordSource:r.keyword_source,keywordVersion:version,status:r.status,briefing:r.briefing===1,exposed:r.exposed===1,textRank:r.text_rank,imageRank:r.image_rank,bodyCited:bodyCited(r),cited:r.text_rank!==null||r.image_rank!==null,...metricOf(db,r.keyword),viewedAt:r.viewed_at};
};
export type CategoryShare={name:string;total:number;cited:number;exposed:number};
export function summarize(rows:CitationRow[]){
 const checked=rows.filter(r=>r.status==='checked');
 const categories=new Map<string,CategoryShare>();
 for(const r of checked){const name=r.category||'미분류',c=categories.get(name)??{name,total:0,cited:0,exposed:0};c.total++;if(r.cited)c.cited++;if(r.exposed)c.exposed++;categories.set(name,c);}
 return{total:rows.length,checked:checked.length,errors:rows.length-checked.length,exposed:checked.filter(r=>r.exposed).length,briefing:checked.filter(r=>r.briefing).length,
  cited:checked.filter(r=>r.cited).length,textCited:checked.filter(r=>r.textRank!==null).length,imageCited:checked.filter(r=>r.imageRank!==null).length,
  categories:[...categories.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name))};
}

/** AI 인용 현황: 대표 블로그 또는 지정 블로그. blogId=null은 미연결 진단으로 결과 없음. */
export function citationOverview(db:Database,ownerId:string,{blogId,config,now=Date.now()}:{blogId?:string|null;config:CitationConfig|null;now?:number}){
 const blog=(blogId===null?undefined:blogId?db.prepare('SELECT id,naver_id AS naverId,title FROM blogs WHERE id=? AND owner_id=?').get(blogId,ownerId):db.prepare('SELECT id,naver_id AS naverId,title FROM blogs WHERE owner_id=? ORDER BY is_primary DESC,created_at LIMIT 1').get(ownerId)) as {id:string;naverId:string;title:string}|undefined;
 if(blogId&&!blog)throw new AppError(404,'BLOG_NOT_FOUND','블로그를 찾을 수 없습니다.');
 const base={configured:!!config,remaining:remainingCitationsToday(db,ownerId,now),limit:DAILY_CITATION_LIMIT,postsPerRun:CITATION_POSTS};
 if(!blog)return{...base,blog:null,activeRun:null,lastRun:null,report:null};
 const active=db.prepare("SELECT * FROM citation_runs WHERE blog_id=? AND state IN ('queued','running')").get(blog.id) as RunRow|undefined;
 const last=db.prepare("SELECT * FROM citation_runs WHERE blog_id=? AND state IN ('succeeded','failed','canceled') ORDER BY completed_at DESC,created_at DESC,rowid DESC LIMIT 1").get(blog.id) as RunRow|undefined;
 const done=db.prepare("SELECT * FROM citation_runs WHERE blog_id=? AND state='succeeded' ORDER BY completed_at DESC,created_at DESC,rowid DESC LIMIT 1").get(blog.id) as RunRow|undefined;
 const rows=done?(db.prepare(`${RESULT_SELECT} WHERE r.run_id=? ORDER BY p.published_at DESC,r.checked_at DESC`).all(done.id) as ResultRow[]).map(r=>toRow(db,r)):[];
 return{...base,blog:{...blog},activeRun:active?toRun(active):null,lastRun:last?toRun(last):null,report:done?{runId:done.id,checkedAt:done.completed_at??done.updated_at,...summarize(rows),rows}:null};
}
export type CitationOverview=ReturnType<typeof citationOverview>;

function ownedResult(db:Database,ownerId:string,id:string):ResultRow&{naver_id:string;external_id:string;tags_json:string}{
 const r=/^[a-f0-9-]{36}$/.test(id)?db.prepare(`SELECT r.id,r.post_id,r.keyword,r.keyword_source,r.status,r.briefing,r.exposed,r.text_rank,r.image_rank,r.evidence_json,r.checked_at,r.viewed_at,p.title,p.url,p.category,p.published_at,p.external_id,p.tags_json,b.naver_id FROM citation_results r JOIN blog_posts p ON p.id=r.post_id JOIN blogs b ON b.id=r.blog_id WHERE r.id=? AND r.owner_id=? AND b.owner_id=?`).get(id,ownerId,ownerId) as ResultRow&{naver_id:string;external_id:string;tags_json:string}|undefined:undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','AI 인용 확인 결과를 찾을 수 없습니다.');
 return r;
}
/** 상세: 저장한 브리핑 본문·본문 출처·이미지 출처·관련 질문·키워드 지표. 내 블로그·이 글의 출처에 표시를 붙인다. */
export function citationDetail(db:Database,ownerId:string,id:string){
 const r=ownedResult(db,ownerId,id),evidence=JSON.parse(r.evidence_json) as Evidence;
 const mark=(link:string)=>{const ref=naverPostRef(link);const mine=ref?.naverId===r.naver_id.toLowerCase();return{mine,samePost:mine&&ref?.logNo===r.external_id};};
 const briefing=evidence.briefing?{markdown:evidence.briefing.markdown,questions:evidence.briefing.questions,references:evidence.briefing.references.map(x=>({...x,...mark(x.link)})),media:evidence.briefing.media.map(x=>({...x,...mark(x.link)}))}:null;
 const textCitedCount=briefing?briefing.references.filter(x=>x.mine).length:0;
 const samePostCitedCount=briefing?briefing.references.filter(x=>x.samePost).length:0;
 return{...toRow(db,r),briefingDetail:briefing,exposure:evidence.exposure,error:evidence.error??null,searches:evidence.searches,
  textCitedCount,samePostCitedCount,mainKeywordMetric:keywordMetricDetail(db,r.keyword),subKeywords:subKeywordMetrics(db,r.tags_json,r.keyword),relatedKeywords:relatedKeywordMetrics(db,r.keyword,r.category)};
}
/** 회원이 상세를 열어 확인한 시각(튜토리얼 'AI 인용 현황' 보상 조건). GET 조회는 상태를 바꾸지 않는다. */
export function markCitationViewed(db:Database,ownerId:string,id:string,now=Date.now()){
 return transaction(db,()=>{
  const r=ownedResult(db,ownerId,id);
  if(r.viewed_at===null)db.prepare('UPDATE citation_results SET viewed_at=? WHERE id=? AND viewed_at IS NULL').run(now,r.id);
  return{viewedAt:(db.prepare('SELECT viewed_at FROM citation_results WHERE id=?').get(r.id) as {viewed_at:number}).viewed_at};
 });
}
/** 튜토리얼 조건: 성공한 실제 공급자 확인 결과의 상세를 본인이 연 기록. */
export function hasViewedCitation(db:Database,ownerId:string){
 return Boolean(db.prepare("SELECT 1 FROM citation_results r JOIN citation_runs c ON c.id=r.run_id WHERE r.owner_id=? AND c.owner_id=? AND c.state='succeeded' AND r.status='checked' AND r.viewed_at IS NOT NULL").get(ownerId,ownerId));
}
export function hasCitationResult(db:Database,ownerId:string){
 return Boolean(db.prepare("SELECT 1 FROM citation_results r JOIN citation_runs c ON c.id=r.run_id WHERE r.owner_id=? AND c.state='succeeded' AND r.status='checked'").get(ownerId));
}
