import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {isTrackingPixel} from '../content/blog-pages';
import {hasClass,isEl,mapTree,mustFind,textOf,withAttrs,withChildren,type El} from '../content/tree';
import {ago,dashboardData,stamp,type DashboardData,type DashboardResult} from './dashboard-data';
import {scoreChart} from './score-chart';

const set=(n:El,text:string)=>withChildren(n,[text]);
const cls=(c:string)=>hasClass(c);

function headline(d:DashboardData):string{
 const latest=d.history[0];
 if(!d.blog)return'블로그를 연결하면 AI 브리핑 진단을 시작할 수 있습니다';
 if(!latest)return'블로그 스캔으로 첫 진단을 받아보세요';
 return latest.actions.length?`진단 점수 ${latest.score}점 · 할 일 ${latest.actions.length}개를 확인하세요`:`진단 점수 ${latest.score}점 · 모든 기준을 잘 지키고 있어요`;
}
const lastScan=(d:DashboardData)=>d.history[0]?`마지막 스캔: ${stamp(d.history[0].measuredAt)} (${ago(d.history[0].measuredAt,d.now)})`:'아직 스캔 기록이 없습니다';

/** 요금제 줄: 결제 단계 전이라 '무료 이용'과 실제 오늘 남은 진단 수만 보여주고 체험 D-day는 뺀다. */
function planRow(n:El,d:DashboardData):El{
 const kids=n.children;
 const dday=kids.findIndex(c=>isEl(c)&&cls('mui-h0mlsf')(c));
 const kept=kids.filter((_,i)=>i!==dday&&i!==dday-1);
 return withChildren(n,kept.map(c=>{
  if(!isEl(c))return c;
  if(cls('mui-1j3i02f')(c))return set(c,'무료 이용');
  if(cls('mui-tgveqo')(c))return set(c,`오늘 ${d.remaining}회 남음`);
  return c;
 }));
}

function scanButton(n:El,d:DashboardData):El{
 const icon=n.children.filter(isEl);
 const label=d.activeJob?`진단 중… ${d.activeJob.progress}%`:'블로그 스캔';
 return withChildren(withAttrs(n,{'data-scan-blog':d.blog?.id??'','data-scan-job':d.activeJob?.id??'',...(d.activeJob?{'aria-busy':'true'}:{})}),[...icon,label]);
}

function metrics(box:El,d:DashboardData):El{
 const tpl=box.children.find(isEl)!;
 const latest=d.history[0];
 const rows:[string,string,string,string,string][]=[
  ['진단 점수',latest?String(latest.score):'-',latest?'점':'',latest?`5개 기준 · ${latest.methodVersion}`:'스캔 후 표시됩니다','/dashboard/mate'],
  ['분석한 글',latest?String(latest.postCount):'-',latest?'개':'','네이버 RSS 공개 글 기준','/dashboard/mate'],
  ['최근 30일 발행',d.blog?String(d.posts30):'-',d.blog?'개':'','수집한 글의 발행일 기준','/dashboard/write'],
  ['할 일',latest?String(latest.actions.length):'-',latest?'개':'','점수가 낮은 기준부터','#today-todo']
 ];
 return withChildren(box,rows.map(([label,value,unit,caption,href])=>mapTree([withAttrs(tpl,{href})],n=>{
  if(cls('mui-d8obsw')(n))return[set(n,label)];
  if(cls('mui-lo4gk5')(n))return[set(n,value)];
  if(cls('mui-xui3fc')(n))return[set(n,unit)];
  if(cls('mui-94slr')(n))return[set(n,caption)];
  return undefined;
 })[0]));
}

function growth(box:El,d:DashboardData):El{
 return mapTree([box],n=>{
  if(n.attrs.role==='tablist')return[];
  if(cls('mui-47u1fc')(n))return[set(n,`진단 점수 변화를 봅니다 (최근 ${Math.min(30,d.history.length)}회)`)];
  if(cls('mui-124y0cg')(n))return[withChildren(n,[scoreChart(d.history)])];
  return undefined;
 })[0] as El;
}

/** 랭킹은 측정 데이터와 집계(P5) 전이라 원본 계정의 순위를 지우고 '데이터 없음'으로 둔다. */
function ranking(box:El,d:DashboardData):El{
 return mapTree([box],n=>{
  if(cls('mui-1c2fwzk')(n))return[set(n,'-')];
  if(cls('mui-16eue6i')(n))return[withAttrs(set(n,''),{style:'display:none'})];
  if(cls('mui-qtwa3i')(n))return[set(n,'순위 데이터 없음')];
  if(cls('mui-1r1o9d4')(n))return[set(n,'랭킹 집계 전입니다')];
  if(n.attrs['aria-label']==='랭킹 범위'){const [first,second]=n.children.filter(isEl);return[withChildren(n,[first,set(second,d.blog?.category||'내 분류')])];}
  return undefined;
 })[0] as El;
}

function todos(box:El,d:DashboardData):El{
 const list=mustFind(box.children,cls('mui-1sklw8n'),'todo list');
 const item=mustFind(list.children,cls('mui-oajxy2'),'todo item');
 const latest=d.history[0];
 type Entry={title:string;desc:string;action?:{id:string;status:string;version:number}};
 const entries:Entry[]=!latest?[{title:d.blog?'블로그 스캔으로 첫 진단 받기':'블로그 연결하기',desc:d.blog?'스캔이 끝나면 점수가 낮은 기준부터 할 일을 알려드립니다.':'설정에서 네이버 블로그 ID를 등록해주세요.'}]
  :d.actions.length?d.actions.map(a=>({title:a.title,desc:latest.criteria.find(c=>c.key===a.criterion)?.evidence??'',action:{id:a.id,status:a.status,version:a.version}})):[{title:'모든 기준을 충족했습니다',desc:'지금처럼 꾸준히 발행해주세요.'}];
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

function feedItem(li:El,r:DashboardResult,prev:DashboardResult|undefined,now:number):El{
 const diff=prev?r.score-prev.score:null;
 const change=diff===null?'':diff===0?' (변화 없음)':` (${diff>0?'+':''}${diff}점)`;
 return mapTree([li],n=>{
  if(n.tag==='a')return[{...withAttrs(n,{href:'/dashboard/mate'}),children:mapTree(n.children,x=>{
   if(x.attrs['aria-label']?.startsWith('이벤트 종류'))return[withChildren(withAttrs(x,{'aria-label':'이벤트 종류: 진단'}),['진단'])];
   if(cls('mui-90enrw')(x))return[set(x,`진단 점수 ${r.score}점${change}`)];
   if(cls('mui-1n65wbf')(x))return[set(x,`분석한 글 ${r.postCount}개 · 할 일 ${r.actions.length}개`)];
   if(cls('mui-2iqb2j')(x))return[set(x,ago(r.measuredAt,now))];
   return undefined;
  })}];
  return undefined;
 })[0] as El;
}

function feed(box:El,d:DashboardData):El{
 return mapTree([box],n=>{
  if(cls('mui-hgyhg8')(n)){const tpl=n.children.find(isEl)!;return[withChildren(n,d.history.map((r,i)=>feedItem(tpl,r,d.history[i+1],d.now)))];}
  if(n.tag==='p'&&/^최근 .*보여줍니다$/.test(textOf(n)))return[set(n,d.history.length?'진단 기록을 시간순으로 보여드립니다':'아직 진단 기록이 없습니다')];
  return undefined;
 })[0] as El;
}

function transform(nodes:CapturedNode[],d:DashboardData):CapturedNode[]{
 return mapTree(nodes,n=>{
  if(cls('mui-3lb3hl')(n))return[planRow(n,d)];
  if(cls('mui-4b4sse')(n))return[set(n,d.blog?.title??'연결된 블로그 없음')];
  if(cls('mui-fga7wp')(n))return[set(n,`@${d.nickname}`)];
  if(cls('mui-1m5dz0o')(n))return[set(n,d.blog?.category||'분류 없음')];
  if(cls('mui-zhxvjz')(n))return[set(n,lastScan(d))];
  if(n.tag==='button'&&cls('mui-rpip74')(n))return[scanButton(n,d)];
  if(cls('mui-4ynyf6')(n))return[set(n,headline(d))];
  if(cls('mui-1qjnrdp')(n))return[set(n,'AI 브리핑 인용 확인은 공급자 설정 전이라 아직 제공하지 않습니다 (미설정)')];
  if(cls('mui-jojpj5')(n))return[withChildren(n,[])];
  if(n.attrs['aria-label']==='핵심 지표')return[metrics(n,d)];
  if(cls('mui-xb6up5')(n))return[growth(n,d)];
  if(cls('mui-63uc4g')(n))return[ranking(n,d)];
  if(cls('mui-kz80vq')(n))return[todos(n,d)];
  if(cls('mui-15kcbxp')(n))return[feed(n,d)];
  if(n.tag==='a'&&n.attrs['aria-label']==='NAEO 블로거 설정')return[withAttrs(n,{'aria-label':`${d.nickname} 설정`})];
  return undefined;
 });
}

/** /dashboard 캡처를 틀로 로그인 회원 본인의 블로그·진단 결과를 채운다(원본 계정 데이터는 남기지 않는다). */
export async function buildDashboardPage(db:Database,userId:string,now=Date.now()):Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/dashboard');
 if(!tpl)throw new Error('dashboard template missing');
 const d=dashboardData(db,userId,now);
 return{...tpl,body:transform(tpl.body.filter(n=>!isTrackingPixel(n)),d),source:'database'};
}
