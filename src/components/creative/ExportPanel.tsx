'use client';
import {kstDateTime} from '@/lib/kst-time';
import {useState} from 'react';
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
 async function run(format:'pdf'|'zip'){
  setBusy(true);setError('');
  try{
   const job=await api<ExportJob>(`/api/creative/projects/${project.id}/exports`,{method:'POST',body:{format}});
   for(const [i,s] of project.slides.entries()){
    setProgress(`${i+1} / ${project.slides.length}장 변환·업로드 중…`);
    const r=await fetch(`/api/creative/exports/${job.id}/pages/${i}`,{method:'PUT',headers:{'Content-Type':'image/png'},body:await slidePng(project,s.id,i),credentials:'same-origin'});
    if(!r.ok)throw new ApiError((await r.json()).error?.message??'업로드하지 못했습니다.','UPLOAD_FAILED',r.status);
   }
   setProgress('파일을 만드는 중…');
   await api(`/api/creative/exports/${job.id}/complete`,{method:'POST',body:{}});
   setProgress('완료했어요.');
  }catch(e){setError(e instanceof Error?e.message:'내보내지 못했습니다.');setProgress('');}
  finally{setJobs(await api<ExportJob[]>(`/api/creative/projects/${project.id}/exports`).catch(()=>jobs));setBusy(false);}
 }
 const day=(ms:number)=>kstDateTime(ms,{seconds:true});
 return <main className="account-login" style={{maxWidth:760}}>
  <div className="panel account-card">
   <p className="eyebrow">EXPORT</p><h1 className="page-heading">{project.title} 내보내기</h1>
   <p className="muted">{project.slides.length}장 · {project.width}×{project.height}px. 이 브라우저에서 PNG로 그린 뒤 서버가 검증해 PDF(장마다 한 페이지) 또는 PNG 묶음(ZIP)을 만들어요. 파일은 7일 보관돼요. 영상 파일은 지원하지 않아요.</p>
   <div className="account-actions"><button className="button" type="button" disabled={busy} onClick={()=>void run('pdf')}>PDF로 내보내기</button><button className="button secondary" type="button" disabled={busy} onClick={()=>void run('zip')}>PNG 묶음(ZIP)</button><a className="button secondary" href="/dashboard/social">편집으로 돌아가기</a></div>
   <div aria-live="polite">{progress&&<p role="status">{progress}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>
   <h2 style={{fontSize:18}}>최근 내보내기</h2>
   {jobs.length?<ul style={{listStyle:'none',padding:0,display:'grid',gap:8}} aria-label="최근 내보내기">{jobs.map(j=><li key={j.id} data-export-state={j.state}>
    {j.format.toUpperCase()} · {day(j.createdAt)} · {j.state==='succeeded'?<a href={`/api/creative/exports/${j.id}/file`}>내려받기 ({Math.ceil((j.fileSize??0)/1024)}KB)</a>:j.state==='failed'?<span className="account-error">실패: {j.error}</span>:<span>진행 중 {j.received}/{j.slideCount}</span>}
   </li>)}</ul>:<p className="muted">아직 내보낸 파일이 없어요.</p>}
  </div>
 </main>;
}
