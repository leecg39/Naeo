import {kstDateTime} from '@/lib/kst-time';
import {useCallback,useEffect,useState} from 'react';
import {api} from '@/lib/api-client';
import type {ShareLink} from '@/server/writing/shares';

const fmt=(ms:number)=>kstDateTime(ms);

/** 초안 사진 묶음 공유 링크(/p/:token/images): 만들기(1~30일)·복사·철회. */
export default function DraftShares({draftId}:{draftId:string}){
 const [links,setLinks]=useState<ShareLink[]>([]),[days,setDays]=useState(7),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [now,setNow]=useState(0);
 const load=useCallback(async()=>{const next=await api<ShareLink[]>(`/api/drafts/${draftId}/shares`);setLinks(next);setNow(Date.now());},[draftId]);
 useEffect(()=>{let live=true;void api<ShareLink[]>(`/api/drafts/${draftId}/shares`).then(r=>{if(live){setLinks(r);setNow(Date.now());}}).catch(()=>{});return()=>{live=false;};},[draftId]);
 async function run(action:()=>Promise<string>){setBusy(true);try{setMessage(await action());await load();}catch(e){setMessage(e instanceof Error?e.message:'처리하지 못했습니다.');}finally{setBusy(false);}}
 const url=(token:string)=>`${window.location.origin}/p/${token}/images`;
 return <div style={{display:'grid',gap:8}}>
  <strong>사진 공유 링크</strong>
  <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
   <label style={{fontSize:14}}>기간 <select value={days} onChange={e=>setDays(Number(e.target.value))} disabled={busy} style={{font:'inherit'}}>{[1,7,30].map(d=><option key={d} value={d}>{d}일</option>)}</select></label>
   <button type="button" className="naeo-button" disabled={busy} onClick={()=>void run(async()=>{const l=await api<ShareLink>(`/api/drafts/${draftId}/shares`,{method:'POST',body:{days}});try{await navigator.clipboard.writeText(url(l.token));return'공유 링크를 만들고 복사했습니다.';}catch{return'공유 링크를 만들었습니다.';}})}>공유 링크 만들기</button>
  </div>
  {message&&<p role="status" style={{margin:0,fontSize:13}}>{message}</p>}
  <ul style={{listStyle:'none',padding:0,margin:0,display:'grid',gap:6}}>{links.map(l=>{const active=!l.revokedAt&&l.expiresAt>now;return <li key={l.token} style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',fontSize:13}}>
   <a href={`/p/${l.token}/images`} target="_blank" rel="noopener" style={{color:'#03c75a',overflowWrap:'anywhere'}}>/p/{l.token.slice(0,6)}…/images</a>
   <span>{l.revokedAt?'철회됨':active?`${fmt(l.expiresAt)}까지`:'만료'}</span>
   {active&&<button type="button" className="naeo-button" style={{fontSize:12,padding:'2px 8px'}} disabled={busy} onClick={()=>void run(async()=>{await api(`/api/shares/${l.token}`,{method:'DELETE'});return'공유 링크를 철회했습니다.';})}>철회</button>}
  </li>;})}</ul>
 </div>;
}
