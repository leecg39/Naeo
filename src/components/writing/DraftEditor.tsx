import {kstDateTime} from '@/lib/kst-time';
import {useState,type FormEvent} from 'react';
import {api,ApiError} from '@/lib/api-client';
import type {Draft,DraftStatus} from '@/server/writing/drafts';
import DraftMedia from './DraftMedia';
import DraftShares from './DraftShares';
import DraftExport from './DraftExport';

export type DraftDetail=Draft&{revisions:{version:number;createdAt:number}[]};
const STATUS:Record<DraftStatus,string>={draft:'초안',ready:'발행 준비',published:'발행함',archived:'보관'};
const NEXT:Record<DraftStatus,DraftStatus[]>={draft:['ready','archived'],ready:['draft','published','archived'],published:['archived'],archived:['draft']};
const fmt=(ms:number)=>kstDateTime(ms);
const field={width:'100%',padding:'10px 12px',borderRadius:8,border:'1px solid rgba(255,255,255,.2)',background:'transparent',color:'inherit',font:'inherit'} as const;
const label={display:'grid',gap:6,fontSize:14} as const;

/** 초안 편집: 저장(version), 상태 전이, 이력 복구, 삭제, 사진·공유 링크. */
export default function DraftEditor({draft,onChanged,onClosed}:{draft:DraftDetail;onChanged:(d:DraftDetail|null,message:string)=>void;onClosed:()=>void}){
 const [title,setTitle]=useState(draft.title),[keyword,setKeyword]=useState(draft.keyword),[category,setCategory]=useState(draft.category),[body,setBody]=useState(draft.body);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[confirmDelete,setConfirmDelete]=useState(false);
 const dirty=title!==draft.title||keyword!==draft.keyword||category!==draft.category||body!==draft.body;
 const reload=async()=>api<DraftDetail>(`/api/drafts/${draft.id}`);
 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setConflict(false);
  try{await action();}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');if(e instanceof ApiError&&e.code==='VERSION_CONFLICT')setConflict(true);}
  finally{setBusy(false);}
 }
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{await api(`/api/drafts/${draft.id}`,{method:'PATCH',body:{title,keyword,category,body,version:draft.version}});onChanged(await reload(),'저장했습니다.');});};
 const move=(status:DraftStatus)=>void run(async()=>{if(dirty)throw new Error('먼저 저장한 뒤 상태를 바꿔주세요.');await api(`/api/drafts/${draft.id}`,{method:'PATCH',body:{status,version:draft.version}});onChanged(await reload(),`'${STATUS[status]}'(으)로 바꿨습니다.`);});
 const restore=(revision:number)=>void run(async()=>{await api(`/api/drafts/${draft.id}/restore`,{method:'POST',body:{revision,version:draft.version}});onChanged(await reload(),`${revision}번 버전으로 되돌렸습니다.`);});
 const remove=()=>void run(async()=>{await api(`/api/drafts/${draft.id}`,{method:'DELETE',body:{version:draft.version}});onChanged(null,'초안을 삭제했습니다. 사진은 내 사진함에 남습니다.');});
 const copy=async()=>{try{await navigator.clipboard.writeText(`# ${title}\n\n${body}\n`);setError('');onChanged(draft,'제목과 본문을 마크다운으로 복사했습니다.');}catch{setError('복사 권한을 확인해주세요.');}};
 return <section className="naeo-panel" aria-label="초안 편집" style={{padding:20,display:'grid',gap:14}}>
  <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'center'}}>
   <strong style={{fontSize:18}}>초안 편집</strong>
   <span style={{fontSize:13,color:'#a3a3a3'}}>{STATUS[draft.status]} · 버전 {draft.version} · {fmt(draft.updatedAt)} 저장 · {fmt(draft.expiresAt)} 자동 삭제{dirty?' · 저장하지 않은 변경 있음':''}</span>
  </div>
  {error&&<div role="alert" style={{color:'#f87171'}}>{error} {conflict&&<button type="button" className="naeo-button" onClick={()=>void run(async()=>{const d=await reload();onChanged(d,'최신 내용을 불러왔습니다.');})}>최신 내용 불러오기</button>}</div>}
  <form onSubmit={save} style={{display:'grid',gap:12}}>
   <label style={label}>제목<input style={field} value={title} onChange={e=>setTitle(e.target.value)} required maxLength={200} disabled={busy}/></label>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12}}>
    <label style={label}>키워드<input style={field} value={keyword} onChange={e=>setKeyword(e.target.value)} maxLength={60} disabled={busy}/></label>
    <label style={label}>주제<input style={field} value={category} onChange={e=>setCategory(e.target.value)} maxLength={30} disabled={busy}/></label>
   </div>
   <label style={label}>본문(마크다운)<textarea style={{...field,minHeight:320,lineHeight:1.7,resize:'vertical'}} value={body} onChange={e=>setBody(e.target.value)} maxLength={100000} disabled={busy}/></label>
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
    <button className="naeo-button" type="submit" disabled={busy||!dirty}>저장</button>
    {NEXT[draft.status].map(s=><button key={s} className="naeo-button" type="button" disabled={busy} onClick={()=>move(s)}>{STATUS[s]}(으)로</button>)}
    <button className="naeo-button" type="button" disabled={busy} onClick={()=>void copy()}>마크다운 복사</button>
    {!confirmDelete?<button className="naeo-button" type="button" disabled={busy} onClick={()=>setConfirmDelete(true)}>삭제</button>
     :<button className="naeo-button" type="button" disabled={busy} onClick={remove}>삭제 확인</button>}
    <button className="naeo-button" type="button" disabled={busy} onClick={()=>{if(!dirty||window.confirm('저장하지 않은 변경을 버릴까요?'))onClosed();}}>닫기</button>
   </div>
  </form>
  <DraftExport draftId={draft.id} dirty={dirty}/>
  <DraftMedia draftId={draft.id}/>
  <DraftShares draftId={draft.id}/>
  {draft.revisions.length>1&&<details><summary>수정 이력 {draft.revisions.length}개</summary><ul style={{listStyle:'none',padding:0,display:'grid',gap:6,marginTop:8}}>{draft.revisions.map(r=><li key={r.version} style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
   <span style={{fontSize:13}}>버전 {r.version} · {fmt(r.createdAt)}</span>
   {r.version!==draft.version&&<button className="naeo-button" type="button" disabled={busy||dirty} onClick={()=>restore(r.version)}>이 버전으로 되돌리기<span className="sr-only"> 버전 {r.version}</span></button>}
  </li>)}</ul></details>}
 </section>;
}
