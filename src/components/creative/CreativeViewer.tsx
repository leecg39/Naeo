'use client';
import {useCallback,useEffect,useState} from 'react';
import type {Project} from '@/server/creative/projects';

/** 내 프로젝트 보기: 서버가 그린 SVG를 원래 비율로 넘겨 본다(←/→ 키, 버튼). */
export default function CreativeViewer({project}:{project:Project}){
 const [i,setI]=useState(0),n=project.slides.length;
 const go=useCallback((d:number)=>setI(v=>Math.max(0,Math.min(n-1,v+d))),[n]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='ArrowRight')go(1);if(e.key==='ArrowLeft')go(-1);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[go]);
 const s=project.slides[i];
 return <main style={{minHeight:'100vh',background:'#0a0a0a',color:'#fff',display:'grid',placeItems:'center',padding:16,gap:12}}>
  <h1 style={{fontSize:18,margin:0}}>{project.title}</h1>
  <img src={`/api/creative/projects/${project.id}/slides/${s.id}.svg?v=${s.version}-${project.version}-${i}`} alt={`슬라이드 ${i+1}: ${s.heading}`} data-slide-index={i} style={{maxWidth:'min(100%,720px)',maxHeight:'75vh',width:'auto',height:'auto',borderRadius:12,aspectRatio:`${project.width}/${project.height}`}}/>
  <nav aria-label="슬라이드 이동" style={{display:'flex',gap:12,alignItems:'center'}}>
   <button type="button" onClick={()=>go(-1)} disabled={i===0} aria-label="이전 슬라이드" style={{padding:'8px 16px',borderRadius:999}}>←</button>
   <span aria-live="polite">{i+1} / {n}</span>
   <button type="button" onClick={()=>go(1)} disabled={i===n-1} aria-label="다음 슬라이드" style={{padding:'8px 16px',borderRadius:999}}>→</button>
  </nav>
  <a href="/dashboard/social" style={{color:'#03c75a'}}>소셜 제작으로 돌아가기</a>
 </main>;
}
