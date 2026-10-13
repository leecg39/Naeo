'use client';
import {kstDateTime} from '@/lib/kst-time';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {createPortal} from 'react-dom';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {DraftSummary} from '@/server/writing/drafts';
import type {GenerationJob} from '@/server/generation/generation';
import DraftEditor,{type DraftDetail} from './DraftEditor';

const STATUS:Record<DraftSummary['status'],string>={draft:'초안',ready:'발행 준비',published:'발행함',archived:'보관'};
const JOB:Record<GenerationJob['state'],string>={queued:'대기',running:'생성 중',succeeded:'완료',failed:'실패',canceled:'취소'};
const fmt=(ms:number)=>kstDateTime(ms,{date:'short'});
const field={padding:'8px 12px',borderRadius:8,border:'1px solid rgba(255,255,255,.2)',background:'transparent',color:'inherit',font:'inherit'} as const;
export const OPEN_DRAFT_EVENT='naeo:open-draft';

function Workspace(){
 const [result,setResult]=useState<PageResult<DraftSummary>|null>(null),[q,setQ]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(1);
 const [selected,setSelected]=useState<DraftDetail|null>(null),[jobs,setJobs]=useState<GenerationJob[]>([]),[tokens,setTokens]=useState<number|null>(null);
 const [notice,setNotice]=useState(''),[error,setError]=useState(''),[signedOut,setSignedOut]=useState(false),[templates,setTemplates]=useState<{id:string;name:string}[]>([]);
 const load=useCallback(async(p=page)=>{
  try{
   const query=new URLSearchParams({page:String(p),pageSize:'10',q,...(status?{status}:{})});
   const [list,gens,credit,tpl]=await Promise.all([apiResponse<PageResult<DraftSummary>>(`/api/drafts?${query}`),apiResponse<PageResult<GenerationJob>>('/api/generations?pageSize=5'),apiResponse<{balance:number}>('/api/credits?pageSize=1'),api<{id:string;name:string}[]>('/api/writing-templates')]);
   setResult(list);setJobs(gens.data);setTokens(credit.balance);setTemplates(tpl);setPage(p);
   document.querySelectorAll('[data-credit-balance="true"]').forEach(el=>{el.textContent=`잔액 ${credit.balance}토큰`;});
  }catch(e){if(e instanceof ApiError&&e.status===401)setSignedOut(true);else setError(e instanceof Error?e.message:'불러오지 못했습니다.');}
 },[page,q,status]);
 const open=useCallback(async(id:string)=>{try{setSelected(await api<DraftDetail>(`/api/drafts/${id}`));setNotice('');}catch(e){setError(e instanceof Error?e.message:'초안을 열지 못했습니다.');}},[]);
 useEffect(()=>{
  const fromUrl=new URLSearchParams(window.location.search).get('draft');
  const t=window.setTimeout(()=>{void load(1);if(fromUrl&&/^[a-f0-9-]{36}$/.test(fromUrl))void open(fromUrl);},0);
  const onOpen=(e:Event)=>{const id=(e as CustomEvent<string>).detail;void load(1);void open(id);};
  window.addEventListener(OPEN_DRAFT_EVENT,onOpen);
  return()=>{window.clearTimeout(t);window.removeEventListener(OPEN_DRAFT_EVENT,onOpen);};
 // eslint-disable-next-line react-hooks/exhaustive-deps -- 첫 화면에서 한 번만 불러온다
 },[]);
 const create=(e:FormEvent)=>{e.preventDefault();void(async()=>{try{const d=await api<{id:string}>('/api/drafts',{method:'POST',body:{title:'새 초안',body:''}});await load(1);await open(d.id);setNotice('새 초안을 만들었습니다.');}catch(err){setError(err instanceof Error?err.message:'만들지 못했습니다.');}})();};
 if(signedOut)return <section className="naeo-panel" style={{padding:20,margin:'24px 0'}}><p>로그인하면 내 초안·사진·생성 기록을 관리할 수 있습니다.</p><a className="naeo-button" href="/login?next=%2Fdashboard%2Fwrite">로그인</a></section>;
 const pages=result?Math.max(1,Math.ceil(result.pagination.total/result.pagination.pageSize)):1;
 return <section aria-label="내 초안" style={{display:'grid',gap:16,margin:'32px 0',padding:'0 0 32px'}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
   <h2 style={{margin:0,fontSize:20}}>내 초안</h2>
   <span style={{fontSize:13,color:'#a3a3a3'}}>토큰 잔액 {tokens??'—'} · 글 생성 10토큰(실패·취소 시 환급)</span>
  </div>
  {templates.length>0&&<label style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',fontSize:14}}>AI 글 생성 템플릿
   <select id="writing-template" style={field} defaultValue=""><option value="">템플릿 없이</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
  <div aria-live="polite">{notice&&<p role="status" style={{margin:0,color:'#03c75a'}}>{notice}</p>}{error&&<p role="alert" style={{margin:0,color:'#f87171'}}>{error}</p>}</div>
  {jobs.length>0&&<div className="naeo-panel" style={{padding:12,fontSize:13,display:'grid',gap:4}}><strong>최근 AI 생성</strong>{jobs.map(j=><div key={j.id} style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   <span>{fmt(j.createdAt)} · {JOB[j.state]}{j.errorMessage&&j.state==='failed'?` · ${j.errorMessage}`:''}</span>
   {j.draftId&&<button type="button" className="naeo-button" style={{fontSize:12,padding:'2px 8px'}} onClick={()=>void open(j.draftId!)}>초안 열기</button>}
  </div>)}</div>}
  <form role="search" onSubmit={e=>{e.preventDefault();void load(1);}} style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   <label className="sr-only" htmlFor="draft-q">초안 검색</label>
   <input id="draft-q" style={{...field,flex:'1 1 200px',minWidth:0}} value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="제목·키워드 검색"/>
   <label className="sr-only" htmlFor="draft-status">상태</label>
   <select id="draft-status" style={field} value={status} onChange={e=>setStatus(e.target.value)}><option value="">전체 상태</option>{Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
   <button className="naeo-button" type="submit">검색</button>
   <button className="naeo-button" type="button" onClick={create}>새 초안</button>
  </form>
  <ul style={{listStyle:'none',padding:0,margin:0,display:'grid',gap:8}}>{result?.data.map(d=><li key={d.id}><button type="button" onClick={()=>void open(d.id)} className="naeo-panel"
   style={{width:'100%',textAlign:'left',padding:'12px 14px',font:'inherit',color:'inherit',cursor:'pointer',border:selected?.id===d.id?'1px solid #03c75a':undefined}}>
   <strong style={{display:'block',overflowWrap:'anywhere'}}>{d.title}</strong>
   <span style={{fontSize:13,color:'#a3a3a3'}}>{STATUS[d.status]} · {d.keyword||'키워드 없음'} · 사진 {d.imageCount} · {fmt(d.updatedAt)}</span>
  </button></li>)}</ul>
  {result&&!result.data.length&&<p style={{color:'#a3a3a3'}}>초안이 없습니다. 위에서 AI로 글을 만들거나 &lsquo;새 초안&rsquo;으로 직접 써보세요.</p>}
  {pages>1&&<nav aria-label="초안 페이지" style={{display:'flex',gap:12,alignItems:'center'}}>
   <button type="button" className="naeo-button" disabled={page<=1} onClick={()=>void load(page-1)}>이전</button><span>{page} / {pages}</span>
   <button type="button" className="naeo-button" disabled={page>=pages} onClick={()=>void load(page+1)}>다음</button>
  </nav>}
  {selected&&<DraftEditor key={`${selected.id}:${selected.version}`} draft={selected} onChanged={(d,m)=>{setSelected(d);setNotice(m);setError('');void load();}} onClosed={()=>setSelected(null)}/>}
 </section>;
}

/** 캡처한 글쓰기 화면의 main 안에 실제 초안 작업 공간을 붙인다. */
export default function DraftsWorkspace(){
 const [host,setHost]=useState<HTMLElement|null>(null);
 useEffect(()=>{const find=()=>document.querySelector<HTMLElement>('main');const t=window.setTimeout(()=>setHost(find()),0);return()=>window.clearTimeout(t);},[]);
 return host?createPortal(<div style={{maxWidth:1100,margin:'0 auto',padding:'0 16px'}}><Workspace/></div>,host):null;
}
