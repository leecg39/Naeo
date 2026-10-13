import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {isTrackingPixel} from '../content/blog-pages';
import {hasClass,isEl,mapTree,withAttrs,withChildren,type El} from '../content/tree';
import {listRecommendations,type Recommendation} from './recommendations';

const PAGE_SIZE=50;
const DAY=86_400_000;
const cls=(c:string)=>hasClass(c);
const set=(n:El,t:string)=>withChildren(n,[t]);
const el=(tag:string,attrs:Record<string,string>,children:CapturedNode[]=[]):El=>({tag,attrs,children});
const num=(n:number|null)=>n===null?'—':n.toLocaleString('ko-KR');
const KST=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'});
const day=(ms:number)=>{const p=Object.fromEntries(KST.formatToParts(new Date(ms)).map(x=>[x.type,x.value]));return`${p.month}월 ${p.day}일`;};
const satLabel=(r:Recommendation)=>r.saturation===null?'포화도 지표 없음':`포화도 ${r.saturation}배 (${r.level}). 낮을수록 선점 가치 높음`;
const icon=(r:Recommendation)=>r.golden?'🏆':r.preempt?'🔍':null;
const checkbox=(n:El,r:Recommendation)=>{
 const attrs=Object.fromEntries(Object.entries(n.attrs).filter(([k])=>k!=='checked'));
 return{...n,attrs:{...attrs,'aria-label':`${r.phrase} 작성 완료 표시`,'data-keyword-id':r.id,...(r.state==='written'?{checked:''}:{})}};
};

function row(tpl:El,r:Recommendation):El{
 let cell=0;
 const numbers=[r.pcVolume,r.mobileVolume,r.total,r.documentCount];
 const base=withAttrs(tpl,{'aria-label':`${r.phrase} ${r.state==='written'?'작성 완료':'미작성'}`,'data-keyword-id':r.id,'data-golden':String(r.golden),'data-preempt':String(r.preempt),'data-day':String(r.recommendedAt)});
 return mapTree([base],n=>{
  if(cls('mui-uqma1x')(n)&&n!==base)return[{...withAttrs(n,{'aria-label':`${r.phrase} 상세보기`}),children:mapTree(n.children,x=>{
   if(x.tag==='input')return[checkbox(x,r)];
   if(cls('mui-1vdvqag')(x))return[set(x,day(r.recommendedAt))];
   if(cls('mui-ry11bq')(x)){const i=icon(r);return i?[set(x,i)]:[];}
   if(cls('mui-1btzqbu')(x))return[set(x,r.phrase)];
   if(cls('mui-s2uf1z')(x)){const v=numbers[cell++]??null;return[{...x,children:x.children.map(c=>isEl(c)?set(c,num(v)):c)}];}
   if(cls('mui-1n5phso')(x))return[set(withAttrs(x,{'aria-label':satLabel(r)}),r.saturation===null?'—':String(r.saturation))];
   if(cls('mui-whh5e5')(x))return[withChildren(x,r.preempt?['선점기회']:[])];
   return undefined;
  })}];
  return undefined;
 })[0] as El;
}

function card(tpl:El,r:Recommendation,index:number):El{
 let metric=0;
 const values=[num(r.total),num(r.documentCount)];
 return mapTree([tpl],n=>{
  if(cls('mui-1t929sw')(n))return[{...withAttrs(n,{id:`kw-card-${index}`}),children:mapTree(n.children,x=>{
   if(cls('mui-z3vqf5')(x)){const i=icon(r);return i?[set(x,i)]:[];}
   if(cls('mui-y4fv6f')(x))return[set(x,r.phrase)];
   if(cls('mui-1kwe2ke')(x))return[set(x,values[metric++]??'—')];
   if(cls('mui-1n5phso')(x))return[set(withAttrs(x,{'aria-label':satLabel(r)}),r.saturation===null?'—':String(r.saturation))];
   if(x.tag==='input')return[checkbox(x,r)];
   if(cls('mui-3yq6tl')(x))return[withAttrs(x,{'aria-label':`${r.phrase} 경쟁 분석 보기`})];
   return undefined;
  })}];
  return undefined;
 })[0] as El;
}

type Summary={total:number;golden:number;preempt:number;written:number};
function stats(box:El,s:Summary,thisWeek:number):El{
 const values:[string,string,string|null][]=[['이번 주 추천',String(thisWeek),null],['황금 키워드',String(s.golden),'클릭하여 보기'],['작성함',String(s.written),`${s.total?Math.round(s.written/s.total*100):0}%`],['선점기회',String(s.preempt),'클릭하여 보기'],['전체 추천',String(s.total),null]];
 let i=0;
 return withChildren(box,box.children.map(c=>{
  if(!isEl(c))return c;
  const [label,value,caption]=values[i++]??['','',null];
  const ps=c.children.filter(isEl);
  const aria:Record<string,string>=c.attrs['aria-label']!==undefined?{'aria-label':`${label}: ${value}, 클릭하여 필터`}:{};
  return withChildren(withAttrs(c,aria),[set(ps[0],label),set(ps[1],value),...(ps[2]?[set(ps[2],caption??'')]:[])]);
 }));
}

const EXPLAIN:CapturedNode[]=[{tag:'strong',attrs:{},children:['황금 키워드']},'는 포화도(문서수 ÷ 월 검색량)가 1 미만이고 월 검색량이 1,000 이상인 키워드, ',{tag:'strong',attrs:{},children:['선점기회']},'는 포화도 3 미만·검색량 300 이상인 키워드예요. 이 기준은 이 복제본의 새 규칙입니다.'];

function firstPass(nodes:CapturedNode[],items:Recommendation[],s:Summary,now:number):CapturedNode[]{
 return mapTree(nodes,n=>{
  if(cls('mui-j7gwwk')(n))return[set(n,'무료 이용')];
  if(cls('mui-1djvbb4')(n)){const span=n.children.find(isEl)!;return[withChildren(withAttrs(n,{'aria-label':`작성 완료 ${s.written}/${s.total}`}),['작성 완료 ',set(span,`${s.written}/${s.total}`)])];}
  if(cls('mui-1ptiu1r')(n))return[withChildren(n,EXPLAIN)];
  if(cls('mui-18gihw7')(n))return[set(n,'추천 키워드는 관리자가 등록하고 지표(월 검색량·문서수)를 기록한 키워드입니다. 지표가 없는 키워드는 —로 보입니다. 네이버 검색광고 API는 미설정입니다.')];
  if(cls('mui-uvzp1a')(n))return[stats(n,s,items.filter(r=>now-r.recommendedAt<=7*DAY).length)];
  if(cls('mui-1o5fj7v')(n)){
   const buttons=n.children.filter(isEl);
   const active=buttons.find(b=>b.children.join('')==='이번 주')!.attrs.class,inactive=buttons.find(b=>b.children.join('')==='전체기간')!.attrs.class;
   return[withChildren(n,buttons.map(b=>{const label=b.children.join('');if(label==='전체기간')return withAttrs(b,{class:active,'data-active':'true'});if(label==='이번 주')return withAttrs(b,{class:inactive});return b;}))];
  }
  if(cls('mui-tovi31')(n))return[set(n,`(${items.length}건 기준)`)];
  if(n.attrs.role==='rowgroup'&&cls('mui-uien4a')(n)){const tpl=n.children.find(isEl)!;return[withChildren(n,items.map(r=>row(tpl,r)))];}
  if(cls('mui-sjhw3n')(n)){const tpl=n.children.find(isEl)!;return[withChildren(n,items.map((r,i)=>card(tpl,r,i)))];}
  if(cls('mui-1sk9a2v')(n)){
   if(items.length)return[withAttrs(n,{style:'display:none'})];
   return[mapTree([n],x=>cls('mui-1h2al8m')(x)?[set(x,'아직 추천할 키워드가 없습니다')]:cls('mui-1tverh')(x)?[set(x,'관리자가 키워드와 지표를 등록하면 여기에 표시됩니다.')]:undefined)[0]];
  }
  return undefined;
 });
}

function searchForm(q:string):El{
 return el('form',{action:'/dashboard/recommendations',method:'get',role:'search',style:'display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px'},[
  el('label',{for:'reco-q',class:'sr-only'},['추천 키워드 검색']),
  el('input',{id:'reco-q',name:'q',value:q,maxlength:'100',placeholder:'키워드·분류 검색',style:'flex:1 1 200px;min-width:0;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;font:inherit'}),
  el('button',{type:'submit',style:'padding:8px 14px;border-radius:8px;border:1px solid #03c75a;background:#03c75a;color:#fff;font:inherit;cursor:pointer'},['검색'])
 ]);
}
function pager(page:number,pages:number,q:string):El{
 const href=(p:number)=>`/dashboard/recommendations?${new URLSearchParams({...(q?{q}:{}),...(p>1?{page:String(p)}:{})})}`.replace(/\?$/,'');
 const link=(p:number,label:string)=>el('a',{href:href(p),style:'color:#03c75a;font-weight:700'},[label]);
 return el('nav',{'aria-label':'추천 키워드 페이지',style:'display:flex;gap:16px;justify-content:center;align-items:center;margin:16px 0'},[
  ...(page>1?[link(page-1,'이전')]:[]),el('span',{},[`${page} / ${pages}`]),...(page<pages?[link(page+1,'다음')]:[])
 ]);
}

/** /dashboard/recommendations: 관리자가 등록한 공개 키워드와 이 회원의 작성 완료 표시(캡처 계정 키워드는 남기지 않는다). */
export async function buildRecommendationsPage(db:Database,userId:string,params:{q?:string;page?:string},now=Date.now()):Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/dashboard/recommendations');
 if(!tpl)throw new Error('recommendations template missing');
 const q=(params.q??'').slice(0,100),page=Math.max(1,Math.min(10000,Number.parseInt(params.page??'1',10)||1));
 const result=listRecommendations(db,userId,{q,page,pageSize:PAGE_SIZE},now);
 const pages=Math.max(1,Math.ceil(result.pagination.total/PAGE_SIZE));
 const first=firstPass(tpl.body.filter(n=>!isTrackingPixel(n)),result.data,result.summary,now);
 const body=mapTree(first,n=>cls('mui-n41su9')(n)?[withChildren(n,[searchForm(q),...n.children,pager(page,pages,q)])]:undefined);
 return{...tpl,body,source:'database'};
}
