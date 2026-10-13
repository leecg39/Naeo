import type {Database} from '../database';
import {remainingScansToday} from '../jobs/queue';
import type {AnalysisReport} from './rules';
import {listActionItems,type ActionItem} from './action-items';
import {rankingView} from '../ranking/ranking';

export type DashboardResult=AnalysisReport&{id:string;postCount:number;measuredAt:number};
export type DashboardData={
 nickname:string;blog:{id:string;naverId:string;title:string;category:string}|null;
 history:DashboardResult[];activeJob:{id:string;state:'queued'|'running';progress:number}|null;
 remaining:number;posts30:number;now:number;actions:ActionItem[];
 /** 전체·월간·주간 순서의 내 순위(공개 여부·참여자 수 포함). */
 rankings:{public:boolean;rank:number|null;participants:number}[];
};
function myRankings(db:Database,userId:string,now:number){
 return(['all','month','week'] as const).map(period=>{const v=rankingView(db,{period,pageSize:1},userId,now);return{public:v.me?.public??false,rank:v.me?.rank??null,participants:v.participants};});
}
const DAY=86_400_000;

/** 대시보드에 필요한 본인 데이터만 읽는다(대표 블로그 기준, 최근 진단 30회). */
export function dashboardData(db:Database,userId:string,now=Date.now()):DashboardData{
 const nickname=(db.prepare('SELECT nickname FROM profiles WHERE user_id=?').get(userId) as {nickname:string}|undefined)?.nickname??'';
 const blog=db.prepare('SELECT id,naver_id AS naverId,title,category FROM blogs WHERE owner_id=? ORDER BY is_primary DESC,created_at LIMIT 1').get(userId) as DashboardData['blog']|undefined;
 const remaining=remainingScansToday(db,userId,now);
 if(!blog)return{nickname,blog:null,history:[],activeJob:null,remaining,posts30:0,now,actions:[],rankings:myRankings(db,userId,now)};
 const rows=db.prepare('SELECT id,report_json,post_count,measured_at FROM scan_results WHERE blog_id=? ORDER BY measured_at DESC,id LIMIT 30').all(blog.id) as {id:string;report_json:string;post_count:number;measured_at:number}[];
 const history=rows.map(r=>({...(JSON.parse(r.report_json) as AnalysisReport),id:r.id,postCount:r.post_count,measuredAt:r.measured_at}));
 const activeJob=db.prepare("SELECT id,state,progress FROM scan_jobs WHERE blog_id=? AND state IN ('queued','running')").get(blog.id) as DashboardData['activeJob']|undefined;
 const {n}=db.prepare('SELECT count(*) AS n FROM blog_posts WHERE blog_id=? AND published_at>=?').get(blog.id,now-30*DAY) as {n:number};
 return{nickname,blog:{...blog},history,activeJob:activeJob?{...activeJob}:null,remaining,posts30:n,now,actions:listActionItems(db,userId),rankings:myRankings(db,userId,now)};
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
