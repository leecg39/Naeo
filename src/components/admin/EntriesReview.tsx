'use client';
import ListPagination from './ListPagination';
import {loadValidPage} from './pagination';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {Entry} from '@/server/events/entries';
import type {EventItem} from '@/server/events/events';

type Row=Entry&{ownerEmail:string;ownerNickname:string};
type Result=PageResult<Row>&{event:EventItem};
const STATUS:Record<Entry['status'],string>={submitted:'심사 대기',approved:'승인',rejected:'반려',withdrawn:'철회'};

export default function EntriesReview({events,initial}:{events:PageResult<{slug:string;title:string}>;initial:Result|null}){
 const router=useRouter();
 const [options,setOptions]=useState(events),[eventQuery,setEventQuery]=useState(''),[appliedEventQuery,setAppliedEventQuery]=useState('');
 const [result,setResult]=useState(initial),[status,setStatus]=useState(''),[notes,setNotes]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const slug=result?.event.slug??'';
 const [appliedStatus,setAppliedStatus]=useState('');
 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/event');router.refresh();}}
  finally{setBusy(false);}
 }
 async function loadOptions(page=1,q=appliedEventQuery){
  const next=await loadValidPage(requested=>apiResponse<PageResult<{slug:string;title:string}>>(`/api/admin/events?${new URLSearchParams({q,page:String(requested),pageSize:'20',acceptsEntries:'true'})}`),page);
  setOptions(next);setAppliedEventQuery(q);
 }
 async function load(s=slug,st=appliedStatus,page=result?.pagination.page??1){
  if(!s)return;
  const next=await loadValidPage(requested=>apiResponse<Result>(`/api/admin/event-entries?${new URLSearchParams({slug:s,page:String(requested),pageSize:String(result?.pagination.pageSize??100),...(st?{status:st}:{})})}`),page);
  setResult(next);setAppliedStatus(st);setStatus(st);
 }
 const review=(e:Row,decision:'approved'|'rejected')=>void run(async()=>{
  await api(`/api/admin/event-entries/${e.id}/review`,{method:'POST',body:{decision,note:notes[e.id]??e.reviewNote,version:e.version}});
  await load();setNotice(decision==='approved'?`${e.ownerNickname||e.ownerEmail} 참여를 승인했습니다.`:`${e.ownerNickname||e.ownerEmail} 참여를 반려했습니다.`);
 });
 return <div className="settings-sections">
  <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<div role="alert" className="account-error">{error} <button className="button secondary" type="button" disabled={busy} onClick={()=>void run(()=>load())}>최신 정보 불러오기</button></div>}</div>
  <section className="panel account-card">
   <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(()=>loadOptions(1,eventQuery));}}>
    <label>이벤트 검색<input className="field" value={eventQuery} onChange={e=>setEventQuery(e.target.value)} maxLength={100} disabled={busy} placeholder="제목·주소"/></label>
    <button type="submit" className="button secondary" disabled={busy}>이벤트 검색</button>
    <label>이벤트<select className="field" value={slug} onChange={e=>{const s=e.target.value;void run(async()=>{await load(s,status,1);router.replace(`/admin/event?slug=${encodeURIComponent(s)}`);});}} disabled={busy}>{!slug&&<option value="">이벤트 선택</option>}{slug&&!options.data.some(e=>e.slug===slug)&&<option value={slug}>{result?.event.title} (현재 선택)</option>}{options.data.map(e=><option key={e.slug} value={e.slug}>{e.title}</option>)}</select></label>
    <label>상태<select className="field" value={status} onChange={e=>{const nextStatus=e.target.value;if(slug)void run(()=>load(slug,nextStatus,1));}} disabled={busy||!slug}><option value="">전체</option>{Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   </form>
   <p className="muted">선택 가능한 이벤트 {options.pagination.total}개</p>
   <ListPagination label="이벤트 선택 페이지" pagination={options.pagination} busy={busy} onPage={page=>void run(()=>loadOptions(page))}/>
   {result?<>
    <p className="muted" style={{marginTop:16}}>{result.event.title} · 참여 {result.pagination.total}건 · 승인 시 {result.event.rewardTokens}토큰</p>
    <div className="responsive-table"><table className="data-table">
     <caption className="sr-only">참여 목록</caption>
     <thead><tr><th>회원</th><th>인증 글·남긴 말</th><th>상태</th><th>심사</th></tr></thead>
     <tbody>{result.data.map(e=><tr key={e.id}>
      <td><strong>{e.ownerNickname}</strong><br/><span className="muted">{e.ownerEmail}</span></td>
      <td>{e.proofUrl?<a href={e.proofUrl} target="_blank" rel="noopener noreferrer">{e.proofUrl}</a>:'-'}{e.note&&<p className="muted" style={{margin:'4px 0 0'}}>{e.note}</p>}</td>
      <td>{STATUS[e.status]}{e.reviewNote&&<p className="muted" style={{margin:'4px 0 0'}}>{e.reviewNote}</p>}</td>
      <td>{e.status==='withdrawn'?'-':<div style={{display:'grid',gap:6}}>
       <input className="field" aria-label={`${e.ownerEmail} 심사 메모`} value={notes[e.id]??e.reviewNote} onChange={x=>setNotes(n=>({...n,[e.id]:x.target.value}))} maxLength={300} placeholder="심사 메모(회원에게 표시)" disabled={busy}/>
       <div style={{display:'flex',gap:6}}>
        {e.status!=='approved'&&<button className="button" type="button" disabled={busy} onClick={()=>review(e,'approved')}>승인<span className="sr-only"> {e.ownerEmail}</span></button>}
        {e.status!=='rejected'&&<button className="button secondary" type="button" disabled={busy} onClick={()=>review(e,'rejected')}>반려<span className="sr-only"> {e.ownerEmail}</span></button>}
       </div></div>}</td>
     </tr>)}</tbody>
    </table>{!result.data.length&&<p className="empty-state">참여가 없습니다.</p>}</div>
    <ListPagination pagination={result.pagination} busy={busy} onPage={page=>void run(()=>load(slug,appliedStatus,page))}/>
    <p className="muted">승인하면 이벤트 토큰이 한 번 지급되고, 승인을 반려로 바꾸면 지급한 토큰을 회수합니다(회원이 이미 써서 잔액이 부족하면 거절).</p>
   </>:<p className="empty-state">심사할 이벤트를 고르세요.</p>}
  </section>
 </div>;
}
