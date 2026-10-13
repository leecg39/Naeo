'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CapturedView from '@/components/captured/CapturedView';
import type { CapturedPageData } from '@/types/site';
import type { InstallBehavior } from '@/lib/behavior';
import { installAuxiliary } from '@/behaviors/auxiliary';
const VIDEO_DURATIONS=[10,35,25,25,25,25,25,25,25,30,25,25,25,25,25,30,20,25,15,35,35,25,20];
export default function StatefulExperience({data}:{data:CapturedPageData}){
 const [state,setState]=useState(data.path==='/mcp'?'default':'slide1');const [auto,setAuto]=useState(true);
 const [elapsed,setElapsed]=useState(0);const [hud,setHud]=useState(true);const activeRoot=useRef<HTMLElement|null>(null);
 const isMcp=data.path==='/mcp',isVideo=data.path==='/youtube/aeo-intro';
 const count=isVideo?23:10;
 const scene=(Number(state.replace('slide',''))||1)-1;
 const next=useCallback((delta:number)=>{setState(s=>{const index=(Number(s.replace('slide',''))||1)-1+delta;return 'slide'+(isVideo?Math.max(0,Math.min(count-1,index))+1:(index+count)%count+1)});setElapsed(0);if(isVideo)setAuto(true)},[count,isVideo]);
 useEffect(()=>{
  if(!isVideo||!auto)return;
  let previous=performance.now();
  const timer=setInterval(()=>{const now=performance.now(),delta=(now-previous)/1000;previous=now;setElapsed(value=>Math.min(VIDEO_DURATIONS[scene],value+delta))},100);
  return()=>clearInterval(timer);
 },[auto,isVideo,scene]);
 useEffect(()=>{if(!isVideo||elapsed<VIDEO_DURATIONS[scene])return;if(scene===count-1)setAuto(false);else next(1)},[count,elapsed,isVideo,next,scene]);
 useEffect(()=>{
  if(!isVideo||!activeRoot.current)return;
  const stage=activeRoot.current.querySelector<HTMLElement>('[data-naeo-video-stage]');if(!stage)return;
  const panels=[...stage.children].slice(2) as HTMLElement[];panels.forEach(panel=>{panel.hidden=!hud;panel.style.visibility=hud?'visible':'hidden'});
  const status=panels.find(panel=>panel.style.top==='32px'&&panel.style.right==='32px');
  const spans=status?.querySelectorAll('span');
  const format=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  if(spans?.[2])spans[2].textContent=`${format(VIDEO_DURATIONS.slice(0,scene).reduce((a,b)=>a+b,0)+elapsed)} / 9:40`;
  if(spans?.[4]){spans[4].textContent=auto?'▶ AUTO':'❚❚ PAUSED';spans[4].style.color=auto?'#03c75a':'#f59e0b'}
  const progress=panels.find(panel=>panel.style.height==='3px')?.firstElementChild as HTMLElement|undefined;
  if(progress)progress.style.width=`${100*elapsed/VIDEO_DURATIONS[scene]}%`;
 },[auto,elapsed,hud,isVideo,scene]);
 const install=useCallback<InstallBehavior>((root,tools)=>{
  activeRoot.current=root;
  if(isVideo){const stage=[...root.querySelectorAll<HTMLElement>('div')].find(el=>el.style.position==='fixed'&&el.style.zIndex==='9999');if(stage)stage.dataset.naeoVideoStage='true'}
  const cleanup=installAuxiliary(root,tools);
  const click=(e:MouseEvent)=>{if(!(e.target instanceof Element))return;const b=e.target.closest('button');if(!b)return;const text=b.textContent?.trim()||'',label=b.getAttribute('aria-label')||'';
   if(isMcp){if(text.includes('내 AI로 직접 쓰기')){e.preventDefault();setState('chatgpt')}else if(text.includes('NAEO가 다 써주기')){e.preventDefault();setState('default')}else if(text==='Claude'||text==='ChatGPT'){e.preventDefault();setState(text.toLowerCase())}else if(text.includes('복사')){e.preventDefault();const container=b.parentElement;const quoted=container?.textContent?.match(/[“"]([^”"]+)[”"]/);const copy=text==='복사'?'https://www.naeo.kr/api/mcp':quoted?.[1]||container?.querySelector('p')?.textContent||'';void navigator.clipboard.writeText(copy).then(()=>tools.toast('복사했습니다.')).catch(()=>tools.toast(copy));}}
   else{const m=label.match(/^슬라이드 (\d+)$/);if(m){e.preventDefault();setState('slide'+m[1])}else if(text==='←'||text==='→'){e.preventDefault();next(text==='←'?-1:1)}}
  };
  const key=(e:KeyboardEvent)=>{if(isMcp||/INPUT|TEXTAREA/.test((e.target as Element)?.tagName))return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();next(e.key==='ArrowRight'?1:-1)}if(isVideo&&(e.code==='Space'||e.key.toLowerCase()==='a')){e.preventDefault();setAuto(x=>!x)}if(isVideo&&e.key.toLowerCase()==='h')setHud(x=>!x);if(isVideo&&(e.key==='Home'||e.key==='End')){e.preventDefault();setState(e.key==='Home'?'slide1':'slide23');setElapsed(0)}};
  root.addEventListener('click',click,true);window.addEventListener('keydown',key);return()=>{cleanup?.();root.removeEventListener('click',click,true);window.removeEventListener('keydown',key)};
 },[isMcp,isVideo,next]);
 const active=useMemo(()=>({...data,body:data.states?.[state]||data.body}),[data,state]);
 return <CapturedView key={state} data={active} install={install}/>;
}
