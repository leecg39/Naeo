import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {isTrackingPixel} from '../content/blog-pages';
import {hasClass,isEl,mapTree,withAttrs,withChildren,type El} from '../content/tree';
import {listMyMateReports,type MateReport} from './mate';

const el=(tag:string,attrs:Record<string,string>,children:CapturedNode[]=[]):El=>({tag,attrs,children});
const KST=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'});

function item(r:MateReport):El{
 return el('li',{'data-mate-report':r.token,style:'display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding:14px 16px;border:1px solid rgba(255,255,255,.1);border-radius:12px'},[
  el('div',{style:'display:grid;gap:2px;min-width:0'},[
   el('strong',{style:'font-size:15px;overflow-wrap:anywhere'},[`${r.naverId} · ${r.report.score}점`]),
   el('span',{style:'font-size:13px;color:#a3a3a3'},[`${KST.format(new Date(r.createdAt))} · 공개 글 ${r.postCount}개 · 할 일 ${r.report.actions.length}개`])
  ]),
  el('div',{style:'display:flex;gap:8px'},[
   el('a',{href:`/mate/s?r=${r.token}`,style:'color:#03c75a;font-weight:700;font-size:14px'},['리포트 보기']),
   el('button',{type:'button','data-mate-delete':r.token,'aria-label':`${r.naverId} 진단 기록 삭제`,style:'background:transparent;border:1px solid rgba(255,255,255,.3);color:inherit;border-radius:8px;padding:4px 10px;cursor:pointer;font:inherit;font-size:13px'},['삭제'])
  ])
 ]);
}

/** /dashboard/mate: 로그인 회원 본인의 무료 진단 기록(30일 보관). 없으면 캡처의 빈 상태를 그대로 쓴다. */
export async function buildMateDashboardPage(db:Database,userId:string,now=Date.now()):Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/dashboard/mate');
 if(!tpl)throw new Error('mate dashboard template missing');
 const reports=listMyMateReports(db,userId,{pageSize:50},now).data;
 const body=mapTree(tpl.body.filter(n=>!isTrackingPixel(n)),n=>{
  if(!reports.length||!hasClass('mui-58vxc6')(n))return undefined;
  const [h5,p,link]=n.children.filter(isEl);
  return[withChildren(withAttrs(n,{style:'align-items:stretch;text-align:left'}),[
   withChildren(h5,[`메이트 진단 기록 ${reports.length}건`]),
   withChildren(p,['리포트와 공유 링크는 진단일부터 30일 동안 열 수 있습니다.']),
   el('ul',{style:'list-style:none;margin:16px 0;padding:0;display:grid;gap:10px;width:100%'},reports.map(item)),
   withChildren(link,['새 블로그 진단하기'])
  ])];
 });
 return{...tpl,body,source:'database'};
}
