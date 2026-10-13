import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {AppError} from '../errors';
import {appOrigin} from '../http';

/**
 * 방문·체류 집계(개인정보 최소화): IP·전체 URL·원래 방문자 id를 저장하지 않는다.
 * 방문자는 매일 바뀌는 무작위 salt와 쿠키 id의 해시로만 세어 날짜를 넘어 같은 사람을 이을 수 없다.
 */
export const RAW_RETENTION_DAYS=30,DWELL_WINDOW=30*60_000,MAX_DWELL=30*60_000;
const KST=9*3600_000;
export const kstDay=(ms:number)=>new Date(ms+KST).toISOString().slice(0,10);
const BOT=/bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly/i;
export function shouldTrack(r:{path:string;userAgent:string|null;dnt:string|null;gpc:string|null}):boolean{
 if(r.dnt==='1'||r.gpc==='1')return false;
 if(!r.userAgent||BOT.test(r.userAgent))return false;
 return !/^\/(admin|api|dev)(\/|$)/.test(r.path);
}
/** 쿼리·해시 제거, 끝 슬래시 제거, 공유 토큰은 패턴으로 바꿔 저장한다. */
export function normalizePath(raw:string):string|null{
 if(typeof raw!=='string'||!raw.startsWith('/')||raw.startsWith('//'))return null;
 let p=raw.split(/[?#]/)[0];
 if(p.length>1)p=p.replace(/\/+$/,'');
 p=p.replace(/^\/p\/[A-Za-z0-9_-]{22}\/images$/,'/p/:token/images');
 return p.length<=200&&/^[\w\-./:%가-힣]+$/.test(p)?p:null;
}
function saltFor(db:Database,day:string):string{
 const row=db.prepare('SELECT salt FROM analytics_salts WHERE day=?').get(day) as {salt:string}|undefined;
 if(row)return row.salt;
 const salt=randomBytes(32).toString('hex');
 db.prepare('INSERT INTO analytics_salts(day,salt) VALUES(?,?) ON CONFLICT(day) DO NOTHING').run(day,salt);
 return (db.prepare('SELECT salt FROM analytics_salts WHERE day=?').get(day) as {salt:string}).salt;
}
function referrerHost(raw:string,own:string):string{
 try{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.host===new URL(own).host)return '';return u.hostname.slice(0,100);}catch{return '';}
}
const viewInput=z.object({path:z.string().max(500),visitorId:z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),referrer:z.string().max(1000).default('')}).strict();
export function recordView(db:Database,input:unknown,now=Date.now(),own=appOrigin()){
 const v=viewInput.parse(input);
 const path=normalizePath(v.path);
 if(!path)throw new AppError(400,'INVALID_PATH','경로가 올바르지 않습니다.');
 return transaction(db,()=>{
  const day=kstDay(now),visitorHash=createHash('sha256').update(saltFor(db,day)+v.visitorId).digest('hex'),id=randomUUID();
  db.prepare('INSERT INTO page_views(id,day,path,visitor_hash,referrer_host,created_at) VALUES(?,?,?,?,?,?)').run(id,day,path,visitorHash,referrerHost(v.referrer,own),now);
  return{id,visitorHash};
 });
}
const dwellInput=z.object({viewId:z.uuid(),ms:z.number().int().min(0).max(24*3600_000)}).strict();
/** 체류 시간: 방문마다 한 번, 30분 안에만, 최대 30분으로 자른다. */
export function recordDwell(db:Database,input:unknown,now=Date.now()){
 const v=dwellInput.parse(input);
 const row=db.prepare('SELECT dwell_ms AS dwell,created_at AS at FROM page_views WHERE id=?').get(v.viewId) as {dwell:number|null;at:number}|undefined;
 if(!row||now-row.at>DWELL_WINDOW+MAX_DWELL)throw new AppError(404,'NOT_FOUND','방문 기록이 없습니다.');
 if(row.dwell!==null)throw new AppError(409,'DWELL_RECORDED','이미 기록했습니다.');
 db.prepare('UPDATE page_views SET dwell_ms=? WHERE id=? AND dwell_ms IS NULL').run(Math.min(v.ms,MAX_DWELL),v.viewId);
 return{recorded:true};
}
/** 원본 기록이 남은 날짜의 일별 집계를 원본에서 다시 계산한다(여러 번 실행해도 같다). */
export function rollupAnalytics(db:Database,now=Date.now()){
 const days=(db.prepare('SELECT DISTINCT day FROM page_views WHERE day<=?').all(kstDay(now)) as {day:string}[]).map(r=>r.day);
 transaction(db,()=>{
  for(const day of days){
   db.prepare('DELETE FROM page_stats WHERE day=?').run(day);
   db.prepare(`INSERT INTO page_stats(day,path,views,visitors,dwell_total_ms,dwell_samples) SELECT day,path,count(*),count(DISTINCT visitor_hash),coalesce(sum(dwell_ms),0),count(dwell_ms) FROM page_views WHERE day=? GROUP BY path`).run(day);
   // 하루 전체(경로 '*'): 방문자는 페이지별 합이 아니라 그날의 고유 방문자 수.
   db.prepare(`INSERT INTO page_stats(day,path,views,visitors,dwell_total_ms,dwell_samples) SELECT day,'*',count(*),count(DISTINCT visitor_hash),coalesce(sum(dwell_ms),0),count(dwell_ms) FROM page_views WHERE day=? GROUP BY day`).run(day);
   db.prepare('DELETE FROM referrer_stats WHERE day=?').run(day);
   db.prepare("INSERT INTO referrer_stats(day,host,views) SELECT day,referrer_host,count(*) FROM page_views WHERE day=? AND referrer_host<>'' GROUP BY referrer_host").run(day);
  }
 });
 return{days:days.length};
}
const summaryInput=z.object({days:z.coerce.number().int().min(1).max(90).default(7)});
export function analyticsSummary(db:Database,actorId:string,query:unknown,now=Date.now()){
 requireAdmin(userById(db,actorId));
 const {days}=summaryInput.parse(query);
 rollupAnalytics(db,now);
 const from=kstDay(now-(days-1)*86_400_000);
 const daily=(db.prepare("SELECT day,views,visitors FROM page_stats WHERE day>=? AND path='*' ORDER BY day").all(from) as {day:string;views:number;visitors:number}[]).map(r=>({...r}));
 const topPaths=(db.prepare('SELECT path,sum(views) AS views,sum(visitors) AS visitors,sum(dwell_total_ms) AS dwell,sum(dwell_samples) AS samples FROM page_stats WHERE day>=? AND path<>\'*\' GROUP BY path ORDER BY views DESC,path LIMIT 20').all(from) as {path:string;views:number;visitors:number;dwell:number;samples:number}[])
  .map(r=>({path:r.path,views:r.views,visitors:r.visitors,avgDwellSec:r.samples?Math.round(r.dwell/r.samples/1000):null}));
 const referrers=(db.prepare('SELECT host,sum(views) AS views FROM referrer_stats WHERE day>=? GROUP BY host ORDER BY views DESC LIMIT 10').all(from) as {host:string;views:number}[]).map(r=>({...r}));
 return{days,from,daily,topPaths,referrers};
}
