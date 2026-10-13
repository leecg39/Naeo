import {capturedPaths,getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {blogIndexSections,listCategories,listPublishedArticles,type Article,type Category} from './articles';
import {mergeCss} from './css';
import {renderMarkdown,type Heading} from './markdown';
import {find,hasClass,isEl,mapTree,mustFind,textOf,withAttrs,withChildren,type El} from './tree';

const ARTICLE_TEMPLATE='/blog/marketing/golden-keywords';
const INDEX_TEMPLATE='/blog';
type Options={origin:string};

/**
 * 원본 버그 보정(의도적 차이): 경로 표시의 현재 글 제목 span은 inline이라 원본이 지정한
 * max-width·말줄임이 적용되지 않아 긴 제목이 390px 화면을 가로로 넘친다(naeo.kr 실측 440px).
 */
const BLOG_CSS_FIXES='.MuiBreadcrumbs-li .mui-wb1kkn{display:inline-block;vertical-align:bottom}';
let cssCache:Promise<string>|undefined;
/** 캡처된 블로그 페이지 21개의 CSS를 합쳐 새 글에서도 모든 본문 구성 요소 스타일을 쓰게 한다. */
function blogCss():Promise<string>{
 return cssCache??=Promise.all(capturedPaths.filter(p=>p==='/blog'||p.startsWith('/blog/')).map(getCapturedPage))
  .then(pages=>mergeCss(pages.flatMap(p=>p?[p.css]:[]))+'\n'+BLOG_CSS_FIXES);
}
/** 캡처 시점에 광고·분석 스크립트가 붙인 숨김 1×1 추적 픽셀인지 판단한다(페이지 내용 아님). */
export const isTrackingPixel=(n:CapturedNode)=>isEl(n)&&n.tag==='img'&&n.attrs.width==='1'&&n.attrs.height==='1'&&/display:\s*none/.test(n.attrs.style??'');
async function template(route:string):Promise<CapturedPageData>{
 const page=await getCapturedPage(route);
 if(!page)throw new Error('blog template missing: '+route);
 return{...page,body:page.body.filter(n=>!isTrackingPixel(n))};
}

const KST=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'});
export const formatDate=(ms:number)=>KST.format(new Date(ms));
const replaceText=(n:El,text:string):El=>withChildren(n,[text]);

/** 사이드바(본문 aside와 모바일 서랍) 분류 그룹을 DB 글 목록으로 다시 만든다. 최근 업데이트 상자는 유지한다. */
function sidebarGroups(container:El,cats:Category[],all:Article[],activeUrl:string|null):El{
 const groups=container.children.filter(c=>isEl(c)&&hasClass('mui-i3pbo')(c)) as El[];
 const tpl=groups[0];
 const label=mustFind(tpl.children,n=>n.tag==='span','sidebar label');
 const ul=mustFind(tpl.children,n=>n.tag==='ul','sidebar list');
 const built=cats.map(c=>mapTree([tpl],n=>{
  if(n===label)return[replaceText(n,c.name)];
  if(n===ul)return[withChildren(n,all.filter(a=>a.category.id===c.id).map(a=>({tag:'li',attrs:{class:a.url===activeUrl?'MuiBox-root mui-1a9wya8':'MuiBox-root mui-7y1qm3'},children:[{tag:'a',attrs:{href:a.url},children:[a.title]}]})))];
  return undefined;
 })[0]);
 const at=container.children.indexOf(tpl);
 const rest=container.children.filter(c=>!groups.includes(c as El));
 return withChildren(container,[...rest.slice(0,at),...built,...rest.slice(at)]);
}
const isSidebarContainer=(n:El)=>n.children.some(c=>isEl(c)&&hasClass('mui-i3pbo')(c)&&find(c.children,x=>x.tag==='a'&&(x.attrs.href??'').startsWith('/blog/'))!==undefined);

function shareLinks(share:El,a:Article,origin:string):El{
 const url=encodeURIComponent(origin+a.url),title=encodeURIComponent(a.title);
 const hrefs:Record<string,string>={
  'X에 공유':`https://twitter.com/intent/tweet?text=${title}&url=${url}`,
  'Facebook에 공유':`https://www.facebook.com/sharer/sharer.php?u=${url}`,
  'LinkedIn에 공유':`https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
  '네이버 블로그에 공유':`https://share.naver.com/web/shareView?url=${url}&title=${title}`
 };
 return withChildren(share,share.children.map(c=>isEl(c)&&hrefs[c.attrs['aria-label']]?withAttrs(c,{href:hrefs[c.attrs['aria-label']]}):c));
}

function articleHeader(header:El,a:Article,origin:string):El{
 const [meta,h1,summary]=header.children.filter(isEl);
 const share=mustFind(header.children,hasClass('mui-amb5n2'),'share');
 const newMeta=mapTree([meta],n=>{
  if(hasClass('mui-b9zgoq')(n))return[replaceText(n,a.category.name)];
  if(n.tag==='time')return[withChildren(withAttrs(n,{datetime:new Date(a.publishedAt!).toISOString()}),[formatDate(a.publishedAt!)])];
  if(n.tag==='span'&&/min read/.test(textOf(n)))return[replaceText(n,`· ${a.readMinutes} min read`)];
  return undefined;
 });
 const parts:CapturedNode[]=[...newMeta,replaceText(h1,a.title)];
 if(a.showSummary&&a.summary&&summary.tag==='p')parts.push(replaceText(summary,a.summary));
 parts.push(shareLinks(share,a,origin));
 return withChildren(header,parts);
}

function navAnchor(tpl:El,target:Article):El{
 return mapTree([withAttrs(tpl,{href:target.url})],n=>n.tag==='p'?[replaceText(n,target.title)]:undefined)[0] as El;
}
function prevNext(box:El,older:Article|undefined,newer:Article|undefined):El{
 const [prevTpl,nextTpl]=[mustFind(box.children,hasClass('mui-1ltivly'),'prev'),mustFind(box.children,hasClass('mui-1wt77r0'),'next')];
 const empty:El={tag:'div',attrs:{class:'MuiBox-root mui-0'},children:[]};
 return withChildren(box,[older?navAnchor(prevTpl,older):empty,newer?navAnchor(nextTpl,newer):{...empty}]);
}

function toc(nav:El,headings:Heading[]):El{
 const label=mustFind(nav.children,n=>n.tag==='span','toc label');
 const links=headings.filter(h=>h.depth<=3).map((h,i):El=>({tag:'a',attrs:{class:i===0?'MuiBox-root mui-1dsm7pu':h.depth===3?'MuiBox-root mui-1ahkk7l':'MuiBox-root mui-h98nsl',href:'#'+h.id},children:[h.text]}));
 return withChildren(nav,[label,...links]);
}

function breadcrumb(ol:El,a:Article):El{
 const items=ol.children.filter(isEl);
 const [, , catLi, , currentLi]=items;
 return withChildren(ol,ol.children.map(c=>{
  if(c===catLi)return mapTree([c],n=>n.tag==='a'?[withChildren(withAttrs(n,{href:`/blog?category=${a.category.slug}`}),n.children.map(s=>isEl(s)?replaceText(s,a.category.name):s))]:undefined)[0];
  if(c===currentLi)return mapTree([c],n=>n.tag==='span'?[replaceText(n,a.title)]:undefined)[0];
  return c;
 }));
}

export async function buildArticlePage(db:Database,a:Article,{origin}:Options):Promise<CapturedPageData>{
 const tpl=await template(ARTICLE_TEMPLATE);
 const all=listPublishedArticles(db,{});
 const cats=listCategories(db).filter(c=>c.publishedCount>0);
 const i=all.findIndex(x=>x.id===a.id);
 const {nodes,headings}=renderMarkdown(a.bodyMarkdown);
 const tags=mustFind(tpl.body,hasClass('mui-kdcaw'),'tags');
 const tagTpl=tags.children.find(isEl)!;
 const body=mapTree(tpl.body,n=>{
  if(isSidebarContainer(n))return[sidebarGroups(n,cats,all,a.url)];
  if(n.tag==='nav'&&n.attrs['aria-label']==='페이지 경로')return[mapTree([n],x=>x.tag==='ol'?[breadcrumb(x,a)]:undefined)[0]];
  if(hasClass('mui-1yjvs5a')(n))return[articleHeader(n,a,origin)];
  if(hasClass('mui-49c794')(n))return[withChildren(n,nodes)];
  if(n===tags)return[withChildren(n,a.tags.map(t=>mapTree([tagTpl],x=>hasClass('mui-oruufx')(x)?[replaceText(x,t)]:undefined)[0]))];
  if(hasClass('mui-1o2n272')(n))return[prevNext(n,all[i+1],i>0?all[i-1]:undefined)];
  if(n.tag==='nav'&&n.attrs['aria-label']==='목차')return[toc(n,headings)];
  return undefined;
 });
 return{...tpl,path:a.url,title:`${a.title} | NAEO`,description:a.summary,css:await blogCss(),body,source:'database',capturedAt:new Date(a.updatedAt).toISOString()};
}

function card(tpl:El,a:Article,eager:boolean):El{
 return mapTree([withAttrs(tpl,{href:a.url})],n=>{
  if(n.tag==='img'){const rest=Object.fromEntries(Object.entries(n.attrs).filter(([k])=>k!=='loading'));return[{...n,attrs:eager?{...rest,src:a.coverImage}:{...rest,loading:'lazy',src:a.coverImage}}];}
  if(hasClass('mui-b9zgoq')(n))return[replaceText(n,a.category.name)];
  if(n.tag==='span'&&/min read/.test(textOf(n)))return[replaceText(n,`${formatDate(a.publishedAt!)} · ${a.readMinutes} min read`)];
  if(n.tag==='p'&&hasClass('MuiTypography-body1')(n)||n.tag==='h6')return[replaceText(n,a.title)];
  if(n.tag==='p'&&hasClass('MuiTypography-body2')(n))return[replaceText(n,a.summary)];
  return undefined;
 })[0] as El;
}
/** 섹션 안의 카드 목록을 바꾼다. 원본처럼 추천·언론 보도 첫 카드 이미지는 즉시 로드한다. */
function cardSection(section:El,list:Article[],firstEager:boolean,label?:string):El{
 const grid=mustFind(section.children,n=>n.children.some(c=>isEl(c)&&c.tag==='a'),'card grid');
 const tpl=grid.children.find(c=>isEl(c)&&c.tag==='a') as El;
 return mapTree([section],n=>{
  if(n===grid)return[withChildren(n,list.map((a,i)=>card(tpl,a,firstEager&&i===0)))];
  if(label&&n.tag==='span'&&hasClass('MuiTypography-overline')(n))return[replaceText(n,label)];
  return undefined;
 })[0] as El;
}

function eventHighlight(box:El,e:Article):El{
 return mapTree([box],n=>{
  if(n.tag==='a'&&textOf(n).includes('자세히 보기'))return[withAttrs(n,{href:e.url})];
  if(hasClass('mui-1lbah0i')(n))return[mapTree([withAttrs(n,{href:e.url,'aria-label':`이벤트 보기: ${e.title}`})],x=>{
   if(x.tag==='img')return[withAttrs(x,{src:e.coverImage,alt:e.title})];
   if(x.tag==='p')return[replaceText(x,e.title)];
   if(x.tag==='span')return[replaceText(x,e.summary)];
   return undefined;
  })[0]];
  return undefined;
 })[0] as El;
}

function tabs(list:El,cats:Category[],total:number):El{
 const [selected,outlined]=list.children.filter(isEl);
 const tab=(tpl:El,label:string,slug:string)=>withChildren(withAttrs(tpl,{'data-category':slug}),[label]);
 return withChildren(list,[tab(selected,`전체 (${total})`,''),...cats.map(c=>tab(outlined,`${c.name} (${c.publishedCount})`,c.slug))]);
}

export async function buildBlogIndexPage(db:Database):Promise<CapturedPageData>{
 const tpl=await template(INDEX_TEMPLATE);
 const s=blogIndexSections(db);
 const cats=listCategories(db).filter(c=>c.publishedCount>0);
 const sectionLabel=(n:El)=>{const span=n.children.find(c=>isEl(c)&&c.tag==='span');return span?textOf(span).trim():'';};
 const news=cats.find(c=>c.slug==='news');
 const body=mapTree(tpl.body,n=>{
  if(isSidebarContainer(n))return[sidebarGroups(n,cats,s.all,null)];
  if(n.attrs.role==='tablist'&&n.attrs['aria-label']==='블로그 카테고리')return[tabs(n,cats,s.all.length)];
  if(hasClass('mui-10ib5jr')(n)&&find(n.children,x=>x.tag==='h6'&&textOf(x)==='이벤트'))return s.event?[eventHighlight(n,s.event)]:[];
  if(n.tag==='section'&&sectionLabel(n)==='추천 가이드')return s.featured.length?[cardSection(n,s.featured,true)]:[];
  if(n.tag==='section'&&sectionLabel(n)==='언론 보도')return s.news.length?[cardSection(n,s.news,true,news?.name)]:[];
  if(n.tag==='section'&&sectionLabel(n)==='전체 글')return[cardSection(n,s.rest,false)];
  return undefined;
 });
 return{...tpl,css:await blogCss(),body,source:'database'};
}

export const blogArticleRoute=(path:string)=>{const m=/^\/blog\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(path);return m?{category:m[1],slug:m[2]}:null;};
