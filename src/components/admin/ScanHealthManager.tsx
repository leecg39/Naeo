'use client';
import {useCallback,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {AdminScanJob,scanHealth} from '@/server/jobs/admin-scans';

type Health=ReturnType<typeof scanHealth>;
const STATE:Record<AdminScanJob['state'],string>={queued:'대기',running:'실행 중',succeeded:'완료',failed:'실패',canceled:'취소'};
const fmt=(ms:number|null)=>ms?new Date(ms).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}):'—';
const ago=(ms:number|null)=>ms===null?'—':ms<60_000?`${Math.round(ms/1000)}초`:`${Math.round(ms/60_000)}분`;

function Summary({h}:{h:Health}){
 const cards:[string,string|number][]=[['대기',h.counts.queued],['실행 중',h.counts.running],['24시간 완료',h.lastDay.succeeded],['24시간 실패',h.lastDay.failed],['살아 있는 worker',h.aliveWorkers],['가장 오래 기다린 작업',ago(h.oldestQueuedMs)],['응답 없는 실행(lease 만료)',h.overdueLeases]];
 return <section className="panel account-card"><h2>현황</h2>
  <div className="admin-stats">{cards.map(([label,value])=><div key={label}><span className="muted">{label}</span><strong>{value}</strong></div>)}</div>
  {h.aliveWorkers===0&&<p role="alert" className="account-error">실행 중인 worker가 없습니다. 서버에서 <code>npm run worker</code>를 실행해야 진단 작업이 처리됩니다.</p>}
  <div className="responsive-table" style={{marginTop:16}}><table className="data-table"><caption className="sr-only">worker 목록</caption>
   <thead><tr><th>worker</th><th>상태</th><th>마지막 신호</th><th>처리</th><th>실패</th></tr></thead>
   <tbody>{h.workers.map(w=><tr key={w.workerId}><td>{w.workerId}</td><td>{w.alive?'동작 중':'중지'}</td><td>{fmt(w.lastSeenAt)}</td><td>{w.processed}</td><td>{w.failed}</td></tr>)}</tbody>
  </table>{!h.workers.length&&<p className="empty-state">worker 기록이 없습니다.</p>}</div>
 </section>;
}

export default function ScanHealthManager({initialHealth,initialJobs}:{initialHealth:Health;initialJobs:PageResult<AdminScanJob>}){
 const router=useRouter();
 const [health,setHealth]=useState(initialHealth),[jobs,setJobs]=useState(initialJobs),[state,setState]=useState(''),[q,setQ]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{
  const query=new URLSearchParams({pageSize:'30',q,...(state?{state}:{})});
  const [h,j]=await Promise.all([api<Health>('/api/admin/scan-health'),apiResponse<PageResult<AdminScanJob>>(`/api/admin/scans?${query}`)]);
  setHealth(h);setJobs(j);
 },[q,state]);
 useEffect(()=>{const id=window.setInterval(()=>{void refresh().catch(()=>{});},10_000);return()=>window.clearInterval(id);},[refresh]);
 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/scan-health');router.refresh();}}
  finally{setBusy(false);}
 }
 const act=(job:AdminScanJob,kind:'cancel'|'retry')=>void run(async()=>{
  await api(`/api/admin/scans/${job.id}/${kind}`,{method:'POST',body:{}});
  await refresh();setNotice(kind==='cancel'?(job.state==='running'?'취소를 요청했습니다. worker가 다음 단계에서 멈춥니다.':'작업을 취소했습니다.'):'새 작업으로 다시 시도합니다.');
 });
 return <div className="settings-sections">
  <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>
  <Summary h={health}/>
  <section className="panel account-card">
   <h2>진단 작업</h2>
   <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(refresh);}}>
    <label>검색<input className="field" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="이메일·블로그 ID·오류 코드" disabled={busy}/></label>
    <label>상태<select className="field" value={state} onChange={e=>setState(e.target.value)} disabled={busy}><option value="">전체</option>{Object.entries(STATE).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <button className="button" type="submit" disabled={busy}>새로고침</button>
   </form>
   <p className="muted" style={{marginTop:16}}>총 {jobs.pagination.total}개 · 10초마다 자동 새로고침</p>
   <div className="responsive-table"><table className="data-table"><caption className="sr-only">진단 작업 목록</caption>
    <thead><tr><th>블로그 / 회원</th><th>상태</th><th>진행</th><th>시도</th><th>오류</th><th>생성</th><th>관리</th></tr></thead>
    <tbody>{jobs.data.map(j=><tr key={j.id}>
     <td><strong>{j.naverId}</strong><br/><span className="muted">{j.ownerEmail}</span></td>
     <td>{STATE[j.state]}{j.cancelRequested&&j.state==='running'?' (취소 요청)':''}</td><td>{j.progress}%</td><td>{j.attempt}/{j.maxAttempts}</td>
     <td>{j.errorCode?<><code>{j.errorCode}</code><br/><span className="muted">{j.errorMessage}</span></>:'—'}</td><td>{fmt(j.createdAt)}</td>
     <td><div className="account-actions">
      {(j.state==='queued'||j.state==='running')&&!j.cancelRequested&&<button className="button secondary" type="button" disabled={busy} onClick={()=>act(j,'cancel')}>취소<span className="sr-only"> {j.naverId}</span></button>}
      {(j.state==='failed'||j.state==='canceled')&&<button className="button secondary" type="button" disabled={busy} onClick={()=>act(j,'retry')}>재시도<span className="sr-only"> {j.naverId}</span></button>}
     </div></td>
    </tr>)}</tbody>
   </table>{!jobs.data.length&&<p className="empty-state">작업이 없습니다.</p>}</div>
  </section>
 </div>;
}
