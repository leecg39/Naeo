'use client';
import ListPagination from './ListPagination';
import OperationNotice from './OperationNotice';
import {loadValidPage} from './pagination';
import {useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {EventItem,EventPhase} from '@/server/events/events';

type Row=EventItem&{phase:EventPhase;entryCounts:Record<string,number>};
type Form={slug:string;title:string;summary:string;body:string;status:EventItem['status'];startsAt:string;endsAt:string;requiresProof:boolean;rewardTokens:string;acceptsEntries:boolean;ctaLabel:string;ctaHref:string;coverImage:string};
const PHASE:Record<EventPhase,string>={open:'진행 중',upcoming:'예정',ended:'종료'};
const STATUS:Record<EventItem['status'],string>={draft:'초안',published:'게시',closed:'마감'};
/** datetime-local 값은 한국 시간으로 해석한다(+09:00). */
const toLocal=(ms:number)=>new Date(ms+9*3600_000).toISOString().slice(0,16);
const toIso=(local:string)=>`${local}:00+09:00`;
const empty=():Form=>({slug:'',title:'',summary:'',body:'',status:'draft',startsAt:toLocal(Date.now()),endsAt:toLocal(Date.now()+7*86_400_000),requiresProof:true,rewardTokens:'0',acceptsEntries:true,ctaLabel:'',ctaHref:'',coverImage:''});
const formOf=(e:EventItem):Form=>({slug:e.slug,title:e.title,summary:e.summary,body:e.body,status:e.status,startsAt:toLocal(e.startsAt),endsAt:toLocal(e.endsAt),requiresProof:e.requiresProof,rewardTokens:String(e.rewardTokens),acceptsEntries:e.acceptsEntries,ctaLabel:e.ctaLabel,ctaHref:e.ctaHref,coverImage:e.coverImage});

function Editor({item,busy,run,onSaved,onClose}:{item:EventItem|null;busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onSaved:(m:string)=>Promise<void>;onClose:()=>void}){
 const [form,setForm]=useState<Form>(item?formOf(item):empty()),[confirming,setConfirming]=useState(false);
 const set=<K extends keyof Form>(k:K,v:Form[K])=>setForm(f=>({...f,[k]:v}));
 const payload=()=>({...form,startsAt:toIso(form.startsAt),endsAt:toIso(form.endsAt),rewardTokens:Number(form.rewardTokens||0)});
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  if(item)await api(`/api/admin/events/${item.id}`,{method:'PATCH',body:{...payload(),version:item.version}});
  else await api('/api/admin/events',{method:'POST',body:payload()});
  await onSaved(item?'저장했습니다. 공개 화면에 바로 반영됩니다.':'이벤트를 만들었습니다.');
 });};
 const remove=()=>void run(async()=>{if(!item)return;await api(`/api/admin/events/${item.id}`,{method:'DELETE',body:{version:item.version}});await onSaved('이벤트를 삭제했습니다.');});
 const field=(label:string,k:'slug'|'title'|'summary'|'ctaLabel'|'ctaHref'|'coverImage',max:number,required=false)=><label>{label}<input className="field" value={form[k]} onChange={e=>set(k,e.target.value)} maxLength={max} required={required} disabled={busy}/></label>;
 return <section className="panel account-card" aria-label={item?'이벤트 편집':'새 이벤트'}>
  <h2>{item?'이벤트 편집':'새 이벤트'}</h2>{item&&<p className="muted">버전 {item.version}</p>}
  <form className="account-form" onSubmit={save}>
   {field('주소(/event/주소, 영문 소문자·숫자·하이픈)','slug',60,true)}
   {field('제목','title',100,true)}
   {field('요약(목록·메타 설명)','summary',300)}
   <label>본문(마크다운)<textarea className="field" value={form.body} onChange={e=>set('body',e.target.value)} maxLength={20000} rows={10} disabled={busy}/></label>
   <label>상태<select className="field" value={form.status} onChange={e=>set('status',e.target.value as Form['status'])} disabled={busy}><option value="draft">초안(비공개)</option><option value="published">게시</option><option value="closed">마감(참여 종료)</option></select></label>
   <label>시작(한국 시간)<input className="field" type="datetime-local" value={form.startsAt} onChange={e=>set('startsAt',e.target.value)} required disabled={busy}/></label>
   <label>종료(한국 시간, 이 시각 직전까지)<input className="field" type="datetime-local" value={form.endsAt} onChange={e=>set('endsAt',e.target.value)} required disabled={busy}/></label>
   <label><input type="checkbox" checked={form.acceptsEntries} onChange={e=>set('acceptsEntries',e.target.checked)} disabled={busy}/> 참여 신청 받기</label>
   <label><input type="checkbox" checked={form.requiresProof} onChange={e=>set('requiresProof',e.target.checked)} disabled={busy}/> 블로그 글 인증 필수</label>
   <label>승인 시 지급 토큰<input className="field" type="number" min={0} max={10000} value={form.rewardTokens} onChange={e=>set('rewardTokens',e.target.value)} disabled={busy}/></label>
   {field('안내 버튼 문구(참여 신청을 받지 않을 때)','ctaLabel',40)}
   {field('안내 버튼 링크(/로 시작하는 사이트 내부 경로)','ctaHref',200)}
   {field('대표 이미지(/로 시작하는 사이트 내부 경로, 비우면 이미지 없이 표시)','coverImage',300)}
   <div className="account-actions">
    <button className="button" type="submit" disabled={busy}>{item?'저장':'이벤트 만들기'}</button>
    {item&&!confirming&&<button className="button secondary" type="button" disabled={busy} onClick={()=>setConfirming(true)}>삭제</button>}
    {item&&confirming&&<button className="button" type="button" disabled={busy} onClick={remove}>삭제 확인</button>}
    <button className="button secondary" type="button" disabled={busy} onClick={onClose}>닫기</button>
   </div>
  </form>
 </section>;
}

export default function EventsManager({initial}:{initial:PageResult<Row>}){
 const router=useRouter();
 const [result,setResult]=useState(initial),[q,setQ]=useState(''),[status,setStatus]=useState('');
 const [applied,setApplied]=useState({q:'',status:''});
 const [selected,setSelected]=useState<EventItem|null>(null),[creating,setCreating]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/events');router.refresh();}}
  finally{setBusy(false);}
 }
 async function load(page=result.pagination.page,filters=applied){
  const next=await loadValidPage(async requested=>{
   const query=new URLSearchParams({...filters,page:String(requested),pageSize:String(result.pagination.pageSize)});
   for(const [key,value] of [...query])if(!value)query.delete(key);
   return apiResponse<PageResult<Row>>(`/api/admin/events?${query}`);
  },page);setResult(next);setApplied(filters);
 }
 const saved=async(m:string)=>{setSelected(null);setCreating(false);await load(creating?1:result.pagination.page);setNotice(m);};
 return <div className="settings-sections">
  <div aria-live="polite"><OperationNotice message={notice}/>{error&&<div role="alert" className="account-error">{error} <button className="button secondary" type="button" disabled={busy} onClick={()=>void run(async()=>{setSelected(null);await load();})}>최신 정보 불러오기</button></div>}</div>
  <section className="panel account-card">
   <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(()=>load(1,{q,status}));}}>
    <label>이벤트 검색<input className="field" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="제목·주소" disabled={busy}/></label>
    <label>상태<select className="field" value={status} onChange={e=>setStatus(e.target.value)} disabled={busy}><option value="">전체 상태</option><option value="draft">초안</option><option value="published">게시</option><option value="closed">마감</option></select></label>
    <button className="button" type="submit" disabled={busy}>검색</button>
    <button className="button secondary" type="button" disabled={busy} onClick={()=>{setSelected(null);setCreating(true);}}>새 이벤트</button>
   </form>
   <p className="muted" style={{marginTop:16}}>총 {result.pagination.total}개</p>
   <div className="responsive-table"><table className="data-table">
    <caption className="sr-only">이벤트 목록</caption>
    <thead><tr><th>제목</th><th>상태</th><th>진행</th><th>참여(대기/승인)</th><th>관리</th></tr></thead>
    <tbody>{result.data.map(e=><tr key={e.id}>
     <td><strong>{e.title}</strong><br/><a className="muted" href={`/event/${e.slug}`} target="_blank" rel="noreferrer">/event/{e.slug}</a></td>
     <td>{STATUS[e.status]}</td><td>{PHASE[e.phase]}</td>
     <td>{e.acceptsEntries?`${e.entryCounts.submitted??0} / ${e.entryCounts.approved??0}`:'신청 안 받음'}</td>
     <td style={{display:'flex',gap:6,flexWrap:'wrap'}}><button className="button secondary" type="button" disabled={busy} onClick={()=>{setCreating(false);setSelected(e);}}>편집<span className="sr-only"> {e.title}</span></button>{e.acceptsEntries&&<Link className="button secondary" href={`/admin/event?slug=${e.slug}`}>참여 심사<span className="sr-only"> {e.title}</span></Link>}</td>
    </tr>)}</tbody>
   </table>{!result.data.length&&<p className="empty-state">조건에 맞는 이벤트가 없습니다.</p>}</div>
   <ListPagination pagination={result.pagination} busy={busy} onPage={page=>void run(()=>load(page))}/>
  </section>
  {(creating||selected)&&<Editor key={selected?`${selected.id}:${selected.version}`:'new'} item={selected} busy={busy} run={run} onSaved={saved} onClose={()=>{setSelected(null);setCreating(false);}}/>}
 </div>;
}
