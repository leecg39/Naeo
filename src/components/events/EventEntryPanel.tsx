'use client';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {createPortal} from 'react-dom';
import {api,ApiError} from '@/lib/api-client';

type Entry={id:string;proofUrl:string;note:string;status:'submitted'|'approved'|'rejected'|'withdrawn';reviewNote:string;version:number};
type Host={el:HTMLElement;slug:string;phase:string;requiresProof:boolean;next:string};
const STATUS:Record<Entry['status'],string>={submitted:'심사 대기 중',approved:'승인됨',rejected:'반려됨',withdrawn:'철회함'};
const box={display:'grid',gap:12,padding:20,border:'1px solid #e5e5e5',borderRadius:16,maxWidth:640} as const;
const input={padding:'10px 12px',border:'1px solid #d4d4d4',borderRadius:10,fontSize:15,width:'100%'} as const;
const button={padding:'10px 18px',borderRadius:999,border:0,background:'#03c75a',color:'#fff',fontWeight:700,cursor:'pointer'} as const;
const secondary={...button,background:'#f5f5f5',color:'#171717'} as const;

function Panel({host}:{host:Host}){
 const [entry,setEntry]=useState<Entry|null>(null),[state,setState]=useState<'loading'|'guest'|'ready'>('loading');
 const [proofUrl,setProofUrl]=useState(''),[note,setNote]=useState(''),[editing,setEditing]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{
  try{const e=await api<Entry|null>(`/api/events/${host.slug}/entry`);setEntry(e);setProofUrl(e?.proofUrl??'');setNote(e?.note??'');setState('ready');}
  catch(e){if(e instanceof ApiError&&e.status===401)setState('guest');else{setError(e instanceof Error?e.message:'불러오지 못했습니다.');setState('ready');}}
 },[host.slug]);
 useEffect(()=>{const t=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(t);},[load]);
 async function run(action:()=>Promise<string>){
  setBusy(true);setError('');setNotice('');
  try{const message=await action();await load();setEditing(false);setNotice(message);}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');}
  finally{setBusy(false);}
 }
 const fields={...(proofUrl.trim()?{proofUrl:proofUrl.trim()}:{}),note};
 const submit=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  if(entry)await api(`/api/event-entries/${entry.id}`,{method:'PATCH',body:{...fields,version:entry.version}});
  else await api(`/api/events/${host.slug}/entries`,{method:'POST',body:fields});
  return entry?'참여 내용을 고쳤습니다.':'참여했습니다. 운영자 심사 후 결과를 알려드려요.';
 });};
 const withdraw=()=>void run(async()=>{await api(`/api/event-entries/${entry!.id}/withdraw`,{method:'POST',body:{version:entry!.version}});return '참여를 철회했습니다.';});
 const open=host.phase==='open';
 if(state==='loading')return <p role="status">참여 정보를 불러오는 중…</p>;
 if(state==='guest')return <div style={box}><p style={{margin:0}}>로그인하면 이 이벤트에 참여할 수 있어요.</p><a href={`/login?next=${encodeURIComponent(host.next)}`} style={{...button,textDecoration:'none',justifySelf:'start'}}>로그인하고 참여하기</a></div>;
 const form=<form onSubmit={submit} style={{display:'grid',gap:10}} aria-label="이벤트 참여">
  <label style={{display:'grid',gap:6}}>인증할 블로그 글 주소{host.requiresProof?' (필수)':' (선택)'}
   <input style={input} value={proofUrl} onChange={e=>setProofUrl(e.target.value)} placeholder="https://blog.naver.com/내아이디/글번호" required={host.requiresProof} maxLength={300} disabled={busy} inputMode="url"/></label>
  <label style={{display:'grid',gap:6}}>남길 말 (선택)<textarea style={input} value={note} onChange={e=>setNote(e.target.value)} maxLength={500} rows={3} disabled={busy}/></label>
  <p style={{margin:0,fontSize:13,color:'#737373'}}>설정에 등록한 내 네이버 블로그의 글만 인증할 수 있어요.</p>
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button style={button} type="submit" disabled={busy}>{entry?'저장':'참여하기'}</button>{entry&&<button style={secondary} type="button" disabled={busy} onClick={()=>setEditing(false)}>취소</button>}</div>
 </form>;
 return <div style={box}>
  <div aria-live="polite">{notice&&<p role="status" style={{margin:0,color:'#03a14a'}}>{notice}</p>}{error&&<p role="alert" style={{margin:0,color:'#dc2626'}}>{error}</p>}</div>
  {entry?<>
   <p style={{margin:0}}><strong>내 참여: {STATUS[entry.status]}</strong></p>
   {entry.proofUrl&&<p style={{margin:0,wordBreak:'break-all'}}>인증 글: <a href={entry.proofUrl} target="_blank" rel="noopener noreferrer">{entry.proofUrl}</a></p>}
   {entry.reviewNote&&<p style={{margin:0}}>심사 메모: {entry.reviewNote}</p>}
   {entry.status==='submitted'&&open&&!editing&&<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button style={button} type="button" disabled={busy} onClick={()=>setEditing(true)}>고치기</button><button style={secondary} type="button" disabled={busy} onClick={withdraw}>참여 철회</button></div>}
   {editing&&form}
  </>:open?form:<p style={{margin:0}}>{host.phase==='upcoming'?'아직 참여 기간 전이에요.':'참여 기간이 끝났어요.'}</p>}
 </div>;
}

/** 이벤트 상세의 data-event-entry 자리에 참여 영역을 붙인다. */
export default function EventEntryPanel(){
 const [host,setHost]=useState<Host|null>(null);
 useEffect(()=>{const t=window.setTimeout(()=>{
  const el=document.querySelector<HTMLElement>('[data-event-entry]');
  if(el)setHost({el,slug:el.dataset.eventEntry??'',phase:el.dataset.phase??'',requiresProof:el.dataset.requiresProof==='true',next:el.dataset.loginNext??'/event'});
 },0);return()=>window.clearTimeout(t);},[]);
 if(!host)return null;
 return createPortal(<Panel host={host}/>,host.el);
}
