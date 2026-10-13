'use client';
import {kstDate} from '@/lib/kst-time';
import {useState,type FormEvent} from 'react';
import {api,ApiError} from '@/lib/api-client';
import type {Subscription} from '@/server/billing/subscriptions';
import type {Payment} from '@/server/billing/payments';
import type {Refund} from '@/server/billing/refunds';

/** now: 환불 가능 기간 판단 기준 시각(서버 렌더 시각, 새로 불러올 때 갱신). */
export type BillingState={subscription:Subscription|null;payments:Payment[];refunds:Refund[];paymentsConfigured:boolean;balance:number;now:number};
const PAY:Record<Payment['status'],string>={ready:'결제 대기',paid:'결제 완료',failed:'실패',expired:'만료',canceled:'환불됨',partial_canceled:'부분 환불'};
const REFUND:Record<Refund['status'],string>={requested:'환불 심사 중',approved:'환불 처리 중',rejected:'환불 거절',completed:'환불 완료',failed:'환불 처리 실패(재처리 대기)'};
const day=(ms:number)=>kstDate(ms);
const WEEK=7*86_400_000;
/** 이벤트 처리기에서만 부르는 현재 시각(렌더 중에는 읽지 않는다). */
const clock=()=>Date.now();

export default function BillingSection({initial}:{initial:BillingState}){
 const [state,setState]=useState(initial),[code,setCode]=useState(''),[reason,setReason]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const reload=async()=>{
  const me=await api<Omit<BillingState,'balance'|'now'>>('/api/billing/me');
  const credits=await fetch('/api/credits',{cache:'no-store',credentials:'same-origin'}).then(r=>r.json()) as {balance:number};
  setState({...me,balance:credits.balance,now:clock()});
 };
 async function run(action:()=>Promise<string>){
  setBusy(true);setError('');setNotice('');
  try{const m=await action();await reload();setNotice(m);}catch(e){setError(e instanceof ApiError||e instanceof Error?e.message:'처리하지 못했습니다.');}finally{setBusy(false);}
 }
 const sub=state.subscription;
 const toggle=()=>void run(async()=>{await api(`/api/billing/subscription/${sub!.cancelAtPeriodEnd?'resume':'cancel'}`,{method:'POST',body:{version:sub!.version}});return sub!.cancelAtPeriodEnd?'해지 예약을 취소했어요.':'기간이 끝나면 해지돼요. 그때까지는 계속 이용할 수 있어요.';});
 const redeem=(e:FormEvent)=>{e.preventDefault();void run(async()=>{const r=await api<{tokens:number}>('/api/billing/coupons/redeem',{method:'POST',body:{code}});setCode('');return `쿠폰으로 ${r.tokens}토큰을 받았어요.`;});};
 const refund=(p:Payment)=>void run(async()=>{await api(`/api/billing/payments/${p.id}/refund`,{method:'POST',body:{reason:reason[p.id]??''}});return '환불을 요청했어요. 운영자 확인 후 처리돼요.';});
 const openRefund=(p:Payment)=>state.refunds.find(r=>r.paymentId===p.id&&['requested','approved','failed'].includes(r.status));
 return <section className="panel account-card" id="billing" aria-label="구독·결제">
  <h2>구독·결제</h2>
  <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>
  <p>보유 토큰 <strong>{state.balance.toLocaleString('ko-KR')}</strong></p>
  {sub?<div className="account-form">
   <p><strong>{sub.planName}</strong> · {sub.trial?'무료 체험 중':'이용 중'} · {day(sub.currentPeriodEnd)}까지{sub.cancelAtPeriodEnd?' (기간 종료 후 해지)':''}</p>
   {sub.renewalPaymentId&&<p className="muted">다음 30일 이용권 결제가 완료되어 기간이 끝나면 이어서 시작돼요.</p>}
   <p className="muted">기간이 끝나면 그 기간에 받은 토큰 중 쓰지 않은 만큼은 사라져요. 자동 결제는 없어요.</p>
   <div className="account-actions"><button className="button secondary" type="button" disabled={busy} onClick={toggle}>{sub.cancelAtPeriodEnd?'해지 예약 취소':'구독 해지 예약'}</button><a className="button secondary" href="/pricing">{sub.trial?'유료로 전환':'요금제 보기'}</a></div>
  </div>:<div className="account-form"><p>무료 이용 중이에요.</p><a className="button" href="/pricing">요금제·무료 체험 보기</a>{!state.paymentsConfigured&&<p className="muted">결제 기능은 아직 설정되지 않았어요(미설정).</p>}</div>}
  <form className="account-form" onSubmit={redeem} aria-label="쿠폰 사용">
   <label>쿠폰 코드<input className="field" value={code} onChange={e=>setCode(e.target.value)} maxLength={40} required disabled={busy} autoComplete="off"/></label>
   <div className="account-actions"><button className="button" type="submit" disabled={busy||!code.trim()}>쿠폰 사용</button></div>
   <p className="muted">토큰 쿠폰은 여기서 바로 받고, 할인 쿠폰은 결제할 때 입력해요.</p>
  </form>
  <h3>결제 내역</h3>
  {state.payments.length?<div className="responsive-table"><table className="data-table"><caption className="sr-only">결제 내역</caption>
   <thead><tr><th>주문</th><th>금액</th><th>상태</th><th>일시</th><th>환불</th></tr></thead>
   <tbody>{state.payments.map(p=>{const open=openRefund(p),done=state.refunds.find(r=>r.paymentId===p.id&&['completed','rejected'].includes(r.status));const can=p.status==='paid'&&p.amount>0&&!open&&state.now<=(p.approvedAt??0)+WEEK;return <tr key={p.id}>
    <td>{p.orderName}</td><td>₩{p.amount.toLocaleString('ko-KR')}</td><td>{PAY[p.status]}{p.failureMessage&&p.status!=='paid'?<span className="muted"> · {p.failureMessage}</span>:null}</td><td>{day(p.approvedAt??p.createdAt)}</td>
    <td>{open?REFUND[open.status]:can?<div style={{display:'grid',gap:6}}><input className="field" aria-label={`${p.orderName} 환불 사유`} value={reason[p.id]??''} onChange={e=>setReason(r=>({...r,[p.id]:e.target.value}))} maxLength={300} placeholder="환불 사유"/><button className="button secondary" type="button" disabled={busy||!(reason[p.id]??'').trim()} onClick={()=>refund(p)}>환불 요청</button></div>:done?REFUND[done.status]:'-'}</td>
   </tr>;})}</tbody></table></div>:<p className="muted">결제 내역이 없어요.</p>}
 </section>;
}
