'use client';
import OperationNotice from './OperationNotice';
import {kstDate} from '@/lib/kst-time';
import {useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {Keyword,Metric} from '@/server/keywords/records';
import {classify} from '@/server/keywords/records';

type Row=Keyword&{latest:Metric|null};
type Detail=Keyword&{metrics:Metric[];latest:Metric|null};
const fmt=(ms:number)=>kstDate(ms);
const num=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('ko-KR');

function MetricForm({keyword,busy,run,onSaved}:{keyword:Detail;busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onSaved:(m:string)=>Promise<void>}){
 const [pc,setPc]=useState(''),[mobile,setMobile]=useState(''),[docs,setDocs]=useState('');
 const submit=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  await api(`/api/admin/keywords/${keyword.id}/metrics`,{method:'POST',body:{pcVolume:Number(pc),mobileVolume:Number(mobile),documentCount:Number(docs)}});
  setPc('');setMobile('');setDocs('');await onSaved('지표를 기록했습니다.');
 });};
 const remove=(m:Metric)=>void run(async()=>{await api(`/api/admin/keywords/${keyword.id}/metrics/${m.id}`,{method:'DELETE'});await onSaved('지표를 삭제했습니다.');});
 return <div style={{marginTop:20}}>
  <h3>지표 이력</h3>
  <p className="muted">네이버 검색광고 API가 설정되지 않아 관리자가 확인한 월간 검색량·문서수를 직접 기록합니다(출처: 관리자 입력).</p>
  <form className="admin-filters" onSubmit={submit}>
   <label>PC 검색량<input className="field" type="number" min={0} required value={pc} onChange={e=>setPc(e.target.value)} disabled={busy}/></label>
   <label>모바일 검색량<input className="field" type="number" min={0} required value={mobile} onChange={e=>setMobile(e.target.value)} disabled={busy}/></label>
   <label>문서수<input className="field" type="number" min={0} required value={docs} onChange={e=>setDocs(e.target.value)} disabled={busy}/></label>
   <button className="button" type="submit" disabled={busy}>지표 기록</button>
  </form>
  <div className="responsive-table"><table className="data-table"><caption className="sr-only">지표 이력</caption>
   <thead><tr><th>측정일</th><th>PC</th><th>모바일</th><th>문서수</th><th>포화도</th><th>출처</th><th>관리</th></tr></thead>
   <tbody>{keyword.metrics.map(m=><tr key={m.id}><td>{fmt(m.measuredAt)}</td><td>{num(m.pcVolume)}</td><td>{num(m.mobileVolume)}</td><td>{num(m.documentCount)}</td>
    <td>{classify(m).saturation??'—'}</td><td>{m.source==='manual'?'관리자 입력':'검색광고 API'}</td>
    <td><button className="button secondary" type="button" disabled={busy} onClick={()=>remove(m)}>삭제<span className="sr-only"> {fmt(m.measuredAt)} 지표</span></button></td></tr>)}</tbody>
  </table>{!keyword.metrics.length&&<p className="empty-state">아직 지표가 없습니다. 지표가 없으면 추천 화면에 '—'로 보입니다.</p>}</div>
 </div>;
}

function Editor({item,busy,run,onSaved,onClose}:{item:Detail|null;busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onSaved:(id:string|null,m:string)=>Promise<void>;onClose:()=>void}){
 const [phrase,setPhrase]=useState(item?.phrase??''),[category,setCategory]=useState(item?.category??''),[note,setNote]=useState(item?.note??''),[status,setStatus]=useState<Keyword['status']>(item?.status??'active'),[confirming,setConfirming]=useState(false);
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  if(item){await api(`/api/admin/keywords/${item.id}`,{method:'PATCH',body:{phrase,category,note,status,version:item.version}});await onSaved(item.id,'저장했습니다.');}
  else{const k=await api<Keyword>('/api/admin/keywords',{method:'POST',body:{phrase,category,note,status}});await onSaved(k.id,'키워드를 만들었습니다. 지표를 기록해주세요.');}
 });};
 const remove=()=>void run(async()=>{if(!item)return;await api(`/api/admin/keywords/${item.id}`,{method:'DELETE',body:{version:item.version}});await onSaved(null,'키워드를 삭제했습니다.');});
 return <section className="panel account-card" aria-label={item?'키워드 편집':'새 키워드'}>
  <h2>{item?'키워드 편집':'새 키워드'}</h2>
  {item&&<p className="muted">버전 {item.version} · 등록 {fmt(item.createdAt)}</p>}
  <form className="account-form" onSubmit={save}>
   <label>키워드<input className="field" value={phrase} onChange={e=>setPhrase(e.target.value)} required maxLength={60} disabled={busy}/></label>
   <label>분류<input className="field" value={category} onChange={e=>setCategory(e.target.value)} maxLength={30} disabled={busy}/></label>
   <label>메모(관리용)<input className="field" value={note} onChange={e=>setNote(e.target.value)} maxLength={200} disabled={busy}/></label>
   <label>상태<select className="field" value={status} onChange={e=>setStatus(e.target.value as Keyword['status'])} disabled={busy}><option value="active">추천에 노출</option><option value="hidden">숨김</option></select></label>
   <div className="account-actions">
    <button className="button" type="submit" disabled={busy}>{item?'저장':'키워드 만들기'}</button>
    {item&&!confirming&&<button className="button secondary" type="button" disabled={busy} onClick={()=>setConfirming(true)}>삭제</button>}
    {item&&confirming&&<button className="button" type="button" disabled={busy} onClick={remove}>삭제 확인(지표·회원 표시도 삭제)</button>}
    <button className="button secondary" type="button" disabled={busy} onClick={onClose}>닫기</button>
   </div>
  </form>
  {item&&<MetricForm keyword={item} busy={busy} run={run} onSaved={m=>onSaved(item.id,m)}/>}
 </section>;
}

export default function KeywordsManager({initial}:{initial:PageResult<Row>}){
 const router=useRouter();
 const [result,setResult]=useState(initial),[q,setQ]=useState(''),[status,setStatus]=useState('');
 const [selected,setSelected]=useState<Detail|null>(null),[creating,setCreating]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const totalPages=Math.max(1,Math.ceil(result.pagination.total/result.pagination.pageSize));
 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/keywords');router.refresh();}}
  finally{setBusy(false);}
 }
 const load=async(page=result.pagination.page)=>setResult(await apiResponse<PageResult<Row>>(`/api/admin/keywords?${new URLSearchParams({page:String(page),pageSize:'20',q,...(status?{status}:{})})}`));
 const open=(id:string)=>run(async()=>{setCreating(false);setSelected(await api<Detail>(`/api/admin/keywords/${id}`));});
 const saved=async(id:string|null,m:string)=>{setCreating(false);setSelected(id?await api<Detail>(`/api/admin/keywords/${id}`):null);await load();setNotice(m);};
 return <div className="settings-sections">
  <div aria-live="polite"><OperationNotice message={notice}/>{error&&<div role="alert" className="account-error">{error} {selected&&<button className="button secondary" type="button" disabled={busy} onClick={()=>void open(selected.id)}>최신 정보 불러오기</button>}</div>}</div>
  <section className="panel account-card">
   <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(()=>load(1));}}>
    <label>키워드 검색<input className="field" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="키워드·분류" disabled={busy}/></label>
    <label>상태<select className="field" value={status} onChange={e=>setStatus(e.target.value)} disabled={busy}><option value="">전체</option><option value="active">노출</option><option value="hidden">숨김</option></select></label>
    <button className="button" type="submit" disabled={busy}>검색</button>
    <button className="button secondary" type="button" disabled={busy} onClick={()=>{setSelected(null);setCreating(true);}}>새 키워드</button>
   </form>
   <p className="muted" style={{marginTop:16}}>총 {result.pagination.total}개 · 황금 키워드(포화도 1 미만·검색량 1,000 이상)와 선점기회(포화도 3 미만·검색량 300 이상)는 이 복제본의 새 규칙입니다.</p>
   <div className="responsive-table"><table className="data-table"><caption className="sr-only">키워드 목록</caption>
    <thead><tr><th>키워드</th><th>분류</th><th>상태</th><th>검색량</th><th>문서수</th><th>포화도</th><th>관리</th></tr></thead>
    <tbody>{result.data.map(k=>{const c=classify(k.latest);return <tr key={k.id}>
     <td><strong>{k.phrase}</strong>{c.golden?' 🏆':c.preempt?' 🔍':''}</td><td>{k.category||'—'}</td><td>{k.status==='active'?'노출':'숨김'}</td>
     <td>{num(c.total)}</td><td>{num(k.latest?.documentCount)}</td><td>{c.saturation??'—'}</td>
     <td><button className="button secondary" type="button" disabled={busy} onClick={()=>void open(k.id)}>편집<span className="sr-only"> {k.phrase}</span></button></td>
    </tr>;})}</tbody>
   </table>{!result.data.length&&<p className="empty-state">키워드가 없습니다.</p>}</div>
   <div className="account-actions" style={{marginTop:20}}>
    <button type="button" className="button secondary" disabled={busy||result.pagination.page<=1} onClick={()=>void run(()=>load(result.pagination.page-1))}>이전</button>
    <span aria-live="polite">{result.pagination.page} / {totalPages}</span>
    <button type="button" className="button secondary" disabled={busy||result.pagination.page>=totalPages} onClick={()=>void run(()=>load(result.pagination.page+1))}>다음</button>
   </div>
  </section>
  {(creating||selected)&&<Editor key={selected?`${selected.id}:${selected.version}:${selected.metrics.length}`:'new'} item={selected} busy={busy} run={run} onSaved={saved} onClose={()=>{setSelected(null);setCreating(false);}}/>}
 </div>;
}
