'use client';
import {useEffect,useRef,type CSSProperties} from 'react';

/** 편집기 제거로 사라진 포커스만 복구한다. 사용자가 옮긴 포커스는 유지한다. */
export default function OperationNotice({message,className="account-success",style}:{message:string;className?:string;style?:CSSProperties}){
 const notice=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  if(!message)return;
  let frame=0,timer=0;
  const restoreLostFocus=()=>{
   const active=document.activeElement;
   if(!active||active===document.body||!active.isConnected){
    if(notice.current?.isConnected)notice.current.focus();
    return true;
   }
   return false;
  };
  restoreLostFocus();
  // Some async lists commit the notice before the action row disappears.
  // Observe that later commit and restore focus only if it becomes lost.
  const observer=new MutationObserver(()=>{restoreLostFocus();});
  observer.observe(document.body,{childList:true,subtree:true});
  frame=requestAnimationFrame(()=>{restoreLostFocus();});
  timer=window.setTimeout(()=>observer.disconnect(),2000);
  return()=>{observer.disconnect();cancelAnimationFrame(frame);window.clearTimeout(timer);};
 },[message]);
 return message?<p ref={notice} tabIndex={-1} role="status" className={className} style={style}>{message}</p>:null;
}
