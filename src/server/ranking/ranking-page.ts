import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {isTrackingPixel} from '../content/blog-pages';
import {find,hasClass,isEl,mapTree,mustFind,textOf,withAttrs,withChildren,type El} from '../content/tree';
import {champions,rankingView,titlesOf,weeklyRiser,type RankRow} from './ranking';

const el=(tag:string,attrs:Record<string,string>,children:CapturedNode[]=[]):El=>({tag,attrs,children});
const cls=(c:string)=>hasClass(c);
const set=(n:El,t:string)=>withChildren(n,[t]);
const PAGE=200;
const CRITERIA=['발행 빈도','최근성','제목 구체성','태그 활용','주제 일관성'];
const TABS:[string,string][]=[['all','전체 랭킹'],['month','월간 랭킹'],['week','주간 랭킹']];
type View=ReturnType<typeof rankingView>;
const muted='color:#a3a3a3;font-size:13px;margin:0';

function row(tpl:El,r:RankRow,titles:string[]):El{
 const itemTpl=mustFind(tpl.children,cls('mui-x2ydgz'),'title item');
 let metric=0;
 return mapTree([withAttrs(tpl,{'data-rank':String(r.rank)})],n=>{
  if(cls('mui-1oji7iq')(n))return[withChildren(n,[el('p',{style:'margin:0;font-weight:800;font-size:18px;text-align:center;width:100%'},[String(r.rank)])])];
  if(cls('mui-lz6tq6')(n))return[withChildren(n,[[...r.nickname][0]??'?'])];
  if(n.tag==='a'&&n.attrs.href)return[mapTree([withAttrs(n,{href:`https://blog.naver.com/${r.naverId}`,target:'_blank',rel:'noopener noreferrer','aria-label':`${r.nickname} 블로그 새 창에서 열기`})],x=>cls('mui-e5niar')(x)?[set(x,r.nickname)]:undefined)[0]];
  if(cls('mui-1z10mwa')(n)){
   if(!titles.length)return[];
   return[withChildren(withAttrs(n,{'aria-label':`보유 칭호: ${titles.join(', ')}`}),titles.map(t=>mapTree([itemTpl],x=>{
    if(cls('mui-ixm4ez')(x))return[set(x,t)];
    if(x.attrs['aria-label']?.startsWith('칭호'))return[{...withAttrs(x,{'aria-label':`칭호: ${t}`}),children:mapTree(x.children,y=>cls('mui-ixm4ez')(y)?[set(y,t)]:undefined)}];
    return undefined;
   })[0]))];
  }
  if(cls('mui-yjsvyy')(n))return[set(n,r.category||'(분류 없음)')];
  if(cls('mui-1y95vmu')(n)){const unit=n.children.find(isEl);return[withChildren(n,[String(r.score),...(unit?[unit]:[])])];}
  if(cls('mui-1paao7q')(n))return[set(n,String(r.criteria[metric++]??0))];
  return undefined;
 })[0] as El;
}

function header(h:El):El{
 const labels=['순위','블로그','진단 점수',...CRITERIA];
 return withChildren(h,h.children.filter(isEl).map((cell,i)=>{
  const label=labels[i]??'';
  const attrs=Object.fromEntries(Object.entries(cell.attrs).filter(([k])=>k!=='aria-label'));
  const next={...cell,attrs:i>=3?{...attrs,'aria-label':`${label} (20점 만점)`}:attrs};
  return mapTree([next],x=>cls('sort-label')(x)?[set(x,label)]:undefined)[0] as El;
 }));
}

function myRank(card:El,view:View,viewer:boolean):El{
 const me=view.me;
 const line=(t:string,big=false)=>el('p',{style:big?'margin:0;font-size:28px;font-weight:800;color:#03c75a':muted},[t]);
 const body=!viewer?[line('로그인하면 내 순위를 볼 수 있어요.'),el('a',{href:'/login?next=%2Franking',style:'color:#03c75a;font-weight:700'},['로그인'])]
  :!me?.public?[line('랭킹 비공개 상태예요.',false),line(me?.score!=null?`이번 기간 내 진단 점수는 ${me.score}점입니다. 랭킹에 참여하려면 설정에서 '랭킹 공개'를 켜세요.`:'설정에서 랭킹 공개를 켜고 블로그를 진단하면 순위에 오릅니다.'),el('a',{href:'/dashboard/settings',style:'color:#03c75a;font-weight:700'},['설정으로 이동'])]
  :me.rank?[line(`${me.rank}위`,true),line(`${view.period.label} · 진단 점수 ${me.score}점 · 공개 참여 ${view.participants}명 중`),line(`전체 ${view.participants}명 중 내 위치 상위 ${Math.ceil(me.rank/view.participants*100)}%`)]
  :[line('이번 기간에 진단 기록이 없어요.'),el('a',{href:'/dashboard',style:'color:#03c75a;font-weight:700'},['대시보드에서 블로그 스캔하기'])];
 return withChildren(card,[el('div',{style:'display:grid;gap:8px;padding:20px'},[el('strong',{},['내 랭킹']),...body])]);
}

function chips(box:El,view:View,dialog:boolean):El{
 const buttons=box.children.filter(isEl);
 const dialogButton=dialog?buttons.find(b=>textOf(b).includes('전체 분야')):undefined;
 const all=buttons.find(b=>textOf(b).trim()==='전체')!,tpl=buttons.find(b=>b!==all&&b!==dialogButton)??all;
 const span=tpl.children.find(isEl);
 const items=(dialog?view.categories.slice(0,8):view.categories).map(c=>withChildren(tpl,[c.name,...(span?[withChildren(withAttrs(span,{'aria-label':`등록자 ${c.count}명`}),[` · ${c.count}`])]:[])]));
 return withChildren(box,[...(dialogButton?[dialogButton]:[]),all,...items]);
}

function hallOfFame(box:El,db:Database):El{
 const list=champions(db);
 return withChildren(box,[el('div',{style:'display:grid;gap:10px;padding:20px'},[
  el('strong',{style:'font-size:18px'},['명예의 전당']),
  ...(list.length?list.map(c=>el('p',{style:'margin:0'},[`${c.periodType==='week'?`${c.periodKey} 주`:`${c.periodKey.slice(0,4)}년 ${Number(c.periodKey.slice(5,7))}월`} 1위 · ${c.nickname} · ${c.score}점`]))
   :[el('p',{style:muted},['아직 확정된 기간이 없습니다. 주간·월간 기간이 끝나면 1위가 이곳에 기록됩니다.'])])
 ])]);
}

const RULES:CapturedNode[]=[el('div',{style:'display:grid;gap:8px;padding:20px'},[
 el('strong',{style:'font-size:18px'},['순위 산정 방식']),
 el('p',{style:muted},['랭킹 공개를 켠 회원의 대표 블로그를 기간 안에서 가장 최근에 진단한 점수(5가지 기준 × 20점)로 순위를 매깁니다. 동점이면 그 점수를 먼저 기록한 회원이 앞섭니다. 원본 서비스의 종합 가중치는 공개되지 않아 이 복제본이 정한 새 규칙입니다.']),
 el('p',{style:muted},['주간은 월요일 0시~일요일, 월간은 매월 1일~말일(한국 시간)이며 기간이 끝나면 순위를 확정해 다시 바뀌지 않습니다. AI 인용·검색 노출 지표는 원본의 순위 가중치를 알 수 없어 순위에는 쓰지 않고 AI 추천·경쟁 분석 화면에서 따로 보여 줍니다.'])
])];

/** 캡처 중인 애니메이션 스타일(opacity/transform)을 벗겨 SSR에서도 보이게 한다. */
const stripMotion=(n:El):El=>mapTree([n],x=>{
 if(!x.attrs.style||!/opacity|transform/.test(x.attrs.style))return undefined;
 const attrs={...x.attrs};delete attrs.style;return[withAttrs(x,attrs)];
})[0] as El;

/** 포디움 카드 한 장(시각 순서상 2·1·3위): 링크·이름·점수·칭호를 실 데이터로 채운다. */
function podiumCard(card:El,r:RankRow,titles:string[]):El{
 const badgeTpl=find([card],(n)=>isEl(n)&&n.attrs.role==='img'&&!!n.children.find(isEl));
 return mapTree([card],n=>{
  if(n.tag==='a'&&n.attrs.href)return[mapTree([withAttrs(n,{href:`https://blog.naver.com/${r.naverId}`,'aria-label':`${r.nickname} 블로그 새 창에서 열기`})],x=>{
   if(cls('MuiAvatar-colorDefault')(x))return[withChildren(x,[[...r.nickname][0]??'?'])];
   if(cls('podium-name')(x))return[set(x,r.nickname)];
   return undefined;
  })[0]];
  if(n.tag==='img'&&/^\d위$/.test(n.attrs.alt??''))return[withAttrs(n,{alt:`${r.rank}위`})];
  if(cls('mui-xi606m')(n))return[withChildren(n,n.children.map(c=>isEl(c)&&c.tag==='p'?withChildren(c,[String(r.score),...c.children.filter(isEl)]):c))];
  if(cls('mui-1s8s8qe')(n)){
   if(!titles.length||!badgeTpl)return[];
   return[withChildren(n,titles.map(t=>mapTree([badgeTpl],x=>{
    if(cls('mui-ztoy9z')(x))return[set(x,t)];
    if(x.attrs['aria-label']?.startsWith('칭호'))return[withAttrs(x,{'aria-label':`칭호: ${t}`})];
    return undefined;
   })[0]))];
  }
  return undefined;
 })[0] as El;
}

/** 상위 3명 포디움. 시각 배치는 2위-1위-3위 순이다. */
function podium(tpl:El|undefined,rows:RankRow[],db:Database):CapturedNode[]{
 if(!tpl||rows.length<3)return[];
 const root=mustFind([tpl],cls('mui-86p70d'),'podium');
 const isCard=(c:El)=>{let found=false;mapTree([c],x=>{if(cls('mui-sji05q')(x)||cls('mui-4wrtun')(x))found=true;return undefined;});return found;};
 const order=[rows[1],rows[0],rows[2]];
 let slot=0;
 return[stripMotion(withChildren(tpl,tpl.children.map(c=>{
  if(!isEl(c)||c!==root)return c;
  return withChildren(root,root.children.flatMap(c2=>{
   if(!isEl(c2)||!isCard(c2))return[c2];
   const r=order[slot++];
   return r?[podiumCard(c2,r,titlesOf(db,r.userId))]:[];
  }));
 })))];
}

/** 이주의 급상승 스포트라이트. 비교할 지난주 데이터가 없으면 숨긴다. */
function riser(tpl:El|undefined,db:Database,now:number):CapturedNode[]{
 if(!tpl)return[];
 const r=weeklyRiser(db,now);
 if(!r)return[];
 return[stripMotion(mapTree([tpl],n=>{
  if(cls('mui-d9yhq7')(n))return[withChildren(n,[[...r.nickname][0]??'?'])];
  if(cls('mui-1ezoiih')(n))return[set(n,r.nickname)];
  if(cls('mui-1alclet')(n))return[set(n,`▲${r.delta}계단`)];
  return undefined;
 })[0] as El)];
}

/** /ranking: 원본 공개 랭킹의 다른 블로그 데이터 대신, 이 서비스에서 랭킹 공개를 켠 회원의 진단 점수로 다시 그린다. */
export async function buildRankingPage(db:Database,params:{period?:string;page?:string;offset?:string},viewerId:string|null,now=Date.now()):Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/ranking');
 if(!tpl)throw new Error('ranking template missing');
 const period=['all','month','week'].includes(params.period??'')?params.period!:'all';
 const page=Math.max(1,Math.min(100,Number.parseInt(params.page??'1',10)||1));
 const view=rankingView(db,{period,page,pageSize:PAGE},viewerId,now);
 const top=rankingView(db,{period,page:1,pageSize:3},viewerId,now).data;
 const body=mapTree(tpl.body.filter(n=>!isTrackingPixel(n)),n=>{
  if(!cls('mui-r295hx')(n))return undefined;
  const inner=n.children.find(isEl)!;
  const parts=inner.children.filter(isEl);
  const [hero,tabs,counts,riserPart,podiumPart,mine,,catChips,mobileChips,table,more,hall,rules]=parts;
  const tableEl=mustFind([table],cls('mui-tnkwu5'),'ranking table');
  const [head,rowTpl]=tableEl.children.filter(isEl);
  const rows=view.data.map(r=>row(rowTpl,r,titlesOf(db,r.userId)));
  const empty=el('p',{style:'padding:32px;text-align:center;color:#a3a3a3'},["아직 랭킹에 오른 회원이 없습니다. 설정에서 '랭킹 공개'를 켜고 블로그를 진단하면 참여할 수 있어요."]);
  const next=view.total>page*PAGE?[withChildren(more,[el('a',{href:`/ranking?period=${period}&page=${page+1}`,style:'color:#03c75a;font-weight:700'},[`다음 ${PAGE}명 보기`])])]:[];
  const built=[
   mapTree([hero],x=>x.tag==='p'&&/\d{2}:\d{2}/.test(textOf(x))?[set(x,`${view.period.label} · 실시간 집계 · 기간이 끝나면 확정`)]:x.tag==='p'&&textOf(x).length>40?[set(x,'랭킹 공개를 켠 회원의 블로그 진단 점수(발행 빈도·최근성·제목·태그·주제) 순위입니다.')]:undefined)[0],
   mapTree([tabs],x=>{const i=TABS.findIndex(([,l])=>textOf(x).trim()===l);if(x.attrs.role!=='tab'||i<0)return undefined;const on=TABS[i][0]===period;return[withAttrs(x,{'data-period':TABS[i][0],'aria-selected':String(on),class:on?'MuiBox-root mui-6tq00o':'MuiBox-root mui-jq23q2'})];})[0],
   mapTree([counts],x=>cls('mui-rkgcjv')(x)?[withChildren(x,['총 ',el('span',{class:'MuiBox-root mui-1f57lhv'},[`${view.participants}명`]),`이 ${view.period.label} 랭킹에 참여 중이에요 (랭킹 공개 회원)`])]:undefined)[0],
   ...riser(riserPart,db,now),...podium(podiumPart,top,db),
   myRank(mine,view,viewerId!==null),
   chips(catChips,view,false),chips(mobileChips,view,true),
   withChildren(table,table.children.map(c=>isEl(c)&&c===tableEl?withChildren(tableEl,[header(head),...rows]):c)),
   ...(view.data.length?[]:[empty]),...next,hallOfFame(hall,db),withChildren(rules,RULES)
  ];
  return[withChildren(n,[withChildren(inner,built as CapturedNode[])])];
 });
 return{...tpl,body,source:'database'};
}
