import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode,CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {isTrackingPixel} from '../content/blog-pages';
import {hasClass,isEl,mapTree,textOf,withAttrs,withChildren,type El} from '../content/tree';
import {DAILY_SCAN_LIMIT} from '../jobs/queue';
import {listPublicPlans,type Plan} from './plans';
import {currentSubscription,PERIOD_DAYS,type Subscription} from './subscriptions';
import {seedPlans} from './seed';

const cls=(c:string)=>hasClass(c);
const set=(n:El,t:string)=>withChildren(n,[t]);
const won=(n:number)=>`₩${n.toLocaleString('ko-KR')}`;
const first=(nodes:CapturedNode[],f:(n:El)=>boolean):El|undefined=>{for(const n of nodes){if(!isEl(n))continue;if(f(n))return n;const x=first(n.children,f);if(x)return x;}return undefined;};

function features(plan:Plan):string[]{
 if(plan.price===0)return[`블로그 진단 하루 ${DAILY_SCAN_LIMIT}회`,'랭킹·이벤트 참여','쿠폰 토큰 사용'];
 return[`${PERIOD_DAYS}일마다 ${plan.monthlyTokens.toLocaleString('ko-KR')}토큰`,...(plan.trialDays?[`${plan.trialDays}일 무료 체험(계정·블로그당 1회)`]:[]),'AI 글쓰기·블로그 진단·키워드 추천','결제 후 7일 안 환불 요청','기간이 끝나면 남은 기간 토큰 소멸'];
}
function action(plan:Plan,sub:Subscription|null,loggedIn:boolean):{label:string;disabled:boolean}{
 if(sub?.planId===plan.id)return{label:sub.trial?'체험 중':'이용 중',disabled:!sub.trial};
 if(plan.price===0)return{label:loggedIn?'무료로 이용 중':'무료로 시작하기',disabled:loggedIn&&!sub};
 return{label:!sub&&plan.trialDays?`${plan.trialDays}일 무료 체험`:'결제하기',disabled:false};
}
function card(tpl:El,unitTpl:El|undefined,plan:Plan,sub:Subscription|null,loggedIn:boolean):El{
 const row=first(tpl.children,cls('mui-zcccau'));
 const act=action(plan,sub,loggedIn);
 return mapTree([withAttrs(tpl,{'data-plan':plan.code})],n=>{
  if(cls('MuiChip-label')(n))return[set(n,plan.trialDays?`${plan.trialDays}일 무료 체험`:'추천')];
  if(n.tag==='h6')return[set(n,plan.name)];
  if(cls('mui-11z8a71')(n))return[set(n,plan.description)];
  if(cls('mui-pknlr3')(n)){const h4=first(n.children,x=>x.tag==='h4')!;return[withChildren(n,[set(h4,won(plan.price)),...(plan.price>0&&unitTpl?[set(unitTpl,`/${PERIOD_DAYS}일`)]:[])])];}
  if(cls('mui-83r2k5')(n))return[set(n,plan.price>0?`${PERIOD_DAYS}일 이용권 · 자동 결제 없음`:'결제 없이 이용')];
  if(cls('mui-m7p7vu')(n)&&row)return[withChildren(n,features(plan).map(f=>mapTree([row],x=>x.tag==='p'?[set(x,f)]:undefined)[0]))];
  if(n.tag==='button'){
   const klass=(n.attrs.class??'').replace(/\bMui-disabled\b/g,'')+(act.disabled?' Mui-disabled':'');
   const attrs:Record<string,string>={...n.attrs,class:klass,type:'button','data-plan-action':plan.code,'data-price':String(plan.price),'data-trial-days':String(plan.trialDays),'aria-label':`${plan.name} ${act.label}`};
   if(act.disabled)attrs.disabled='';else delete attrs.disabled;
   return[{...n,attrs,children:[act.label]}];
  }
  return undefined;
 })[0] as El;
}

/** /pricing: 판매 중인 DB 요금제와 내 구독 상태로 카드·버튼을 다시 그린다(가격이 '문의'인 캡처 카드는 그대로). */
export async function buildPricingPage(db:Database,viewerId:string|null,configured:boolean,now=Date.now()):Promise<CapturedPageData>{
 await seedPlans(db,now);
 const tpl=await getCapturedPage('/pricing');
 if(!tpl)throw new Error('pricing template missing');
 const plans=listPublicPlans(db),sub=viewerId?currentSubscription(db,viewerId,now):null;
 const body=mapTree(tpl.body.filter(n=>!isTrackingPixel(n)),n=>{
  if(cls('MuiAlert-message')(n))return[set(n,configured?'결제는 토스페이먼츠로 처리되며 카드 정보는 이 서비스에 저장되지 않아요. 결제 후 7일 안에는 설정에서 환불을 요청할 수 있어요.':'지금은 결제 기능이 설정되지 않았어요(미설정). 무료 체험과 쿠폰은 이용할 수 있어요.')];
  if(!cls('mui-517y9t')(n))return undefined;
  const cards=n.children.filter(isEl);
  const contact=cards.filter(c=>!/\d/.test(textOf(first([c],x=>x.tag==='h4')??c)));
  const plain=cards.find(c=>!contact.includes(c)&&!first([c],cls('MuiChip-root')))??cards[0];
  const highlight=cards.find(c=>first([c],cls('MuiChip-root')))??plain;
  const unit=first(highlight.children,cls('mui-1hnqmre'));
  return[withChildren(n,[...plans.map(p=>card(p.trialDays>0?highlight:plain,unit,p,sub,viewerId!==null)),...contact])];
 });
 return{...tpl,body,source:'database'};
}
