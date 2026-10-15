'use client';
import ListPagination from '../admin/ListPagination';
import {loadValidPage} from '../admin/pagination';
import {kstDateTime} from '@/lib/kst-time';
import {useCallback,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {Media} from '@/server/writing/media';
import {uploadPhoto} from './DraftMedia';

const grid={listStyle:'none',padding:0,margin:0,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:12} as const;
const img={width:'100%',aspectRatio:'1',objectFit:'cover',borderRadius:10,display:'block'} as const;
const KB=(n:number)=>`${Math.max(1,Math.round(n/1024))}KB`;
/** 캡처한 /images 화면의 업로드 카드. 이 화면에는 main이 없어 카드 안에 붙인다. */
const CARD='.mui-y1kssf';
function useMain(){
 const [host,setHost]=useState<HTMLElement|null>(null);
 useEffect(()=>{const t=window.setTimeout(()=>setHost(document.querySelector<HTMLElement>('main')??document.querySelector<HTMLElement>(CARD)??document.body),0);return()=>window.clearTimeout(t);},[]);
 return host;
}

function Library(){
 const [items,setItems]=useState<PageResult<Media>|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[signedOut,setSignedOut]=useState(false);
 const load=useCallback(async(page=1)=>{
  const next=await loadValidPage(p=>apiResponse<PageResult<Media>>(`/api/media?page=${p}&pageSize=100`),page);
  setItems(next);setSignedOut(false);
 },[]);
 const run=useCallback(async(action:()=>Promise<string>,page=1)=>{setBusy(true);setMessage('');try{const result=await action();await load(page);setMessage(result);}catch(e){if(e instanceof ApiError&&e.status===401)setSignedOut(true);else setMessage(e instanceof Error?e.message:'처리하지 못했습니다.');}finally{setBusy(false);}},[load]);
 useEffect(()=>{const t=window.setTimeout(()=>void run(async()=>''),0);return()=>window.clearTimeout(t);},[run]);
 // 캡처 화면의 원래 업로드 영역(끌어놓기 상자·숨은 파일 입력)도 실제 업로드로 연결한다.
 useEffect(()=>{
  const card=document.querySelector<HTMLElement>(CARD);
  const input=card?.querySelector<HTMLInputElement>(':scope > input[type=file]'),zone=card?.querySelector<HTMLElement>('.mui-1ko6mrb');
  if(!input)return;
  const pick=()=>input.click();
  const change=()=>{const files=[...input.files??[]];input.value='';if(files.length)void run(async()=>{for(const f of files)await uploadPhoto(f);return`사진 ${files.length}장을 올렸습니다.`;});};
  zone?.addEventListener('click',pick);input.addEventListener('change',change);
  return()=>{zone?.removeEventListener('click',pick);input.removeEventListener('change',change);};
 },[run]);
 if(signedOut)return <p>로그인하면 내 사진함을 볼 수 있습니다. <a href="/login?next=%2Fimages" style={{color:'#03c75a'}}>로그인</a></p>;
 return <div style={{display:'grid',gap:12}}>
  <h2 style={{margin:0,fontSize:20}}>내 사진함 {items?`(${items.pagination.total})`:''}</h2>
  <p style={{margin:0,fontSize:13,color:'#a3a3a3'}}>JPG·PNG·WEBP, 10MB 이하. 사진은 본인만 볼 수 있고, 공유 링크를 만든 글의 사진만 링크로 열 수 있습니다.</p>
  <input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="사진 올리기" disabled={busy}
   onChange={e=>{const files=[...e.target.files??[]];e.target.value='';void run(async()=>{for(const f of files)await uploadPhoto(f);return`사진 ${files.length}장을 올렸습니다.`;});}}/>
  {message&&<p role="status" style={{margin:0}}>{message}</p>}
  <ul style={grid}>{items?.data.map(m=><li key={m.publicId} style={{display:'grid',gap:6}}>
   {/* 로그인한 본인만 받는 개인 사진 */}
   <img src={`/api/media/${m.publicId}`} alt={m.originalName||'내 사진'} style={img}/>
   <span style={{fontSize:12,color:'#a3a3a3'}}>{m.draftId?'초안에 연결됨':'연결 안 됨'} · {KB(m.size)}</span>
   <button type="button" className="naeo-button" disabled={busy} onClick={()=>{if(window.confirm('사진을 삭제할까요?'))void run(async()=>{await api(`/api/media/${m.publicId}`,{method:'DELETE'});return'사진을 삭제했습니다.';},items?.pagination.page);}}>삭제<span className="sr-only"> {m.originalName}</span></button>
  </li>)}</ul>
  {items&&!items.data.length&&<p style={{color:'#a3a3a3'}}>아직 올린 사진이 없습니다.</p>}
  {items&&<ListPagination label="내 사진함 페이지" pagination={items.pagination} busy={busy} onPage={page=>void run(async()=>'',page)}/>}
 </div>;
}

type Shared={title:string;expiresAt:number;images:{publicId:string;mime:string;size:number}[]};
function SharedGallery({token}:{token:string}){
 const [view,setView]=useState<Shared|null>(null),[error,setError]=useState('');
 // 공유 링크는 보기 전용이라 캡처 화면의 업로드 안내·입력을 숨긴다.
 useEffect(()=>{
  const hidden=[...document.querySelectorAll<HTMLElement>(`${CARD} > :not(section)`)];
  hidden.forEach(el=>{el.dataset.prevDisplay=el.style.display;el.style.display='none';});
  return()=>hidden.forEach(el=>{el.style.display=el.dataset.prevDisplay??'';});
 },[]);
 useEffect(()=>{let live=true;void api<Shared>(`/api/shares/${token}`).then(v=>{if(live)setView(v);}).catch(e=>{if(live)setError(e instanceof Error?e.message:'공유 링크를 열지 못했습니다.');});return()=>{live=false;};},[token]);
 if(error)return <p role="alert">{error}</p>;
 if(!view)return <p role="status">불러오는 중…</p>;
 return <div style={{display:'grid',gap:12}}>
  <h2 style={{margin:0,fontSize:20,overflowWrap:'anywhere'}}>{view.title}</h2>
  <p style={{margin:0,fontSize:13,color:'#a3a3a3'}}>공유 사진 {view.images.length}장 · {kstDateTime(view.expiresAt)}까지 열 수 있습니다.</p>
  <ul style={grid}>{view.images.map((m,i)=><li key={m.publicId}>
   {/* 공유 토큰으로만 받는 사진 */}
   <img src={`/api/shares/${token}/media/${m.publicId}`} alt={`공유 사진 ${i+1}`} style={img}/>
  </li>)}</ul>
  {!view.images.length&&<p style={{color:'#a3a3a3'}}>이 글에 연결된 사진이 없습니다.</p>}
 </div>;
}

const wrap=(child:React.ReactNode)=><section style={{maxWidth:1100,margin:'32px auto',padding:'0 16px'}}>{child}</section>;
export function ImagesLibrary(){const host=useMain();return host?createPortal(wrap(<Library/>),host):null;}
export function SharedImages({token}:{token:string}){const host=useMain();return host?createPortal(wrap(<SharedGallery token={token}/>),host):null;}
