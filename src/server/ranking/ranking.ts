import {z} from 'zod';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';

const DAY=86_400_000,KST=9*3600_000;
export type PeriodType='week'|'month'|'all';
export type Period={type:PeriodType;key:string;start:number;end:number;label:string};
/** criteria: 5가지 진단 기준 점수(발행 빈도·최근성·제목·태그·주제 순, 각 20점). metrics: 기간 내 실측 지표(AI 본문 인용·AI 이미지 노출·통합 검색 노출·키워드 상위 노출 횟수). */
export type RankRow={rank:number;userId:string;nickname:string;naverId:string;category:string;score:number;measuredAt:number;criteria:number[];metrics:number[];mate:boolean};
type Raw=Omit<RankRow,'rank'|'criteria'|'metrics'|'mate'>&{criteria_json:string;ai_body:number;ai_image:number;exposed:number;keyword_hits:number;mate:number};
const ORDER=['cadence','recency','titles','tags','topic'];
const criteriaOf=(json:string)=>{try{const list=JSON.parse(json) as {key:string;score:number}[];return ORDER.map(k=>list.find(c=>c.key===k)?.score??0);}catch{return ORDER.map(()=>0);}};
const queryInput=z.object({period:z.enum(['week','month','all']).default('week'),offset:z.coerce.number().int().min(-52).max(0).default(0),
 category:z.string().trim().max(50).optional(),q:z.string().trim().max(50).default(''),mate:z.enum(['1','true']).optional().catch(undefined),page:z.coerce.number().int().min(1).max(1000).default(1),pageSize:z.coerce.number().int().min(1).max(200).default(50)});
const ymd=(ms:number)=>new Date(ms).toISOString().slice(0,10);

/** 랭킹 기간(KST): 주간은 월요일 0시~다음 월요일, 월간은 1일 0시~다음 달 1일, 전체는 처음부터 지금까지. */
export function periodRange(type:PeriodType,offset:number,now=Date.now()):Period{
 if(type==='all')return{type,key:'all',start:0,end:Number.MAX_SAFE_INTEGER,label:'전체 기간'};
 const kst=now+KST,day=Math.floor(kst/DAY)*DAY;
 if(type==='week'){
  const dow=(new Date(day).getUTCDay()+6)%7;
  const start=day-dow*DAY+offset*7*DAY;
  return{type,key:ymd(start),start:start-KST,end:start+7*DAY-KST,label:`${ymd(start)} 주`};
 }
 const d=new Date(day),y=d.getUTCFullYear(),m=d.getUTCMonth()+offset;
 const start=Date.UTC(y,m,1),end=Date.UTC(y,m+1,1);
 return{type,key:ymd(start).slice(0,7),start:start-KST,end:end-KST,label:`${new Date(start).getUTCFullYear()}년 ${new Date(start).getUTCMonth()+1}월`};
}

/**
 * 기간 안 대표 블로그의 가장 최근 진단 점수. 랭킹 공개·활성 회원만.
 * 동점이면 그 점수를 먼저 기록한 회원, 그다음 닉네임 순(새 규칙).
 */
function measured(db:Database,p:Period,onlyPublic:boolean,now=Date.now()):RankRow[]{
 const mateExpr=`EXISTS(SELECT 1 FROM mate_reports mr WHERE mr.owner_id=r.owner_id AND mr.expires_at>${Math.floor(now)})`;
 const rows=db.prepare(`SELECT t.owner_id AS userId,t.nickname,t.naver_id AS naverId,t.category,t.score,t.measured_at AS measuredAt,json_extract(t.report_json,'$.criteria') AS criteria_json,t.mate,
   coalesce(cr.ab,0) AS ai_body,coalesce(cr.ai,0) AS ai_image,coalesce(cr.ex,0) AS exposed,coalesce(ke.kh,0) AS keyword_hits FROM (
   SELECT r.owner_id,p.nickname,b.naver_id,b.category,r.score,r.measured_at,r.report_json,${mateExpr} AS mate,
    ROW_NUMBER() OVER (PARTITION BY r.owner_id ORDER BY r.measured_at DESC,r.id) AS n
   FROM scan_results r JOIN blogs b ON b.id=r.blog_id AND b.is_primary=1
   JOIN users u ON u.id=r.owner_id AND u.status='active' JOIN profiles p ON p.user_id=r.owner_id
   WHERE r.measured_at>=? AND r.measured_at<? ${onlyPublic?'AND p.ranking_public=1':''}
  ) t
  LEFT JOIN (SELECT owner_id,sum(briefing) ab,sum(CASE WHEN image_rank IS NOT NULL THEN 1 ELSE 0 END) ai,sum(exposed) ex FROM citation_results WHERE checked_at>=? AND checked_at<? GROUP BY owner_id) cr ON cr.owner_id=t.owner_id
  LEFT JOIN (SELECT ke2.owner_id oid,count(*) kh FROM keyword_exposures ke2,json_each(ke2.results_json) je WHERE json_extract(je.value,'$.kind')='mine' AND ke2.checked_at>=? AND ke2.checked_at<? GROUP BY ke2.owner_id) ke ON ke.oid=t.owner_id
  WHERE n=1 ORDER BY t.score DESC,t.measured_at ASC,t.nickname ASC,t.owner_id ASC`).all(p.start,p.end,p.start,p.end,p.start,p.end) as Raw[];
 return rows.map(({criteria_json,ai_body,ai_image,exposed,keyword_hits,...r},i)=>({...r,mate:Boolean(r.mate),criteria:criteriaOf(criteria_json??'[]'),metrics:[ai_body,ai_image,exposed,keyword_hits],rank:i+1}));
}
function snapshot(db:Database,p:Period):RankRow[]|null{
 if(p.type==='all'||!db.prepare('SELECT 1 FROM ranking_periods WHERE period_type=? AND period_key=?').get(p.type,p.key))return null;
 return (db.prepare('SELECT user_id AS userId,nickname,naver_id AS naverId,category,score,measured_at AS measuredAt,rank,criteria_json,metrics_json,mate FROM ranking_snapshots WHERE period_type=? AND period_key=? ORDER BY rank').all(p.type,p.key) as (Omit<RankRow,'criteria'|'metrics'|'mate'>&{criteria_json:string;metrics_json:string;mate:number})[]).map(({criteria_json,metrics_json,mate,...r})=>({...r,mate:Boolean(mate),criteria:JSON.parse(criteria_json) as number[],metrics:JSON.parse(metrics_json||'[]') as number[]}));
}

/** 랭킹 화면용(회원 id 포함). 공개 응답은 liveRanking을 쓴다. */
export function rankingView(db:Database,query:unknown,viewerId:string|null,now=Date.now()){
 const v=queryInput.parse(query);
 const period=periodRange(v.period,v.offset,now);
 const snap=snapshot(db,period);
 const ranked=(snap??measured(db,period,true,now)).filter(r=>!v.mate||r.mate);
 const filtered=ranked.filter(r=>(!v.category||r.category===v.category)&&(!v.q||r.nickname.includes(v.q)||r.naverId.includes(v.q.toLowerCase())));
 const categories=[...ranked.reduce((m,r)=>m.set(r.category||'(분류 없음)',(m.get(r.category||'(분류 없음)')??0)+1),new Map<string,number>())].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
 let me:{public:boolean;rank:number|null;score:number|null}|null=null;
 if(viewerId){
  const mine=ranked.find(r=>r.userId===viewerId);
  if(mine)me={public:true,rank:mine.rank,score:mine.score};
  else{const all=measured(db,period,false).find(r=>r.userId===viewerId);const isPublic=(db.prepare('SELECT ranking_public AS p FROM profiles WHERE user_id=?').get(viewerId) as {p:number}|undefined)?.p===1;me={public:isPublic,rank:null,score:all?.score??null};}
 }
 const data=filtered.slice((v.page-1)*v.pageSize,v.page*v.pageSize);
 const entrants=(db.prepare(`SELECT count(*) AS n FROM (SELECT r.owner_id,MIN(r.measured_at) fm FROM scan_results r
   JOIN users u ON u.id=r.owner_id AND u.status='active' JOIN profiles p ON p.user_id=r.owner_id AND p.ranking_public=1
   GROUP BY r.owner_id) WHERE fm>=?`).get(now-7*DAY) as {n:number}).n;
 return{period,confirmed:snap!==null,participants:ranked.length,entrants,mateOnly:!!v.mate,total:filtered.length,page:v.page,pageSize:v.pageSize,data,me,categories};
}

/** 공개 랭킹(확정된 기간이면 스냅숏). 순위는 전체 기준이고 분류·검색은 그 위에 거른다. 회원 id는 내보내지 않는다. */
export function liveRanking(db:Database,query:unknown,viewerId:string|null,now=Date.now()){
 const view=rankingView(db,query,viewerId,now);
 return{...view,data:view.data.map(r=>({rank:r.rank,nickname:r.nickname,naverId:r.naverId,category:r.category,score:r.score,measuredAt:r.measuredAt,criteria:r.criteria,metrics:r.metrics}))};
}

/** 끝난 기간의 순위를 확정 스냅숏으로 저장한다(한 번만, 이후 늦게 들어온 결과로 바뀌지 않음). */
export function confirmPeriod(db:Database,type:'week'|'month',offset:number,now=Date.now()){
 const p=periodRange(type,offset,now);
 if(p.end>now)throw new AppError(409,'PERIOD_NOT_FINISHED','아직 끝나지 않은 기간은 확정할 수 없습니다.');
 return transaction(db,()=>{
  const done=db.prepare('SELECT entries FROM ranking_periods WHERE period_type=? AND period_key=?').get(type,p.key) as {entries:number}|undefined;
  if(done)return{period:p,entries:done.entries};
  const rows=measured(db,p,true,now);
  db.prepare('INSERT INTO ranking_periods(period_type,period_key,starts_at,ends_at,entries,confirmed_at) VALUES(?,?,?,?,?,?)').run(type,p.key,p.start,p.end,rows.length,now);
  const insert=db.prepare('INSERT INTO ranking_snapshots(period_type,period_key,user_id,nickname,naver_id,category,rank,score,total,measured_at,criteria_json,metrics_json,mate) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const r of rows)insert.run(type,p.key,r.userId,r.nickname,r.naverId,r.category,r.rank,r.score,rows.length,r.measuredAt,JSON.stringify(r.criteria),JSON.stringify(r.metrics),r.mate?1:0);
  return{period:p,entries:rows.length};
 });
}

/** 이주의 급상승: 지난주 대비 이번 주 순위가 가장 많이 오른 공개 회원. 데이터가 없으면 null. */
export function weeklyRiser(db:Database,now=Date.now()):{nickname:string;delta:number}|null{
 const prev=snapshot(db,periodRange('week',-1,now))??measured(db,periodRange('week',-1,now),true);
 if(!prev.length)return null;
 const prevRank=new Map(prev.map(r=>[r.userId,r.rank]));
 let best:{nickname:string;delta:number}|null=null;
 for(const r of measured(db,periodRange('week',0,now),true)){
  const before=prevRank.get(r.userId);
  if(before==null)continue;
  const delta=before-r.rank;
  if(delta>0&&(!best||delta>best.delta))best={nickname:r.nickname,delta};
 }
 return best;
}

/** 명예의 전당: 확정 기간의 1위(최근 기간부터). */
export function champions(db:Database,limit=12){
 return (db.prepare(`SELECT s.period_type AS periodType,s.period_key AS periodKey,s.user_id AS userId,s.nickname,s.naver_id AS naverId,s.score FROM ranking_snapshots s
  JOIN ranking_periods p ON p.period_type=s.period_type AND p.period_key=s.period_key WHERE s.rank=1 ORDER BY p.starts_at DESC,s.period_type LIMIT ?`).all(limit) as {periodType:'week'|'month';periodKey:string;userId:string;nickname:string;naverId:string;score:number}[]).map(r=>({...r}));
}

/** 명예의 전당 주제별 왕: 가장 최근 확정 월의 분야별 최상위 공개 회원. */
export function categoryChampions(db:Database):{category:string;nickname:string;naverId:string;userId:string;score:number;periodKey:string}[]{
 const key=(db.prepare("SELECT max(period_key) AS k FROM ranking_snapshots WHERE period_type='month'").get() as {k:string|null}).k;
 if(!key)return[];
 return db.prepare(`SELECT s.category,s.nickname,s.naver_id AS naverId,s.user_id AS userId,s.score,s.period_key AS periodKey FROM ranking_snapshots s
  WHERE s.period_type='month' AND s.period_key=?
  AND s.rank=(SELECT MIN(rank) FROM ranking_snapshots x WHERE x.period_type='month' AND x.period_key=s.period_key AND x.category=s.category)
  ORDER BY s.rank,s.category LIMIT 20`).all(key) as {category:string;nickname:string;naverId:string;userId:string;score:number;periodKey:string}[];
}
/** 칭호(새 규칙): 확정 주간 1위 횟수, 확정 월간 1위 달. */
export function titlesOf(db:Database,userId:string):string[]{
 const weeks=(db.prepare("SELECT count(*) AS n FROM ranking_snapshots WHERE user_id=? AND period_type='week' AND rank=1").get(userId) as {n:number}).n;
 const months=(db.prepare("SELECT period_key AS k FROM ranking_snapshots WHERE user_id=? AND period_type='month' AND rank=1 ORDER BY period_key DESC").all(userId) as {k:string}[]).map(r=>`${r.k.slice(0,4)}년 ${Number(r.k.slice(5,7))}월 1위`);
 return[...(weeks?[`주간 1위 ${weeks}회`]:[]),...months];
}
export function memberHistory(db:Database,userId:string){
 return (db.prepare(`SELECT s.period_type AS periodType,s.period_key AS periodKey,s.rank,s.score,s.total FROM ranking_snapshots s JOIN ranking_periods p ON p.period_type=s.period_type AND p.period_key=s.period_key
  WHERE s.user_id=? ORDER BY p.starts_at DESC LIMIT 30`).all(userId) as {periodType:'week'|'month';periodKey:string;rank:number;score:number;total:number}[]).map(r=>({...r}));
}
