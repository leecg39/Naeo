'use client';
import ListPagination from './ListPagination';
import OperationNotice from './OperationNotice';
import {loadValidPage} from './pagination';
import {kstDateTime} from '@/lib/kst-time';
import {useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {Announcement} from '@/server/content/announcements';

type Form={type:Announcement['type'];title:string;body:string;linkUrl:string;linkLabel:string;target:Announcement['target'];startsAt:string;endsAt:string;status:Announcement['status'];metadata:Announcement['metadata']};
/** datetime-local 값은 브라우저 현지 시각이라 저장할 때 ISO(UTC)로 바꾼다. */
const toLocal=(ms:number|null)=>ms!==null?new Date(ms-new Date(ms).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
const toIso=(v:string)=>v?new Date(v).toISOString():null;
const fmt=(ms:number|null)=>ms!==null?kstDateTime(ms):'제한 없음';
const formOf=(a:Announcement|null):Form=>a?{type:a.type,title:a.title,body:a.body,linkUrl:a.linkUrl,linkLabel:a.linkLabel,target:a.target,startsAt:toLocal(a.startsAt),endsAt:toLocal(a.endsAt),status:a.status,metadata:a.metadata}
 :{type:'maintenance',title:'',body:'',linkUrl:'',linkLabel:'',target:'landing',startsAt:'',endsAt:'',status:'draft',metadata:{}};
const payload=(f:Form)=>({...f,startsAt:toIso(f.startsAt),endsAt:toIso(f.endsAt)});
function stateOf(a:Announcement,now:number){
 if(a.status==='draft')return'초안';
 if(a.startsAt&&a.startsAt>now)return'예약';
 if(a.endsAt&&a.endsAt<=now)return'종료';
 return'게시 중';
}

function Editor({item,busy,run,onSaved,onClose}:{item:Announcement|null;busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onSaved:(m:string)=>Promise<void>;onClose:()=>void}){
 const [form,setForm]=useState(formOf(item)),[confirming,setConfirming]=useState(false);
 const set=<K extends keyof Form>(k:K,v:Form[K])=>setForm(f=>({...f,[k]:v}));
 const setMeta=(key:keyof Announcement['metadata'],value:string)=>setForm(f=>({...f,metadata:{...f.metadata,[key]:value||undefined}}));
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  if(item)await api(`/api/admin/announcements/${item.id}`,{method:'PATCH',body:{...payload(form),version:item.version}});
  else await api('/api/admin/announcements',{method:'POST',body:payload(form)});
  await onSaved(item?'저장했습니다. 공개 화면에 바로 반영됩니다.':'공지를 만들었습니다.');
 });};
 const remove=()=>void run(async()=>{if(!item)return;await api(`/api/admin/announcements/${item.id}`,{method:'DELETE',body:{version:item.version}});await onSaved('공지를 삭제했습니다.');});
 return <section className="panel account-card" aria-label={item?'공지 편집':'새 공지'}>
  <h2>{item?'공지 편집':'새 공지'}</h2>
  {item&&<p className="muted">버전 {item.version}</p>}
  <form className="account-form" onSubmit={save}>
   <label>유형<select className="field" value={form.type} onChange={e=>set('type',e.target.value as Form['type'])} disabled={busy}><option value="maintenance">점검</option><option value="event">이벤트</option><option value="feature">기능 안내</option><option value="coupon">쿠폰</option><option value="blog">블로그</option></select></label>
   <label>제목<input className="field" value={form.title} onChange={e=>set('title',e.target.value)} required maxLength={80} disabled={busy}/></label>
   {form.type==='coupon'&&<label>쿠폰 코드(선택)<input className="field" value={form.metadata.couponCode||''} onChange={e=>setMeta('couponCode',e.target.value)} maxLength={120} disabled={busy}/></label>}
   <label>내용(선택)<textarea className="field" value={form.body} onChange={e=>set('body',e.target.value)} maxLength={300} rows={3} disabled={busy}/></label>
   <label>링크(선택, /경로 또는 https 주소)<input className="field" value={form.linkUrl} onChange={e=>set('linkUrl',e.target.value)} maxLength={300} disabled={busy}/></label>
   <label>링크 문구<input className="field" value={form.linkLabel} onChange={e=>set('linkLabel',e.target.value)} maxLength={30} required={!!form.linkUrl&&!(['coupon','feature','blog'].includes(form.type)||form.metadata.display==='ticker'||(form.metadata.image&&form.metadata.display!=='notice'))} disabled={busy}/></label>
   <label>표시 위치<select className="field" value={form.target} onChange={e=>set('target',e.target.value as Form['target'])} disabled={busy}><option value="landing">공개 사이트</option><option value="dashboard">회원 대시보드</option><option value="all">모든 공개 화면</option></select></label>
   <fieldset disabled={busy}><legend>이미지 배너 설정</legend>
    <label>표시 방식<select className="field" value={form.metadata.display||'auto'} onChange={e=>setMeta('display',e.target.value==='auto'?'':e.target.value)}><option value="auto">이미지가 있으면 배너</option><option value="notice">텍스트 공지</option><option value="banner">이미지 배너</option><option value="ticker">흐르는 공지 띠</option></select></label>
    <label>기본 이미지 주소<input className="field" value={form.metadata.image||''} onChange={e=>setMeta('image',e.target.value)} maxLength={300} required={form.metadata.display==='banner'} placeholder="/images/banner.png 또는 https://…"/></label>
    <label>모바일 이미지 주소(선택)<input className="field" value={form.metadata.imageMobile||''} onChange={e=>setMeta('imageMobile',e.target.value)} maxLength={300}/></label>
    <label>기본 비율(기본 4 / 5)<input className="field" value={form.metadata.ratio||''} onChange={e=>setMeta('ratio',e.target.value)} placeholder="4 / 5" maxLength={30}/></label>
    <label>모바일 비율(선택)<input className="field" value={form.metadata.ratioMobile||''} onChange={e=>setMeta('ratioMobile',e.target.value)} placeholder="4 / 5" maxLength={30}/></label>
    <label>정확한 표시 경로(선택)<input className="field" value={form.metadata.exactPath||''} onChange={e=>setMeta('exactPath',e.target.value)} placeholder="/event" maxLength={300}/></label>
    <label>배너 버튼 문구(기본 이벤트 보러가기)<input className="field" value={form.metadata.ctaLabel||''} onChange={e=>setMeta('ctaLabel',e.target.value)} maxLength={30}/></label>
    <p className="muted">쿠폰·기능·블로그는 전용 대화상자로, 점검은 상단 띠로 표시합니다. 이벤트는 이미지가 있어야 표시합니다. 이미지 배너 설정은 이벤트 유형에 적용됩니다. 흐르는 공지 띠는 모든 유형보다 우선하며 내용을 표시하며 비어 있으면 제목을 사용합니다. [coffee], [airpods], [ipad]는 상품 아이콘으로 표시됩니다. 닫으면 오늘 숨김이 적용됩니다. 이벤트 상세에서는 표시하지 않습니다. 비율은 너비 / 높이입니다. 모바일 이미지·비율을 비우면 기본값을 사용합니다. 링크를 비우면 배너는 /event로 이동합니다. 표시 경로는 위 표시 위치 범위 안에서 적용됩니다.</p>
   </fieldset>
   <label>시작(비우면 바로)<input className="field" type="datetime-local" value={form.startsAt} onChange={e=>set('startsAt',e.target.value)} disabled={busy}/></label>
   <label>종료(비우면 계속)<input className="field" type="datetime-local" value={form.endsAt} onChange={e=>set('endsAt',e.target.value)} disabled={busy}/></label>
   <label>상태<select className="field" value={form.status} onChange={e=>set('status',e.target.value as Form['status'])} disabled={busy}><option value="draft">초안(비공개)</option><option value="published">공개</option></select></label>
   <p className="muted">공개 중인 공지는 경로에 맞는 수정 순서로 표시하며 닫으면 다음 공지가 보입니다. 닫기는 현재 화면에서만, 오늘 하루 안 보기는 UTC 자정(한국 오전 9시)까지 적용됩니다.</p>
   <div className="account-actions">
    <button className="button" type="submit" disabled={busy}>{item?'저장':'공지 만들기'}</button>
    {item&&!confirming&&<button className="button secondary" type="button" disabled={busy} onClick={()=>setConfirming(true)}>삭제</button>}
    {item&&confirming&&<button className="button" type="button" disabled={busy} onClick={remove}>삭제 확인</button>}
    <button className="button secondary" type="button" disabled={busy} onClick={onClose}>닫기</button>
   </div>
  </form>
 </section>;
}

export default function AnnouncementsManager({initial,now:serverNow}:{initial:PageResult<Announcement>;now:number}){
 const router=useRouter();
 const [result,setResult]=useState(initial),[q,setQ]=useState(''),[status,setStatus]=useState(''),[now,setNow]=useState(serverNow);
 const [applied,setApplied]=useState({q:'',status:''});
 const [selected,setSelected]=useState<Announcement|null>(null),[creating,setCreating]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/announcements');router.refresh();}}
  finally{setBusy(false);}
 }
 async function load(page=result.pagination.page,filters=applied){
  const next=await loadValidPage(async requested=>{
   const query=new URLSearchParams({...filters,page:String(requested),pageSize:String(result.pagination.pageSize)});
   for(const [key,value] of [...query])if(!value)query.delete(key);
   return apiResponse<PageResult<Announcement>>(`/api/admin/announcements?${query}`);
  },page);
  setResult(next);setApplied(filters);setNow(Date.now());
 }
 const saved=async(m:string)=>{setSelected(null);setCreating(false);await load(creating?1:result.pagination.page);setNotice(m);};
 return <div className="settings-sections">
  <div aria-live="polite"><OperationNotice message={notice}/>{error&&<div role="alert" className="account-error">{error} <button className="button secondary" type="button" disabled={busy} onClick={()=>void run(async()=>{setSelected(null);await load();setNotice('최신 목록을 불러왔습니다. 다시 편집해주세요.');})}>최신 정보 불러오기</button></div>}</div>
  <section className="panel account-card">
   <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(()=>load(1,{q,status}));}}>
    <label>공지 검색<input className="field" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="제목·내용" disabled={busy}/></label>
    <label>상태<select className="field" value={status} onChange={e=>setStatus(e.target.value)} disabled={busy}><option value="">전체 상태</option><option value="published">공개</option><option value="draft">초안</option></select></label>
    <button className="button" type="submit" disabled={busy}>검색</button>
    <button className="button secondary" type="button" disabled={busy} onClick={()=>{setSelected(null);setCreating(true);}}>새 공지</button>
   </form>
   <p className="muted" style={{marginTop:16}}>총 {result.pagination.total}개</p>
   <div className="responsive-table"><table className="data-table">
    <caption className="sr-only">공지 목록</caption>
    <thead><tr><th>제목</th><th>위치</th><th>상태</th><th>기간</th><th>관리</th></tr></thead>
    <tbody>{result.data.map(a=><tr key={a.id}>
     <td><strong>{a.title}</strong></td><td>{a.target==='dashboard'?'회원 대시보드':a.target==='all'?'모든 공개 화면':'공개 사이트'}</td><td>{stateOf(a,now)}</td><td>{fmt(a.startsAt)} ~ {fmt(a.endsAt)}</td>
     <td><button className="button secondary" type="button" disabled={busy} onClick={()=>{setCreating(false);setSelected(a);}}>편집<span className="sr-only"> {a.title}</span></button></td>
    </tr>)}</tbody>
   </table>{!result.data.length&&<p className="empty-state">공지가 없습니다. 공지가 없으면 첫 화면은 원래 디자인 그대로 보입니다.</p>}</div>
   <ListPagination pagination={result.pagination} busy={busy} onPage={page=>void run(()=>load(page))}/>
  </section>
  {(creating||selected)&&<Editor key={selected?`${selected.id}:${selected.version}`:'new'} item={selected} busy={busy} run={run} onSaved={saved} onClose={()=>{setSelected(null);setCreating(false);}}/>}
 </div>;
}
