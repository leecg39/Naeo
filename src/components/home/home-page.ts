import type {CapturedNode, CapturedPageData} from '../../types/site';
import {find, hasClass, isEl, mapTree, withAttrs, withChildren, type El} from '../../server/content/tree';
import {homeStyles} from './home-styles';

export type HomeRank = {rank:number;nickname:string;naverId:string;category:string;score:number};
export type HomeRanking = {data:HomeRank[];participants:number};
export const HOME_DEMO_STAGES = ['키워드 선택', 'AI 작성', '완성 글', '모바일 미리보기', '발행 예시'] as const;
const node = (tag:string, attrs:Record<string,string>, children:CapturedNode[]=[]):El => ({tag, attrs, children});
const cls = hasClass;

function rankingContent(ranking:HomeRanking):CapturedNode[] {
 const rows=ranking.data.slice(0,10);
 const link=(r:HomeRank)=>node('a',{href:`https://blog.naver.com/${encodeURIComponent(r.naverId)}`,target:'_blank',rel:'noopener noreferrer','aria-label':`${r.nickname} 블로그 새 창에서 열기`},[r.nickname]);
 return [node('div',{'data-naeo-home-ranking':''},[
  ...(rows.length ? [node('ol',{class:'naeo-home-podium','aria-label':'공개 블로그 진단 점수 상위 3명'},rows.slice(0,3).map(r=>node('li',{class:'naeo-home-rank-card'},[
   node('span',{},[`${r.rank}위`]),node('div',{class:'naeo-home-rank-avatar','aria-hidden':'true'},[[...r.nickname][0]||'N']),link(r),node('p',{},[r.category||'분류 없음']),node('strong',{},[`${r.score}점`]),node('p',{},['블로그 진단 점수 · 100점 만점'])
  ]))),...(rows.length>3?[node('ol',{class:'naeo-home-rank-list',start:'4','aria-label':'공개 블로그 진단 점수 4위부터 10위까지'},rows.slice(3).map(r=>node('li',{class:'naeo-home-rank-row'},[
   node('span',{},[`${r.rank}위`]),node('div',{},[link(r),node('small',{},[r.category||'분류 없음'])]),node('strong',{},[`${r.score}점`])
  ])))]:[])]:[node('div',{class:'naeo-home-rank-empty'},[
   node('h3',{},['첫 번째 공개 랭킹을 기다리고 있어요']),node('p',{},['블로그를 진단하고 설정에서 랭킹 공개를 켜면 이곳에 표시됩니다.']),node('a',{href:'/dashboard/settings'},['랭킹 공개 설정하기 →'])
  ])]),
  node('div',{class:'naeo-home-rank-rules'},[
   node('h3',{},['순위는 이렇게 정해져요']),node('p',{},['랭킹 공개에 동의한 회원의 대표 블로그를 최근 진단한 점수로 순위를 매깁니다. 발행 빈도 · 최근성 · 제목 구체성 · 태그 활용 · 주제 일관성을 각각 20점 만점으로 평가합니다.']),node('p',{},['AI 브리핑 인용 횟수가 아닌 블로그 진단 점수 순위입니다. 동점이면 같은 점수를 먼저 기록한 블로그가 앞섭니다.'])
  ])
 ])];
}

function writingDemo(demo:El):El[] {
 const frames=demo.children.filter(isEl);
 const layers=frames[1]?.children.filter(isEl)??[];
 if(layers.length<6)return[demo];
 const panels=[0,1,2,4,5].map((sourceIndex,index)=>{
  let panel=withAttrs(layers[sourceIndex],{'data-naeo-demo-panel':String(index),'aria-hidden':String(index!==0),id:`home-writing-panel-${index}`});
  panel=mapTree([panel],n=>{
   if(cls('mui-18ktybd')(n))return[withChildren(n,['연말정산 미리보기'])];
   if(cls('mui-pgj5po')(n))return[withChildren(n,[node('p',{style:'font-size:12px;line-height:1.6;margin:0'},['카드 사용처를 바꿔가며 세 번 돌려봤더니 환급금이 41만 원 늘었어요'])])];
   if(cls('mui-1jumy29')(n))return[withAttrs(n,{role:'button',tabindex:'0','data-naeo-demo-action':'1','aria-label':'AI 작성 예시 보기'})];
   if(cls('mui-1yuqzqm')(n))return[withAttrs(n,{role:'button',tabindex:'0','data-naeo-demo-action':'3','aria-label':'발행된 글 모바일 예시 보기'})];
   return undefined;
  })[0] as El;
  // Reveal nested entry frames only inside this selected-stage container.
  const reveal=(children:CapturedNode[]):CapturedNode[]=>children.map(child=>{
   if(!isEl(child))return child;
   const hidden=/(?:^|;)opacity:0(?:;|$)/.test(child.attrs.style??'');
   const attrs=hidden?{...child.attrs,style:(child.attrs.style??'').replace(/opacity:0(?=;|$)/g,'opacity:1').replace(/transform:[^;]+/g,'transform:none')}:child.attrs;
   if(hidden&&attrs['aria-hidden']==='true')attrs['aria-hidden']='false';
   return{...child,attrs,children:reveal(child.children)};
  });
  return withChildren(panel,reveal(panel.children));
 });
 const viewport=withAttrs(withChildren(frames[1],panels),{'data-naeo-demo-viewport':''});
 const next=withAttrs(withChildren(demo,[frames[0],viewport]),{'data-naeo-home-demo':'writing',role:'group','aria-label':'AI 글쓰기 과정 예시'});
 const controls=node('div',{class:'naeo-home-demo-controls','data-naeo-demo-controls':'writing',role:'group','aria-label':'AI 글쓰기 예시 단계 선택'},[
  ...HOME_DEMO_STAGES.map((title,index)=>node('button',{type:'button','data-naeo-demo-select':String(index),'aria-controls':`home-writing-panel-${index}`,'aria-pressed':String(index===0)},[title])),
  node('button',{type:'button','data-naeo-demo-play':'','aria-label':'AI 글쓰기 예시 재생 또는 일시정지'},['일시정지'])
 ]);
 return[next,controls];
}

/** Keeps the verified captured content and restores only its unresolved runtime slots. */
export function buildHomePage(page:CapturedPageData,ranking:HomeRanking):CapturedPageData {
 if(page.path!=='/')return page;
 const body=mapTree(page.body,n=>{
  if(cls('mui-5o8f48')(n))return mapTree([n],x=>{
   if(cls('mui-wg1uo3')(x))return rankingContent(ranking);
   if(cls('mui-1ydr4p3')(x))return[withChildren(x,['랭킹 공개를 켠 블로그의 진단 점수를 만나보세요.',node('br',{}),'내 블로그도 함께 확인해 보세요.'])];
   if(cls('mui-i3cuwy')(x))return[withChildren(x,[`현재 ${ranking.participants.toLocaleString('ko-KR')}개 블로그가 공개 랭킹에 참여하고 있어요`])];
   return undefined;
  });
  if(n.attrs['data-demo-step']!==undefined)return writingDemo(n);
  if(cls('mui-1lvssd5')(n)||cls('mui-1udmfet')(n))return[withAttrs(n,{'data-naeo-home-mcp':''})];
  return undefined;
 });
 // Keep the heading discoverable without exposing a snapshot's never-ending progress indicator.
 const rankingNode=find(body,cls('mui-5o8f48'));
 if(rankingNode)rankingNode.attrs={...rankingNode.attrs,'data-naeo-home-ranking-section':''};
 return {...page,body,css:`${page.css}\n${homeStyles}`};
}
