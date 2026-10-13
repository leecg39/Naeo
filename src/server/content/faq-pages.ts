import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import {isTrackingPixel} from './blog-pages';
import {groupFaq,type FaqItem} from './faq';
import {hasClass,isEl,mapTree,mustFind,withChildren,type El} from './tree';

/** 질문·답변 글자는 텍스트 노드로만 넣는다(HTML 해석 없음). 답변 줄바꿈은 원본처럼 그대로 둔다. */
function accordion(tpl:El,f:FaqItem):El{
 return mapTree([tpl],n=>{
  if(hasClass('mui-1sfflb6')(n))return[withChildren(n,[f.question])];
  if(hasClass('mui-1vau8ke')(n))return[withChildren(n,[f.answer])];
  return undefined;
 })[0] as El;
}

function sections(container:El,items:FaqItem[]):CapturedNode[]{
 const sectionTpl=mustFind(container.children,n=>n.tag==='section','faq section');
 const headingTpl=mustFind(sectionTpl.children,n=>n.tag==='h2','faq heading');
 const accordionTpl=mustFind(sectionTpl.children,hasClass('MuiAccordion-root'),'faq accordion');
 return groupFaq(items).map(g=>withChildren(sectionTpl,[withChildren(headingTpl,[g.category]),...g.items.map(f=>accordion(accordionTpl,f))]));
}

/** /faq 캡처를 틀로 DB의 공개 FAQ를 분류별 접이식 목록으로 다시 만든다. */
export async function buildFaqPage(items:FaqItem[]):Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/faq');
 if(!tpl)throw new Error('faq template missing');
 const body=mapTree(tpl.body.filter(n=>!isTrackingPixel(n)),n=>{
  if(!hasClass('mui-1thvpft')(n))return undefined;
  const intro=n.children.filter(c=>!(isEl(c)&&c.tag==='section'));
  return[withChildren(n,[...intro,...sections(n,items)])];
 });
 return{...tpl,body,source:'database'};
}
