'use client';
import {kstDateTime} from '@/lib/kst-time';
import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from '@/lib/api-client';
import type {Project} from '@/server/creative/projects';
import type {ExportJob} from '@/server/creative/exports';

/** 서버 SVG를 같은 크기의 캔버스에 그려 PNG로 만든다(브라우저 글꼴로 한글 렌더링). */
async function slidePng(project:Project,slideId:string,index:number):Promise<Blob>{
 const svg=await fetch(`/api/creative/projects/${project.id}/slides/${slideId}.svg?v=${index}`,{cache:'no-store',credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error('슬라이드를 불러오지 못했습니다.');return r.blob();});
 const url=URL.createObjectURL(svg);
 try{
  const img=new Image();img.decoding='async';
  await new Promise<void>((ok,fail)=>{img.onload=()=>ok();img.onerror=()=>fail(new Error('슬라이드 이미지를 그리지 못했습니다.'));img.src=url;});
  const canvas=document.createElement('canvas');canvas.width=project.width;canvas.height=project.height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('캔버스를 쓸 수 없습니다.');
  ctx.drawImage(img,0,0,project.width,project.height);
  return await new Promise<Blob>((ok,fail)=>canvas.toBlob(b=>b?ok(b):fail(new Error('PNG로 바꾸지 못했습니다.')),'image/png'));
 }finally{URL.revokeObjectURL(url);}
}

export default function ExportPanel({project,initial}:{project:Project;initial:ExportJob[]}){
 const [jobs,setJobs]=useState(initial),[progress,setProgress]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [secondsPerSlide,setSecondsPerSlide]=useState(3),[capability,setCapability]=useState<{available:boolean;message:string}|null>(null),[refreshError,setRefreshError]=useState(''),[canceling,setCanceling]=useState<string|null>(null);
 const upload=useRef<{id:string|null;controller:AbortController}|null>(null);
 const active=jobs.some(j=>j.state==='queued'||j.state==='encoding');
 useEffect(()=>{
  let alive=true;
  void api<{mp4:{available:boolean;message:string}}>('/api/creative/export-capabilities').then(c=>{if(alive)setCapability(c.mp4);}).catch(()=>{if(alive)setCapability({available:false,message:'영상 내보내기 상태를 확인하지 못했습니다. 새로고침해 주세요.'});});
  return()=>{alive=false;upload.current?.controller.abort();};
 },[]);
 useEffect(()=>{
  if(!active)return;
  let alive=true,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   try{const next=await api<ExportJob[]>(`/api/creative/projects/${project.id}/exports`);if(alive){setJobs(next);setRefreshError('');}}
   catch{if(alive)setRefreshError('진행 상태를 확인하지 못했습니다. 연결되면 다시 불러옵니다.');}
   if(alive)timer=setTimeout(()=>void poll(),2000);
  };
  timer=setTimeout(()=>void poll(),1000);
  return()=>{alive=false;clearTimeout(timer);};
 },[active,project.id]);
 const updateJob=(job:ExportJob)=>setJobs(current=>[job,...current.filter(j=>j.id!==job.id)].slice(0,10));
 async function run(format:'pdf'|'zip'|'mp4'){
  if(upload.current)return;
  setBusy(true);setError('');
  const controller=new AbortController();upload.current={id:null,controller};
  try{
   const job=await api<ExportJob>(`/api/creative/projects/${project.id}/exports`,{method:'POST',body:{format,...(format==='mp4'?{secondsPerSlide}:{})}});
   controller.signal.throwIfAborted();
   upload.current.id=job.id;updateJob(job);
   for(const [i,s] of project.slides.entries()){
    controller.signal.throwIfAborted();
    setProgress(`${i+1} / ${project.slides.length}장 변환·업로드 중…`);
    const r=await fetch(`/api/creative/exports/${job.id}/pages/${i}`,{method:'PUT',headers:{'Content-Type':'image/png'},body:await slidePng(project,s.id,i),credentials:'same-origin',signal:controller.signal});
    if(!r.ok)throw new ApiError((await r.json()).error?.message??'업로드하지 못했습니다.','UPLOAD_FAILED',r.status);
    const uploaded=(await r.json()).data as ExportJob;
    if(!controller.signal.aborted)updateJob(uploaded);
   }
   controller.signal.throwIfAborted();
   setProgress('파일을 만드는 중…');
   const completed=await api<ExportJob>(`/api/creative/exports/${job.id}/complete`,{method:'POST',body:{}});
   updateJob(completed);
   setProgress(format==='mp4'?'장면 전송을 마쳤습니다. 영상은 백그라운드에서 만들어집니다.':'파일을 만들었습니다. 아래에서 내려받으세요.');
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'내보내지 못했습니다.');setProgress('');}
  finally{upload.current=null;setBusy(false);}
 }
 async function cancel(job:ExportJob){
  setCanceling(job.id);setError('');
  try{
   const canceled=await api<ExportJob>(`/api/creative/exports/${job.id}`,{method:'DELETE'});
   if(upload.current?.id===job.id)upload.current.controller.abort();
   updateJob(canceled);setProgress('내보내기를 취소했습니다.');
  }catch(e){setError(e instanceof Error?e.message:'취소하지 못했습니다.');}
  finally{setCanceling(null);}
 }
 const day=(ms:number)=>kstDateTime(ms,{seconds:true});
 return <main className="account-login" style={{maxWidth:760}}>
  <div className="panel account-card">
   <p className="eyebrow">EXPORT</p><h1 className="page-heading">{project.title} 내보내기</h1>
   <p className="muted">{project.slides.length}장 · {project.width}×{project.height}px. PDF, PNG 묶음(ZIP), MP4 영상으로 저장할 수 있어요. 완성된 파일은 7일 보관돼요.</p>
   <div className="account-actions"><button className="button" type="button" disabled={busy} onClick={()=>void run('pdf')}>PDF로 내보내기</button><button className="button secondary" type="button" disabled={busy} onClick={()=>void run('zip')}>PNG 묶음(ZIP)</button><a className="button secondary" href="/dashboard/social">편집으로 돌아가기</a></div>
   <fieldset style={{border:'1px solid var(--border, #444)',borderRadius:12,padding:16,margin:'20px 0',minWidth:0}}>
    <legend>MP4 영상</legend>
    <label htmlFor="export-slide-seconds">장면당 재생 시간</label>{' '}
    <select id="export-slide-seconds" value={secondsPerSlide} disabled={busy} onChange={e=>setSecondsPerSlide(Number(e.target.value))} style={{padding:8,maxWidth:'100%',color:'inherit',background:'var(--surface, #202020)',border:'1px solid var(--border, #555)',borderRadius:6}}>
     {Array.from({length:30},(_,i)=>i+1).map(s=><option key={s} value={s}>{s}초</option>)}
    </select>
    <p className="muted" id="export-video-description">총 {project.slides.length*secondsPerSlide}초 · 무음. 각 장면이 순서대로 표시돼요. 장면 전송 후에는 다른 화면으로 이동해도 영상 만들기가 계속돼요.</p>
    <button className="button" type="button" aria-describedby="export-video-description export-video-availability" disabled={busy||!capability?.available||active} onClick={()=>void run('mp4')}>MP4로 내보내기</button>
    <p className="muted" id="export-video-availability">{capability===null?'영상 내보내기를 확인하는 중…':!capability.available?capability.message:active?'진행 중인 영상이 완료되면 새 영상을 만들 수 있어요.':'MP4 영상은 소리와 장면 전환 효과 없이 저장돼요.'}</p>
   </fieldset>
   <div aria-live="polite">{progress&&<p role="status">{progress}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>
   {refreshError&&<p role="status" className="account-error">{refreshError}</p>}
   <h2 style={{fontSize:18}}>최근 내보내기</h2>
   {jobs.length?<ul style={{listStyle:'none',padding:0,display:'grid',gap:8}} aria-label="최근 내보내기" aria-live="polite">{jobs.map(j=><li key={j.id} data-export-state={j.state}>
    <span>{j.format.toUpperCase()} · {day(j.createdAt)} · </span>
    {j.state==='succeeded'?<a href={`/api/creative/exports/${j.id}/file`}>{j.format.toUpperCase()} 내려받기 ({Math.ceil((j.fileSize??0)/1024)}KB)</a>:j.state==='failed'?<span className="account-error">실패: {j.error} 위에서 다시 내보낼 수 있어요.</span>:j.state==='canceled'?<span>취소됨</span>:j.state==='queued'?<span>영상 만들기 대기 중</span>:j.state==='encoding'?<span>영상 만드는 중 <progress max={100} value={j.progress} aria-label="영상 변환 진행률"/> {j.progress}%</span>:<span>장면 전송 {j.received}/{j.slideCount}</span>}
    {(j.state==='collecting'||j.state==='queued'||j.state==='encoding')&&<button type="button" className="button secondary" style={{marginLeft:8,padding:'6px 12px'}} disabled={canceling===j.id} aria-label={`${j.format.toUpperCase()} 내보내기 취소`} onClick={()=>void cancel(j)}>{canceling===j.id?'취소 중…':'취소'}</button>}
   </li>)}</ul>:<p className="muted">아직 내보낸 파일이 없어요.</p>}
  </div>
 </main>;
}
