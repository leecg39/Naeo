import type {Database} from '../database';
import type {DashboardData} from './dashboard-data';
import type {CitationOverview} from '../citations/runs';
import type {CitationPoint,DashboardVisualization} from '../../lib/dashboard-visualization';

/** Only completed measurements for this member and selected blog enter charts. */
export function dashboardVisualization(db:Database,userId:string,data:DashboardData,citation:CitationOverview):DashboardVisualization{
 const citations=data.blog?(db.prepare(`
  SELECT c.id,coalesce(c.completed_at,c.updated_at) AS measuredAt,
   count(CASE WHEN r.status='checked' THEN 1 END) AS checked,
   count(CASE WHEN r.status='error' THEN 1 END) AS errors,
   count(CASE WHEN r.status='checked' AND (r.text_rank IS NOT NULL OR r.image_rank IS NOT NULL) THEN 1 END) AS cited,
   count(CASE WHEN r.status='checked' AND r.exposed=1 THEN 1 END) AS exposed
  FROM citation_runs c LEFT JOIN citation_results r ON r.run_id=c.id AND r.owner_id=c.owner_id AND r.blog_id=c.blog_id
  WHERE c.owner_id=? AND c.blog_id=? AND c.state='succeeded'
  GROUP BY c.id ORDER BY measuredAt DESC,c.rowid DESC LIMIT 365
 `).all(userId,data.blog.id) as CitationPoint[]).map(row=>({...row})):[];
 return{subject:data.subject,subjects:data.subjects,citationHref:data.blog?`/dashboard/ai-picks?blog=${encodeURIComponent(data.blog.naverId)}`:'/dashboard/ai-picks',now:data.now,connected:!!data.blog,history:data.history,latestSource:data.latestSource,citations,
  citationState:citation.activeRun?'running':citation.lastRun?.state==='failed'?'failed':citation.report?'ready':citation.configured?'empty':'not_configured',
  citedPosts:(citation.report?.rows??[]).filter(r=>r.status==='checked'&&r.cited).slice(0,6).map(r=>({id:r.id,title:r.title,keyword:r.keyword,textRank:r.textRank,imageRank:r.imageRank}))};
}
