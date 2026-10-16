'use client';
import OperationNotice from './OperationNotice';
import {useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {api,ApiError} from '@/lib/api-client';
import {formatKst} from '@/lib/inquiry-labels';
import type {InquiryTemplate} from '@/server/inquiries/templates';

type Draft={name:string;subject:string;body:string};
const empty:Draft={name:'',subject:'',body:''};

export default function TemplatesManager({initial}:{initial:InquiryTemplate[]}){
 const router=useRouter();
 const [templates,setTemplates]=useState(initial),[selected,setSelected]=useState<InquiryTemplate|null>(null),[draft,setDraft]=useState<Draft>(empty),[editing,setEditing]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const set=(key:keyof Draft,value:string)=>setDraft(d=>({...d,[key]:value}));

 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){
   setError(e instanceof Error?e.message:'처리하지 못했습니다.');
   if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/inquiries/templates');router.refresh();}
  }finally{setBusy(false);}
 }
 const reload=async()=>setTemplates(await api<InquiryTemplate[]>('/api/admin/inquiry-templates'));
 const startNew=()=>{setSelected(null);setDraft(empty);setEditing(true);setError('');};
 const edit=(t:InquiryTemplate)=>{setSelected(t);setDraft({name:t.name,subject:t.subject,body:t.body});setEditing(true);setError('');};
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  const saved=selected
   ?await api<InquiryTemplate>(`/api/admin/inquiry-templates/${selected.id}`,{method:'PATCH',body:{...draft,version:selected.version}})
   :await api<InquiryTemplate>('/api/admin/inquiry-templates',{method:'POST',body:draft});
  setSelected(saved);await reload();setNotice(selected?'템플릿을 저장했습니다.':'템플릿을 만들었습니다.');
 });};
 const remove=(t:InquiryTemplate)=>void run(async()=>{
  if(!window.confirm(`'${t.name}' 템플릿을 삭제할까요?`))return;
  await api(`/api/admin/inquiry-templates/${t.id}`,{method:'DELETE',body:{version:t.version}});
  if(selected?.id===t.id){setSelected(null);setEditing(false);}
  await reload();setNotice('템플릿을 삭제했습니다.');
 });

 return <div className="settings-sections">
  <div aria-live="polite"><OperationNotice message={notice}/>{error&&<div role="alert" className="account-error">{error} <button className="button secondary" type="button" disabled={busy} onClick={()=>void run(async()=>{await reload();setEditing(false);setSelected(null);setNotice('최신 목록을 불러왔습니다.');})}>최신 정보 불러오기</button></div>}</div>
  <section className="panel account-card">
   <div className="account-actions"><button className="button" type="button" disabled={busy} onClick={startNew}>새 템플릿</button></div>
   <div className="responsive-table"><table className="data-table">
    <caption className="sr-only">답변 템플릿 목록</caption>
    <thead><tr><th>이름</th><th>제목</th><th>수정일</th><th>관리</th></tr></thead>
    <tbody>{templates.map(t=><tr key={t.id}>
     <td><strong>{t.name}</strong></td><td>{t.subject||'—'}</td><td>{formatKst(t.updatedAt)}</td>
     <td><div className="account-actions"><button className="button secondary" type="button" disabled={busy} onClick={()=>edit(t)}>편집<span className="sr-only"> {t.name}</span></button><button className="button secondary" type="button" disabled={busy} onClick={()=>remove(t)}>삭제<span className="sr-only"> {t.name}</span></button></div></td>
    </tr>)}</tbody>
   </table>{!templates.length&&<p className="empty-state">아직 템플릿이 없습니다. 자주 쓰는 답변을 저장해 두면 문의 답변에서 바로 넣을 수 있습니다.</p>}</div>
  </section>
  {editing&&<section className="panel account-card" aria-label={selected?'템플릿 편집':'새 템플릿'}>
   <h2>{selected?'템플릿 편집':'새 템플릿'}</h2>
   {selected&&<p className="muted">버전 {selected.version}</p>}
   <form className="account-form" onSubmit={save}>
    <label>템플릿 이름<input className="field" value={draft.name} onChange={e=>set('name',e.target.value)} required maxLength={60} disabled={busy}/></label>
    <label>메일 제목(선택)<input className="field" value={draft.subject} onChange={e=>set('subject',e.target.value)} maxLength={200} disabled={busy}/></label>
    <label>답변 본문<textarea className="field" value={draft.body} onChange={e=>set('body',e.target.value)} rows={8} required maxLength={10000} disabled={busy}/></label>
    <div className="account-actions"><button className="button" type="submit" disabled={busy}>{selected?'템플릿 저장':'템플릿 만들기'}</button><button className="button secondary" type="button" disabled={busy} onClick={()=>setEditing(false)}>닫기</button></div>
   </form>
  </section>}
 </div>;
}
