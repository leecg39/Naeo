'use client';
import OperationNotice from './OperationNotice';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import {UPDATE_TYPES,UPDATE_TYPE_LABELS,type SiteUpdate} from '@/server/content/updates';
import UpdateEditor from './UpdateEditor';

export default function UpdatesManager({initial}:{initial:PageResult<SiteUpdate>}){
 const router=useRouter();
 const [result,setResult]=useState(initial),[q,setQ]=useState(''),[status,setStatus]=useState(''),[type,setType]=useState('');
 const [selected,setSelected]=useState<SiteUpdate|null>(null),[creating,setCreating]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const totalPages=Math.max(1,Math.ceil(result.pagination.total/result.pagination.pageSize));
 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/updates');router.refresh();}}
  finally{setBusy(false);}
 }
 async function load(page=result.pagination.page){
  const query=new URLSearchParams({page:String(page),pageSize:'20',q,...(status?{status}:{}),...(type?{type}:{})});
  const next=await apiResponse<PageResult<SiteUpdate>>(`/api/admin/updates?${query}`);
  if(!next.data.length&&page>1)return load(page-1);
  setResult(next);
 }
 const saved=async(u:SiteUpdate|null,message:string)=>{setSelected(u);setCreating(false);await load();setNotice(message);};
 const reloadLatest=()=>void run(async()=>{await load();if(selected)setSelected(await api<SiteUpdate>(`/api/admin/updates/${selected.id}`));setNotice('최신 내용을 불러왔습니다.');});
 return <div className="settings-sections">
  <div aria-live="polite"><OperationNotice message={notice}/>{error&&<div role="alert" className="account-error">{error} {selected&&<button className="button secondary" type="button" disabled={busy} onClick={reloadLatest}>최신 정보 불러오기</button>}</div>}</div>
  <section className="panel account-card">
   <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(()=>load(1));}}>
    <label>업데이트 검색<input className="field" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="제목·주소·버전·요약" disabled={busy}/></label>
    <label>분류<select className="field" value={type} onChange={e=>setType(e.target.value)} disabled={busy}><option value="">전체 분류</option>{UPDATE_TYPES.map(t=><option key={t} value={t}>{UPDATE_TYPE_LABELS[t]}</option>)}</select></label>
    <label>상태<select className="field" value={status} onChange={e=>setStatus(e.target.value)} disabled={busy}><option value="">전체 상태</option><option value="published">공개</option><option value="draft">초안</option></select></label>
    <button className="button" type="submit" disabled={busy}>검색</button>
    <button className="button secondary" type="button" disabled={busy} onClick={()=>{setSelected(null);setCreating(true);}}>새 업데이트</button>
   </form>
   <p className="muted" style={{marginTop:16}}>총 {result.pagination.total}개</p>
   <div className="responsive-table"><table className="data-table">
    <caption className="sr-only">업데이트 목록</caption>
    <thead><tr><th>제목 / 주소</th><th>버전</th><th>분류</th><th>날짜</th><th>상태</th><th>관리</th></tr></thead>
    <tbody>{result.data.map(u=><tr key={u.id}>
     <td><strong>{u.title}</strong><br/><span className="muted">{u.slug}</span></td><td>{u.versionLabel||'—'}</td>
     <td>{u.types.map(t=>UPDATE_TYPE_LABELS[t]).join(', ')}</td><td>{u.publishedOn}</td><td>{u.status==='published'?'공개':'초안'}</td>
     <td><button className="button secondary" type="button" disabled={busy} onClick={()=>void run(async()=>{setCreating(false);setSelected(await api<SiteUpdate>(`/api/admin/updates/${u.id}`));})}>편집<span className="sr-only"> {u.title}</span></button></td>
    </tr>)}</tbody>
   </table>{!result.data.length&&<p className="empty-state">조건에 맞는 업데이트가 없습니다.</p>}</div>
   <div className="account-actions" style={{marginTop:20}}>
    <button type="button" className="button secondary" disabled={busy||result.pagination.page<=1} onClick={()=>void run(()=>load(result.pagination.page-1))}>이전</button>
    <span aria-live="polite">{result.pagination.page} / {totalPages}</span>
    <button type="button" className="button secondary" disabled={busy||result.pagination.page>=totalPages} onClick={()=>void run(()=>load(result.pagination.page+1))}>다음</button>
   </div>
  </section>
  {(creating||selected)&&<UpdateEditor key={selected?`${selected.id}:${selected.version}`:'new'} item={selected} busy={busy} run={run} onSaved={saved} onClose={()=>{setSelected(null);setCreating(false);}}/>}
 </div>;
}
