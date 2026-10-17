import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {isTrackingPixel} from '../content/blog-pages';
import {hasClass,isEl,mapTree,mustFind,textOf,withAttrs,withChildren,type El} from '../content/tree';
import {ago,dashboardData,stamp,type DashboardData} from './dashboard-data';
import {dashboardVisualization} from './dashboard-visualization';
import {dashboardOverview} from './dashboard-overview';
import {currentSubscription,type Subscription} from '../billing/subscriptions';
import {citationConfig} from '../citations/provider';
import {citationOverview} from '../citations/runs';

const set=(n:El,text:string)=>withChildren(n,[text]);
const cls=(c:string)=>hasClass(c);

// Captured MUI colors use rgb()/rgba(), outside CapturedView's legacy hex palette.
const lightShell=`
html.light [data-naeo-captured-root="/dashboard"] .mui-h1pps5 {background:#f7f7f7;color:#262626}
html.light [data-naeo-captured-root="/dashboard"] .mui-zkzhpp {background:#fff;border-color:#ddd}
html.light [data-naeo-captured-root="/dashboard"] .mui-zkzhpp p,
html.light [data-naeo-captured-root="/dashboard"] .mui-zhxvjz {color:#5d6268}
html.light [data-naeo-captured-root="/dashboard"] .mui-zkzhpp .mui-4b4sse {color:#262626}
html.light [data-naeo-captured-root="/dashboard"] .mui-zkzhpp .mui-1j3i02f {color:#04853d}
html.light [data-naeo-captured-root="/dashboard"] .mui-zkzhpp .mui-h0mlsf {color:#c62828}
html.light [data-naeo-captured-root="/dashboard"] .mui-zkzhpp .mui-1m5dz0o {background:#f0f0f0}
html.light [data-naeo-captured-root="/dashboard"] .mui-zkzhpp a[href="/pricing"] {color:#51565c;border-color:#ddd}
html.light [data-naeo-captured-root="/dashboard"] #today-todo {background:#fff;color:#262626;border:1px solid #ddd;border-radius:6px;padding:16px;margin-top:16px}
html.light [data-naeo-captured-root="/dashboard"] #today-todo p {color:#51565c}
`;


const lastScan=(d:DashboardData)=>d.history[0]?`마지막 ${d.history[0].source==='mate'?'진단':'스캔'}: ${stamp(d.history[0].measuredAt)} (${ago(d.history[0].measuredAt,d.now)})`:'아직 스캔 기록이 없습니다';

/** 저장된 구독과 실제 오늘 잔여 스캔 횟수. */
function planRow(n:El,d:DashboardData,subscription:Subscription|null):El{
 const dday=n.children.findIndex(c=>isEl(c)&&cls('mui-h0mlsf')(c));
 const kept=subscription?.trial?n.children:n.children.filter((_,i)=>i!==dday&&i!==dday-1);
 return withChildren(n,kept.map(c=>{
  if(!isEl(c))return c;
  if(cls('mui-1j3i02f')(c))return set(c,subscription?`${subscription.planName}${subscription.trial?' 체험':''}`:'무료 이용');
  if(cls('mui-tgveqo')(c))return set(c,`오늘 ${d.remaining}회 남음`);
  if(cls('mui-h0mlsf')(c)&&subscription)return set(c,`D-${Math.max(0,Math.ceil((subscription.currentPeriodEnd-d.now)/86400000))}`);
  return c;
 }));
}

function scanButton(n:El,d:DashboardData):El{
 const icon=n.children.filter(isEl);
 const label=d.activeJob?`진단 중… ${d.activeJob.progress}%`:!d.blog&&d.subject?'블로그 연결':'블로그 스캔';
 return withChildren(withAttrs(n,{id:'dashboard-scan','data-scan-blog':d.blog?.id??'','data-scan-job':d.activeJob?.id??'',...(d.activeJob?{'aria-busy':'true'}:{})}),[...icon,label]);
}

function todos(box:El,d:DashboardData):El{
 const list=mustFind(box.children,cls('mui-1sklw8n'),'todo list');
 const item=mustFind(list.children,cls('mui-oajxy2'),'todo item');
 const latest=d.history[0];
 type Entry={title:string;desc:string;action?:{id:string;status:string;version:number}};
 const entries:Entry[]=!latest?[{title:d.blog?'블로그 스캔으로 첫 진단 받기':'블로그 연결하기',desc:d.blog?'스캔이 끝나면 점수가 낮은 기준부터 할 일을 알려드립니다.':'설정에서 네이버 블로그 ID를 등록해주세요.'}]
  :d.actions.length?d.actions.map(a=>({title:a.title,desc:latest.criteria.find(c=>c.key===a.criterion)?.evidence??'',action:{id:a.id,status:a.status,version:a.version}})):latest.actions.length?latest.actions.map(a=>({title:a.title,desc:latest.criteria.find(c=>c.key===a.criterion)?.evidence??''})):[{title:'모든 기준을 충족했습니다',desc:'지금처럼 꾸준히 발행해주세요.'}];
 const toggle=(a:NonNullable<Entry['action']>,title:string):El=>({tag:'button',attrs:{type:'button','data-action-id':a.id,'data-version':String(a.version),'aria-pressed':String(a.status==='done'),'aria-label':`${title} ${a.status==='done'?'완료 취소':'완료 표시'}`,
  style:`margin-left:auto;flex:none;border-radius:999px;padding:4px 12px;font:inherit;font-size:13px;cursor:pointer;border:1px solid #03c75a;${a.status==='done'?'background:#03c75a;color:#fff':'background:transparent;color:#03c75a'}`},children:[a.status==='done'?'✓ 완료':'완료']});
 const fill=(nodes:CapturedNode[],title:string,desc:string)=>mapTree(nodes,n=>{
  if(cls('mui-9m8hl0')(n))return[set(n,title)];
  if(cls('mui-fa9sfz')(n))return[set(n,desc)];
  return undefined;
 });
 // 제목·설명을 먼저 바꾼 뒤 토글 버튼을 붙인다(부모를 바꾸면 자식 변환이 건너뛰어지므로 순서가 중요하다).
 const build=(e:Entry)=>{
  const base=withChildren(item,item.children.filter(c=>!(isEl(c)&&cls('mui-1f0w7xa')(c))));
  const filled=fill([base],e.action?.status==='done'?`✓ ${e.title}`:e.title,e.desc)[0] as El;
  const action=e.action;
  if(!action)return filled;
  return mapTree([filled],n=>cls('mui-1fdy0y8')(n)?[withChildren(withAttrs(n,{style:'display:flex;align-items:center;gap:8px'}),[...n.children,toggle(action,e.title)])]:undefined)[0];
 };
 return withAttrs(mapTree([box],n=>n===list?[withChildren(n,entries.map(build))]:undefined)[0] as El,{id:'today-todo'});
}

function transform(nodes:CapturedNode[],d:DashboardData,subscription:Subscription|null):CapturedNode[]{
 return mapTree(nodes,n=>{
  if(n.attrs.id==='recharts_measurement_span')return[];
  if(n.tag==='img'&&n.attrs.src==='/assets/674ed81c3e87d4c3.bin')return[{tag:'span',attrs:{'aria-label':`${d.nickname} 프로필`,style:'display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#333;color:#fff;font-size:12px;font-weight:700'},children:[Array.from(d.nickname)[0]??'N']}];
  if(n.tag==='button'&&textOf(n)==='변경')return[{tag:'div',attrs:{'data-naeo-slot':'dashboard-blog-change'},children:[]}];
  if(cls('MuiContainer-root')(n)&&n.children.some(c=>isEl(c)&&cls('mui-1upilqn')(c))){
   const originalTodos=mustFind(n.children,cls('mui-kz80vq'),'diagnosis action list');
   return[withChildren(n,[
    {tag:'div',attrs:{'data-naeo-slot':'dashboard-overview'},children:[]},
    {tag:'details',attrs:{style:'margin:18px 0 32px;border:1px solid var(--naeo-border,#333);border-radius:8px;padding:16px'},children:[
     {tag:'summary',attrs:{style:'cursor:pointer;font-size:14px;font-weight:600'},children:['진단 개선 할 일']},todos(originalTodos,d)
    ]}
   ])];
  }
  if(cls('mui-3lb3hl')(n))return[planRow(n,d,subscription)];
  if(cls('mui-4b4sse')(n))return[set(n,d.subject?.title??'연결된 블로그 없음')];
  if(cls('mui-fga7wp')(n))return[set(n,`@${d.nickname}`)];
  if(cls('mui-1m5dz0o')(n))return[set(n,d.blog?.category||'분류 없음')];
  if(cls('mui-zhxvjz')(n))return[set(n,lastScan(d))];
  if(n.tag==='button'&&cls('mui-rpip74')(n))return[scanButton(n,d)];
  if(n.tag==='a'&&n.attrs['aria-label']==='NAEO 블로거 설정')return[withAttrs(n,{'aria-label':`${d.nickname} 설정`})];
  return undefined;
 });
}

/** /dashboard 캡처를 틀로 로그인 회원 본인의 블로그·진단 결과를 채운다(원본 계정 데이터는 남기지 않는다). */
export async function buildDashboardPage(db:Database,userId:string,now=Date.now(),naverId?:string):Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/dashboard');
 if(!tpl)throw new Error('dashboard template missing');
 const d=dashboardData(db,userId,now,naverId);
 const c=citationOverview(db,userId,{blogId:d.blog?.id??null,config:citationConfig(),now});
 const visualization=dashboardVisualization(db,userId,d,c);
 return{...tpl,css:tpl.css+lightShell,body:transform(tpl.body.filter(n=>!isTrackingPixel(n)),d,currentSubscription(db,userId,now)),dashboard:visualization,dashboardOverview:dashboardOverview(db,userId,d,c,visualization),source:'database'};
}
