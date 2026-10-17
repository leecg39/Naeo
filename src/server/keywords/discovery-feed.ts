import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';
import {autoKeyword} from '../citations/keywords';
import {currentSubscription} from '../billing/subscriptions';
import {collectBlog,CollectError} from '../collect/rss';
import {rateLimit} from '../http';
import {paginationInput} from '../validation';
import {type FetchLike,ProviderError} from '../generation/provider';
import {blogSearch,newsSearch,naverSearchConfig,type NaverSearchConfig} from '../competitors/naver-search';
import {relatedKeywordStats,searchAdConfig,type SearchAdConfig} from './searchad';
import {phraseKey} from './recommendations';
import {MEMBER_KEYWORD_LIMIT} from './member-keywords';
import {localDiscoveryCandidates,metricPoint,type DiscoveryCandidate} from './discovery-sources';
import type {DiscoveredRecommendation,RecommendationFeed,RecommendationMetricPoint,RecommendationCompetition} from '../../lib/recommendation-feed';

const DAY=86_400_000,LEASE=10*60_000;
export const recommendationFeedQuery=paginationInput.extend({blogId:z.string().max(100).default(''),period:z.enum(['all','week','month']).default('all'),filter:z.enum(['all','golden','new','opportunity','revisit','rewritten','written','unwritten']).default('all'),sort:z.enum(['score','pc','mobile','total','documents','saturation']).default('score'),direction:z.enum(['asc','desc']).default('desc')});
const refreshInput=z.object({blogId:z.string().max(100).optional()}).strict();
const updateInput=z.object({version:z.number().int().positive(),written:z.boolean().optional(),dismissed:z.boolean().optional(),saved:z.boolean().optional()}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
const versionInput=z.object({version:z.number().int().positive()}).strict();
type ProviderOptions={fetchImpl?:FetchLike;ads?:SearchAdConfig|null;search?:NaverSearchConfig|null};
type Blog={id:string;title:string;naver_id:string;is_primary:number;version:number};
type Build={id:string;source:'local'|'refresh';state:string;new_count:number;completed_at:number|null;lease_until:number;notice:string|null};
type Row={id:string;blog_id:string;phrase:string;category:string;signal:DiscoveredRecommendation['signal'];score:number;reason:string;source:DiscoveredRecommendation['source'];source_post_id:string|null;post_title:string|null;post_url:string|null;pc_volume:number|null;mobile_volume:number|null;document_count:number|null;measured_at:number|null;history_json:string;related_json:string;competition_json:string;written:number;dismissed:number;version:number;recommended_at:number;updated_at:number;saved_keyword_id:string|null};
const ROW_SELECT=`SELECT r.*,p.title AS post_title,p.url AS post_url,k.id AS saved_keyword_id FROM member_recommendations r JOIN blogs b ON b.id=r.blog_id AND b.owner_id=r.owner_id
 LEFT JOIN blog_posts p ON p.id=r.source_post_id AND p.blog_id=r.blog_id LEFT JOIN member_keywords k ON k.owner_id=r.owner_id AND k.phrase_key=r.phrase_key`;
const parse=<T>(value:string,fallback:T):T=>{try{return JSON.parse(value) as T;}catch{return fallback;}};
const emptyCompetition=():RecommendationCompetition=>({blogs:[],news:[],checkedAt:null,error:null});
const kstMonth=(now:number)=>{const d=new Date(now+9*3600_000);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)-9*3600_000;};
function planFor(db:Database,ownerId:string,now:number):RecommendationFeed['plan']{
 const sub=currentSubscription(db,ownerId,now),paid=Boolean(sub);
 return{paid,name:sub?.planName??'무료',cycleDays:paid?7:30,perBuild:paid?25:3,monthlyLimit:paid?100:3,goldenLimit:paid?10:3};
}
function ownedBlog(db:Database,ownerId:string,requested?:string):Blog|null{
 const row=db.prepare(`SELECT id,title,naver_id,is_primary,version FROM blogs WHERE owner_id=? ${requested?'AND id=?':''} ORDER BY is_primary DESC,created_at DESC,id LIMIT 1`).get(...(requested?[ownerId,requested]:[ownerId])) as Blog|undefined;
 if(requested&&!row)throw new AppError(404,'BLOG_NOT_FOUND','본인 블로그를 찾을 수 없습니다.');
 return row??null;
}
function publishedKeywords(db:Database,ownerId:string,blogId:string){
 const rows=db.prepare(`SELECT p.title,p.tags_json,k.keyword FROM blog_posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN post_keywords k ON k.post_id=p.id AND k.owner_id=b.owner_id WHERE b.owner_id=? AND b.id=? ORDER BY p.collected_at DESC LIMIT 200`).all(ownerId,blogId) as {title:string;tags_json:string;keyword:string|null}[];
 const values=rows.map(p=>({title:phraseKey(p.title),keyword:phraseKey(p.keyword??autoKeyword(p.title,parse<string[]>(p.tags_json,[]))?.keyword??'')}));
 return(phrase:string)=>values.some(p=>p.keyword===phraseKey(phrase)||p.title.includes(phraseKey(phrase)));
}
function plain(row:Row,published=false):DiscoveredRecommendation{
 const total=row.pc_volume===null||row.mobile_volume===null?null:row.pc_volume+row.mobile_volume;
 const saturation=total===null||total===0||row.document_count===null?null:row.document_count/total;
 return{id:row.id,blogId:row.blog_id,phrase:row.phrase,category:row.category,signal:row.signal,score:row.score,reason:row.reason,source:row.source,sourcePost:row.source_post_id&&row.post_title&&row.post_url?{id:row.source_post_id,title:row.post_title,url:row.post_url}:null,
  pcVolume:row.pc_volume,mobileVolume:row.mobile_volume,total,documentCount:row.document_count,saturation,measuredAt:row.measured_at,
  alreadyPublished:published||row.source==='citation',golden:!row.written&&!published&&row.source!=='citation'&&total!==null&&total>=1000&&saturation!==null&&saturation<=1,
  opportunity:row.signal==='opportunity'&&total!==null&&total>=1000&&row.document_count!==null&&row.document_count>0&&row.document_count<10000,
  written:!!row.written,dismissed:!!row.dismissed,saved:!!row.saved_keyword_id,savedKeywordId:row.saved_keyword_id,
  history:parse(row.history_json,[]),related:parse(row.related_json,[]),competition:parse(row.competition_json,emptyCompetition()),recommendedAt:row.recommended_at,updatedAt:row.updated_at,version:row.version};
}
export function getRecommendation(db:Database,ownerId:string,id:string){
 const row=db.prepare(`${ROW_SELECT} WHERE r.owner_id=? AND r.id=?`).get(ownerId,id) as Row|undefined;
 if(!row)throw new AppError(404,'RECOMMENDATION_NOT_FOUND','추천 키워드를 찾을 수 없습니다.');
 return plain(row,publishedKeywords(db,ownerId,row.blog_id)(row.phrase));
}
const ownRecommendation=getRecommendation;
function monthlyUsed(db:Database,ownerId:string,now:number){return(db.prepare("SELECT coalesce(sum(new_count),0) AS n FROM recommendation_builds WHERE owner_id=? AND state='succeeded' AND started_at>=? AND started_at<=?").get(ownerId,kstMonth(now),now) as {n:number}).n;}
function latestBuild(db:Database,ownerId:string,blogId:string){return db.prepare("SELECT * FROM recommendation_builds WHERE owner_id=? AND blog_id=? AND state='succeeded' ORDER BY completed_at DESC,id DESC LIMIT 1").get(ownerId,blogId) as Build|undefined;}

/** 조회는 네트워크·생성을 수행하지 않는다. bootstrap은 rebuildLocalRecommendations를 한 번 호출한다. */
export function getRecommendationFeed(db:Database,ownerId:string,input:unknown={},now=Date.now()):RecommendationFeed{
 const q=recommendationFeedQuery.parse(input),selected=ownedBlog(db,ownerId,q.blogId),plan=planFor(db,ownerId,now),used=monthlyUsed(db,ownerId,now);
 const blogs=(db.prepare('SELECT id,title,naver_id,is_primary FROM blogs WHERE owner_id=? ORDER BY is_primary DESC,created_at DESC,id').all(ownerId) as Blog[]).map(b=>({id:b.id,title:b.title,naverId:b.naver_id,isPrimary:!!b.is_primary}));
 const latest=selected?latestBuild(db,ownerId,selected.id):undefined;
 const published=selected?publishedKeywords(db,ownerId,selected.id):()=>false;
 const all=selected?(db.prepare(`${ROW_SELECT} WHERE r.owner_id=? AND r.blog_id=? AND r.dismissed=0 AND r.recommended_at<=?`).all(ownerId,selected.id,now) as Row[]).map(r=>plain(r,published(r.phrase))):[];
 const since=q.period==='week'?now-7*DAY:q.period==='month'?kstMonth(now):0,term=q.q.toLocaleLowerCase();
 const filtered=all.filter(r=>r.recommendedAt>=since&&`${r.phrase}\n${r.category}`.toLocaleLowerCase().includes(term));
 const summary={total:filtered.length,golden:filtered.filter(r=>r.golden).length,written:filtered.filter(r=>r.written).length,opportunity:filtered.filter(r=>r.opportunity).length,revisit:filtered.filter(r=>r.signal==='revisit'||r.signal==='rewritten').length,rewritten:filtered.filter(r=>r.signal==='rewritten').length,new:filtered.filter(r=>r.signal==='new').length};
 const number=(a:number|null,b:number|null)=>a===null?(b===null?0:1):b===null?-1:(a-b)*(q.direction==='asc'?1:-1);
 const value=(r:DiscoveredRecommendation)=>q.sort==='pc'?r.pcVolume:q.sort==='mobile'?r.mobileVolume:q.sort==='total'?r.total:q.sort==='documents'?r.documentCount:q.sort==='saturation'?r.saturation:r.score;
 const sort=(a:DiscoveredRecommendation,b:DiscoveredRecommendation)=>number(value(a),value(b))||b.recommendedAt-a.recommendedAt||a.phrase.localeCompare(b.phrase,'ko');
 const goldenItems=filtered.filter(r=>r.golden).sort(sort).slice(0,plan.goldenLimit);
 const goldenIds=new Set(goldenItems.map(r=>r.id));
 const matched=filtered.filter(r=>q.filter==='all'&&!goldenIds.has(r.id)||q.filter==='golden'&&r.golden||q.filter==='written'&&r.written||q.filter==='unwritten'&&!r.written||q.filter==='opportunity'&&r.opportunity||q.filter==='revisit'&&r.signal==='rewritten'||q.filter===r.signal).sort(sort);
 const page=Math.min(q.page,Math.max(1,Math.ceil(matched.length/q.pageSize)));
 const postCount=selected?(db.prepare('SELECT count(*) AS n FROM blog_posts WHERE blog_id=?').get(selected.id) as {n:number}).n:0;
 const lastBuiltAt=latest?.completed_at??null;
 return{status:!selected?'no_blog':!postCount?'needs_scan':all.length?'ready':'no_candidates',blogs,selectedBlogId:selected?.id??null,plan,cap:{used,remaining:Math.max(0,plan.monthlyLimit-used)},nextBuildAt:lastBuiltAt===null?null:lastBuiltAt+plan.cycleDays*DAY,lastBuiltAt,building:!!db.prepare("SELECT 1 FROM recommendation_builds WHERE owner_id=? AND state='running' AND lease_until>?").get(ownerId,now),providers:{searchAd:!!searchAdConfig(),naverSearch:!!naverSearchConfig()},notice:latest?.notice??null,summary,items:matched.slice((page-1)*q.pageSize,page*q.pageSize),goldenItems,pagination:{page,pageSize:q.pageSize,total:matched.length},query:{...q,blogId:selected?.id??'',page}};
}

function startBuild(db:Database,ownerId:string,blog:Blog,source:'local'|'refresh',now:number){
 return transaction(db,()=>{
  if(!ownedBlog(db,ownerId,blog.id))throw new AppError(404,'BLOG_NOT_FOUND','블로그를 찾을 수 없습니다.');
  db.prepare("UPDATE recommendation_builds SET state='failed',completed_at=?,error_message='중단된 추천 작업' WHERE owner_id=? AND state='running' AND lease_until<=?").run(now,ownerId,now);
  if(db.prepare("SELECT 1 FROM recommendation_builds WHERE owner_id=? AND state='running'").get(ownerId))throw new AppError(409,'RECOMMENDATION_BUILDING','추천을 만들고 있습니다. 잠시 후 새로고침해주세요.');
  const plan=planFor(db,ownerId,now),latest=latestBuild(db,ownerId,blog.id);
  const inCycle=!!latest?.completed_at&&latest.completed_at+plan.cycleDays*DAY>now;
  const enrich=source==='refresh'&&inCycle&&latest?.source==='local';
  if(inCycle&&!enrich)return null;
  const remaining=Math.max(0,plan.monthlyLimit-monthlyUsed(db,ownerId,now));
  if(!remaining&&!db.prepare('SELECT 1 FROM member_recommendations WHERE owner_id=? AND blog_id=?').get(ownerId,blog.id))return null;
  const id=randomUUID();db.prepare("INSERT INTO recommendation_builds(id,owner_id,blog_id,state,source,started_at,lease_until) VALUES(?,?,?,'running',?,?,?)").run(id,ownerId,blog.id,source,now,now+LEASE);
  return{id,limit:enrich?0:Math.min(plan.perBuild,remaining),enrich};
 });
}
function failBuild(db:Database,id:string,ownerId:string,message:string,now:number){db.prepare("UPDATE recommendation_builds SET state='failed',completed_at=?,error_message=? WHERE id=? AND owner_id=? AND state='running'").run(now,message.slice(0,300),id,ownerId);}
function persistBuild(db:Database,ownerId:string,blog:Blog,build:{id:string;limit:number;enrich?:boolean},candidates:DiscoveryCandidate[],notice:string|null,now:number){
 return transaction(db,()=>{
  const current=ownedBlog(db,ownerId,blog.id);
  if(current?.version!==blog.version)throw new AppError(409,'VERSION_CONFLICT','추천 생성 중 블로그 정보가 변경되었습니다. 다시 시도해주세요.');
  if(!db.prepare("SELECT 1 FROM recommendation_builds WHERE id=? AND owner_id=? AND state='running' AND lease_until>?").get(build.id,ownerId,now))throw new AppError(409,'RECOMMENDATION_BUILD_EXPIRED','추천 생성 작업이 만료되었습니다. 다시 시도해주세요.');
  const existing=(db.prepare(`${ROW_SELECT} WHERE r.owner_id=? AND r.blog_id=?`).all(ownerId,blog.id) as Row[]).map(r=>plain(r)),byKey=new Map(existing.map(r=>[phraseKey(r.phrase),r]));
  const candidateByKey=new Map(candidates.map(c=>[phraseKey(c.phrase),c]));
  // 이전 추천은 작성 또는 숨김을 누르기 전까지 보존한다. 생성 실패로 지표를 지우지 않는다.
  for(const old of existing){
   if(old.dismissed||old.written)continue;
   const c=candidateByKey.get(phraseKey(old.phrase));
   const preserveComplete=c?.documentCount==null&&old.documentCount!==null&&old.pcVolume!==null&&old.mobileVolume!==null;
   const pc=preserveComplete?old.pcVolume:c?.pcVolume??old.pcVolume,mobile=preserveComplete?old.mobileVolume:c?.mobileVolume??old.mobileVolume,docs=preserveComplete?old.documentCount:c?.documentCount??old.documentCount,measured=preserveComplete?old.measuredAt:c?.measuredAt??old.measuredAt;
   const total=pc===null||mobile===null?null:pc+mobile;
   const signal=c?.signal==='rewritten'?'rewritten':build.enrich?(old.signal==='new'&&total!==null&&total>=1000&&docs!==null&&docs>0&&docs<10000?'opportunity':old.signal):'revisit';
   const history=mergeHistory(old.history,c?.history??[]);
   db.prepare('UPDATE member_recommendations SET signal=?,reason=?,score=?,source=?,source_post_id=?,category=?,pc_volume=?,mobile_volume=?,document_count=?,measured_at=?,history_json=?,related_json=?,recommended_at=?,updated_at=?,version=version+1 WHERE id=? AND owner_id=?')
    .run(signal,build.enrich?(c?.reason??old.reason):c?.signal==='rewritten'?c.reason:`이전에 추천한 ‘${old.phrase}’의 작성 완료가 아직 표시되지 않아 다시 추천합니다. ${c?.reason??old.reason.replace(/^이전에 추천한.*?다시 추천합니다\. /,'')}`,c?.score??old.score,c?.source??old.source,c?.sourcePost?.id??old.sourcePost?.id??null,c?.category??old.category,pc,mobile,docs,measured,JSON.stringify(history),JSON.stringify(c?.related.length?c.related:old.related),build.enrich?old.recommendedAt:now,now,old.id,ownerId);
  }
  let inserted=0;
  for(const c of candidates){
   if(inserted>=build.limit)break;if(byKey.has(phraseKey(c.phrase)))continue;
   const total=c.pcVolume===null||c.mobileVolume===null?null:c.pcVolume+c.mobileVolume;
   const opportunity=c.signal!=='rewritten'&&total!==null&&total>=1000&&c.documentCount!==null&&c.documentCount>0&&c.documentCount<10000;
   const id=randomUUID();db.prepare(`INSERT INTO member_recommendations(id,owner_id,blog_id,phrase,phrase_key,category,signal,score,reason,source,source_post_id,pc_volume,mobile_volume,document_count,measured_at,history_json,related_json,recommended_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,ownerId,blog.id,c.phrase,phraseKey(c.phrase),c.category,opportunity?'opportunity':c.signal,c.score,c.reason,c.source,c.sourcePost?.id??null,c.pcVolume,c.mobileVolume,c.documentCount,c.measuredAt,JSON.stringify(mergeHistory([],c.history)),JSON.stringify(c.related),now,now,now);
   byKey.set(phraseKey(c.phrase),{} as DiscoveredRecommendation);inserted++;
  }
  db.prepare("UPDATE recommendation_builds SET state='succeeded',new_count=?,completed_at=?,notice=? WHERE id=? AND owner_id=?").run(inserted,now,notice,build.id,ownerId);
  return inserted;
 });
}
function mergeHistory(a:RecommendationMetricPoint[],b:RecommendationMetricPoint[]){
 const seen=new Map<string,RecommendationMetricPoint>();
 for(const p of [...a,...b])seen.set(`${p.at}:${p.source}`,p);
 return[...seen.values()].sort((x,y)=>x.at-y.at).slice(-12);
}
/** 같은 주기 안에서도 새로 확인된 정상 인용 하락은 기존 추천에 즉시 반영한다. 새 슬롯은 소비하지 않는다. */
function reassessCitations(db:Database,ownerId:string,blogId:string,candidates:DiscoveryCandidate[],now:number){
 transaction(db,()=>{for(const c of candidates){
  if(c.signal!=='rewritten')continue;
  db.prepare("UPDATE member_recommendations SET signal='rewritten',reason=?,score=?,source='citation',source_post_id=?,updated_at=?,version=version+1 WHERE owner_id=? AND blog_id=? AND phrase_key=? AND written=0 AND dismissed=0 AND (signal<>'rewritten' OR reason<>?)").run(c.reason,c.score,c.sourcePost?.id??null,now,ownerId,blogId,phraseKey(c.phrase),c.reason);
 }});
}
/** 스캔 완료 훅 또는 첫 화면 bootstrap 전용. 네트워크를 사용하지 않는다. */
export function rebuildLocalRecommendations(db:Database,ownerId:string,blogId:string,now=Date.now()):RecommendationFeed{
 const blog=ownedBlog(db,ownerId,blogId)!;
 const local=localDiscoveryCandidates(db,ownerId,blog.id,now);
 if(!local.posts.length)return getRecommendationFeed(db,ownerId,{blogId},now);
 const build=startBuild(db,ownerId,blog,'local',now);if(!build){reassessCitations(db,ownerId,blogId,local.candidates,now);return getRecommendationFeed(db,ownerId,{blogId},now);}
 try{persistBuild(db,ownerId,blog,build,local.candidates,'수집한 본인 글과 공개 지표를 분석했습니다. 검색량이 없는 글감은 추론 후보로 표시합니다.',now);}
 catch(e){failBuild(db,build.id,ownerId,'분석 기반 추천을 저장하지 못했습니다.',now);throw e;}
 return getRecommendationFeed(db,ownerId,{blogId},now);
}
async function boundedMap<T>(values:T[],count:number,fn:(value:T)=>Promise<void>){let index=0;await Promise.all(Array.from({length:Math.min(count,values.length)},async()=>{for(;;){const i=index++;if(i>=values.length)return;await fn(values[i]);}}));}
/** 직접 새로고침: 등록된 본인 블로그 RSS, 광고 연관어 및 문서수만 요청한다. 최대 10개 문서수 조회, 동시 3개. */
export async function refreshRecommendationFeed(db:Database,ownerId:string,input:unknown={},options:ProviderOptions={},now=Date.now()):Promise<RecommendationFeed>{
 const {blogId}=refreshInput.parse(input),blog=ownedBlog(db,ownerId,blogId);
 if(!blog)throw new AppError(400,'BLOG_REQUIRED','추천을 받으려면 먼저 블로그를 등록해주세요.');
 const build=startBuild(db,ownerId,blog,'refresh',now);if(!build)return getRecommendationFeed(db,ownerId,{blogId:blog.id},now);
 const ads=options.ads===undefined?searchAdConfig():options.ads,search=options.search===undefined?naverSearchConfig():options.search;
 const notes:string[]=[];let providerFailed=false,documentFailures=0;
 if(build.enrich&&!ads){failBuild(db,build.id,ownerId,'검색광고 연결을 기다립니다.',now);return{...getRecommendationFeed(db,ownerId,{blogId:blog.id},now),notice:'검색광고 연결 전에는 기존 분석 기반 후보를 계속 사용할 수 있습니다.'};}
 try{
  let local=localDiscoveryCandidates(db,ownerId,blog.id,now);
  if(!local.posts.length){await collectBlog(db,blog.id,options.fetchImpl,now);ownedBlog(db,ownerId,blog.id);local=localDiscoveryCandidates(db,ownerId,blog.id,now);}
  if(!local.posts.length)throw new CollectError('NO_PUBLIC_POSTS','추천에 사용할 공개 글이 없습니다.',false);
  const candidates=local.candidates;
  if(ads&&local.topics.length){
   try{
    const existing=(db.prepare('SELECT phrase FROM member_recommendations WHERE owner_id=? AND blog_id=? AND written=0 AND dismissed=0 ORDER BY score DESC LIMIT 3').all(ownerId,blog.id) as {phrase:string}[]).map(r=>r.phrase);
    const hints=[...new Map([...existing,...local.topics.map(t=>t.phrase)].map(p=>[phraseKey(p),p])).values()].slice(0,5);
    const stats=await relatedKeywordStats(ads,hints,options.fetchImpl);
    const measured=[...stats.values()].sort((a,b)=>b.pcVolume+b.mobileVolume-a.pcVolume-a.mobileVolume).slice(0,40);
    for(const stat of measured){
     const existing=candidates.find(c=>phraseKey(c.phrase)===phraseKey(stat.phrase));
     const related=measured.filter(r=>phraseKey(r.phrase)!==phraseKey(stat.phrase)).slice(0,8).map(r=>({phrase:r.phrase,pcVolume:r.pcVolume,mobileVolume:r.mobileVolume,total:r.pcVolume+r.mobileVolume,source:'naver_searchad' as const}));
     if(existing){existing.pcVolume=stat.pcVolume;existing.mobileVolume=stat.mobileVolume;existing.documentCount=null;existing.measuredAt=now;existing.related=related;existing.reason=existing.reason.replace('검색 수요는 아직 측정하지 않았습니다.','월간 검색량은 검색광고 공급자로 확인했습니다.');continue;}
     if(local.hasWritten(stat.phrase))continue;
     const topic=local.topics[0];
     candidates.push({phrase:stat.phrase,category:topic.post.category,score:85,reason:`‘${topic.post.title}’ 등 본인 글의 주요 주제를 검색광고 연관어로 조회해 발견했습니다. 월간 검색량은 공급자 실측이며, 기존에 수집한 글의 제목·대표 키워드에는 없는 후보입니다.`,source:'naver_searchad',signal:'new',sourcePost:{id:topic.post.id,title:topic.post.title,url:topic.post.url},pcVolume:stat.pcVolume,mobileVolume:stat.mobileVolume,documentCount:null,measuredAt:now,history:[],related});
    }
   }catch(e){providerFailed=true;notes.push(e instanceof ProviderError?e.message:'검색량 조회에 실패해 기존 지표를 유지했습니다.');}
  }else notes.push('검색광고 연결 전에는 분석 기반 글감과 기존 실측 자료를 사용합니다.');
  candidates.sort((a,b)=>b.score-a.score||a.phrase.localeCompare(b.phrase,'ko'));
  const measured=candidates.filter(c=>c.measuredAt===now&&c.pcVolume!==null&&c.mobileVolume!==null);
  const toMeasure=measured.slice(0,10);
  if(search)await boundedMap(toMeasure,3,async c=>{try{c.documentCount=(await blogSearch(search,c.phrase,{display:1},options.fetchImpl)).total;}catch{documentFailures++;notes.push('일부 문서수를 확인하지 못했습니다. 확인되지 않은 값은 비워두고 기존 지표를 유지합니다.');}});
  else if(measured.length)notes.push('문서수 조회가 연결되지 않아 새 검색량만 표시하며 황금 판정은 보류합니다.');
  for(const c of measured)c.history=mergeHistory(c.history,[metricPoint(c.pcVolume!,c.mobileVolume!,c.documentCount,now,'naver_searchad')]);
  const retryable=providerFailed||!!search&&toMeasure.length>0&&documentFailures===toMeasure.length;
  if(retryable&&db.prepare('SELECT 1 FROM member_recommendations WHERE owner_id=? AND blog_id=?').get(ownerId,blog.id)){
   failBuild(db,build.id,ownerId,notes.join(' '),now);return{...getRecommendationFeed(db,ownerId,{blogId:blog.id},now),notice:[...new Set(notes)].join(' ')+' 기존 추천은 유지했으며 다시 시도할 수 있습니다.'};
  }
  if(!ads||retryable)db.prepare("UPDATE recommendation_builds SET source='local' WHERE id=?").run(build.id);
  persistBuild(db,ownerId,blog,build,candidates,[...new Set(notes)].join(' ')||null,now);
  return getRecommendationFeed(db,ownerId,{blogId:blog.id},now);
 }catch(e){
  failBuild(db,build.id,ownerId,e instanceof Error?e.message:'추천 생성 실패',now);
  if(e instanceof AppError)throw e;
  if(e instanceof CollectError){
   if(['BLOG_NOT_FOUND','NO_PUBLIC_POSTS','INVALID_BLOG_ID'].includes(e.code))throw new AppError(422,'RECOMMENDATION_BLOG_UNAVAILABLE',`‘${blog.naver_id}’에서 공개 글을 가져올 수 없습니다. 블로그 ID와 글·RSS 공개 설정을 확인해주세요.`,{retryable:false});
   throw new AppError(e.retryable?503:422,e.retryable?'RECOMMENDATION_RSS_UNAVAILABLE':'RECOMMENDATION_RSS_INVALID',e.message,{retryable:e.retryable});
  }
  throw new AppError(502,'RECOMMENDATION_REFRESH_FAILED','추천을 만들지 못했습니다. 기존 추천은 유지했습니다. 잠시 후 다시 시도해주세요.');
 }
}

export function updateRecommendation(db:Database,ownerId:string,id:string,input:unknown,now=Date.now()):DiscoveredRecommendation{
 const v=updateInput.parse(input),current=ownRecommendation(db,ownerId,id);
 if(current.version!==v.version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 추천 상태가 변경되었습니다. 새로고침해주세요.');
 if(v.saved===false)throw new AppError(400,'USE_KEYWORD_WORKSPACE','보관한 키워드는 내 보관함에서 삭제할 수 있습니다.');
 return transaction(db,()=>{
  const next=ownRecommendation(db,ownerId,id);if(next.version!==v.version)throw new AppError(409,'VERSION_CONFLICT','추천 상태가 변경되었습니다. 새로고침해주세요.');
  if(v.saved===true&&!next.saved){
   if((db.prepare('SELECT count(*) AS n FROM member_keywords WHERE owner_id=?').get(ownerId) as {n:number}).n>=MEMBER_KEYWORD_LIMIT)throw new AppError(409,'KEYWORD_LIMIT',`내 키워드는 ${MEMBER_KEYWORD_LIMIT}개까지 보관할 수 있습니다.`);
   db.prepare('INSERT INTO member_keywords(id,owner_id,phrase,phrase_key,category,note,favorite,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)').run(randomUUID(),ownerId,next.phrase,phraseKey(next.phrase),next.category.slice(0,30),next.reason.slice(0,500),now,now);
  }
  db.prepare('UPDATE member_recommendations SET written=?,dismissed=?,version=version+1,updated_at=? WHERE id=? AND owner_id=?').run(Number(v.written??next.written),Number(v.dismissed??next.dismissed),now,id,ownerId);
  return ownRecommendation(db,ownerId,id);
 });
}
/** 사용자가 열어본 본인 추천에 대해서만 실제 상위 블로그·뉴스를 조회한다. */
export async function loadRecommendationCompetition(db:Database,ownerId:string,id:string,input:unknown,options:ProviderOptions={},now=Date.now()):Promise<DiscoveredRecommendation>{
 const {version}=versionInput.parse(input),current=ownRecommendation(db,ownerId,id);
 if(current.version!==version)throw new AppError(409,'VERSION_CONFLICT','추천 상태가 변경되었습니다. 새로고침해주세요.');
 if(!currentSubscription(db,ownerId,now))throw new AppError(403,'PAID_PLAN_REQUIRED','경쟁 블로그·뉴스 조회는 구독 중인 회원에게 제공됩니다.');
 const search=options.search===undefined?naverSearchConfig():options.search;
 if(!search)throw new AppError(503,'NAVER_SEARCH_NOT_CONFIGURED','경쟁 글 조회가 아직 연결되지 않았습니다.');
 rateLimit(db,`recommendation-competition:${ownerId}`,20,3600_000,now);
 const results=await Promise.allSettled([blogSearch(search,current.phrase,{display:5},options.fetchImpl),newsSearch(search,current.phrase,{display:5},options.fetchImpl)]);
 if(results.every(r=>r.status==='rejected'))throw new AppError(502,'COMPETITION_UNAVAILABLE','경쟁 글을 조회하지 못했습니다. 기존 결과는 유지했습니다.');
 const blogResult=results[0],newsResult=results[1];
 const competition:RecommendationCompetition={blogs:blogResult.status==='fulfilled'?blogResult.value.items.map(r=>({title:r.title,url:r.link,name:r.bloggerName,date:r.postDate})):current.competition.blogs,news:newsResult.status==='fulfilled'?newsResult.value.items.map(r=>({title:r.title,url:r.originalLink||r.link,name:new URL(r.originalLink||r.link).hostname,date:r.pubDate})):current.competition.news,checkedAt:now,error:results.some(r=>r.status==='rejected')?'일부 검색 결과를 불러오지 못했습니다. 이전에 조회한 결과는 유지했습니다.':null};
 return transaction(db,()=>{
  const latest=ownRecommendation(db,ownerId,id);if(latest.version!==version)throw new AppError(409,'VERSION_CONFLICT','조회 중 추천 상태가 변경되었습니다. 다시 조회해주세요.');
  db.prepare('UPDATE member_recommendations SET competition_json=?,updated_at=?,version=version+1 WHERE id=? AND owner_id=?').run(JSON.stringify(competition),now,id,ownerId);
  return ownRecommendation(db,ownerId,id);
 });
}
