import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {isTrackingPixel} from '../content/blog-pages';
import {find,hasClass,mapTree,withChildren,type El} from '../content/tree';
import {listCompetitors,type Competitor} from './competitors';
import {listExposures,remainingExposuresToday,EXPOSURE_DAILY_LIMIT,EXPOSURE_RESULTS,type Exposure,type ExposureHit} from './exposure';
import {naverSearchConfig} from './naver-search';

const el=(tag:string,attrs:Record<string,string>,children:CapturedNode[]=[]):El=>({tag,attrs,children});
const cls=(c:string)=>hasClass(c);
const KST=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const ERRORS:Record<string,string>={BLOG_NOT_FOUND:'블로그를 찾을 수 없음',FETCH_FAILED:'수집 실패(잠시 후 다시)',RSS_TOO_LARGE:'RSS가 너무 큼'};
const button=(label:string,attrs:Record<string,string>)=>el('button',{type:'button',style:'border:1px solid rgba(255,255,255,.3);background:transparent;color:inherit;border-radius:8px;padding:4px 10px;font:inherit;font-size:13px;cursor:pointer',...attrs},[label]);
const TH='MuiBox-root mui-1pa59fg',TD='MuiBox-root mui-n2i96c';

function status(c:Competitor):string{
 if(c.lastError)return`${ERRORS[c.lastError]??c.lastError}${c.lastCollectedAt?` · 마지막 성공 ${KST.format(new Date(c.lastCollectedAt))}`:''}`;
 return c.lastCollectedAt?KST.format(new Date(c.lastCollectedAt)):'아직 수집 전';
}
function scoreCell(c:Competitor,mine:number|null):string{
 if(!c.snapshot)return'—';
 const diff=mine===null?'':` (내 점수 대비 ${c.snapshot.report.score-mine>0?'+':''}${c.snapshot.report.score-mine})`;
 return`${c.snapshot.report.score}점${diff}`;
}
function row(c:Competitor,mine:number|null):El{
 const td=(children:CapturedNode[])=>el('td',{class:TD},children);
 return el('tr',{'data-competitor-id':c.id,'data-version':String(c.version),'data-note':c.note,'aria-label':`경쟁 블로그 ${c.naverId}`},[
  td([el('a',{href:`https://blog.naver.com/${c.naverId}`,target:'_blank',rel:'noopener noreferrer',style:'color:#03c75a;font-weight:700'},[c.naverId]),...(c.snapshot?.blogTitle?[el('br',{}),el('span',{style:'font-size:12px;color:#a3a3a3'},[c.snapshot.blogTitle])]:[])]),
  td([c.note||'—']),
  td([c.snapshot?`${c.snapshot.postCount}개`:'—']),
  td([scoreCell(c,mine)]),
  td([status(c)]),
  td([el('div',{style:'display:flex;gap:6px;flex-wrap:wrap'},[
   button('갱신',{'data-action':'refresh','aria-label':`${c.naverId} 갱신`}),
   button('메모',{'data-action':'note','aria-label':`${c.naverId} 메모 수정`}),
   button('삭제',{'data-action':'delete','aria-label':`${c.naverId} 삭제`})
  ])])
 ]);
}

const badge=(kind:ExposureHit['kind'])=>kind==='mine'?el('span',{style:'display:inline-block;padding:1px 6px;border-radius:6px;background:#03c75a;color:#fff;font-size:11px;font-weight:700'},['내 블로그']):kind==='competitor'?el('span',{style:'display:inline-block;padding:1px 6px;border-radius:6px;background:#8b5cf6;color:#fff;font-size:11px;font-weight:700'},['경쟁']):null;
function hitRow(h:ExposureHit):El{
 const td=(children:(CapturedNode|null)[])=>el('td',{class:TD},children.filter((x):x is CapturedNode=>x!==null));
 return el('tr',{'data-rank':String(h.rank),...(h.kind!=='other'?{'data-kind':h.kind}:{})},[
  td([String(h.rank)]),
  td([el('a',{href:h.link,target:'_blank',rel:'noopener noreferrer',style:'color:inherit'},[h.title||h.link]),badge(h.kind)]),
  td([h.naverId??'—']),
  td([h.postDate||'—'])
 ]);
}
function exposureCard(e:Exposure):El{
 const mine=e.hits.filter(h=>h.kind==='mine'),comp=e.hits.filter(h=>h.kind==='competitor');
 const summary=`상위 ${EXPOSURE_RESULTS}개 중 내 블로그 ${mine.length}개${mine.length?`(${mine.map(h=>h.rank+'위').join(', ')})`:''} · 경쟁 ${comp.length}개${comp.length?`(${comp.map(h=>h.rank+'위').join(', ')})`:''} · 전체 문서 ${e.total.toLocaleString('ko-KR')}개`;
 return el('section',{'data-exposure-id':e.id,style:'border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:12px;display:grid;gap:8px'},[
  el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;align-items:baseline'},[
   el('strong',{},[e.keyword]),
   el('span',{style:'font-size:12px;color:#a3a3a3'},[`${KST.format(new Date(e.checkedAt))} · ${summary}`])
  ]),
  e.hits.length?el('div',{style:'overflow-x:auto'},[el('table',{class:'MuiBox-root mui-15dn4s8'},[
   el('thead',{class:'MuiBox-root mui-0'},[el('tr',{class:'MuiBox-root mui-0'},['순위','글','블로그','날짜'].map(h=>el('th',{class:TH,scope:'col'},[h])))]),
   el('tbody',{class:'MuiBox-root mui-0'},e.hits.map(hitRow))
  ])]):el('p',{style:'margin:0;font-size:13px;color:#a3a3a3'},['상위 노출 결과가 없습니다.'])
 ]);
}
function exposureSection(exposures:Exposure[],configured:boolean,remaining:number):El{
 if(!configured)return el('p',{style:'margin:0;font-size:13px;color:#a3a3a3'},['키워드별 상위 노출 블로그 비교는 네이버 검색 API 설정 전이라 아직 제공하지 않습니다(미설정).']);
 return el('div',{style:'display:grid;gap:12px'},[
  el('form',{'data-exposure-form':'',style:'display:flex;gap:8px;flex-wrap:wrap'},[
   el('label',{for:'exposure-keyword',class:'sr-only'},['확인할 키워드']),
   el('input',{id:'exposure-keyword',name:'keyword',required:'',maxlength:'60',placeholder:'키워드 입력 (예: 제주 여행)',style:'flex:2 1 220px;min-width:0;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;font:inherit'}),
   el('button',{type:'submit',style:'padding:8px 14px;border-radius:8px;border:1px solid #03c75a;background:#03c75a;color:#fff;font:inherit;cursor:pointer'},['상위 노출 확인'])
  ]),
  el('p',{'data-exposure-remaining':'',style:'margin:0;font-size:13px;color:#a3a3a3'},[`블로그 탭 상위 ${EXPOSURE_RESULTS}개에서 내 블로그와 경쟁 블로그를 표시합니다. 오늘 ${remaining}/${EXPOSURE_DAILY_LIMIT}회 남았습니다.`]),
  ...exposures.slice(0,10).map(exposureCard)
 ]);
}

function body(list:ReturnType<typeof listCompetitors>,exposures:Exposure[],searchConfigured:boolean,remaining:number):El{
 const mine=list.mine?.report.score??null;
 const head=['블로그','메모','공개 글','진단 점수','마지막 수집','관리'].map(h=>el('th',{class:TH,scope:'col'},[h]));
 return el('div',{style:'display:grid;gap:12px'},[
  el('form',{'data-competitor-add':'',style:'display:flex;gap:8px;flex-wrap:wrap'},[
   el('label',{for:'competitor-blog',class:'sr-only'},['경쟁 블로그 주소 또는 아이디']),
   el('input',{id:'competitor-blog',name:'blog',required:'',maxlength:'300',placeholder:'blog.naver.com/아이디 또는 아이디',style:'flex:2 1 220px;min-width:0;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;font:inherit'}),
   el('label',{for:'competitor-note',class:'sr-only'},['메모']),
   el('input',{id:'competitor-note',name:'note',maxlength:'500',placeholder:'메모(선택)',style:'flex:1 1 160px;min-width:0;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;font:inherit'}),
   el('button',{type:'submit',style:'padding:8px 14px;border-radius:8px;border:1px solid #03c75a;background:#03c75a;color:#fff;font:inherit;cursor:pointer'},['경쟁 블로그 추가'])
  ]),
  el('p',{'data-competitor-count':'',style:'margin:0;font-size:13px;color:#a3a3a3'},[`등록 ${list.data.length} / ${list.limit}개 · ${list.mine?`내 블로그(${list.mine.naverId}) 최근 진단 ${list.mine.report.score}점과 비교합니다.`:'내 블로그를 진단하면 점수를 비교해 드립니다.'}`]),
  el('div',{style:'overflow-x:auto'},[el('table',{class:'MuiBox-root mui-15dn4s8'},[
   el('caption',{class:'sr-only'},['경쟁 블로그 목록']),
   el('thead',{class:'MuiBox-root mui-0'},[el('tr',{class:'MuiBox-root mui-0'},head)]),
   el('tbody',{class:'MuiBox-root mui-0'},list.data.length?list.data.map(c=>row(c,mine)):[el('tr',{},[el('td',{class:TD,colspan:'6',style:'text-align:center;padding:24px;color:#a3a3a3'},['아직 등록한 경쟁 블로그가 없습니다. 위에서 블로그 주소를 추가해보세요.'])])])
  ])]),
  el('h3',{style:'margin:8px 0 0;font-size:15px'},['키워드 상위 노출']),
  exposureSection(exposures,searchConfigured,remaining)
 ]);
}

/** /dashboard/competitors: 원본 계정의 키워드 순위표(다른 블로그 글 제목) 대신 내가 등록한 경쟁 블로그를 비교한다. */
export async function buildCompetitorsPage(db:Database,userId:string):Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/dashboard/competitors');
 if(!tpl)throw new Error('competitors template missing');
 const list=listCompetitors(db,userId);
 const exposures=listExposures(db,userId),searchConfigured=naverSearchConfig()!==null;
 const out=mapTree(tpl.body.filter(n=>!isTrackingPixel(n)),n=>{
  if(cls('mui-j7gwwk')(n))return[withChildren(n,['무료 이용'])];
  if(cls('mui-1ptiu1r')(n))return[withChildren(n,['경쟁 블로그를 등록하면 공개 RSS를 수집해 내 블로그와 같은 5가지 기준(새 규칙)으로 진단 점수를 비교합니다. 블로그당 10분에 한 번 갱신할 수 있습니다.'])];
  if(cls('mui-ohkwel')(n)){const p=find(n.children,x=>x.tag==='p');return p?[withChildren(n,[withChildren(p,[`최대 ${list.limit}개까지 등록할 수 있습니다. 공개 RSS만 사용하며 다른 회원은 내 목록을 볼 수 없습니다.`])])]:[];}
  if(cls('mui-186wd1t')(n))return[];
  if(cls('mui-kqpuym')(n))return[withChildren(n,[body(list,exposures,searchConfigured,remainingExposuresToday(db,userId))])];
  return undefined;
 });
 return{...tpl,body:out,source:'database'};
}
