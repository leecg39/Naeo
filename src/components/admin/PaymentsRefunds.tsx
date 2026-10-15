'use client';
import {kstDateTime} from '@/lib/kst-time';
import {useState} from 'react';
import {api,apiResponse,type PageResult} from '@/lib/api-client';
import type {Payment} from '@/server/billing/payments';
import type {Refund} from '@/server/billing/refunds';

type PayRow=Payment&{email:string};
type RefundRow=Refund&{email:string;orderId:string;orderName:string};
const PAY:Record<Payment['status'],string>={ready:'결제 대기',paid:'결제 완료',failed:'실패',expired:'만료',canceled:'환불됨',partial_canceled:'부분 환불'};
const REFUND:Record<Refund['status'],string>={requested:'요청',approved:'처리 중',rejected:'거절',completed:'완료',failed:'결제사 실패'};
const fmt=(ms:number)=>kstDateTime(ms,{seconds:true});

export default function PaymentsRefunds({initialPayments,initialRefunds,configured}:{initialPayments:PageResult<PayRow>;initialRefunds:PageResult<RefundRow>;configured:boolean}){
 const [payments,setPayments]=useState(initialPayments),[refunds,setRefunds]=useState(initialRefunds),[status,setStatus]=useState(''),[q,setQ]=useState('');
 const [notes,setNotes]=useState<Record<string,string>>({}),[amounts,setAmounts]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{
  setPayments(await apiResponse<PageResult<PayRow>>(`/api/admin/payments?${new URLSearchParams({pageSize:'100',q,...(status?{status}:{})})}`));
  setRefunds(await apiResponse<PageResult<RefundRow>>('/api/admin/refunds?pageSize=100'));
 };
 async function run(action:()=>Promise<string>){setBusy(true);setError('');setNotice('');try{const m=await action();await load();setNotice(m);}catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');await load().catch(()=>undefined);}finally{setBusy(false);}}
 const decide=(r:RefundRow,decision:'approved'|'rejected')=>void run(async()=>{await api(`/api/admin/refunds/${r.id}/decide`,{method:'POST',body:{decision,note:notes[r.id]??'',version:r.version}});return decision==='approved'?`${r.email} 환불을 완료했습니다.`:'환불 요청을 거절했습니다.';});
 const refund=(p:PayRow)=>void run(async()=>{const amount=amounts[p.id]?Number(amounts[p.id]):undefined;await api(`/api/admin/payments/${p.id}/refund`,{method:'POST',body:{reason:notes[p.id]||'운영자 환불',...(amount?{amount}:{})}});return `${p.orderName} 환불을 완료했습니다.`;});
 return <div className="settings-sections">
  <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>
  {!configured&&<p className="account-error">결제 키가 설정되지 않았습니다(미설정). 결제사 취소가 필요한 환불은 처리할 수 없습니다.</p>}
  <section className="panel account-card" aria-label="환불 요청">
   <h2>환불 요청</h2><p className="muted">처리 중인 요청은 1분 후 같은 환불로 다시 확인할 수 있습니다. 새 환불을 만들지 않습니다.</p>
   <div className="responsive-table"><table className="data-table"><caption className="sr-only">환불 요청 목록</caption>
    <thead><tr><th>회원·주문</th><th>금액</th><th>사유</th><th>상태</th><th>결정</th></tr></thead>
    <tbody>{refunds.data.map(r=><tr key={r.id}><td><strong>{r.email}</strong><br/><span className="muted">{r.orderName}</span></td><td>₩{r.amount.toLocaleString('ko-KR')}</td><td>{r.reason}</td><td>{REFUND[r.status]}{r.failureMessage&&<p className="muted" style={{margin:'4px 0 0'}}>{r.failureMessage}</p>}</td>
     <td>{['requested','failed','approved'].includes(r.status)?<div style={{display:'grid',gap:6}}><input className="field" aria-label={`${r.email} 결정 메모`} value={notes[r.id]??''} onChange={e=>setNotes(n=>({...n,[r.id]:e.target.value}))} maxLength={300} placeholder="메모"/>
      <div style={{display:'flex',gap:6}}><button className="button" type="button" disabled={busy||!configured} onClick={()=>decide(r,'approved')}>{r.status==='requested'?'승인(결제 취소)':'같은 환불 다시 확인'}<span className="sr-only"> {r.email}</span></button>{r.status==='requested'&&<button className="button secondary" type="button" disabled={busy} onClick={()=>decide(r,'rejected')}>거절<span className="sr-only"> {r.email}</span></button>}</div></div>:r.decisionNote||'-'}</td></tr>)}</tbody></table>
    {!refunds.data.length&&<p className="empty-state">환불 요청이 없습니다.</p>}</div>
  </section>
  <section className="panel account-card" aria-label="결제 내역">
   <h2>결제 내역</h2>
   <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(async()=>'목록을 불러왔습니다.');}}>
    <label>검색<input className="field" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="주문 번호·이메일" disabled={busy}/></label>
    <label>상태<select className="field" value={status} onChange={e=>setStatus(e.target.value)} disabled={busy}><option value="">전체</option>{Object.entries(PAY).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <button className="button" type="submit" disabled={busy}>검색</button>
   </form>
   <div className="responsive-table"><table className="data-table"><caption className="sr-only">결제 목록</caption>
    <thead><tr><th>회원</th><th>주문</th><th>금액</th><th>상태</th><th>일시</th><th>직접 환불</th></tr></thead>
    <tbody>{payments.data.map(p=><tr key={p.id}><td>{p.email}</td><td>{p.orderName}<br/><span className="muted">{p.orderId}</span></td><td>₩{p.amount.toLocaleString('ko-KR')}{p.listAmount!==p.amount&&<span className="muted"> (정가 ₩{p.listAmount.toLocaleString('ko-KR')})</span>}{p.canceledAmount>0&&<span className="muted"> · 환불 ₩{p.canceledAmount.toLocaleString('ko-KR')}</span>}</td>
     <td>{p.status==='ready'&&p.confirmStartedAt!==null?'결제 확인 중':PAY[p.status]}{p.failureCode&&<span className="muted"> · {p.failureCode}</span>}{p.status==='ready'&&p.paymentKey&&<button className="button secondary" disabled={busy||!configured} onClick={()=>void run(async()=>{await api(`/api/admin/payments/${p.id}/reconcile`,{method:'POST'});return '결제사 상태를 다시 조회했습니다.';})}>결제사 상태 조회</button>}</td><td>{fmt(p.approvedAt??p.createdAt)}</td>
     <td>{['paid','partial_canceled'].includes(p.status)&&p.amount>p.canceledAmount?<div style={{display:'grid',gap:6}}><input className="field" type="number" min={1} max={p.amount-p.canceledAmount} aria-label={`${p.orderId} 환불 금액`} value={amounts[p.id]??''} onChange={e=>setAmounts(a=>({...a,[p.id]:e.target.value}))} placeholder={`전액 ${p.amount-p.canceledAmount}`}/><input className="field" aria-label={`${p.orderId} 환불 사유`} value={notes[p.id]??''} onChange={e=>setNotes(n=>({...n,[p.id]:e.target.value}))} maxLength={200} placeholder="사유"/><button className="button secondary" type="button" disabled={busy} onClick={()=>refund(p)}>환불<span className="sr-only"> {p.orderId}</span></button></div>:'-'}</td></tr>)}</tbody></table>
    {!payments.data.length&&<p className="empty-state">결제가 없습니다.</p>}</div>
   <p className="muted">결제·환불 기록은 회계 기록이라 삭제되지 않고, 금액은 바꿀 수 없습니다.</p>
  </section>
 </div>;
}
