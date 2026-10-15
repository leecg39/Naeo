'use client';
import ListPagination from './ListPagination';
import {loadValidPage} from './pagination';
import {kstDateTime} from '@/lib/kst-time';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {SiteDocument} from '@/server/content/documents';
import DocumentEditor,{type DocumentDetail} from './DocumentEditor';

const fmt=(ms:number)=>kstDateTime(ms);

export default function DocumentsManager({initial}:{initial:PageResult<SiteDocument>}){
 const router=useRouter();
 const [result,setResult]=useState(initial),[q,setQ]=useState(''),[status,setStatus]=useState('');
 const [selected,setSelected]=useState<DocumentDetail|null>(null),[creating,setCreating]=useState(false);
 const [applied,setApplied]=useState({q:'',status:''});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');

 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){
   setError(e instanceof Error?e.message:'처리하지 못했습니다.');
   if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/pages');router.refresh();}
  }finally{setBusy(false);}
 }
 async function load(page=result.pagination.page,filters=applied){
  const next=await loadValidPage(async requested=>{
   const query=new URLSearchParams({...filters,page:String(requested),pageSize:String(result.pagination.pageSize)});
   for(const [key,value] of [...query])if(!value)query.delete(key);
   return apiResponse<PageResult<SiteDocument>>(`/api/admin/documents?${query}`);
  },page);
  setResult(next);setApplied(filters);
 }
 const open=(id:string)=>run(async()=>{setCreating(false);setSelected(await api<DocumentDetail>(`/api/admin/documents/${id}`));});
 async function saved(d:DocumentDetail|null,message:string){setSelected(d);setCreating(false);setNotice(message);await load(creating?1:result.pagination.page);}
 const reloadLatest=()=>void run(async()=>{await load();if(selected)setSelected(await api<DocumentDetail>(`/api/admin/documents/${selected.id}`));setNotice('최신 내용을 불러왔습니다.');});

 return <div className="settings-sections">
  <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<div role="alert" className="account-error">{error} {selected&&<button className="button secondary" type="button" disabled={busy} onClick={reloadLatest}>최신 정보 불러오기</button>}</div>}</div>
  <section className="panel account-card">
   <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(()=>load(1,{q,status}));}}>
    <label>문서 검색<input className="field" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="제목·주소" disabled={busy}/></label>
    <label>상태<select className="field" value={status} onChange={e=>setStatus(e.target.value)} disabled={busy}><option value="">전체 상태</option><option value="published">공개</option><option value="draft">초안</option></select></label>
    <button className="button" type="submit" disabled={busy}>검색</button>
    <button className="button secondary" type="button" disabled={busy} onClick={()=>{setSelected(null);setCreating(true);setError('');}}>새 문서</button>
   </form>
   <p className="muted" style={{marginTop:16}}>총 {result.pagination.total}개 · 약관·개인정보처리방침·환불 규정 같은 정책 문서를 관리합니다.</p>
   <div className="responsive-table"><table className="data-table">
    <caption className="sr-only">정책 문서 목록</caption>
    <thead><tr><th>제목 / 주소</th><th>상태</th><th>시행일 표시</th><th>수정일</th><th>관리</th></tr></thead>
    <tbody>{result.data.map(d=><tr key={d.id}>
     <td><strong>{d.title}</strong><br/><span className="muted">{d.path}</span></td>
     <td>{d.status==='published'?'공개':'초안'}</td><td>{d.effectiveLabel||'—'}</td><td>{fmt(d.updatedAt)}</td>
     <td><button className="button secondary" type="button" disabled={busy} onClick={()=>void open(d.id)}>편집<span className="sr-only"> {d.title}</span></button></td>
    </tr>)}</tbody>
   </table>{!result.data.length&&<p className="empty-state">조건에 맞는 문서가 없습니다.</p>}</div>
   <ListPagination pagination={result.pagination} busy={busy} onPage={page=>void run(()=>load(page))}/>
  </section>
  {(creating||selected)&&<DocumentEditor key={selected?`${selected.id}:${selected.version}`:'new'} doc={selected} busy={busy} run={run} onSaved={saved} onClose={()=>{setSelected(null);setCreating(false);}}/>}
 </div>;
}
