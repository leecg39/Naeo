'use client';
import {kstDateTime} from '@/lib/kst-time';
import {useState,type FormEvent} from 'react';
import {api} from '@/lib/api-client';
import type {PageSetting} from '@/server/content/page-settings';
import type {PageSettingRevision} from '@/server/content/admin-page-settings';

type Detail=PageSetting&{revisions:PageSettingRevision[]};
const fmt=(ms:number)=>kstDateTime(ms);

function Editor({item,busy,run,onSaved,onClose}:{item:Detail;busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onSaved:(d:Detail,m:string)=>Promise<void>;onClose:()=>void}){
 const [title,setTitle]=useState(item.title),[description,setDescription]=useState(item.description),[status,setStatus]=useState(item.status);
 const reload=()=>api<Detail>(`/api/admin/page-settings/${item.id}`);
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  await api(`/api/admin/page-settings/${item.id}`,{method:'PATCH',body:{title,description,status,version:item.version}});
  await onSaved(await reload(),status==='hidden'?'저장했습니다. 이 페이지는 이제 404입니다.':'저장했습니다. 공개 페이지에 바로 반영됩니다.');
 });};
 const restore=(revision:number)=>void run(async()=>{
  await api(`/api/admin/page-settings/${item.id}/restore`,{method:'POST',body:{revision,version:item.version}});
  await onSaved(await reload(),`${revision}번 버전 제목·설명으로 되돌렸습니다.`);
 });
 return <section className="panel account-card" aria-label="고정 페이지 편집">
  <h2>{item.path} 설정</h2>
  <p className="muted">버전 {item.version} · 본문은 디자인 그대로 유지하고 제목·검색 설명·공개 여부만 바꿉니다.</p>
  <form className="account-form" onSubmit={save}>
   <label>페이지 제목(브라우저 탭에 &lsquo;제목 | NAEO&rsquo;로 표시)<input className="field" value={title} onChange={e=>setTitle(e.target.value)} required maxLength={120} disabled={busy}/></label>
   <label>검색 설명(meta description)<textarea className="field" value={description} onChange={e=>setDescription(e.target.value)} maxLength={300} rows={3} disabled={busy}/></label>
   <label>공개 여부<select className="field" value={status} onChange={e=>setStatus(e.target.value as PageSetting['status'])} disabled={busy}><option value="published">공개</option><option value="hidden">숨김(404)</option></select></label>
   <div className="account-actions"><button className="button" type="submit" disabled={busy}>저장</button><a className="button secondary" href={item.path} target="_blank" rel="noopener">페이지 열기</a><button className="button secondary" type="button" disabled={busy} onClick={onClose}>닫기</button></div>
  </form>
  {item.revisions.length>0&&<div style={{marginTop:24}}><h3>수정 이력</h3><ul className="revision-list">{item.revisions.map(r=><li key={r.version}>
   <span>버전 {r.version} · {fmt(r.createdAt)}</span>
   {r.version!==item.version&&<button className="button secondary" type="button" disabled={busy} onClick={()=>restore(r.version)}>이 제목·설명으로 되돌리기<span className="sr-only"> 버전 {r.version}</span></button>}
  </li>)}</ul></div>}
 </section>;
}

/** /admin/pages 아래쪽: /features·/guide/* 같은 고정 디자인 페이지 설정. */
export default function PageSettingsManager({initial}:{initial:PageSetting[]}){
 const [items,setItems]=useState(initial),[selected,setSelected]=useState<Detail|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function run(action:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');}finally{setBusy(false);}}
 const load=async()=>setItems(await api<PageSetting[]>('/api/admin/page-settings'));
 const saved=async(d:Detail,m:string)=>{setSelected(d);await load();setNotice(m);};
 return <div className="settings-sections">
  <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<div role="alert" className="account-error">{error} {selected&&<button className="button secondary" type="button" disabled={busy} onClick={()=>void run(async()=>{await load();setSelected(await api<Detail>(`/api/admin/page-settings/${selected.id}`));setNotice('최신 내용을 불러왔습니다.');})}>최신 정보 불러오기</button>}</div>}</div>
  <section className="panel account-card">
   <h2>고정 디자인 페이지</h2>
   <div className="responsive-table"><table className="data-table">
    <caption className="sr-only">고정 디자인 페이지 목록</caption>
    <thead><tr><th>주소</th><th>제목</th><th>상태</th><th>수정일</th><th>관리</th></tr></thead>
    <tbody>{items.map(p=><tr key={p.id}><td>{p.path}</td><td>{p.title}</td><td>{p.status==='published'?'공개':'숨김'}</td><td>{fmt(p.updatedAt)}</td>
     <td><button className="button secondary" type="button" disabled={busy} onClick={()=>void run(async()=>setSelected(await api<Detail>(`/api/admin/page-settings/${p.id}`)))}>설정<span className="sr-only"> {p.path}</span></button></td></tr>)}</tbody>
   </table></div>
  </section>
  {selected&&<Editor key={`${selected.id}:${selected.version}`} item={selected} busy={busy} run={run} onSaved={saved} onClose={()=>setSelected(null)}/>}
 </div>;
}
