'use client';
import {useEffect,useState} from 'react';
import type {PublicAnnouncement} from '@/server/content/announcements';

const key=(a:PublicAnnouncement)=>`naeo-announcement-dismissed:${a.id}:${a.version}`;
/** 닫은 공지는 이 브라우저에서만 기억한다(저장소를 못 쓰면 매번 보인다). 공지가 수정되면(version 변경) 다시 보인다. */
function dismissed(a:PublicAnnouncement){try{return window.localStorage.getItem(key(a))==='1';}catch{return false;}}

const bar:React.CSSProperties={position:'fixed',left:16,right:16,bottom:16,zIndex:1300,maxWidth:720,margin:'0 auto',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',
 padding:'12px 14px 12px 18px',borderRadius:14,background:'rgba(17,17,17,.94)',color:'#fff',border:'1px solid rgba(3,199,90,.55)',boxShadow:'0 10px 30px rgba(0,0,0,.35)',fontFamily:'pretendard,system-ui,sans-serif',fontSize:14,lineHeight:1.5};
const link:React.CSSProperties={color:'#03c75a',fontWeight:700,textDecoration:'underline',whiteSpace:'nowrap'};
const close:React.CSSProperties={marginLeft:'auto',background:'transparent',border:'1px solid rgba(255,255,255,.35)',color:'#fff',borderRadius:8,padding:'4px 10px',cursor:'pointer',font:'inherit'};

/** 관리자가 공개한 공지를 화면 아래에 띄운다. 글자는 모두 텍스트로만 렌더링한다. */
export default function AnnouncementBar({announcement}:{announcement:PublicAnnouncement}){
 const [open,setOpen]=useState(false);
 useEffect(()=>{const id=window.setTimeout(()=>setOpen(!dismissed(announcement)),0);return()=>window.clearTimeout(id);},[announcement]);
 if(!open)return null;
 const hide=()=>{try{window.localStorage.setItem(key(announcement),'1');}catch{/* 저장 못 해도 이번 화면에서는 닫는다 */}setOpen(false);};
 return <aside role="region" aria-label="공지" style={bar} data-announcement={announcement.id}>
  <strong style={{whiteSpace:'nowrap'}}>{announcement.title}</strong>
  {announcement.body&&<span style={{overflowWrap:'anywhere',minWidth:0,flex:'1 1 200px'}}>{announcement.body}</span>}
  {announcement.linkUrl&&<a style={link} href={announcement.linkUrl} {...(announcement.linkUrl.startsWith('https://')?{target:'_blank',rel:'noopener noreferrer'}:{})}>{announcement.linkLabel}</a>}
  <button type="button" style={close} onClick={hide} aria-label="공지 닫기">닫기</button>
 </aside>;
}
