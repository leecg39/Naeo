import type {Database} from '../database';
import {collectBlog,type FetchLike} from '../collect/rss';
import type {ScanHandler} from '../jobs/worker';
import {JobCanceled} from '../jobs/worker';
import {analyzePosts,type AiCitationStatus,type PostSample} from './rules';
import {saveScanResult} from './results';
import {AppError} from '../errors';
import {citationConfig} from '../citations/provider';
import {enqueueCitation} from '../citations/runs';
import {mailConfig} from '../mail/provider';
import {queueNotifyMail} from '../mail/notify';

/** 진단이 끝나면 AI 인용 확인을 자동 예약한다(같은 진단 작업은 한 번만). 한도·진행 중이면 이유만 남긴다. */
function scheduleCitation(db:Database,ownerId:string,blogId:string,jobId:string,now:number):AiCitationStatus{
 const config=citationConfig();
 if(!config)return{status:'not_configured'};
 try{return{status:'scheduled',runId:enqueueCitation(db,ownerId,{blogId,idempotencyKey:`scan:${jobId}`},{source:'scan',config},now).id};}
 catch(e){if(e instanceof AppError)return{status:'skipped',reason:e.code};throw e;}
}

/** 진단 작업: RSS 수집 → 최근 글 분석 → (공급자가 있으면) AI 인용 확인 예약 → 결과·이력 저장. */
export function scanHandler(db:Database,fetchImpl:FetchLike=fetch,now:()=>number=Date.now):ScanHandler{
 return async(job,ctx)=>{
  await ctx.progress(10);
  const collected=await collectBlog(db,job.blogId,fetchImpl,now());
  await ctx.progress(60);
  const rows=db.prepare('SELECT title,category,tags_json,published_at FROM blog_posts WHERE blog_id=? ORDER BY published_at DESC LIMIT 200').all(job.blogId) as {title:string;category:string;tags_json:string;published_at:number|null}[];
  const posts:PostSample[]=rows.map(r=>({title:r.title,category:r.category,tags:JSON.parse(r.tags_json) as string[],publishedAt:r.published_at}));
  const report=analyzePosts(posts,now());
  if(ctx.canceled())throw new JobCanceled();
  const {owner_id:ownerId}=db.prepare('SELECT owner_id FROM scan_jobs WHERE id=?').get(job.id) as {owner_id:string};
  report.aiCitation=scheduleCitation(db,ownerId,job.blogId,job.id,now());
  const resultId=saveScanResult(db,{ownerId,blogId:job.blogId,jobId:job.id,report,postCount:posts.length,measuredAt:now()});
  const blog=db.prepare('SELECT title FROM blogs WHERE id=?').get(job.blogId) as {title:string}|undefined;
  const mail=mailConfig();
  // 알림 메일은 부가 기능이므로 큐 적재에 실패해도 진단 결과는 성공으로 남긴다.
  try{queueNotifyMail(db,ownerId,'scan_done',job.id,'NAEO 블로그 분석이 끝났습니다',`${blog?.title??'등록한 블로그'} 진단이 끝났습니다. 점수 ${report.score}점, 수집한 글 ${posts.length}개입니다.\n\n결과 보기: ${mail?mail.appOrigin:''}/dashboard`,mail,now());}
  catch{/* 큐 문제는 진단 결과에 영향을 주지 않는다 */}
  return{resultId,score:report.score,postCount:posts.length,collected};
 };
}
