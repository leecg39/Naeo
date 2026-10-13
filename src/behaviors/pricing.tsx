'use client';
import {useEffect,useState} from 'react';
import type {InstallBehavior,BehaviorTools} from '@/lib/behavior';
import {api,ApiError} from '@/lib/api-client';

type Me={subscription:{planCode:string;trial:boolean}|null;paymentsConfigured:boolean};
type Order={orderId:string;orderName:string;amount:number;status:string;clientKey:string|null;customerKey:string};
type TossPayment={requestPayment:(o:Record<string,unknown>)=>Promise<void>};
type TossFactory=(clientKey:string)=>{payment:(o:{customerKey:string})=>TossPayment};
const SDK='https://js.tosspayments.com/v2/standard';

/** 토스 결제창 SDK(v2 standard)를 한 번만 불러온다. */
function loadToss():Promise<TossFactory>{
 const w=window as unknown as {TossPayments?:TossFactory};
 if(w.TossPayments)return Promise.resolve(w.TossPayments);
 return new Promise((resolve,reject)=>{
  const s=document.createElement('script');s.src=SDK;s.async=true;
  s.onload=()=>w.TossPayments?resolve(w.TossPayments):reject(new Error('결제 모듈을 불러오지 못했습니다.'));
  s.onerror=()=>reject(new Error('결제 모듈을 불러오지 못했습니다. 네트워크를 확인해주세요.'));
  document.head.appendChild(s);
 });
}
const box={display:'grid',gap:12} as const;
const input={padding:'10px 12px',border:'1px solid #d4d4d4',borderRadius:10,fontSize:15} as const;

function PlanDialog({plan,price,trialDays,tools}:{plan:string;price:number;trialDays:number;tools:BehaviorTools}){
 const [me,setMe]=useState<Me|null>(null),[coupon,setCoupon]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let live=true;void api<Me>('/api/billing/me').then(m=>{if(live)setMe(m);}).catch(e=>{if(live)setError(e instanceof Error?e.message:'불러오지 못했습니다.');});return()=>{live=false;};},[]);
 async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof ApiError||e instanceof Error?e.message:'처리하지 못했습니다.');}finally{setBusy(false);}}
 const trial=()=>void run(async()=>{await api('/api/billing/trial',{method:'POST',body:{planCode:plan}});tools.closeDialog();tools.toast(`${trialDays}일 무료 체험을 시작했어요.`);tools.navigate('/dashboard/settings#billing');});
 const pay=()=>void run(async()=>{
  const order=await api<Order>('/api/billing/checkout',{method:'POST',body:{planCode:plan,...(coupon.trim()?{couponCode:coupon.trim()}:{})}});
  if(order.status==='paid'){tools.navigate(`/payment/complete?orderId=${encodeURIComponent(order.orderId)}`);return;}
  const toss=(await loadToss())(order.clientKey!);
  const back=`${window.location.origin}/payment/complete`;
  await toss.payment({customerKey:order.customerKey}).requestPayment({method:'CARD',amount:{currency:'KRW',value:order.amount},orderId:order.orderId,orderName:order.orderName,successUrl:back,failUrl:back});
 });
 if(!me&&!error)return <p role="status">불러오는 중…</p>;
 const canTrial=trialDays>0&&me&&!me.subscription;
 return <div style={box}>
  {error&&<p role="alert" style={{margin:0,color:'#dc2626'}}>{error}</p>}
  {canTrial&&<><p style={{margin:0}}>카드 등록 없이 {trialDays}일 동안 써볼 수 있어요. 계정·블로그당 한 번만 가능해요.</p><button className="naeo-button" type="button" disabled={busy} onClick={trial}>{trialDays}일 무료 체험 시작</button><hr style={{border:0,borderTop:'1px solid #e5e5e5',width:'100%'}}/></>}
  <label style={{display:'grid',gap:6}}>할인 쿠폰 코드(선택)<input style={input} value={coupon} onChange={e=>setCoupon(e.target.value)} maxLength={40} disabled={busy} autoComplete="off"/></label>
  <button className="naeo-button" type="button" disabled={busy||!me?.paymentsConfigured} onClick={pay}>{me?.paymentsConfigured?`₩${price.toLocaleString('ko-KR')} 결제하기`:'결제 미설정'}</button>
  <p style={{margin:0,fontSize:13,color:'#737373'}}>{me?.paymentsConfigured?'토스페이먼츠 결제창으로 이동해요. 30일 이용권이며 자동 결제되지 않아요.':'결제 키가 설정되지 않아 결제할 수 없어요. 체험과 쿠폰은 이용할 수 있어요.'}</p>
 </div>;
}

/** /pricing 요금제 버튼: 로그인 확인 후 체험·쿠폰·결제창을 연다. */
export const installPricing:InstallBehavior=(root,tools)=>{
 const onClick=(e:MouseEvent)=>{
  const b=e.target instanceof Element?e.target.closest<HTMLElement>('[data-plan-action]'):null;
  if(!b||b.hasAttribute('disabled'))return;
  e.preventDefault();
  const plan=b.dataset.planAction!,price=Number(b.dataset.price),trialDays=Number(b.dataset.trialDays);
  void api<Me>('/api/billing/me').then(()=>{
   if(price===0){tools.navigate('/dashboard');return;}
   tools.openDialog(b.closest('[data-plan]')?.querySelector('h6')?.textContent??'요금제',<PlanDialog plan={plan} price={price} trialDays={trialDays} tools={tools}/>);
  }).catch(err=>{if(err instanceof ApiError&&err.status===401)tools.navigate('/login?next=%2Fpricing');else tools.toast('요금제 정보를 불러오지 못했어요.');});
 };
 root.addEventListener('click',onClick);
 return()=>root.removeEventListener('click',onClick);
};
