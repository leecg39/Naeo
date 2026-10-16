'use client';
import OperationNotice from './OperationNotice';
import {kstDateTime} from '@/lib/kst-time';
import {useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {WritingTemplate} from '@/server/generation/templates';
import type {AdminGeneration} from '@/server/generation/admin-generations';

const STATE:Record<AdminGeneration['state'],string>={queued:'대기',running:'생성 중',succeeded:'완료',failed:'실패',canceled:'취소'};
const fmt=(ms:number)=>kstDateTime(ms,{date:'short'});

function TemplateEditor({item,busy,run,onDone}:{item:WritingTemplate|null;busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onDone:(m:string)=>Promise<void>}){
 const [name,setName]=useState(item?.name??''),[category,setCategory]=useState(item?.category??''),[guidance,setGuidance]=useState(item?.guidance??''),[status,setStatus]=useState<WritingTemplate['status']>(item?.status??'active');
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  if(item)await api(`/api/admin/writing-templates/${item.id}`,{method:'PATCH',body:{name,category,guidance,status,version:item.version}});
  else await api('/api/admin/writing-templates',{method:'POST',body:{name,category,guidance,status}});
  await onDone(item?'템플릿을 저장했습니다.':'템플릿을 만들었습니다.');
 });};
 const remove=()=>void run(async()=>{if(!item||!window.confirm(`'${item.name}' 템플릿을 삭제할까요?`))return;await api(`/api/admin/writing-templates/${item.id}`,{method:'DELETE',body:{version:item.version}});await onDone('템플릿을 삭제했습니다.');});
 return <form className="account-form" onSubmit={save} aria-label={item?'템플릿 편집':'새 템플릿'} style={{marginTop:16}}>
  <label>이름<input className="field" value={name} onChange={e=>setName(e.target.value)} required maxLength={60} disabled={busy}/></label>
  <label>주제(선택)<input className="field" value={category} onChange={e=>setCategory(e.target.value)} maxLength={30} disabled={busy}/></label>
  <label>작성 지침(AI 시스템 지시에 들어감, 회원에게는 이름만 보임)<textarea className="field" value={guidance} onChange={e=>setGuidance(e.target.value)} required maxLength={2000} rows={5} disabled={busy}/></label>
  <label>상태<select className="field" value={status} onChange={e=>setStatus(e.target.value as WritingTemplate['status'])} disabled={busy}><option value="active">회원에게 노출</option><option value="hidden">숨김</option></select></label>
  <div className="account-actions"><button className="button" type="submit" disabled={busy}>{item?'저장':'템플릿 만들기'}</button>{item&&<button className="button secondary" type="button" disabled={busy} onClick={remove}>삭제</button>}</div>
 </form>;
}

function CreditGrant({busy,run,onDone}:{busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onDone:(m:string)=>Promise<void>}){
 const [email,setEmail]=useState(''),[delta,setDelta]=useState('10'),[note,setNote]=useState('');
 const grant=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  const users=await apiResponse<PageResult<{id:string;email:string}>>(`/api/admin/users?q=${encodeURIComponent(email.trim())}&pageSize=5`);
  const user=users.data.find(u=>u.email.toLowerCase()===email.trim().toLowerCase());
  if(!user)throw new Error('그 이메일의 회원을 찾을 수 없습니다.');
  const r=await api<{balance:number}>('/api/admin/credits',{method:'POST',body:{userId:user.id,delta:Number(delta),note}});
  await onDone(`${user.email} 잔액 ${r.balance}토큰`);
 });};
 return <form className="admin-filters" onSubmit={grant} aria-label="토큰 지급">
  <label>회원 이메일<input className="field" type="email" value={email} onChange={e=>setEmail(e.target.value)} required disabled={busy}/></label>
  <label>토큰(음수면 회수)<input className="field" type="number" value={delta} onChange={e=>setDelta(e.target.value)} required disabled={busy}/></label>
  <label>사유<input className="field" value={note} onChange={e=>setNote(e.target.value)} required maxLength={200} disabled={busy}/></label>
  <button className="button" type="submit" disabled={busy}>지급·회수</button>
 </form>;
}

export default function WritingAdmin({initialTemplates,initialJobs,aiConfigured}:{initialTemplates:WritingTemplate[];initialJobs:PageResult<AdminGeneration>;aiConfigured:boolean}){
 const router=useRouter();
 const [templates,setTemplates]=useState(initialTemplates),[jobs,setJobs]=useState(initialJobs),[editing,setEditing]=useState<WritingTemplate|null|'new'>(null);
 const [q,setQ]=useState(''),[state,setState]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/writing');router.refresh();}}
  finally{setBusy(false);}
 }
 const loadJobs=async()=>setJobs(await apiResponse<PageResult<AdminGeneration>>(`/api/admin/generations?${new URLSearchParams({pageSize:'30',q,...(state?{state}:{})})}`));
 const doneTemplate=async(m:string)=>{setTemplates(await api<WritingTemplate[]>('/api/admin/writing-templates'));setEditing(null);setNotice(m);};
 return <div className="settings-sections">
  <div aria-live="polite"><OperationNotice message={notice}/>{error&&<p role="alert" className="account-error">{error}</p>}</div>
  <section className="panel account-card">
   <h2>글쓰기 템플릿</h2>
   <p className="muted">회원이 AI 글 생성 때 고를 수 있는 작성 지침입니다. AI 글 공급자 또는 회원별 ChatGPT 연결: <strong>{aiConfigured?'설정 가능':'미설정'}</strong>{aiConfigured?'':' · 공급자 설정이 없어 생성 요청은 토큰 차감 없이 거절됩니다.'} AI 이미지 공급자: <strong>미설정</strong></p>
   <div className="responsive-table"><table className="data-table"><caption className="sr-only">글쓰기 템플릿</caption>
    <thead><tr><th>이름</th><th>주제</th><th>상태</th><th>관리</th></tr></thead>
    <tbody>{templates.map(t=><tr key={t.id}><td><strong>{t.name}</strong></td><td>{t.category||'—'}</td><td>{t.status==='active'?'노출':'숨김'}</td>
     <td><button className="button secondary" type="button" disabled={busy} onClick={()=>setEditing(t)}>편집<span className="sr-only"> {t.name}</span></button></td></tr>)}</tbody>
   </table>{!templates.length&&<p className="empty-state">템플릿이 없습니다.</p>}</div>
   <div className="account-actions" style={{marginTop:12}}><button className="button secondary" type="button" disabled={busy} onClick={()=>setEditing('new')}>새 템플릿</button></div>
   {editing&&<TemplateEditor key={editing==='new'?'new':`${editing.id}:${editing.version}`} item={editing==='new'?null:editing} busy={busy} run={run} onDone={doneTemplate}/>}
  </section>
  <section className="panel account-card">
   <h2>토큰 지급</h2>
   <CreditGrant busy={busy} run={run} onDone={async m=>setNotice(m)}/>
  </section>
  <section className="panel account-card">
   <h2>AI 생성 작업</h2>
   <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(loadJobs);}}>
    <label>검색<input className="field" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="이메일·키워드·오류 코드" disabled={busy}/></label>
    <label>상태<select className="field" value={state} onChange={e=>setState(e.target.value)} disabled={busy}><option value="">전체</option>{Object.entries(STATE).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <button className="button" type="submit" disabled={busy}>검색</button>
   </form>
   <p className="muted" style={{marginTop:12}}>총 {jobs.pagination.total}개</p>
   <div className="responsive-table"><table className="data-table"><caption className="sr-only">AI 생성 작업</caption>
    <thead><tr><th>회원</th><th>키워드</th><th>상태</th><th>토큰</th><th>오류</th><th>요청</th><th>관리</th></tr></thead>
    <tbody>{jobs.data.map(j=><tr key={j.id}><td>{j.ownerEmail}</td><td>{j.keyword}</td><td>{STATE[j.state]}{j.cancelRequested&&j.state==='running'?' (취소 요청)':''}</td><td>{j.cost}</td>
     <td>{j.errorCode?<code>{j.errorCode}</code>:'—'}</td><td>{fmt(j.createdAt)}</td>
     <td>{(j.state==='queued'||j.state==='running')&&!j.cancelRequested&&<button className="button secondary" type="button" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/admin/generations/${j.id}/cancel`,{method:'POST',body:{}});await loadJobs();setNotice('취소했습니다. 토큰은 환급됩니다.');})}>취소<span className="sr-only"> {j.keyword}</span></button>}</td>
    </tr>)}</tbody>
   </table>{!jobs.data.length&&<p className="empty-state">생성 작업이 없습니다.</p>}</div>
  </section>
 </div>;
}
