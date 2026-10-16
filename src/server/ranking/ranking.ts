import {z} from 'zod';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';

const DAY=86_400_000,KST=9*3600_000;
export type PeriodType='week'|'month'|'all';
export type Period={type:PeriodType;key:string;start:number;end:number;label:string};
/** criteria: 5가지 진단 기준 점수(발행 빈도·최근성·제목·태그·주제 순, 각 20점). */
export type RankRow={rank:number;userId:string;nickname:string;naverId:string;category:string;score:number;measuredAt:number;criteria:number[]};
type Raw=Omit<RankRow,'rank'|'criteria'>&{criteria_json:string};
const ORDER=['cadence','recency','titles','tags','topic'];
const criteriaOf=(json:string)=>{try{const list=JSON.parse(json) as {key:string;score:number}[];return ORDER.map(k=>list.find(c=>c.key===k)?.score??0);}catch{return ORDER.map(()=>0);}};
const queryInput=z.object({period:z.enum(['week','month','all']).default('week'),offset:z.coerce.number().int().min(-52).max(0).default(0),
 category:z.string().trim().max(50).optional(),q:z.string().trim().max(50).default(''),page:z.coerce.number().int().min(1).max(1000).default(1),pageSize:z.coerce.number().int().min(1).max(200).default(50)});
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
function measured(db:Database,p:Period,onlyPublic:boolean):RankRow[]{
 const rows=db.prepare(`SELECT owner_id AS userId,nickname,naver_id AS naverId,category,score,measured_at AS measuredAt,json_extract(report_json,'$.criteria') AS criteria_json FROM (
   SELECT r.owner_id,p.nickname,b.naver_id,b.category,r.score,r.measured_at,r.report_json,
    ROW_NUMBER() OVER (PARTITION BY r.owner_id ORDER BY r.measured_at DESC,r.id) AS n
   FROM scan_results r JOIN blogs b ON b.id=r.blog_id AND b.is_primary=1
   JOIN users u ON u.id=r.owner_id AND u.status='active' JOIN profiles p ON p.user_id=r.owner_id
   WHERE r.measured_at>=? AND r.measured_at<? ${onlyPublic?'AND p.ranking_public=1':''}
  ) WHERE n=1 ORDER BY score DESC,measured_at ASC,nickname ASC,owner_id ASC`).all(p.start,p.end) as Raw[];
 return rows.map(({criteria_json,...r},i)=>({...r,criteria:criteriaOf(criteria_json??'[]'),rank:i+1}));
}
function snapshot(db:Database,p:Period):RankRow[]|null{
 if(p.type==='all'||!db.prepare('SELECT 1 FROM ranking_periods WHERE period_type=? AND period_key=?').get(p.type,p.key))return null;
 return (db.prepare('SELECT user_id AS userId,nickname,naver_id AS naverId,category,score,measured_at AS measuredAt,rank,criteria_json FROM ranking_snapshots WHERE period_type=? AND period_key=? ORDER BY rank').all(p.type,p.key) as (Omit<RankRow,'criteria'>&{criteria_json:string})[]).map(({criteria_json,...r})=>({...r,criteria:JSON.parse(criteria_json) as number[]}));
}

/** 랭킹 화면용(회원 id 포함). 공개 응답은 liveRanking을 쓴다. */
export function rankingView(db:Database,query:unknown,viewerId:string|null,now=Date.now()){
 const v=queryInput.parse(query);
 const period=periodRange(v.period,v.offset,now);
 const snap=snapshot(db,period);
 const ranked=snap??measured(db,period,true);
 const filtered=ranked.filter(r=>(!v.category||r.category===v.category)&&(!v.q||r.nickname.includes(v.q)||r.naverId.includes(v.q.toLowerCase())));
 const categories=[...ranked.reduce((m,r)=>m.set(r.category||'(분류 없음)',(m.get(r.category||'(분류 없음)')??0)+1),new Map<string,number>())].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
 let me:{public:boolean;rank:number|null;score:number|null}|null=null;
 if(viewerId){
  const mine=ranked.find(r=>r.userId===viewerId);
  if(mine)me={public:true,rank:mine.rank,score:mine.score};
  else{const all=measured(db,period,false).find(r=>r.userId===viewerId);const isPublic=(db.prepare('SELECT ranking_public AS p FROM profiles WHERE user_id=?').get(viewerId) as {p:number}|undefined)?.p===1;me={public:isPublic,rank:null,score:all?.score??null};}
 }
 const data=filtered.slice((v.page-1)*v.pageSize,v.page*v.pageSize);
 return{period,confirmed:snap!==null,participants:ranked.length,total:filtered.length,page:v.page,pageSize:v.pageSize,data,me,categories};
}

/** 공개 랭킹(확정된 기간이면 스냅숏). 순위는 전체 기준이고 분류·검색은 그 위에 거른다. 회원 id는 내보내지 않는다. */
export function liveRanking(db:Database,query:unknown,viewerId:string|null,now=Date.now()){
 const view=rankingView(db,query,viewerId,now);
 return{...view,data:view.data.map(r=>({rank:r.rank,nickname:r.nickname,naverId:r.naverId,category:r.category,score:r.score,measuredAt:r.measuredAt,criteria:r.criteria}))};
}

/** 끝난 기간의 순위를 확정 스냅숏으로 저장한다(한 번만, 이후 늦게 들어온 결과로 바뀌지 않음). */
export function confirmPeriod(db:Database,type:'week'|'month',offset:number,now=Date.now()){
 const p=periodRange(type,offset,now);
 if(p.end>now)throw new AppError(409,'PERIOD_NOT_FINISHED','아직 끝나지 않은 기간은 확정할 수 없습니다.');
 return transaction(db,()=>{
  const done=db.prepare('SELECT entries FROM ranking_periods WHERE period_type=? AND period_key=?').get(type,p.key) as {entries:number}|undefined;
  if(done)return{period:p,entries:done.entries};
  const rows=measured(db,p,true);
  db.prepare('INSERT INTO ranking_periods(period_type,period_key,starts_at,ends_at,entries,confirmed_at) VALUES(?,?,?,?,?,?)').run(type,p.key,p.start,p.end,rows.length,now);
  const insert=db.prepare('INSERT INTO ranking_snapshots(period_type,period_key,user_id,nickname,naver_id,category,rank,score,total,measured_at,criteria_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for(const r of rows)insert.run(type,p.key,r.userId,r.nickname,r.naverId,r.category,r.rank,r.score,rows.length,r.measuredAt,JSON.stringify(r.criteria));
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
 return (db.prepare(`SELECT s.period_type AS periodType,s.period_key AS periodKey,s.nickname,s.naver_id AS naverId,s.score FROM ranking_snapshots s
  JOIN ranking_periods p ON p.period_type=s.period_type AND p.period_key=s.period_key WHERE s.rank=1 ORDER BY p.starts_at DESC,s.period_type LIMIT ?`).all(limit) as {periodType:'week'|'month';periodKey:string;nickname:string;naverId:string;score:number}[]).map(r=>({...r}));
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
