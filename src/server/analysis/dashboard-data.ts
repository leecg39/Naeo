import type {Database} from '../database';
import {remainingScansToday} from '../jobs/queue';
import type {AnalysisReport} from './rules';
import type {DashboardSubject} from '../../lib/dashboard-visualization';
import {listActionItems,type ActionItem} from './action-items';
import {rankingView} from '../ranking/ranking';

export type DashboardResult=AnalysisReport&{id:string;postCount:number;measuredAt:number;source:'scan'|'mate'};
export type DashboardData={
 nickname:string;blog:{id:string;naverId:string;title:string;category:string}|null;
 subject:DashboardSubject|null;subjects:DashboardSubject[];history:DashboardResult[];activeJob:{id:string;state:'queued'|'running';progress:number}|null;
 remaining:number;posts30:number|null;now:number;actions:ActionItem[];
 /** 전체·월간·주간 순서의 내 순위(공개 여부·참여자 수 포함). */
 rankings:{public:boolean;rank:number|null;participants:number}[];
};
function myRankings(db:Database,userId:string,now:number){
 return(['all','month','week'] as const).map(period=>{const v=rankingView(db,{period,pageSize:1},userId,now);return{public:v.me?.public??false,rank:v.me?.rank??null,participants:v.participants};});
}
const DAY=86_400_000;

/** 본인 소유의 스캔·무료 진단을 같은 블로그별로 합친다. 기존 무료 진단도 재진단 없이 보인다. */
export function dashboardData(db:Database,userId:string,now=Date.now(),naverId?:string):DashboardData{
 const nickname=(db.prepare('SELECT nickname FROM profiles WHERE user_id=?').get(userId) as {nickname:string}|undefined)?.nickname??'';
 const blogs=db.prepare('SELECT id,naver_id AS naverId,title,category,is_primary AS isPrimary FROM blogs WHERE owner_id=? ORDER BY is_primary DESC,created_at,id').all(userId) as (NonNullable<DashboardData['blog']>&{isPrimary:number})[];
 const reports=db.prepare('SELECT naver_id AS naverId,max(created_at) AS measuredAt FROM mate_reports WHERE owner_id=? AND expires_at>? AND created_at<=? GROUP BY naver_id ORDER BY measuredAt DESC,naver_id').all(userId,now,now) as {naverId:string;measuredAt:number}[];
 const subjects:DashboardSubject[]=blogs.map(b=>({naverId:b.naverId,title:b.title||b.naverId,connected:true,primary:!!b.isPrimary}));
 for(const r of reports)if(!subjects.some(b=>b.naverId===r.naverId))subjects.push({naverId:r.naverId,title:r.naverId,connected:false,primary:false});
 const primary=blogs[0];
 const primaryHasResult=primary&&(reports.some(r=>r.naverId===primary.naverId)||db.prepare('SELECT 1 FROM scan_results WHERE blog_id=? AND owner_id=? AND measured_at<=? LIMIT 1').get(primary.id,userId,now));
 // 명시적으로 선택한 본인 기록 > 기록이 있는 대표 블로그 > 최근 무료 진단 > 연결된 블로그.
 const preferred=primaryHasResult?primary.naverId:reports[0]?.naverId;
 const subject=subjects.find(b=>b.naverId===naverId)??subjects.find(b=>b.naverId===preferred)??subjects[0]??null;
 const selected=blogs.find(b=>b.naverId===subject?.naverId);
 const blog=selected?{id:selected.id,naverId:selected.naverId,title:selected.title,category:selected.category}:null;
 const remaining=remainingScansToday(db,userId,now);
 type Row={id:string;report_json:string;post_count:number;measured_at:number;source:'scan'|'mate'};
 const scans=blog?db.prepare("SELECT id,report_json,post_count,measured_at,'scan' AS source FROM scan_results WHERE blog_id=? AND owner_id=? AND measured_at<=? ORDER BY measured_at DESC,id LIMIT 365").all(blog.id,userId,now) as Row[]:[];
 const free=subject?db.prepare("SELECT 'mate:'||token AS id,report_json,post_count,created_at AS measured_at,'mate' AS source FROM mate_reports WHERE naver_id=? AND owner_id=? AND expires_at>? AND created_at<=? ORDER BY created_at DESC,token LIMIT 365").all(subject.naverId,userId,now,now) as Row[]:[];
 const history=[...scans,...free].sort((a,b)=>b.measured_at-a.measured_at||a.id.localeCompare(b.id)).slice(0,365)
  .map(r=>({...(JSON.parse(r.report_json) as AnalysisReport),id:r.id,postCount:r.post_count,measuredAt:r.measured_at,source:r.source}));
 const activeJob=blog?db.prepare("SELECT id,state,progress FROM scan_jobs WHERE blog_id=? AND state IN ('queued','running')").get(blog.id) as DashboardData['activeJob']|undefined:null;
 // 무료 진단에는 글별 발행일이 저장되지 않으므로 미측정을 0으로 표시하지 않는다.
 const posts30=blog&&history[0]?.source==='scan'?(db.prepare('SELECT count(*) AS n FROM blog_posts WHERE blog_id=? AND published_at>=? AND published_at<=?').get(blog.id,now-30*DAY,now) as {n:number}).n:null;
 const actions=history[0]?.source==='scan'?listActionItems(db,userId,history[0].id):[];
 return{nickname,blog,subject,subjects,history,activeJob:activeJob?{...activeJob}:null,remaining,posts30,now,actions,rankings:myRankings(db,userId,now)};
}

/** "N분 전 / N시간 전 / N일 전" (변화 피드 기간 필터가 이 형식을 읽는다). */
export function ago(ms:number,now:number):string{
 const d=Math.max(0,now-ms);
 if(d<3600_000)return`${Math.max(1,Math.floor(d/60_000))}분 전`;
 if(d<DAY)return`${Math.floor(d/3600_000)}시간 전`;
 return`${Math.floor(d/DAY)}일 전`;
}
const KST=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
/** 원본 표기 "MM-DD HH:mm"(한국 시간). */
export function stamp(ms:number):string{
 const parts=Object.fromEntries(KST.formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
 return`${parts.month}-${parts.day} ${parts.hour==='24'?'00':parts.hour}:${parts.minute}`;
}
