import type {AnalysisReport} from '../server/analysis/rules';

export type DiagnosisPoint = AnalysisReport & {id:string;postCount:number;measuredAt:number;source?:'scan'|'mate'};
export type CitationPoint = {id:string;measuredAt:number;checked:number;errors:number;cited:number;exposed:number};
export type DashboardSubject = {naverId:string;title:string;connected:boolean;primary:boolean};
export type DashboardVisualization = {
 subject:DashboardSubject|null;subjects:DashboardSubject[];citationHref:string;
 now:number;connected:boolean;history:DiagnosisPoint[];citations:CitationPoint[];
 citationState:'ready'|'running'|'failed'|'not_configured'|'empty';
 citedPosts:{id:string;title:string;keyword:string;textRank:number|null;imageRank:number|null}[];
};
export type ChartPeriod = 7 | 30 | 90 | 'all';
const DAY=86_400_000,KST=9*3600_000;

/** Inclusive Korean calendar days. Never fill unmeasured days with zero. */
export function inPeriod<T extends {measuredAt:number}>(points:T[],period:ChartPeriod,now:number):T[]{
 const start=period==='all'?0:Math.floor((now+KST)/DAY)*DAY-KST-(period-1)*DAY;
 return points.filter(p=>p.measuredAt>=start&&p.measuredAt<=now).sort((a,b)=>a.measuredAt-b.measuredAt);
}
export const percentage=(value:number,total:number):number|null=>total>0?Math.round(value/total*100):null;
export function scoreChange(current:DiagnosisPoint|undefined,previous:DiagnosisPoint|undefined):number|null{
 return current&&previous&&current.methodVersion===previous.methodVersion?current.score-previous.score:null;
}
export function chartCoordinates(points:{measuredAt:number;value:number}[],max=100,width=800){
 const start=points[0]?.measuredAt??0,end=points.at(-1)?.measuredAt??start;
 return points.map(p=>({...p,x:end===start?width/2:48+(p.measuredAt-start)/(end-start)*(width-72),y:208-Math.max(0,Math.min(max,p.value))/max*180}));
}
