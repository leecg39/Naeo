import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import {isTrackingPixel} from '../content/blog-pages';
import {hasClass,mapTree,withChildren,type El} from '../content/tree';
import type {Payment} from './payments';
import type {Subscription} from './subscriptions';

const el=(tag:string,attrs:Record<string,string>,children:CapturedNode[]=[]):El=>({tag,attrs,children});
const p=(t:string)=>el('p',{style:'margin:0;color:#525252;line-height:1.6'},[t]);
const link=(href:string,t:string,primary=false)=>el('a',{href,style:`display:inline-block;padding:10px 18px;border-radius:999px;font-weight:700;text-decoration:none;${primary?'background:#03c75a;color:#fff':'background:#f5f5f5;color:#171717'}`},[t]);
const day=(ms:number)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'long'}).format(ms);
export type CompleteView={payment:Payment|null;subscription:Subscription|null;error:string|null};

function content(v:CompleteView):{title:string;rows:CapturedNode[]}{
 const pay=v.payment;
 if(pay?.status==='ready'&&pay.confirmStartedAt!==null&&pay.confirmStartedAt!==undefined)return{title:'결제를 확인하는 중이에요',rows:[p('결제 결과가 아직 확정되지 않았어요. 중복 결제를 진행하지 말고 결제 내역에서 다시 확인해주세요.'),link('/dashboard/settings#billing','결제 내역에서 확인',true)]};
 if(v.error&&(!pay||pay.status!=='paid'))return{title:'결제가 완료되지 않았어요',rows:[p(v.error),el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;justify-content:center'},[link('/pricing','요금제로 돌아가기',true),link('/dashboard/settings#billing','결제 내역')])]};
 if(!pay)return{title:'결제 정보를 찾을 수 없어요',rows:[p('주문 번호를 확인할 수 없습니다.'),link('/pricing','요금제 보기',true)]};
 if(pay.status==='paid'){
  const sub=v.subscription;
  const period=sub?(sub.renewalPaymentId===pay.id?`현재 기간이 끝나는 ${day(sub.currentPeriodEnd)}부터 다음 30일이 시작돼요.`:`${day(sub.currentPeriodEnd)}까지 이용할 수 있어요.`):'';
  return{title:'결제가 완료되었어요',rows:[p(`${pay.orderName} · ₩${pay.amount.toLocaleString('ko-KR')}${pay.method?` · ${pay.method}`:''}`),...(period?[p(period)]:[]),p('결제 후 7일 안에는 설정의 결제 내역에서 환불을 요청할 수 있어요.'),
   el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;justify-content:center'},[link('/dashboard','대시보드로',true),link('/dashboard/settings#billing','결제 내역')])]};
 }
 if(pay.status==='canceled'||pay.status==='partial_canceled')return{title:'환불된 결제예요',rows:[p(`환불 금액 ₩${pay.canceledAmount.toLocaleString('ko-KR')}`),link('/dashboard/settings#billing','결제 내역',true)]};
 if(pay.status==='ready')return{title:'결제를 확인하는 중이에요',rows:[p('결제사 승인 결과를 기다리고 있어요. 잠시 후 새로고침해주세요.'),link('/dashboard/settings#billing','결제 내역',true)]};
 return{title:'결제가 완료되지 않았어요',rows:[p(pay.failureMessage||'결제가 취소되었거나 시간이 지났어요.'),link('/pricing','다시 결제하기',true)]};
}

/** /payment/complete: 쿼리 값이 아니라 서버에 저장된 주문 상태로 결과를 그린다. */
export async function buildPaymentCompletePage(v:CompleteView):Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/payment/complete');
 if(!tpl)throw new Error('payment complete template missing');
 const {title,rows}=content(v);
 const body=mapTree(tpl.body.filter(n=>!isTrackingPixel(n)),n=>{
  if(!hasClass('mui-5mnig')(n))return undefined;
  const h5=n.children.find((c):c is El=>typeof c!=='string'&&c.tag==='h5');
  return[withChildren(n,[...(h5?[withChildren(h5,[title])]:[el('h5',{},[title])]),el('div',{'data-payment-result':v.payment?.status??'error',style:'display:grid;gap:12px;justify-items:center;text-align:center;margin-top:12px'},rows)])];
 });
 return{...tpl,body,title:`${title} | NAEO`,source:'database'};
}
