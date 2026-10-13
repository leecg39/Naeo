import {useCallback,useEffect,useState} from 'react';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {Media} from '@/server/writing/media';

/** 사진 업로드(multipart). 서버가 형식·크기·수량을 다시 검사한다. */
export async function uploadPhoto(file:File,draftId?:string):Promise<Media>{
 const form=new FormData();form.set('file',file);if(draftId)form.set('draftId',draftId);
 const res=await fetch('/api/media',{method:'POST',body:form,credentials:'same-origin'});
 const json=await res.json();
 if(!res.ok)throw new ApiError(json.error?.message||'사진을 올리지 못했습니다.',json.error?.code||'UNKNOWN',res.status);
 return json.data as Media;
}

/** 이 초안에 연결된 사진: 올리기·연결 해제·삭제. */
export default function DraftMedia({draftId}:{draftId:string}){
 const [items,setItems]=useState<Media[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const load=useCallback(async()=>setItems((await apiResponse<PageResult<Media>>(`/api/media?draftId=${draftId}&pageSize=20`)).data),[draftId]);
 useEffect(()=>{let live=true;void apiResponse<PageResult<Media>>(`/api/media?draftId=${draftId}&pageSize=20`).then(r=>{if(live)setItems(r.data);}).catch(()=>{});return()=>{live=false;};},[draftId]);
 async function run(action:()=>Promise<string>){setBusy(true);try{setMessage(await action());await load();}catch(e){setMessage(e instanceof Error?e.message:'처리하지 못했습니다.');}finally{setBusy(false);}}
 return <div style={{display:'grid',gap:8}}>
  <strong>사진 {items.length}/20</strong>
  <input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="초안에 사진 올리기" disabled={busy||items.length>=20}
   onChange={e=>{const files=[...e.target.files??[]];e.target.value='';void run(async()=>{for(const f of files)await uploadPhoto(f,draftId);return`사진 ${files.length}장을 올렸습니다.`;});}}/>
  {message&&<p role="status" style={{margin:0,fontSize:13}}>{message}</p>}
  <ul style={{listStyle:'none',padding:0,margin:0,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))',gap:10}}>
   {items.map(m=><li key={m.publicId} style={{display:'grid',gap:4}}>
    {/* 인증이 필요한 개인 사진이라 최적화 서버를 거치지 않는다. */}
    <img src={`/api/media/${m.publicId}`} alt={m.originalName||'초안 사진'} style={{width:'100%',aspectRatio:'1',objectFit:'cover',borderRadius:8}}/>
    <div style={{display:'flex',gap:4}}>
     <button type="button" className="naeo-button" style={{fontSize:12,padding:'2px 6px'}} disabled={busy} onClick={()=>void run(async()=>{await api(`/api/media/${m.publicId}`,{method:'PATCH',body:{draftId:null}});return'초안에서 뺐습니다(사진함에는 남습니다).';})}>빼기</button>
     <button type="button" className="naeo-button" style={{fontSize:12,padding:'2px 6px'}} disabled={busy} onClick={()=>{if(window.confirm('사진을 완전히 삭제할까요?'))void run(async()=>{await api(`/api/media/${m.publicId}`,{method:'DELETE'});return'사진을 삭제했습니다.';});}}>삭제<span className="sr-only"> {m.originalName}</span></button>
    </div>
   </li>)}
  </ul>
 </div>;
}
