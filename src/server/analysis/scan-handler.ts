import type {Database} from '../database';
import {collectBlog,type FetchLike} from '../collect/rss';
import type {ScanHandler} from '../jobs/worker';
import {JobCanceled} from '../jobs/worker';
import {analyzePosts,type PostSample} from './rules';
import {saveScanResult} from './results';

/** 진단 작업: RSS 수집 → 최근 글 분석 → 결과·이력 저장. */
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
  const resultId=saveScanResult(db,{ownerId,blogId:job.blogId,jobId:job.id,report,postCount:posts.length,measuredAt:now()});
  return{resultId,score:report.score,postCount:posts.length,collected};
 };
}
