import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import {isTrackingPixel} from '../content/blog-pages';
import {hasClass,isEl,mapTree,withChildren,type El} from '../content/tree';

const NOT_CONFIGURED='AI 브리핑 인용 확인 공급자가 설정되지 않았습니다.';
const zeroCounts=(nodes:CapturedNode[]):CapturedNode[]=>nodes.map(n=>typeof n==='string'?n.replace(/\d[\d,]*/g,'0'):{...n,children:zeroCounts(n.children)});

function metricCard(card:El):El{
 const [label,value,caption]=card.children.filter(isEl);
 const valueTpl:El=value.tag==='p'?value:{tag:'p',attrs:{class:'MuiTypography-root MuiTypography-body1 mui-tehul9'},children:[]};
 const captionTpl:El=caption?.tag==='p'?caption:{tag:'p',attrs:{class:'MuiTypography-root MuiTypography-body2 mui-1we6nek'},children:[]};
 return withChildren(card,[label,withChildren(valueTpl,['-']),withChildren(captionTpl,['미설정'])]);
}

/** /dashboard/ai-picks: 인용 확인 공급자가 없어 원본 계정의 인용 목록·지표를 지우고 미설정 상태를 보여준다. */
export async function buildAiPicksPage():Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/dashboard/ai-picks');
 if(!tpl)throw new Error('ai-picks template missing');
 const body=mapTree(tpl.body.filter(n=>!isTrackingPixel(n)),n=>{
  if(hasClass('mui-1ptiu1r')(n)){
   const [strong,span]=n.children.filter(isEl);
   return[withChildren(n,[withChildren(strong,[NOT_CONFIGURED]),' ',withChildren(span,['설정되면 내 키워드에서 AI 브리핑 인용 여부를 확인해 여기에 보여드립니다.'])])];
  }
  if(n.attrs['aria-label']==='AI 인용 현황 핵심 지표')return[withChildren(n,n.children.map(c=>isEl(c)&&hasClass('mui-h2iker')(c)?metricCard(c):c))];
  if(hasClass('mui-1aa9dm1')(n)){const label=n.children.filter(isEl)[0];return[withChildren(n,[label,{tag:'p',attrs:{style:'color:#a3a3a3;font-size:13px;margin:8px 0 0'},children:['데이터 없음']}])];}
  if(hasClass('mui-d7s6pe')(n))return[withChildren(n,zeroCounts(n.children))];
  if(hasClass('mui-uien4a')(n))return[withChildren(n,[{tag:'div',attrs:{role:'status',style:'padding:32px 16px;text-align:center;color:#a3a3a3;font-size:14px'},children:[`${NOT_CONFIGURED} (미설정) 인용 기록이 아직 없습니다.`]}])];
  return undefined;
 });
 return{...tpl,body,source:'database'};
}
