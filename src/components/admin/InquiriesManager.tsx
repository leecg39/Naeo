'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import {INQUIRY_STATUS_LABELS,INQUIRY_TYPE_LABELS,formatKst} from '@/lib/inquiry-labels';
import type {AdminInquiry} from '@/server/inquiries/records';
import type {AdminInquiryDetail} from '@/server/inquiries/admin-inquiries';
import type {InquiryTemplate} from '@/server/inquiries/templates';
import InquiryDetail from './InquiryDetail';

export default function InquiriesManager({initial,templates}:{initial:PageResult<AdminInquiry>;templates:InquiryTemplate[]}){
 const router=useRouter();
 const [result,setResult]=useState(initial),[selected,setSelected]=useState<AdminInquiryDetail|null>(null);
 const [q,setQ]=useState(''),[status,setStatus]=useState(''),[type,setType]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const totalPages=Math.max(1,Math.ceil(result.pagination.total/result.pagination.pageSize));

 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){
   setError(e instanceof Error?e.message:'처리하지 못했습니다.');
   if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/inquiries');router.refresh();}
  }finally{setBusy(false);}
 }
 async function load(page=result.pagination.page){
  const query=new URLSearchParams({page:String(page),pageSize:'20',q,...(status?{status}:{}),...(type?{type}:{})});
  const next=await apiResponse<PageResult<AdminInquiry>>(`/api/admin/inquiries?${query}`);
  if(!next.data.length&&page>1)return load(page-1);
  setResult(next);
 }
 const open=(id:string)=>run(async()=>setSelected(await api<AdminInquiryDetail>(`/api/admin/inquiries/${id}`)));
 async function changed(next:AdminInquiryDetail|null,message:string){setSelected(next);setNotice(message);await load();}
 const reloadSelected=()=>run(async()=>{await load();if(selected)setSelected(await api<AdminInquiryDetail>(`/api/admin/inquiries/${selected.id}`));setNotice('최신 정보를 불러왔습니다.');});

 return <div className="settings-sections">
  <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<div role="alert" className="account-error">{error} <button className="button secondary" type="button" disabled={busy} onClick={reloadSelected}>최신 정보 불러오기</button></div>}</div>
  <section className="panel account-card">
   <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(()=>load(1));}}>
    <label>문의 검색<input className="field" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="이메일·제목·내용" disabled={busy}/></label>
    <label>상태<select className="field" value={status} onChange={e=>setStatus(e.target.value)} disabled={busy}><option value="">전체 상태</option>{Object.entries(INQUIRY_STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <label>유형<select className="field" value={type} onChange={e=>setType(e.target.value)} disabled={busy}><option value="">전체 유형</option>{Object.entries(INQUIRY_TYPE_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <button className="button" type="submit" disabled={busy}>검색</button>
   </form>
   <p className="muted" style={{marginTop:16}}>총 {result.pagination.total}건</p>
   <div className="responsive-table"><table className="data-table">
    <caption className="sr-only">문의 목록</caption>
    <thead><tr><th>제목 / 회신 이메일</th><th>유형</th><th>상태</th><th>답변</th><th>접수일</th><th>관리</th></tr></thead>
    <tbody>{result.data.map(i=><tr key={i.id}>
     <td><strong>{i.subject||'(제목 없음)'}</strong><br/><span className="muted">{i.email}{i.ownerId?'':' · 비회원'}</span></td>
     <td>{INQUIRY_TYPE_LABELS[i.type]}</td><td>{INQUIRY_STATUS_LABELS[i.status]}</td><td>{i.replyCount}</td><td>{formatKst(i.createdAt)}</td>
     <td><button className="button secondary" type="button" disabled={busy} onClick={()=>void open(i.id)}>상세<span className="sr-only"> {i.subject||i.email}</span></button></td>
    </tr>)}</tbody>
   </table>{!result.data.length&&<p className="empty-state">조건에 맞는 문의가 없습니다.</p>}</div>
   <div className="account-actions" style={{marginTop:20}}>
    <button type="button" className="button secondary" disabled={busy||result.pagination.page<=1} onClick={()=>void run(()=>load(result.pagination.page-1))}>이전</button>
    <span aria-live="polite">{result.pagination.page} / {totalPages}</span>
    <button type="button" className="button secondary" disabled={busy||result.pagination.page>=totalPages} onClick={()=>void run(()=>load(result.pagination.page+1))}>다음</button>
   </div>
  </section>
  {selected&&<InquiryDetail key={`${selected.id}:${selected.version}`} inquiry={selected} templates={templates} busy={busy} run={run} onChanged={changed} onClose={()=>setSelected(null)}/>}
 </div>;
}
