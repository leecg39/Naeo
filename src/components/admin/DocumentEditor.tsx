import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {api} from '@/lib/api-client';
import type {SiteDocument} from '@/server/content/documents';
import type {DocumentRevision} from '@/server/content/admin-documents';

export type DocumentDetail=SiteDocument&{revisions:DocumentRevision[]};
type Form={path:string;title:string;effectiveLabel:string;body:string;closingNote:string;status:SiteDocument['status'];position:string};
type Props={doc:DocumentDetail|null;busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onSaved:(d:DocumentDetail|null,message:string)=>Promise<void>;onClose:()=>void};

const formOf=(d:DocumentDetail|null):Form=>d
 ?{path:d.path,title:d.title,effectiveLabel:d.effectiveLabel,body:d.body,closingNote:d.closingNote,status:d.status,position:String(d.position)}
 :{path:'',title:'',effectiveLabel:'',body:'## 제1조 (목적)\n',closingNote:'',status:'draft',position:'0'};
const payload=(f:Form)=>({path:f.path.trim(),title:f.title,effectiveLabel:f.effectiveLabel,body:f.body,closingNote:f.closingNote,status:f.status,position:Number(f.position||0)});
const changed=(before:ReturnType<typeof payload>,after:ReturnType<typeof payload>)=>Object.fromEntries(Object.entries(after).filter(([k,v])=>v!==(before as Record<string,unknown>)[k]));
const fmt=(ms:number)=>new Date(ms).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'});

function Revisions({doc,busy,dirty,restore}:{doc:DocumentDetail;busy:boolean;dirty:boolean;restore:(v:number)=>void}){
 if(!doc.revisions.length)return null;
 return <div style={{marginTop:24}}>
  <h3>수정 이력</h3>
  <ul className="revision-list">{doc.revisions.map(r=><li key={r.version}>
   <span>버전 {r.version} · {fmt(r.createdAt)}</span>
   {r.version!==doc.version&&<button className="button secondary" type="button" disabled={busy||dirty} onClick={()=>restore(r.version)}>이 내용으로 되돌리기<span className="sr-only"> 버전 {r.version}</span></button>}
  </li>)}</ul>
  {dirty&&<p className="muted">저장하지 않은 변경이 있으면 되돌리기를 할 수 없습니다.</p>}
 </div>;
}

export default function DocumentEditor({doc,busy,run,onSaved,onClose}:Props){
 const initial=useMemo(()=>formOf(doc),[doc]);
 const [form,setForm]=useState(initial),[deleting,setDeleting]=useState(false),[confirmPath,setConfirmPath]=useState('');
 const dirty=JSON.stringify(form)!==JSON.stringify(initial);
 const set=<K extends keyof Form>(key:K,value:Form[K])=>setForm(f=>({...f,[key]:value}));
 useEffect(()=>{
  if(!dirty)return;
  const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};
  window.addEventListener('beforeunload',warn);
  return()=>window.removeEventListener('beforeunload',warn);
 },[dirty]);
 const reload=(id:string)=>api<DocumentDetail>(`/api/admin/documents/${id}`);

 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  if(!doc){const created=await api<SiteDocument>('/api/admin/documents',{method:'POST',body:payload(form)});await onSaved(await reload(created.id),'문서를 만들었습니다.');return;}
  const diff=changed(payload(initial),payload(form));
  if(!Object.keys(diff).length){await onSaved(doc,'바뀐 내용이 없습니다.');return;}
  await api(`/api/admin/documents/${doc.id}`,{method:'PATCH',body:{...diff,version:doc.version}});
  await onSaved(await reload(doc.id),'저장했습니다. 공개 문서는 바로 반영됩니다.');
 });};
 const restore=(revision:number)=>void run(async()=>{
  if(!doc)return;
  await api(`/api/admin/documents/${doc.id}/restore`,{method:'POST',body:{revision,version:doc.version}});
  await onSaved(await reload(doc.id),`${revision}번 버전 내용으로 되돌렸습니다.`);
 });
 const remove=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  if(!doc)return;
  await api(`/api/admin/documents/${doc.id}`,{method:'DELETE',body:{version:doc.version}});
  await onSaved(null,'문서를 삭제했습니다. 공개 주소는 이제 404입니다.');
 });};

 return <section className="panel account-card" aria-label={doc?'문서 편집':'새 문서'}>
  <h2>{doc?'문서 편집':'새 문서'}</h2>
  {doc&&<p className="muted">{doc.path} · 버전 {doc.version}{dirty?' · 저장하지 않은 변경 있음':''}</p>}
  {doc&&<div className="account-actions" style={{marginBottom:16}}>
   <a className="button secondary" href={`/admin/pages/preview/${doc.id}`} target="_blank" rel="noopener">미리보기</a>
   {doc.status==='published'&&<a className="button secondary" href={doc.path} target="_blank" rel="noopener">공개 페이지</a>}
  </div>}
  <form className="account-form article-form" onSubmit={save}>
   <label>주소(예: /youth-policy)<input className="field" value={form.path} onChange={e=>set('path',e.target.value)} required maxLength={80} pattern="/[a-z0-9\-/]+" disabled={busy}/></label>
   <label>제목<input className="field" value={form.title} onChange={e=>set('title',e.target.value)} required maxLength={120} disabled={busy}/></label>
   <label>시행일 표시(선택)<input className="field" value={form.effectiveLabel} onChange={e=>set('effectiveLabel',e.target.value)} maxLength={120} disabled={busy}/></label>
   <label>상태<select className="field" value={form.status} onChange={e=>set('status',e.target.value as Form['status'])} disabled={busy}><option value="draft">초안(비공개)</option><option value="published">공개</option></select></label>
   <label>목록 순서<input className="field" type="number" min={-1000} max={1000} value={form.position} onChange={e=>set('position',e.target.value)} disabled={busy}/></label>
   <label>본문<textarea className="field article-body" value={form.body} onChange={e=>set('body',e.target.value)} rows={20} maxLength={100000} spellCheck={false} disabled={busy}/></label>
   <p className="muted">&lsquo;## 소제목&rsquo;으로 시작하는 줄이 조항 제목이 되고, 그 아래 줄은 줄바꿈 그대로 표시됩니다. HTML은 글자 그대로 보입니다.</p>
   <label>맺음말(선택)<textarea className="field" value={form.closingNote} onChange={e=>set('closingNote',e.target.value)} rows={3} maxLength={2000} disabled={busy}/></label>
   <div className="account-actions">
    <button className="button" type="submit" disabled={busy}>{doc?'저장':'문서 만들기'}</button>
    {doc&&<button className="button secondary" type="button" disabled={busy} onClick={()=>setDeleting(true)}>삭제</button>}
    <button className="button secondary" type="button" disabled={busy} onClick={()=>{if(!dirty||window.confirm('저장하지 않은 변경을 버릴까요?'))onClose();}}>닫기</button>
   </div>
  </form>
  {deleting&&doc&&<form className="account-form account-delete" style={{marginTop:20}} onSubmit={remove}>
   <h3>문서 삭제 확인</h3>
   <p>삭제하면 되돌릴 수 없고 수정 이력도 함께 지워집니다. 잠시 내리려면 상태를 &apos;초안&apos;으로 바꾸세요.</p>
   <label>확인을 위해 주소 &lsquo;{doc.path}&rsquo; 입력<input className="field" value={confirmPath} onChange={e=>setConfirmPath(e.target.value)} autoComplete="off" disabled={busy}/></label>
   <div className="account-actions"><button className="button" type="submit" disabled={busy||confirmPath!==doc.path}>영구 삭제</button><button className="button secondary" type="button" disabled={busy} onClick={()=>{setDeleting(false);setConfirmPath('');}}>취소</button></div>
  </form>}
  {doc&&<Revisions doc={doc} busy={busy} dirty={dirty} restore={restore}/>}
 </section>;
}
