'use client';
import {useEffect,useRef} from 'react';

/** 편집기 제거로 사라진 포커스만 복구한다. 사용자가 옮긴 포커스는 유지한다. */
export default function OperationNotice({message}:{message:string}){
 const notice=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  if(message&&document.activeElement===document.body)notice.current?.focus();
 },[message]);
 return message?<p ref={notice} tabIndex={-1} role="status" className="account-success">{message}</p>:null;
}
