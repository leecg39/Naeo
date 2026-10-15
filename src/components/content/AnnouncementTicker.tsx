'use client';
import {useEffect,useState,type CSSProperties} from 'react';
import {usePathname} from 'next/navigation';
import type {PublicAnnouncement} from '@/server/content/announcements';
import styles from './AnnouncementTicker.module.css';

const icons:Record<string,{src:string;alt:string}>={
 coffee:{src:'/event/review-2026-09/icon-coffee.webp',alt:'스타벅스 아메리카노'},
 airpods:{src:'/event/review-2026-09/icon-earbuds.webp',alt:'에어팟 프로'},
 ipad:{src:'/event/review-2026-09/icon-tablet.webp',alt:'아이패드 에어'},
};
/** 원본의 헤더 측정·지연 재측정과 resize 갱신. 헤더가 없으면 띠를 숨긴다. */
function useHeaderHeight(){
 const [height,setHeight]=useState(0);
 useEffect(()=>{
  const measure=()=>{const h=Math.round(document.querySelector('body header')?.getBoundingClientRect().height??0);if(h>0)setHeight(h);};
  const frame=requestAnimationFrame(measure),timers=[150,600,1500,3000].map(ms=>window.setTimeout(measure,ms));
  window.addEventListener('resize',measure);
  return()=>{cancelAnimationFrame(frame);timers.forEach(window.clearTimeout);window.removeEventListener('resize',measure);};
 },[]);
 return height;
}
export default function AnnouncementTicker({announcement:a,onDismissToday}:{announcement:PublicAnnouncement;onDismissToday:()=>void}){
 const path=usePathname(),height=useHeaderHeight(),text=(a.body||a.title||'').trim();
 if((a.metadata.exactPath&&a.metadata.exactPath!==path)||path.startsWith('/event/')||!text)return null;
 const label=text.replace(/\s*\[(coffee|airpods|ipad)\]\s*/g,' ').trim();
 return <aside className={styles.ticker} role="region" aria-label={`진행 중인 이벤트 안내: ${label}`} data-announcement={a.id} style={{top:height,visibility:height>0?'visible':'hidden','--duration':`${Math.max(14,Math.round(.28*text.length))}s`} as CSSProperties}>
  <a className={styles.link} href={a.linkUrl||'/event'}>
   <span className={styles.track}>{[0,1,2].map(copy=><span key={copy} className={styles.copy} aria-hidden={copy>0}>
    {text.split(/(\[(?:coffee|airpods|ipad)\])/g).map((part,i)=>{const token=part.match(/^\[(\w+)\]$/)?.[1],icon=token?icons[token]:null;return icon?<img key={i} src={icon.src} alt={icon.alt}/>:<span key={i}>{part}</span>;})}
    <span className={styles.separator} aria-hidden="true">✦</span>
   </span>)}</span>
  </a>
  <button type="button" className={styles.close} onClick={onDismissToday} aria-label="이벤트 안내 닫기">×</button>
 </aside>;
}
