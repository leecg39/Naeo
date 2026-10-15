'use client';
import {useEffect,useRef,useState} from 'react';
import {FileText,Sparkles,TriangleAlert,Copy,Check,X} from 'lucide-react';
import type {PublicAnnouncement} from '@/server/content/announcements';
import styles from './AnnouncementNotice.module.css';

export default function AnnouncementNotice({announcement:a,onClose,onDismissToday}:{announcement:PublicAnnouncement;onClose:()=>void;onDismissToday:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),timer=useRef<number|null>(null),mounted=useRef(false);
 const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState('');
 useEffect(()=>{
  mounted.current=true;const el=dialog.current;if(el&&!el.open)el.showModal();
  return()=>{mounted.current=false;el?.close();if(timer.current!==null)window.clearTimeout(timer.current);};
 },[a.type]);
 const copy=async()=>{
  try{await navigator.clipboard.writeText(a.metadata.couponCode||'');if(!mounted.current)return;setCopyError('');setCopied(true);if(timer.current!==null)window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>setCopied(false),2000);}
  catch{if(mounted.current)setCopyError('복사하지 못했습니다. 코드를 선택해 직접 복사해주세요.');}
 };
 if(a.type==='maintenance')return <aside className={styles.maintenance} role="alert" aria-live="polite"><TriangleAlert size={18} aria-hidden="true"/><span>{a.title}{a.body&&` · ${a.body}`}</span><button type="button" aria-label="공지 닫기" onClick={onClose}><X size={18}/></button></aside>;
 const blog=a.type==='blog',coupon=a.type==='coupon';
 return <dialog ref={dialog} className={styles.dialog} aria-label={a.title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===dialog.current)onClose();}}>
  <div><header className={styles.header}>{blog?<FileText size={22} aria-hidden="true"/>:!coupon?<Sparkles size={22} aria-hidden="true"/>:null}<h2 className={blog?styles.blogTitle:undefined}>{blog?'새 글이 올라왔어요':a.title}</h2><button type="button" aria-label="공지 닫기" onClick={onClose}><X size={24}/></button></header>
   <div className={styles.body}>{blog&&<h3>{a.title}</h3>}{a.body&&<p>{a.body}</p>}
    {coupon&&a.metadata.couponCode&&<div className={styles.coupon}><code>{a.metadata.couponCode}</code><button type="button" aria-label="쿠폰 코드 복사" onClick={()=>void copy()}>{copied?<Check size={22}/>:<Copy size={22}/>}</button></div>}
    <span role="status" className="sr-only">{copied?'복사했습니다.':''}</span>{copyError&&<p role="alert">{copyError}</p>}
    {a.linkUrl&&<a className={styles.cta} href={a.linkUrl}>{coupon?'쿠폰 사용하기':blog?'읽으러 가기':'자세히 보기'}</a>}
    <button type="button" className={styles.dismiss} onClick={onDismissToday}>오늘 하루 안 보기</button>
   </div>
  </div>
 </dialog>;
}
