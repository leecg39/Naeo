'use client';
import {useState,type FormEvent} from 'react';
import type {Slide} from '@/server/creative/projects';

type Run=(action:()=>Promise<string>)=>void;
/** 슬라이드 한 장 편집: 제목·본문·하단 문구·배경색(비우면 테마 배경). */
export default function SlideEditor({slide,busy,save}:{slide:Slide;busy:boolean;save:(fields:Partial<Slide>)=>ReturnType<Run>}){
 const [f,setF]=useState({heading:slide.heading,body:slide.body,caption:slide.caption,background:slide.background});
 const submit=(e:FormEvent)=>{e.preventDefault();save(f);};
 return <form className="account-form" onSubmit={submit} aria-label={`슬라이드 ${slide.position+1} 편집`}>
  <label>제목<textarea className="field" rows={2} maxLength={120} value={f.heading} onChange={e=>setF({...f,heading:e.target.value})} disabled={busy}/></label>
  <label>본문<textarea className="field" rows={5} maxLength={600} value={f.body} onChange={e=>setF({...f,body:e.target.value})} disabled={busy}/></label>
  <label>하단 문구<input className="field" maxLength={80} value={f.caption} onChange={e=>setF({...f,caption:e.target.value})} disabled={busy}/></label>
  <label className="account-checkbox"><input type="checkbox" checked={!!f.background} onChange={e=>setF({...f,background:e.target.checked?'#1f2937':''})} disabled={busy}/><span>이 장만 배경색 바꾸기</span></label>
  {f.background&&<label>배경색<input type="color" value={f.background} onChange={e=>setF({...f,background:e.target.value.toLowerCase()})} disabled={busy}/></label>}
  <div className="account-actions"><button className="button" type="submit" disabled={busy}>슬라이드 저장</button></div>
 </form>;
}
