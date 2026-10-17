import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {isTrackingPixel} from '../content/blog-pages';
import {find,hasClass,isEl,mapTree,mustFind,textOf,withAttrs,withChildren,type El} from '../content/tree';
import {citationConfig} from '../citations/provider';
import {citationOverview,type CategoryShare,type CitationOverview,type CitationRow} from '../citations/runs';
import {ago,stamp} from './dashboard-data';

const NOT_CONFIGURED='AI 브리핑 인용 확인 공급자가 설정되지 않았습니다.';
const SOURCE_LABEL={member:'직접 지정한 대표 키워드',tag:'첫 태그에서 정한 대표 키워드',title:'제목에서 정한 대표 키워드'} as const;
const cls=(c:string)=>hasClass(c);
const set=(n:El,text:string)=>withChildren(n,[text]);
const pct=(part:number,total:number)=>total?Math.round(part/total*100):0;
const KST=9*3600_000;
const ymd=(ms:number)=>{const d=new Date(ms+KST);return{y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate()};};
const md=(ms:number)=>{const p=ymd(ms);return`${String(p.m).padStart(2,'0')}.${String(p.d).padStart(2,'0')}`;};
/** 원본 표기: 확인한 해와 같은 해의 글은 "9.8", 지난해 글은 "24.12.19". */
const published=(ms:number|null,checked:number)=>{if(ms===null)return'-';const p=ymd(ms),c=ymd(checked);return p.y===c.y?`${p.m}.${p.d}`:`${String(p.y%100).padStart(2,'0')}.${p.m}.${p.d}`;};
export function performance(r:Pick<CitationRow,'status'|'briefing'|'textRank'|'imageRank'>):string{
 if(r.status==='error')return'확인 실패';
 const parts=[r.textRank!==null?`본문 ${r.textRank}위`:'',r.imageRank!==null?`이미지 ${r.imageRank}위`:''].filter(Boolean);
 return parts.length?parts.join(' · '):r.briefing?'미추천':'-';
}

type Templates={rows:Record<'plain'|'exposed'|'cited',El>;o:El;x:El;plainPerf:El;citedPerf:El};
function templates(container:El):Templates{
 const rows=container.children.filter(isEl);
 const pick=(c:string)=>mustFind(rows,cls(c),`ai-picks row ${c}`);
 const exposedRow=pick('mui-q6fgsd'),plainRow=pick('mui-ocdnov'),citedRow=pick('mui-5nlkae');
 return{rows:{plain:plainRow,exposed:exposedRow,cited:citedRow},o:mustFind([exposedRow],cls('mui-1ccqkaw'),'exposed mark'),x:mustFind([plainRow],cls('mui-ifjbix'),'not exposed mark'),
  plainPerf:mustFind([plainRow],cls('mui-1ijxa38'),'plain performance'),citedPerf:mustFind([citedRow],cls('mui-1l4tmct'),'cited performance')};
}
function row(t:Templates,r:CitationRow):El{
 const tpl=t.rows[r.cited?'cited':r.exposed?'exposed':'plain'];
 const [dates,title,keyword,metric,exposure,perf,manage]=tpl.children.filter(isEl);
 const [checkedSpan,pubSpan]=dates.children.filter(isEl),link=title.children.filter(isEl)[0];
 const [icon,keywordText]=keyword.children.filter(isEl),metricText=metric.children.filter(isEl)[0],metricUnit=metricText.children.filter(isEl)[0];
 const button=manage.children.filter(isEl)[0],perfText=performance(r);
 const perfNode=r.cited?withChildren(t.citedPerf,[...t.citedPerf.children.filter(isEl),` ${perfText}`]):set(t.plainPerf,perfText);
 const saturation=r.saturation===null?'-':`${(r.saturation*100).toFixed(1)}%`;
 return withAttrs(withChildren(tpl,[
  withChildren(dates,[set(checkedSpan,md(r.checkedAt)),set(pubSpan,` / ${published(r.publishedAt,r.checkedAt)}`)]),
  withChildren(title,[set(withAttrs(link,{href:r.url}),r.title||'(제목 없음)')]),
  withChildren(withAttrs(keyword,{'aria-label':`${r.keyword} 네이버 검색`,title:SOURCE_LABEL[r.keywordSource]}),[icon,set(keywordText,r.keyword)]),
  withChildren(metric,[withChildren(metricText,[`${r.volume??'-'} `,set(metricUnit,`/ ${saturation}`)])]),
  withChildren(exposure,[r.status==='error'?set(t.x,'-'):r.exposed?t.o:t.x]),
  withChildren(perf,[perfNode]),
  withChildren(manage,[withAttrs(button,{'data-result-id':r.id,'aria-label':`${r.title||r.keyword} 인용 상세 보기`})])
 ]),{'data-result-id':r.id,'data-post-id':r.postId,'data-category':r.category||'미분류','data-status':r.status,'data-briefing':String(r.briefing),'data-exposed':String(r.exposed),'data-cited':String(r.cited),
  'data-keyword':r.keyword,'data-keyword-source':r.keywordSource,'data-keyword-version':String(r.keywordVersion),'data-volume':String(r.volume??-1),'data-saturation':String(r.saturation??-1),'data-checked-at':String(r.checkedAt),'data-published-at':String(r.publishedAt??0)});
}
function categoryRow(tpl:El,c:CategoryShare):El{
 const [name,ai,search]=tpl.children.filter(isEl);
 const bar=(b:El,share:number,count:number)=>mapTree([b],n=>{
  if(cls('mui-1bplp28')(n)||cls('mui-grqb2c')(n))return[withAttrs(n,{style:`width:${share}%`})];
  if(cls('mui-r79igr')(n)||cls('mui-12py5g0')(n))return[set(n,`${share}%`)];
  if(cls('mui-1sjffix')(n))return[set(n,`(${count})`)];
  return undefined;
 })[0] as El;
 return withChildren(tpl,[set(name,c.name),bar(ai,pct(c.cited,c.total),c.cited),bar(search,pct(c.exposed,c.total),c.exposed)]);
}
function metricCard(card:El,v:CitationOverview):El{
 const label=textOf(card.children.filter(isEl)[0]),r=v.report;
 const empty=!v.configured&&!r?'미설정':'확인 후 표시됩니다';
 let split=0;
 const value=(n:number|string)=>r?String(n):'-';
 return mapTree([card],n=>{
  if(cls('mui-tehul9')(n))return[set(n,value(r?.total??0))];
  if(cls('mui-2g0c0a')(n))return[set(n,value(r?.exposed??0))];
  if(cls('mui-5159gs')(n))return[set(n,value(r?.briefing??0))];
  if(cls('mui-1cjmsu6')(n))return[set(n,label==='AI 추천률'?r?`${pct(r.cited,r.checked)}%`:'-':value(r?.cited??0))];
  if(cls('mui-104ntgm')(n))return[set(n,r?`/ ${r.checked}`:'')];
  if(cls('mui-7bnr13')(n))return[set(n,value(split++===0?r?.textCited??0:r?.imageCited??0))];
  if(cls('mui-1we6nek')(n)){
   if(!r)return[set(n,empty)];
   const caption:Record<string,string>={'전체 글':`최근 글 · 확인한 글 ${r.checked}개${r.errors?` · 실패 ${r.errors}개`:''}`,'통합검색 노출':`${pct(r.exposed,r.checked)}% 노출`,'AI 브리핑 노출':'AI가 답한 키워드','AI 추천률':`${r.cited} / ${r.checked} 추천`};
   return[set(n,caption[label]??textOf(n))];
  }
  return undefined;
 })[0] as El;
}
function header(n:El,v:CitationOverview,now:number):El{
 const [strong,span]=n.children.filter(isEl);
 if(!v.configured&&!v.report)return withChildren(n,[set(strong,NOT_CONFIGURED),' ',set(span,'설정되면 내 키워드에서 AI 브리핑 인용 여부를 확인해 여기에 보여드립니다.')]);
 const last=v.report?`${stamp(v.report.checkedAt)} (${ago(v.report.checkedAt,now)})`:'아직 확인 기록 없음';
 return withChildren(n,['내 블로그 글이 ',strong,'되고 있는지 확인합니다 · 마지막 확인: ',set(span,last)]);
}
function controls(v:CitationOverview):El{
 const active=v.activeRun;
 const disabled=!v.configured||!v.blog||(!active&&v.remaining<=0);
 const label=active?(active.state==='queued'?'확인 대기 중…':`인용 확인 중… ${active.progress}%`):v.report?'인용 다시 확인':'인용 확인 시작';
 const failed=v.lastRun&&v.lastRun.state==='failed'&&(!v.report||v.lastRun.completedAt!==null&&v.lastRun.completedAt>v.report.checkedAt)?` · 최근 확인 실패: ${v.lastRun.errorMessage??'알 수 없는 오류'}`:'';
 const note=!v.configured?'공급자 설정 후 사용할 수 있습니다(미설정).':!v.blog?'설정에서 네이버 블로그를 먼저 연결해주세요.':`오늘 남은 확인 ${v.remaining}/${v.limit}회 · 한 번에 최근 글 ${v.postsPerRun}개 · 블로그 스캔 뒤 자동 확인${failed}`;
 return{tag:'div',attrs:{'data-citation-controls':'true',style:'display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:12px 0 0'},children:[
  {tag:'button',attrs:{type:'button',class:'naeo-button','data-citation-blog':v.blog?.id??'','data-citation-run':active?.id??'',...(active?{'aria-busy':'true'}:{}),...(disabled||active?{disabled:''}:{})},children:[label]},
  {tag:'p',attrs:{'data-citation-note':'true',style:'margin:0;font-size:13px;color:#a3a3a3;overflow-wrap:anywhere'},children:[note]}
 ]};
}
function emptyRow(v:CitationOverview):El{
 const message=!v.configured?`${NOT_CONFIGURED} (미설정) 인용 기록이 아직 없습니다.`:!v.blog?'블로그를 연결하면 AI 인용을 확인할 수 있습니다.':v.activeRun?'AI 인용을 확인하고 있습니다. 끝나면 결과가 여기에 표시됩니다.':'아직 확인 결과가 없습니다. 위의 「인용 확인 시작」을 눌러주세요.';
 return{tag:'div',attrs:{role:'status',style:'padding:32px 16px;text-align:center;color:#a3a3a3;font-size:14px'},children:[message]};
}

/** /dashboard/ai-picks: 캡처를 틀로 회원 본인의 최근 AI 인용 확인 결과를 채운다(원본 계정 데이터는 남기지 않는다). */
export async function buildAiPicksPage(db:Database,userId:string,now=Date.now(),naverId?:string):Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/dashboard/ai-picks');
 if(!tpl)throw new Error('ai-picks template missing');
 const selected=naverId?(db.prepare('SELECT id FROM blogs WHERE owner_id=? AND naver_id=?').get(userId,naverId) as {id:string}|undefined)?.id??null:undefined;
 const v=citationOverview(db,userId,{blogId:selected,config:citationConfig(),now}),r=v.report;
 const container=mustFind(tpl.body,cls('mui-uien4a'),'ai-picks rows'),t=templates(container);
 const categoryTpl=mustFind(tpl.body,cls('mui-x14t34'),'category row');
 const counts=[`전체 ${r?.total??0}`,`통합검색 노출 ${r?.exposed??0}`,`AI 브리핑 ${r?.briefing??0}`,`AI 추천됨 ${r?.cited??0}`];
 const body=mapTree(tpl.body.filter(n=>!isTrackingPixel(n)),n=>{
  // 캡처 당시 원본의 고정 이벤트 홍보는 실제 공지가 아니므로 뺀다.
  if(n.attrs.role==='status'&&find(n.children,cls('mui-1a0o2bi')))return[];
  if(cls('mui-1743wks')(n))return[withChildren(n,n.children.map(c=>isEl(c)&&cls('mui-1ptiu1r')(c)?header(c,v,now):c)),controls(v)];
  if(n.attrs['aria-label']==='AI 인용 현황 핵심 지표')return[withChildren(n,n.children.map(c=>isEl(c)&&cls('mui-h2iker')(c)?metricCard(c,v):c))];
  if(cls('mui-17xv4e')(n))return[withChildren(n,r&&r.categories.length?r.categories.map(c=>categoryRow(categoryTpl,c)):[{tag:'p',attrs:{style:'color:#a3a3a3;font-size:13px;margin:8px 0 0'},children:['데이터 없음']}])];
  if(cls('mui-5vm3uw')(n)){let i=0;return[withChildren(n,n.children.map(c=>isEl(c)&&c.tag==='button'?set(c,counts[i++]??textOf(c)):c))];}
  if(n===container)return[withAttrs(withChildren(n,r&&r.rows.length?r.rows.map(x=>row(t,x)):[emptyRow(v)]),{'aria-label':`전체 ${r?.rows.length??0}개 글`})];
  return undefined;
 }) as CapturedNode[];
 return{...tpl,body,source:'database'};
}
