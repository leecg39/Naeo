import type {DashboardBriefing,DashboardChange,DashboardOverview,DashboardRankCard} from '../../lib/dashboard-overview';
import type {CitationPoint,DashboardVisualization} from '../../lib/dashboard-visualization';
import type {CitationOverview} from '../citations/runs';
import type {Database} from '../database';
import {getRecommendationFeed} from '../keywords/discovery-feed';
import {periodRange,type PeriodType} from '../ranking/ranking';
import type {DashboardData} from './dashboard-data';

type CitationRecord={id:string;runId:string;postId:string;keyword:string;title:string;status:'checked'|'error';briefing:number;exposed:number;textRank:number|null;imageRank:number|null;checkedAt:number;evidence:string;volume:number|null;documents:number|null};
type Run={id:string;at:number;state:string};
const cited=(row:CitationRecord)=>row.textRank!==null||row.imageRank!==null;
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const string=(value:unknown)=>typeof value==='string'?value:'';
function evidence(value:string){try{return object(JSON.parse(value));}catch{return{};}}
function httpUrl(value:unknown):string|null{
 if(typeof value!=='string')return null;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
const detailHref=(href:string,id:string)=>`${href}&open=${encodeURIComponent(id)}`;

/** Read stored evidence only; never borrow the captured account's screenshots. */
function briefings(rows:CitationRecord[],href:string):DashboardBriefing[]{
 return rows.filter(r=>r.status==='checked'&&r.briefing===1).flatMap(row=>{
  const briefing=object(evidence(row.evidence).briefing),markdown=string(briefing.markdown);
  const media=(Array.isArray(briefing.media)?briefing.media:[]).flatMap(item=>{
   const value=object(item),url=httpUrl(value.link),thumbnail=httpUrl(value.thumbnail);
   return url&&thumbnail?[{title:string(value.title),url,thumbnail}]:[];
  }).slice(0,8);
  const references=(Array.isArray(briefing.references)?briefing.references:[]).flatMap(item=>{
   const value=object(item),url=httpUrl(value.link);
   return url?[{title:string(value.title),url}]:[];
  }).slice(0,10);
  if(!markdown&&!media.length&&!references.length)return[];
  return[{id:row.id,title:row.title,keyword:row.keyword,cited:cited(row),checkedAt:row.checkedAt,markdown,media,references,href:detailHref(href,row.id)}];
 }).sort((a,b)=>Number(b.cited)-Number(a.cited)||b.checkedAt-a.checkedAt).slice(0,28);
}

/** Two checked measurements of the same post and exact keyword establish a change. */
function citationChanges(rows:CitationRecord[],href:string):DashboardChange[]{
 const previous=new Map<string,CitationRecord>(),changes:DashboardChange[]=[];
 for(const row of [...rows].sort((a,b)=>a.checkedAt-b.checkedAt||a.id.localeCompare(b.id))){
  if(row.status!=='checked')continue;
  const key=JSON.stringify([row.postId,row.keyword]),before=previous.get(key);
  previous.set(key,row);
  if(!before||row.checkedAt===before.checkedAt)continue;
  const add=(kind:DashboardChange['kind'],title:string)=>changes.push({id:`${row.id}:${kind}`,kind,title,description:`${row.title} · ${row.keyword}`,at:row.checkedAt,href:detailHref(href,row.id)});
  if(cited(before)!==cited(row))add(cited(row)?'citation_gained':'citation_lost',cited(row)?'AI 브리핑에 새로 인용됨':'AI 브리핑 인용에서 제외됨');
  if(before.exposed!==row.exposed)add(row.exposed?'exposure_gained':'exposure_lost',row.exposed?'검색 결과에 새로 노출됨':'검색 결과에서 노출 제외됨');
 }
 return changes;
}

type RankEntry={userId:string;category:string;naverId:string;rank:number};
function rankingCards(db:Database,userId:string,now:number,selectedNaverId:string|undefined):DashboardOverview['rankings']{
 const primary=db.prepare('SELECT naver_id AS naverId,category FROM blogs WHERE owner_id=? AND is_primary=1 LIMIT 1').get(userId) as {naverId:string;category:string}|undefined;
 const visible=!!db.prepare("SELECT 1 FROM profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND p.ranking_public=1 AND u.status='active'").get(userId);
 const scopes:{scope:'all'|'category';label:string}[]=[{scope:'all',label:'모든 블로그'},...(primary?.category?[{scope:'category' as const,label:primary.category}]:[])];
 const current=new Map<PeriodType,RankEntry[]>();
 for(const period of ['all','month','week'] as const){
  const range=periodRange(period,0,now);
  // Same public/active/primary and tie-break rules as rankingView; exclude future scans.
  const rows=db.prepare(`SELECT userId,category,naverId FROM (
   SELECT r.owner_id AS userId,b.category,b.naver_id AS naverId,r.score,r.measured_at,p.nickname,
    row_number() OVER (PARTITION BY r.owner_id ORDER BY r.measured_at DESC,r.id) AS latest
   FROM scan_results r JOIN blogs b ON b.id=r.blog_id AND b.owner_id=r.owner_id AND b.is_primary=1
   JOIN users u ON u.id=r.owner_id AND u.status='active'
   JOIN profiles p ON p.user_id=r.owner_id AND p.ranking_public=1
   WHERE r.measured_at>=? AND r.measured_at<? AND r.measured_at<=?
  ) WHERE latest=1 ORDER BY score DESC,measured_at ASC,nickname ASC,userId ASC`).all(range.start,range.end,now) as Omit<RankEntry,'rank'>[];
  current.set(period,rows.map((row,i)=>({...row,rank:i+1})));
 }
 return scopes.map(({scope,label})=>({scope,label,cards:(['all','month','week'] as const).map(period=>{
  const rows=(current.get(period)??[]).filter(r=>scope==='all'||r.category===primary?.category);
  const index=rows.findIndex(r=>r.userId===userId),rank=visible&&index>=0?(scope==='all'?rows[index].rank:index+1):null;
  const history:DashboardRankCard['history']=[];
  if(visible&&primary&&period!=='all'){
   const currentPeriod=periodRange(period,0,now);
   const snapshots=db.prepare(`SELECT s.rank,s.category,p.ends_at AS at,s.period_key AS periodKey
    FROM ranking_snapshots s JOIN ranking_periods p ON p.period_type=s.period_type AND p.period_key=s.period_key
    WHERE s.user_id=? AND s.naver_id=? AND s.period_type=? AND s.measured_at<=? AND p.ends_at<=? AND p.confirmed_at<=?
    ORDER BY p.ends_at DESC LIMIT 12`).all(userId,primary.naverId,period,now,currentPeriod.start,now) as {rank:number;category:string;at:number;periodKey:string}[];
   for(const snapshot of snapshots.reverse()){
    if(scope==='category'&&snapshot.category!==primary.category)continue;
    const historicalRank=scope==='all'?snapshot.rank:(db.prepare('SELECT count(*) AS n FROM ranking_snapshots WHERE period_type=? AND period_key=? AND category=? AND rank<=? AND measured_at<=?').get(period,snapshot.periodKey,primary.category,snapshot.rank,now) as {n:number}).n;
    if(historicalRank>0)history.push({at:snapshot.at,rank:historicalRank});
   }
  }
  const previous=history.at(-1),comparable=previous&&previous.at<now,delta=rank!==null&&comparable?previous.rank-rank:null;
  if(comparable&&rank!==null)history.push({at:now,rank});
  const periodLabel=period==='all'?'누적':period==='month'?'이번 달':'이번 주';
  return{period,label:period==='all'?'전체':period==='month'?'월간':'주간',periodLabel:primary&&selectedNaverId!==primary.naverId?`대표 블로그 · ${periodLabel}`:periodLabel,rank,participants:rows.length,public:visible,delta,history};
 })}));
}

/** Current public global rank versus the latest confirmed, earlier period only. */
function rankChanges(rankings:DashboardOverview['rankings'],now:number):DashboardChange[]{
 return(rankings.find(scope=>scope.scope==='all')?.cards??[]).flatMap(card=>{
  if(card.period==='all'||!card.public||card.rank===null||!card.delta||card.history.length<2)return[];
  const previous=card.history.at(-2)!,current=card.history.at(-1)!;
  if(previous.at>=current.at||current.at>now||previous.at>periodRange(card.period,0,now).start)return[];
  return[{id:`rank:${card.period}:${previous.at}:${card.rank}`,kind:'rank' as const,title:`${card.label} 순위 ${Math.abs(card.delta)}계단 ${card.delta>0?'상승':'하락'}`,description:`대표 블로그 · 전체 ${previous.rank}위 → ${card.rank}위`,at:current.at,href:'/ranking'}];
 });
}

/** Member-owned, read-only dashboard summary. No provider call or recommendation generation. */
export function dashboardOverview(db:Database,userId:string,data:DashboardData,citation:CitationOverview,visualization:DashboardVisualization):DashboardOverview{
 const now=data.now;
 const blog=data.blog?db.prepare('SELECT id,naver_id AS naverId,category FROM blogs WHERE id=? AND owner_id=?').get(data.blog.id,userId) as {id:string;naverId:string;category:string}|undefined:undefined;
 const citationHref=blog?`/dashboard/ai-picks?blog=${encodeURIComponent(blog.naverId)}`:'/dashboard/ai-picks';
 const recommendationHref=blog?`/dashboard/recommendations?blogId=${encodeURIComponent(blog.id)}`:'/dashboard/recommendations';
 const feed=blog?getRecommendationFeed(db,userId,{blogId:blog.id,pageSize:12},now):null;
 const runs=blog?db.prepare(`SELECT id,coalesce(completed_at,updated_at) AS at,state FROM citation_runs
  WHERE owner_id=? AND blog_id=? AND state IN ('succeeded','failed','canceled') AND created_at<=? AND coalesce(completed_at,updated_at)<=?
  ORDER BY at DESC,rowid DESC LIMIT 365`).all(userId,blog.id,now,now) as Run[]:[];
 const successful=runs.filter(r=>r.state==='succeeded');
 const rows=blog?db.prepare(`SELECT r.id,r.run_id AS runId,r.post_id AS postId,r.keyword,p.title,r.status,r.briefing,r.exposed,r.text_rank AS textRank,r.image_rank AS imageRank,r.checked_at AS checkedAt,r.evidence_json AS evidence,
  (SELECT m.pc_volume+m.mobile_volume FROM keywords k JOIN keyword_metrics m ON m.keyword_id=k.id WHERE k.phrase=r.keyword AND k.status='active' AND m.measured_at<=? ORDER BY m.measured_at DESC,m.created_at DESC LIMIT 1) AS volume,
  (SELECT m.document_count FROM keywords k JOIN keyword_metrics m ON m.keyword_id=k.id WHERE k.phrase=r.keyword AND k.status='active' AND m.measured_at<=? ORDER BY m.measured_at DESC,m.created_at DESC LIMIT 1) AS documents
  FROM citation_results r JOIN citation_runs c ON c.id=r.run_id AND c.owner_id=r.owner_id AND c.blog_id=r.blog_id
  JOIN blog_posts p ON p.id=r.post_id AND p.blog_id=r.blog_id
  JOIN blogs b ON b.id=r.blog_id AND b.owner_id=r.owner_id
  WHERE r.owner_id=? AND r.blog_id=? AND c.state='succeeded' AND c.created_at<=? AND coalesce(c.completed_at,c.updated_at)<=? AND r.checked_at<=?
  ORDER BY r.checked_at DESC,r.id`).all(now,now,userId,blog.id,now,now,now) as CitationRecord[]:[];
 const runIds=new Set(successful.map(r=>r.id)),boundedRows=rows.filter(r=>runIds.has(r.runId));
 const latest=successful[0],latestRows=latest?boundedRows.filter(r=>r.runId===latest.id):[],checked=latestRows.filter(r=>r.status==='checked');
 const citations:CitationPoint[]=successful.map(run=>{const current=boundedRows.filter(r=>r.runId===run.id),valid=current.filter(r=>r.status==='checked');return{id:run.id,measuredAt:run.at,checked:valid.length,errors:current.length-valid.length,cited:valid.filter(cited).length,exposed:valid.filter(r=>r.exposed===1).length};});
 const active=blog&&db.prepare("SELECT 1 FROM citation_runs WHERE owner_id=? AND blog_id=? AND state IN ('queued','running') AND created_at<=?").get(userId,blog.id,now);
 const citationState=active?'running':runs[0]?.state==='failed'?'failed':latest?'ready':citation.configured?'empty':'not_configured';
 const recommendations=[...new Map([...(feed?.goldenItems??[]),...(feed?.items??[])].map(item=>[item.id,item])).values()].slice(0,12).map(item=>({id:item.id,phrase:item.phrase,signal:item.signal,volume:item.measuredAt!==null&&item.measuredAt>now?null:item.total,saturation:item.measuredAt!==null&&item.measuredAt>now?null:item.saturation,href:`${recommendationHref}&q=${encodeURIComponent(item.phrase)}`}));
 const rankings=rankingCards(db,userId,now,data.subject?.naverId??visualization.subject?.naverId);
 const changes:DashboardChange[]=[...citationChanges(boundedRows,citationHref),...rankChanges(rankings,now),...data.history.filter(r=>r.measuredAt<=now).map(r=>({id:`scan:${r.id}`,kind:'scan' as const,title:`${r.source==='mate'?'무료 진단':'블로그 스캔'} ${r.score}점`,description:`분석한 글 ${r.postCount}개 · 할 일 ${r.actions.length}개`,at:r.measuredAt,href:'/dashboard/mate'}))];
 // The supplied visualization shares the selected subject; query evidence above to avoid stale/future payloads.
 return{now,subject:data.subject,category:blog?.category??'',connected:!!blog,citationState,citationHref,recommendationHref,
  metrics:{checked:latest?checked.length:null,cited:checked.length?checked.filter(cited).length:null,exposed:checked.length?checked.filter(r=>r.exposed===1).length:null,briefing:checked.length?checked.filter(r=>r.briefing===1).length:null,revisit:feed?.summary.revisit??0,opportunity:feed?.summary.opportunity??0,recommendations:feed?.summary.total??0},
  monitoring:briefings(latestRows,citationHref),citations,rankings,
  citedPosts:checked.filter(cited).slice(0,6).map(r=>({id:r.id,title:r.title,keyword:r.keyword,textRank:r.textRank,imageRank:r.imageRank,volume:r.volume,saturation:r.volume!==null&&r.volume>0&&r.documents!==null?r.documents/r.volume:null,href:detailHref(citationHref,r.id)})),
  recommendations,changes:changes.sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id)).slice(0,100)};
}
