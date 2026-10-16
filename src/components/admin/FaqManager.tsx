'use client';
import ListPagination from './ListPagination';
import OperationNotice from './OperationNotice';
import {loadValidPage} from './pagination';
import {useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {FaqItem} from '@/server/content/faq';

type Result=PageResult<FaqItem>&{categories:string[]};
type Form={category:string;question:string;answer:string;status:FaqItem['status'];position:string};
const empty=(categories:string[]):Form=>({category:categories[0]??'',question:'',answer:'',status:'draft',position:'0'});
const formOf=(f:FaqItem):Form=>({category:f.category,question:f.question,answer:f.answer,status:f.status,position:String(f.position)});

function Editor({item,categories,busy,run,onSaved,onClose}:{item:FaqItem|null;categories:string[];busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onSaved:(message:string)=>Promise<void>;onClose:()=>void}){
 const [form,setForm]=useState<Form>(item?formOf(item):empty(categories)),[confirming,setConfirming]=useState(false);
 const set=<K extends keyof Form>(k:K,v:Form[K])=>setForm(f=>({...f,[k]:v}));
 const body=()=>({category:form.category,question:form.question,answer:form.answer,status:form.status,position:Number(form.position||0)});
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  if(item)await api(`/api/admin/faq/${item.id}`,{method:'PATCH',body:{...body(),version:item.version}});
  else await api('/api/admin/faq',{method:'POST',body:body()});
  await onSaved(item?'저장했습니다. 공개 FAQ에 바로 반영됩니다.':'FAQ 항목을 만들었습니다.');
 });};
 const remove=()=>void run(async()=>{
  if(!item)return;
  await api(`/api/admin/faq/${item.id}`,{method:'DELETE',body:{version:item.version}});
  await onSaved('FAQ 항목을 삭제했습니다.');
 });
 return <section className="panel account-card" aria-label={item?'FAQ 편집':'새 FAQ'}>
  <h2>{item?'FAQ 편집':'새 FAQ'}</h2>
  {item&&<p className="muted">버전 {item.version}</p>}
  <form className="account-form" onSubmit={save}>
   <label>분류(새 이름을 쓰면 새 분류)<input className="field" list="faq-categories" value={form.category} onChange={e=>set('category',e.target.value)} required maxLength={40} disabled={busy}/></label>
   <datalist id="faq-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist>
   <label>질문<input className="field" value={form.question} onChange={e=>set('question',e.target.value)} required maxLength={200} disabled={busy}/></label>
   <label>답변(줄바꿈 그대로 표시, HTML은 글자로 표시)<textarea className="field" value={form.answer} onChange={e=>set('answer',e.target.value)} required maxLength={5000} rows={6} disabled={busy}/></label>
   <label>상태<select className="field" value={form.status} onChange={e=>set('status',e.target.value as Form['status'])} disabled={busy}><option value="draft">초안(비공개)</option><option value="published">공개</option></select></label>
   <label>순서(작은 값 먼저)<input className="field" type="number" min={-10000} max={10000} value={form.position} onChange={e=>set('position',e.target.value)} disabled={busy}/></label>
   <div className="account-actions">
    <button className="button" type="submit" disabled={busy}>{item?'저장':'FAQ 만들기'}</button>
    {item&&!confirming&&<button className="button secondary" type="button" disabled={busy} onClick={()=>setConfirming(true)}>삭제</button>}
    {item&&confirming&&<button className="button" type="button" disabled={busy} onClick={remove}>삭제 확인</button>}
    <button className="button secondary" type="button" disabled={busy} onClick={onClose}>닫기</button>
   </div>
  </form>
 </section>;
}

export default function FaqManager({initial}:{initial:Result}){
 const router=useRouter();
 const [result,setResult]=useState(initial),[q,setQ]=useState(''),[status,setStatus]=useState(''),[category,setCategory]=useState('');
 const [applied,setApplied]=useState({q:'',status:'',category:''});
 const [selected,setSelected]=useState<FaqItem|null>(null),[creating,setCreating]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/faq');router.refresh();}}
  finally{setBusy(false);}
 }
 async function load(page=result.pagination.page,filters=applied){
  const next=await loadValidPage(async requested=>{
   const query=new URLSearchParams({...filters,page:String(requested),pageSize:String(result.pagination.pageSize)});
   for(const [key,value] of [...query])if(!value)query.delete(key);
   return apiResponse<Result>(`/api/admin/faq?${query}`);
  },page);
  setResult(next);setApplied(filters);
 }
 const saved=async(message:string)=>{setSelected(null);setCreating(false);await load(creating?1:result.pagination.page);setNotice(message);};
 const reloadLatest=()=>void run(async()=>{setSelected(null);await load();setNotice('최신 목록을 불러왔습니다. 다시 편집해주세요.');});
 return <div className="settings-sections">
  <div aria-live="polite"><OperationNotice message={notice}/>{error&&<div role="alert" className="account-error">{error} <button className="button secondary" type="button" disabled={busy} onClick={reloadLatest}>최신 정보 불러오기</button></div>}</div>
  <section className="panel account-card">
   <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(()=>load(1,{q,status,category}));}}>
    <label>FAQ 검색<input className="field" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="질문·답변·분류" disabled={busy}/></label>
    <label>분류<select className="field" value={category} onChange={e=>setCategory(e.target.value)} disabled={busy}><option value="">전체 분류</option>{result.categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
    <label>상태<select className="field" value={status} onChange={e=>setStatus(e.target.value)} disabled={busy}><option value="">전체 상태</option><option value="published">공개</option><option value="draft">초안</option></select></label>
    <button className="button" type="submit" disabled={busy}>검색</button>
    <button className="button secondary" type="button" disabled={busy} onClick={()=>{setSelected(null);setCreating(true);}}>새 FAQ</button>
   </form>
   <p className="muted" style={{marginTop:16}}>총 {result.pagination.total}개</p>
   <div className="responsive-table"><table className="data-table">
    <caption className="sr-only">FAQ 목록</caption>
    <thead><tr><th>질문</th><th>분류</th><th>상태</th><th>순서</th><th>관리</th></tr></thead>
    <tbody>{result.data.map(f=><tr key={f.id}>
     <td><strong>{f.question}</strong></td><td>{f.category}</td><td>{f.status==='published'?'공개':'초안'}</td><td>{f.position}</td>
     <td><button className="button secondary" type="button" disabled={busy} onClick={()=>{setCreating(false);setSelected(f);}}>편집<span className="sr-only"> {f.question}</span></button></td>
    </tr>)}</tbody>
   </table>{!result.data.length&&<p className="empty-state">조건에 맞는 FAQ가 없습니다.</p>}</div>
   <ListPagination pagination={result.pagination} busy={busy} onPage={page=>void run(()=>load(page))}/>
  </section>
  {(creating||selected)&&<Editor key={selected?`${selected.id}:${selected.version}`:'new'} item={selected} categories={result.categories} busy={busy} run={run} onSaved={saved} onClose={()=>{setSelected(null);setCreating(false);}}/>}
 </div>;
}
