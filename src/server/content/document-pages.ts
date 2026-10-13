import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import {isTrackingPixel} from './blog-pages';
import {parseSections,type SiteDocument} from './documents';
import {hasClass,isEl,mapTree,mustFind,withChildren,type El} from './tree';

/** 정책 문서 4개는 같은 틀(제목·시행일·소제목/본문 절·맺음말)이라 /terms 캡처를 공통 틀로 쓴다. */
const TEMPLATE='/terms';

async function template():Promise<CapturedPageData>{
 const page=await getCapturedPage(TEMPLATE);
 if(!page)throw new Error('document template missing: '+TEMPLATE);
 return{...page,body:page.body.filter(n=>!isTrackingPixel(n))};
}

/** 문서 글자는 모두 텍스트 노드로만 넣는다(HTML 해석 없음). 줄바꿈은 원본 CSS의 pre-line으로 표시된다. */
function documentNodes(container:El,d:SiteDocument):CapturedNode[]{
 const parts=container.children.filter(isEl);
 const h4=mustFind(parts,n=>n.tag==='h4','title');
 const label=mustFind(parts,hasClass('mui-c0skwh'),'effective label');
 const sectionTpl=mustFind(parts,hasClass('mui-1yjvs5a'),'section');
 const [headingTpl,textTpl]=sectionTpl.children.filter(isEl);
 const closingTpl=mustFind(parts,hasClass('mui-hniutj'),'closing note');
 const {preface,sections}=parseSections(d.body);
 const section=(heading:string|null,text:string)=>withChildren(sectionTpl,[...(heading===null?[]:[withChildren(headingTpl,[heading])]),withChildren(textTpl,[text])]);
 return[
  withChildren(h4,[d.title]),
  ...(d.effectiveLabel?[withChildren(label,[d.effectiveLabel])]:[]),
  ...(preface?[section(null,preface)]:[]),
  ...sections.map(s=>section(s.heading,s.text)),
  ...(d.closingNote?[mapTree([closingTpl],n=>n.tag==='p'?[withChildren(n,[d.closingNote])]:undefined)[0]]:[])
 ];
}

export async function buildDocumentPage(d:SiteDocument):Promise<CapturedPageData>{
 const tpl=await template();
 const own=await getCapturedPage(d.path);
 const body=mapTree(tpl.body,n=>hasClass('mui-1thvpft')(n)?[withChildren(n,documentNodes(n,d))]:undefined);
 return{...tpl,path:d.path,title:`${d.title} | NAEO | NAEO`,description:own?.description??'',body,source:'database',capturedAt:new Date(d.updatedAt).toISOString()};
}
