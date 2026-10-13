import {useMemo,useState,type FormEvent} from 'react';
import {api,ApiError} from '@/lib/api-client';
import {UPDATE_TYPES,UPDATE_TYPE_LABELS,type SiteUpdate,type UpdateType} from '@/server/content/updates';

type Form={slug:string;versionLabel:string;types:UpdateType[];title:string;summary:string;bodyMarkdown:string;publishedOn:string;status:SiteUpdate['status'];position:string};
type Props={item:SiteUpdate|null;busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onSaved:(u:SiteUpdate|null,message:string)=>Promise<void>;onClose:()=>void};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
const formOf=(u:SiteUpdate|null):Form=>u
 ?{slug:u.slug,versionLabel:u.versionLabel,types:u.types,title:u.title,summary:u.summary,bodyMarkdown:u.bodyMarkdown,publishedOn:u.publishedOn,status:u.status,position:String(u.position)}
 :{slug:'',versionLabel:'',types:['feature'],title:'',summary:'',bodyMarkdown:'## 무엇이 바뀌었나요\n\n',publishedOn:today(),status:'draft',position:'0'};
const payload=(f:Form)=>({...f,slug:f.slug.trim(),position:Number(f.position||0)});
const changed=(a:ReturnType<typeof payload>,b:ReturnType<typeof payload>)=>Object.fromEntries(Object.entries(b).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify((a as Record<string,unknown>)[k])));

export default function UpdateEditor({item,busy,run,onSaved,onClose}:Props){
 const initial=useMemo(()=>formOf(item),[item]);
 const [form,setForm]=useState(initial),[warnings,setWarnings]=useState<string[]>([]),[confirming,setConfirming]=useState(false);
 const dirty=JSON.stringify(form)!==JSON.stringify(initial);
 const set=<K extends keyof Form>(k:K,v:Form[K])=>setForm(f=>({...f,[k]:v}));
 const toggleType=(t:UpdateType,on:boolean)=>set('types',on?UPDATE_TYPES.filter(x=>x===t||form.types.includes(x)):form.types.filter(x=>x!==t));
 const withWarnings=async<T,>(action:()=>Promise<T>)=>{setWarnings([]);try{return await action();}catch(e){if(e instanceof ApiError&&Array.isArray(e.details))setWarnings(e.details.map(String));throw e;}};
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  if(!item){const u=await withWarnings(()=>api<SiteUpdate>('/api/admin/updates',{method:'POST',body:payload(form)}));await onSaved(u,'업데이트를 만들었습니다.');return;}
  const diff=changed(payload(initial),payload(form));
  if(!Object.keys(diff).length){await onSaved(item,'바뀐 내용이 없습니다.');return;}
  const u=await withWarnings(()=>api<SiteUpdate>(`/api/admin/updates/${item.id}`,{method:'PATCH',body:{...diff,version:item.version}}));
  await onSaved(u,'저장했습니다. 공개 업데이트는 바로 반영됩니다.');
 });};
 const remove=()=>void run(async()=>{
  if(!item)return;
  await api(`/api/admin/updates/${item.id}`,{method:'DELETE',body:{version:item.version}});
  await onSaved(null,'업데이트를 삭제했습니다.');
 });
 return <section className="panel account-card" aria-label={item?'업데이트 편집':'새 업데이트'}>
  <h2>{item?'업데이트 편집':'새 업데이트'}</h2>
  {item&&<p className="muted">/updates?focus={item.slug} · 버전 {item.version}{dirty?' · 저장하지 않은 변경 있음':''}</p>}
  {item&&<div className="account-actions" style={{marginBottom:16}}>
   <a className="button secondary" href={`/admin/updates/preview/${item.id}`} target="_blank" rel="noopener">미리보기</a>
   {item.status==='published'&&<a className="button secondary" href={`/updates?focus=${item.slug}`} target="_blank" rel="noopener">공개 페이지</a>}
  </div>}
  <form className="account-form article-form" onSubmit={save}>
   <label>주소(영문 소문자·숫자·-, 예: 2026-10-13-new-feature)<input className="field" value={form.slug} onChange={e=>set('slug',e.target.value)} required maxLength={80} disabled={busy}/></label>
   <label>버전 표시(예: v1.16.0)<input className="field" value={form.versionLabel} onChange={e=>set('versionLabel',e.target.value)} maxLength={20} disabled={busy}/></label>
   <fieldset className="account-form" disabled={busy}><legend>분류(1개 이상)</legend>
    {UPDATE_TYPES.map(t=><label key={t} className="account-checkbox"><input type="checkbox" checked={form.types.includes(t)} onChange={e=>toggleType(t,e.target.checked)}/> {UPDATE_TYPE_LABELS[t]}</label>)}
   </fieldset>
   <label>제목<input className="field" value={form.title} onChange={e=>set('title',e.target.value)} required maxLength={200} disabled={busy}/></label>
   <label>요약(접힌 상태에 표시)<textarea className="field" value={form.summary} onChange={e=>set('summary',e.target.value)} maxLength={500} rows={2} disabled={busy}/></label>
   <label>날짜<input className="field" type="date" value={form.publishedOn} onChange={e=>set('publishedOn',e.target.value)} required disabled={busy}/></label>
   <label>상태<select className="field" value={form.status} onChange={e=>set('status',e.target.value as Form['status'])} disabled={busy}><option value="draft">초안(비공개)</option><option value="published">공개</option></select></label>
   <label>순서(같은 날짜일 때 작은 값 먼저)<input className="field" type="number" min={-10000} max={10000} value={form.position} onChange={e=>set('position',e.target.value)} disabled={busy}/></label>
   <label>본문(마크다운)<textarea className="field article-body" value={form.bodyMarkdown} onChange={e=>set('bodyMarkdown',e.target.value)} rows={16} spellCheck={false} disabled={busy}/></label>
   <p className="muted">매거진 글과 같은 마크다운(제목·굵게·목록·표·이미지·링크)을 씁니다. HTML 태그와 javascript: 주소는 저장할 수 없습니다.</p>
   {warnings.length>0&&<ul role="alert" className="account-error">{warnings.map(w=><li key={w}>{w}</li>)}</ul>}
   <div className="account-actions">
    <button className="button" type="submit" disabled={busy||!form.types.length}>{item?'저장':'업데이트 만들기'}</button>
    {item&&!confirming&&<button className="button secondary" type="button" disabled={busy} onClick={()=>setConfirming(true)}>삭제</button>}
    {item&&confirming&&<button className="button" type="button" disabled={busy} onClick={remove}>삭제 확인</button>}
    <button className="button secondary" type="button" disabled={busy} onClick={()=>{if(!dirty||window.confirm('저장하지 않은 변경을 버릴까요?'))onClose();}}>닫기</button>
   </div>
  </form>
 </section>;
}
