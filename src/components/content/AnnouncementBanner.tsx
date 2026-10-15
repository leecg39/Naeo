'use client';
import {useEffect,useRef,type CSSProperties} from 'react';
import type {PublicAnnouncement} from '@/server/content/announcements';
import styles from './AnnouncementBanner.module.css';

/** REA 배포 컴포넌트의 이미지·모바일 비율·링크 기본값. Native dialog가 포커스와 Escape를 처리한다. */
export default function AnnouncementBanner({announcement:a,onClose,onDismissToday}:{announcement:PublicAnnouncement;onClose:()=>void;onDismissToday:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),m=a.metadata;
 useEffect(()=>{const el=dialog.current;if(el&&!el.open)el.showModal();return()=>{el?.close();};},[]);
 const href=a.linkUrl||'/event';
 return <dialog ref={dialog} className={styles.dialog} aria-label={a.title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===dialog.current)onClose();}}>
  <div className={styles.content}>
   <a href={href} aria-label={a.title} className={styles.image} style={{'--ratio':m.ratio||'4 / 5','--mobile-ratio':m.ratioMobile||m.ratio||'4 / 5'} as CSSProperties}>
    <picture><source media="(max-width: 599px)" srcSet={m.imageMobile||m.image}/>{/* 관리자 지정 원격 이미지를 원본 URL로 표시한다. */}
     <img src={m.image} alt={a.title}/>
    </picture>
   </a>
   <button type="button" className={styles.close} aria-label="공지 닫기" onClick={onClose}>×</button>
   <div className={styles.actions}><button type="button" onClick={onDismissToday}>오늘 하루 안 보기</button><a href={href}>{m.ctaLabel||'이벤트 보러가기'}</a></div>
  </div>
 </dialog>;
}
