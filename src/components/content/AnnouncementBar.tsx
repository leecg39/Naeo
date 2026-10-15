'use client';
import {useEffect,useState} from 'react';
import type {PublicAnnouncement} from '@/server/content/announcements';
import {dismissAnnouncementToday,isAnnouncementDismissed} from './announcement-dismissal';
function dismissed(id:string){try{return isAnnouncementDismissed(window.localStorage,id);}catch{return false;}}

const bar:React.CSSProperties={position:'fixed',left:16,right:16,bottom:16,zIndex:1300,maxWidth:720,margin:'0 auto',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',
 padding:'12px 14px 12px 18px',borderRadius:14,background:'rgba(17,17,17,.94)',color:'#fff',border:'1px solid rgba(3,199,90,.55)',boxShadow:'0 10px 30px rgba(0,0,0,.35)',fontFamily:'pretendard,system-ui,sans-serif',fontSize:14,lineHeight:1.5};
const link:React.CSSProperties={color:'#03c75a',fontWeight:700,textDecoration:'underline',whiteSpace:'nowrap'};
const close:React.CSSProperties={marginLeft:'auto',background:'transparent',border:'1px solid rgba(255,255,255,.35)',color:'#fff',borderRadius:8,padding:'4px 10px',cursor:'pointer',font:'inherit'};

/** 관리자가 공개한 공지를 화면 아래에 띄운다. 글자는 모두 텍스트로만 렌더링한다. */
export default function AnnouncementBar({announcement}:{announcement:PublicAnnouncement}){
 const [open,setOpen]=useState(false);
 useEffect(()=>{const timer=window.setTimeout(()=>setOpen(!dismissed(announcement.id)),0);return()=>window.clearTimeout(timer);},[announcement.id]);
 if(!open)return null;
 const hideToday=()=>{try{dismissAnnouncementToday(window.localStorage,announcement.id);}catch{/* localStorage getter도 차단될 수 있다 */}setOpen(false);};
 return <aside role="region" aria-label="공지" style={bar} data-announcement={announcement.id}>
  <strong style={{whiteSpace:'nowrap'}}>{announcement.title}</strong>
  {announcement.body&&<span style={{overflowWrap:'anywhere',minWidth:0,flex:'1 1 200px'}}>{announcement.body}</span>}
  {announcement.linkUrl&&<a style={link} href={announcement.linkUrl} {...(announcement.linkUrl.startsWith('https://')?{target:'_blank',rel:'noopener noreferrer'}:{})}>{announcement.linkLabel}</a>}
  <button type="button" style={close} onClick={hideToday}>오늘 하루 안 보기</button>
  <button type="button" style={close} onClick={()=>setOpen(false)} aria-label="공지 닫기">닫기</button>
 </aside>;
}
