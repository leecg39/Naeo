import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {isTrackingPixel} from '../content/blog-pages';
import {renderMarkdown} from '../content/markdown';
import {hasClass,isEl,mapTree,mustFind,withAttrs,withChildren,type El} from '../content/tree';
import {getPublicEvent,listPublicEvents,type EventPhase} from './events';
import {eventHistory} from './history';
import {eventWinners} from './rewards';

const el=(tag:string,attrs:Record<string,string>,children:CapturedNode[]=[]):El=>({tag,attrs,children});
const cls=(c:string)=>hasClass(c);
const PHASE:Record<EventPhase,string>={open:'진행 중',upcoming:'예정',ended:'종료'};
const STATUS:Record<string,string>={submitted:'심사 대기',approved:'승인',rejected:'반려',withdrawn:'철회'};
const muted='color:#737373;font-size:14px;margin:0';
const day=(ms:number)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms).replace(/\.\s?/g,'.').replace(/\.$/,'');
/** 종료 시각은 그 시각 직전까지라 표시는 1ms 전 날짜로. */
export const periodText=(e:{startsAt:number;endsAt:number})=>`${day(e.startsAt)} ~ ${day(e.endsAt-1)}`;
type Listed=ReturnType<typeof listPublicEvents>[number];

function card(tpl:El,e:Listed,href:string):El{
 const a=withAttrs(tpl,{href,'aria-label':`${e.title} (${PHASE[e.phase]})`});
 return mapTree([a],n=>{
  if(cls('mui-1li648i')(n)||cls('mui-841cpt')(n)){
   if(!e.coverImage)return[];
   return[mapTree([n],m=>m.tag==='img'?[withAttrs(m,{src:e.coverImage,alt:e.title})]:undefined)[0] as El];
  }
  if(n.tag==='span'&&cls('MuiChip-label')(n))return[withChildren(n,[PHASE[e.phase]])];
  if(n.tag==='h2')return[withChildren(n,[e.title])];
  if(cls('mui-qymsdf')(n))return[withChildren(n,[periodText(e)])];
  return undefined;
 })[0] as El;
}
function group(box:El,label:string,cards:El[]):El[]{
 if(!cards.length)return[];
 return[withChildren(box,box.children.map(c=>!isEl(c)?c:c.tag==='span'?withChildren(c,[label]):cls('mui-1hdbc19')(c)?withChildren(c,cards):c))];
}
/** 캡처 화면의 본문 영역(mui-v8vqb0)만 바꾸고 머리글·바닥글·사이드바는 유지한다. */
async function withContent(route:string,path:string,title:string,build:(content:El)=>CapturedNode[]):Promise<CapturedPageData>{
 const tpl=await getCapturedPage(route);
 if(!tpl)throw new Error(`${route} template missing`);
 const body=mapTree(tpl.body.filter(n=>!isTrackingPixel(n)),n=>cls('mui-v8vqb0')(n)?[withChildren(n,build(n))]:undefined);
 return{...tpl,path,title:`${title} | NAEO`,body,source:'database'};
}
function hero(content:El,title:string,lead:string):El{
 const h=mustFind(content.children,cls('mui-1qgohm2'),'event hero');
 return withChildren(h,h.children.map(c=>!isEl(c)?c:c.tag==='h1'?withChildren(c,[title]):withChildren(c,[lead])));
}
function lists(content:El,events:Listed[],base:string):CapturedNode[]{
 const [,live,ended]=content.children.filter(isEl);
 const liveTpl=mustFind([live],n=>n.tag==='a','live card'),endedTpl=mustFind([ended],n=>n.tag==='a','ended card');
 const now=events.filter(e=>e.phase!=='ended'),past=events.filter(e=>e.phase==='ended');
 return[...group(live,'진행·예정',now.map(e=>card(liveTpl,e,`${base}/${e.slug}`))),...group(ended,'종료된 이벤트',past.map(e=>card(endedTpl,e,`${base}/${e.slug}`))),
  ...(events.length?[]:[el('p',{style:muted},['지금은 공개된 이벤트가 없습니다.'])])];
}

export async function buildEventListPage(db:Database,now=Date.now()){
 const events=listPublicEvents(db,now);
 return withContent('/event','/event','이벤트',c=>[hero(c,'이벤트','NAEO 회원을 위한 이벤트와 리워드 소식이에요.'),...lists(c,events,'/event')]);
}

function myActivity(db:Database,userId:string,query:unknown):El{
 const {entries,rewards,entryPagination,rewardPagination}=eventHistory(db,userId,query);
 const pager=(label:string,key:'entriesPage'|'rewardsPage',pagination:typeof entryPagination)=>{
  const pages=Math.max(1,Math.ceil(pagination.total/pagination.pageSize));
  const link=(page:number,title:string)=>el('a',{href:`/dashboard/events?${new URLSearchParams({entriesPage:String(entryPagination.page),rewardsPage:String(rewardPagination.page),[key]:String(page)})}#my-events`,class:'button secondary'},[title]);
  return el('nav',{'aria-label':label,style:'display:flex;gap:12px;align-items:center'},[
   ...(pagination.page>1?[link(pagination.page-1,'이전')]:[]),
   el('span',{},[`${pagination.page} / ${pages} · 총 ${pagination.total}건`]),
   ...(pagination.page<pages?[link(pagination.page+1,'다음')]:[]),
  ]);
 };
 const row=(cells:string[])=>el('tr',{},cells.map(c=>el('td',{style:'padding:8px;border-top:1px solid #e5e5e5'},[c])));
 const table=(caption:string,head:string[],rows:El[],empty:string)=>rows.length?el('table',{style:'width:100%;border-collapse:collapse;font-size:14px'},[el('caption',{style:'text-align:left;font-weight:700;padding:8px 0'},[caption]),el('thead',{},[el('tr',{},head.map(h=>el('th',{style:'text-align:left;padding:8px;color:#737373'},[h])))]),el('tbody',{},rows)]):el('p',{style:muted},[empty]);
 return el('section',{'aria-label':'내 이벤트 활동','data-my-events':'true',id:'my-events',style:'display:grid;gap:16px;padding:20px;border:1px solid #e5e5e5;border-radius:16px'},[
  table('내 참여 내역',['이벤트','상태','제출일','심사 메모'],entries.map(e=>{const r=row([e.title,STATUS[e.status]??e.status,day(e.createdAt),e.reviewNote||'-']);r.children[0]=el('td',{style:'padding:8px'},[el('a',{href:`/dashboard/events/${e.slug}`,style:'color:#03c75a'},[e.title])]);return r;}),'아직 참여한 이벤트가 없어요.'),
  pager('내 참여 페이지','entriesPage',entryPagination),
  table('내 리워드',['내용','리워드','상태','지급일'],rewards.map(r=>row([r.description,r.kind==='gift'?r.item:`${r.tokens}토큰`,r.status==='granted'?'지급':'회수',day(r.createdAt)])),'받은 리워드가 없어요.'),
  pager('내 리워드 페이지','rewardsPage',rewardPagination),
 ]);
}
export async function buildDashboardEventsPage(db:Database,userId:string,now=Date.now(),query:unknown={}){
 const events=listPublicEvents(db,now);
 return withContent('/dashboard/events','/dashboard/events','이벤트',c=>[hero(c,'이벤트','참여할 수 있는 이벤트와 내 참여·리워드 내역이에요.'),myActivity(db,userId,query),...lists(c,events,'/dashboard/events')]);
}

/** 이벤트 상세: 본문(마크다운) + 참여 영역(빈 data-event-entry 자리에 클라이언트 컴포넌트가 로딩·폼·상태를 그린다). */
export async function buildEventDetailPage(db:Database,slug:string,opts:{dashboard:boolean},now=Date.now()):Promise<CapturedPageData|null>{
 const e=getPublicEvent(db,slug,now);
 if(!e)return null;
 const base=opts.dashboard?'/dashboard/events':'/event';
 const facts=[`기간 ${periodText(e)}`,PHASE[e.phase],...(e.rewardTokens?[`승인 시 ${e.rewardTokens}토큰`]:[]),...(e.acceptsEntries?[`참여 ${e.entries}명`]:[])];
 const action:El=e.acceptsEntries
  ?el('div',{'data-event-entry':e.slug,'data-phase':e.phase,'data-requires-proof':String(e.requiresProof),'data-login-next':`${base}/${e.slug}`},[])
  :e.ctaHref?el('a',{href:e.ctaHref,style:'display:inline-block;padding:12px 20px;border-radius:999px;background:#03c75a;color:#fff;font-weight:700;text-decoration:none'},[e.ctaLabel||'참여하기']):el('span',{},[]);
 return withContent('/event',`${base}/${e.slug}`,e.title,c=>[
  el('a',{href:base,style:'color:#03c75a;font-weight:700;text-decoration:none'},['← 이벤트 목록']),
  hero(c,e.title,e.summary),
  ...(e.coverImage?[el('img',{src:e.coverImage,alt:e.title,style:'display:block;width:100%;max-width:640px;border-radius:16px;margin:0 0 16px'})]:[]),
  el('p',{style:muted,'aria-label':'이벤트 정보'},[facts.join(' · ')]),
  el('article',{class:'event-body',style:'line-height:1.7'},renderMarkdown(e.body).nodes),
  action,
  ...winners(db,e.id),
 ]).then(page=>opts.dashboard?withDashboardChrome(page):page);
}
/** 이 이벤트로 지급된 리워드(닉네임 가림). 없으면 표시하지 않는다. */
function winners(db:Database,eventId:string):El[]{
 const list=eventWinners(db,eventId);
 if(!list.length)return[];
 return[el('section',{'aria-label':'당첨 내역',style:'display:grid;gap:8px;padding:20px;border:1px solid #e5e5e5;border-radius:16px'},[
  el('strong',{},['당첨 내역']),
  ...list.map(w=>el('p',{style:'margin:0;font-size:14px'},[`${day(w.createdAt)} · ${w.nickname} · ${w.kind==='gift'?w.item:`${w.tokens}토큰`} · ${w.description}`])),
 ])];
}
/** 대시보드 상세는 대시보드 목록 화면의 사이드바를 그대로 쓴다. */
async function withDashboardChrome(page:CapturedPageData):Promise<CapturedPageData>{
 const dash=await getCapturedPage('/dashboard/events');
 if(!dash)return page;
 const content=mustFind(page.body,cls('mui-v8vqb0'),'detail content');
 const body=mapTree(dash.body.filter(n=>!isTrackingPixel(n)),n=>cls('mui-v8vqb0')(n)?[content]:undefined);
 return{...dash,path:page.path,title:page.title,body,source:'database'};
}
