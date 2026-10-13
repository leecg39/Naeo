import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import {isTrackingPixel} from './blog-pages';
import {renderMarkdown} from './markdown';
import {FILTER_TYPES,UPDATE_TYPE_LABELS,type SiteUpdate,type UpdateType} from './updates';
import {find,hasClass,isEl,mapTree,mustFind,withAttrs,withChildren,type El} from './tree';

/** 분류 칩 색 클래스. 'fix'는 캡처에 예가 없어 '개선' 칩 모양을 쓴다(새 규칙). */
const CHIP_CLASS:Record<UpdateType,string>={feature:'mui-10qflqo',improvement:'mui-1amze8r',fix:'mui-1amze8r',design:'mui-6hhxz0'};
const [y,m,d]=[0,1,2];
const parts=(iso:string)=>iso.split('-').map(Number);
const dayLabel=(iso:string)=>{const p=parts(iso);return`${p[y]}년 ${p[m]}월 ${p[d]}일`;};
const monthLabel=(iso:string)=>{const p=parts(iso);return`${p[y]}년 ${p[m]}월`;};

function chip(tpl:El,label:string,colorClass?:string):El{
 const cls=colorClass?(tpl.attrs.class??'').replace(/mui-[a-z0-9]+$/,colorClass):tpl.attrs.class??'';
 return mapTree([withAttrs(tpl,{class:cls})],n=>hasClass('MuiChip-label')(n)?[withChildren(n,[label])]:undefined)[0] as El;
}

function card(tpl:El,u:SiteUpdate):El{
 const chipTpl=mustFind(tpl.children,hasClass('MuiChip-root'),'chip');
 const contentId=`update-content-${u.slug}`;
 return mapTree([withAttrs(tpl,{id:u.slug})],n=>{
  if(n.attrs['aria-controls'])return[{...mapTree([withAttrs(n,{'aria-controls':contentId})],x=>{
   if(hasClass('mui-1qhv6jf')(x)){
    const time=mustFind(x.children,c=>c.tag==='time','time');
    return[withChildren(x,[chip(chipTpl,u.versionLabel,'mui-12sgdhy'),...u.types.map(t=>chip(chipTpl,UPDATE_TYPE_LABELS[t],CHIP_CLASS[t])),withChildren(withAttrs(time,{datetime:`${u.publishedOn}T00:00:00.000Z`}),[dayLabel(u.publishedOn)])])];
   }
   if(x.tag==='h3')return[withChildren(x,[u.title])];
   if(hasClass('mui-f7fcvj')(x))return[withChildren(x,[u.summary])];
   return undefined;
  })[0] as El}];
  if(hasClass('MuiCollapse-root')(n))return[mapTree([withAttrs(n,{id:contentId})],x=>hasClass('mdx-prose')(x)?[withChildren(x,renderMarkdown(u.bodyMarkdown).nodes)]:undefined)[0]];
  return undefined;
 })[0] as El;
}

/** 월별 묶음: 머리글 행 + 세로선 + 항목(점+카드). 마지막 묶음은 원본처럼 아래 여백 없는 클래스를 쓴다. */
function monthGroups(list:El,updates:SiteUpdate[]):El[]{
 const groups=list.children.filter(isEl);
 const groupTpl=groups[0],lastClass=groups.at(-1)!.attrs.class??'';
 const [headRow,timeline]=groupTpl.children.filter(isEl);
 const [line,itemTpl]=timeline.children.filter(isEl);
 const [dot,cardTpl]=itemTpl.children.filter(isEl);
 const months=[...new Set(updates.map(u=>monthLabel(u.publishedOn)))];
 return months.map((label,i)=>withChildren(i===months.length-1?withAttrs(groupTpl,{class:lastClass}):groupTpl,[
  mapTree([headRow],n=>n.tag==='h2'?[withChildren(n,[label])]:undefined)[0],
  withChildren(timeline,[line,...updates.filter(u=>monthLabel(u.publishedOn)===label).map(u=>withChildren(itemTpl,[dot,card(cardTpl,u)]))])
 ]));
}

function filterTabs(tablist:El,updates:SiteUpdate[]):El{
 const [all,...rest]=tablist.children.filter(isEl);
 const tpl=rest[0];
 const count=(t:UpdateType)=>String(updates.filter(u=>u.types.includes(t)).length);
 return withChildren(tablist,[all,...FILTER_TYPES.map(t=>withChildren(tpl,[UPDATE_TYPE_LABELS[t],' (',count(t),')']))]);
}

/** /updates 캡처를 틀로 DB의 공개 업데이트를 최신순·월별로 다시 만든다. 본문은 안전한 마크다운 렌더러를 쓴다. */
export async function buildUpdatesPage(updates:SiteUpdate[]):Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/updates');
 if(!tpl)throw new Error('updates template missing');
 const body=mapTree(tpl.body.filter(n=>!isTrackingPixel(n)),n=>{
  if(n.attrs.role==='tablist'&&n.attrs['aria-label']==='업데이트 필터')return[filterTabs(n,updates)];
  if(hasClass('mui-1et8h7o')(n))return[withChildren(n,updates.length?monthGroups(n,updates):[])];
  return undefined;
 });
 return{...tpl,body,source:'database'};
}
export const hasUpdateList=(page:CapturedPageData):boolean=>!!find(page.body,hasClass('mui-1et8h7o'));
export type {CapturedNode};
