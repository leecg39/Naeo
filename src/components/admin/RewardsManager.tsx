'use client';
import ListPagination from './ListPagination';
import {loadValidPage} from './pagination';
import {kstDateTime} from '@/lib/kst-time';
import {useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {Reward} from '@/server/events/rewards';

type Row=Reward&{email:string;nickname:string};
const KIND:Record<Reward['kind'],string>={event:'이벤트',ranking:'랭킹',manual:'수동',gift:'상품·쿠폰'};
const fmt=(ms:number)=>kstDateTime(ms,{seconds:true});

export default function RewardsManager({initial}:{initial:PageResult<Row>}){
 const router=useRouter();
 const [result,setResult]=useState(initial),[q,setQ]=useState(''),[status,setStatus]=useState(''),[kind,setKind]=useState('');
 const [applied,setApplied]=useState({q:'',status:'',kind:''});
 const [grant,setGrant]=useState({email:'',type:'tokens',tokens:'10',item:'',description:'',eventSlug:''}),[rank,setRank]=useState({period:'week',offset:'-1',top:'3',tokens:'10',eventSlug:''});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState('');
 async function run(action:()=>Promise<string|void>){
  setBusy(true);setError('');setNotice('');
  try{const m=await action();if(m)setNotice(m);}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/rewards');router.refresh();}}
  finally{setBusy(false);}
 }
 async function load(page=result.pagination.page,filters=applied){
  const next=await loadValidPage(async requested=>{
   const query=new URLSearchParams({...filters,page:String(requested),pageSize:String(result.pagination.pageSize)});
   for(const [key,value] of [...query])if(!value)query.delete(key);
   return apiResponse<PageResult<Row>>(`/api/admin/rewards?${query}`);
  },page);setResult(next);setApplied(filters);setConfirm('');
 }
 const manual=(e:FormEvent)=>{e.preventDefault();void run(async()=>{await api('/api/admin/rewards',{method:'POST',body:{email:grant.email,...(grant.type==='tokens'?{tokens:Number(grant.tokens)}:{item:grant.item}),description:grant.description,...(grant.eventSlug?{eventSlug:grant.eventSlug}:{})}});await load(1);setGrant(g=>({...g,description:'',item:''}));return `${grant.email}에게 ${grant.type==='tokens'?`${grant.tokens}토큰`:grant.item}을(를) 지급했습니다.`;});};
 const ranking=(e:FormEvent)=>{e.preventDefault();void run(async()=>{const r=await api<{granted:number;eligible:number;period:{label:string}}>('/api/admin/rewards/ranking',{method:'POST',body:{period:rank.period,offset:Number(rank.offset),top:Number(rank.top),tokens:Number(rank.tokens),...(rank.eventSlug?{eventSlug:rank.eventSlug}:{})}});await load(1);return `${r.period.label}: 대상 ${r.eligible}명 중 ${r.granted}명에게 새로 지급했습니다(이미 받은 회원 제외).`;});};
 const revoke=(r:Row)=>void run(async()=>{await api(`/api/admin/rewards/${r.id}/revoke`,{method:'POST',body:{version:r.version}});setConfirm('');await load();return `${r.email}의 리워드 ${r.tokens}토큰을 회수했습니다.`;});
 return <div className="settings-sections">
  <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>
  <section className="panel account-card" aria-label="수동 지급">
   <h2>토큰 리워드 지급</h2>
   <form className="admin-filters" onSubmit={manual}>
    <label>회원 이메일<input className="field" type="email" value={grant.email} onChange={e=>setGrant(g=>({...g,email:e.target.value}))} required maxLength={254} disabled={busy}/></label>
    <label>종류<select className="field" value={grant.type} onChange={e=>setGrant(g=>({...g,type:e.target.value}))} disabled={busy}><option value="tokens">토큰</option><option value="gift">상품·쿠폰</option></select></label>
    {grant.type==='tokens'?<label>토큰<input className="field" type="number" min={1} max={100000} value={grant.tokens} onChange={e=>setGrant(g=>({...g,tokens:e.target.value}))} required disabled={busy}/></label>
     :<label>상품명(발송은 별도)<input className="field" value={grant.item} onChange={e=>setGrant(g=>({...g,item:e.target.value}))} required maxLength={100} disabled={busy}/></label>}
    <label>당첨 내역에 표시할 이벤트 주소(선택)<input className="field" value={grant.eventSlug} onChange={e=>setGrant(g=>({...g,eventSlug:e.target.value}))} maxLength={60} placeholder="ranking-reward" disabled={busy}/></label>
    <label>사유(회원에게 표시)<input className="field" value={grant.description} onChange={e=>setGrant(g=>({...g,description:e.target.value}))} required maxLength={200} disabled={busy}/></label>
    <button className="button" type="submit" disabled={busy}>지급</button>
   </form>
  </section>
  <section className="panel account-card" aria-label="랭킹 리워드">
   <h2>랭킹 리워드</h2>
   <p className="muted">확정된 지난 기간의 상위 회원에게 지급합니다. 같은 기간·회원은 여러 번 눌러도 한 번만 지급됩니다.</p>
   <form className="admin-filters" onSubmit={ranking}>
    <label>기간<select className="field" value={rank.period} onChange={e=>setRank(r=>({...r,period:e.target.value}))} disabled={busy}><option value="week">주간</option><option value="month">월간</option></select></label>
    <label>몇 기간 전<input className="field" type="number" min={-52} max={-1} value={rank.offset} onChange={e=>setRank(r=>({...r,offset:e.target.value}))} disabled={busy}/></label>
    <label>상위 몇 명<input className="field" type="number" min={1} max={100} value={rank.top} onChange={e=>setRank(r=>({...r,top:e.target.value}))} disabled={busy}/></label>
    <label>1인당 토큰<input className="field" type="number" min={1} max={100000} value={rank.tokens} onChange={e=>setRank(r=>({...r,tokens:e.target.value}))} disabled={busy}/></label>
    <label>당첨 내역 이벤트(선택)<input className="field" value={rank.eventSlug} onChange={e=>setRank(r=>({...r,eventSlug:e.target.value}))} maxLength={60} placeholder="ranking-reward" disabled={busy}/></label>
    <button className="button" type="submit" disabled={busy}>랭킹 리워드 지급</button>
   </form>
  </section>
  <section className="panel account-card" aria-label="지급 내역">
   <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(()=>load(1,{q,status,kind}));}}>
    <label>검색<input className="field" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="이메일·닉네임·사유" disabled={busy}/></label>
    <label>종류<select className="field" value={kind} onChange={e=>setKind(e.target.value)} disabled={busy}><option value="">전체</option><option value="event">이벤트</option><option value="ranking">랭킹</option><option value="manual">수동</option><option value="gift">상품·쿠폰</option></select></label>
    <label>상태<select className="field" value={status} onChange={e=>setStatus(e.target.value)} disabled={busy}><option value="">전체</option><option value="granted">지급</option><option value="revoked">회수</option></select></label>
    <button className="button" type="submit" disabled={busy}>검색</button>
   </form>
   <p className="muted" style={{marginTop:16}}>총 {result.pagination.total}건</p>
   <div className="responsive-table"><table className="data-table">
    <caption className="sr-only">리워드 지급 내역</caption>
    <thead><tr><th>회원</th><th>내용</th><th>종류</th><th>토큰·상품</th><th>상태</th><th>지급 시각</th><th>관리</th></tr></thead>
    <tbody>{result.data.map(r=><tr key={r.id}>
     <td><strong>{r.nickname}</strong><br/><span className="muted">{r.email}</span></td><td>{r.description}</td><td>{KIND[r.kind]}</td><td>{r.kind==='gift'?r.item:r.tokens}</td>
     <td>{r.status==='granted'?'지급':`회수(${r.revokedAt?fmt(r.revokedAt):''})`}</td><td>{fmt(r.createdAt)}</td>
     <td>{r.status==='granted'&&(confirm===r.id?<button className="button" type="button" disabled={busy} onClick={()=>revoke(r)}>회수 확인</button>:<button className="button secondary" type="button" disabled={busy} onClick={()=>setConfirm(r.id)}>회수<span className="sr-only"> {r.email} {r.description}</span></button>)}</td>
    </tr>)}</tbody>
   </table>{!result.data.length&&<p className="empty-state">지급 내역이 없습니다.</p>}</div>
   <ListPagination pagination={result.pagination} busy={busy} onPage={page=>void run(()=>load(page))}/>
  </section>
 </div>;
}
