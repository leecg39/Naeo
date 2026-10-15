'use client';
import {useEffect,useState} from 'react';
import type {PublicAnnouncement} from '@/server/content/announcements';
import {dismissAnnouncementToday,isAnnouncementDismissed} from './announcement-dismissal';
import AnnouncementBanner from './AnnouncementBanner';
import AnnouncementTicker from './AnnouncementTicker';
import AnnouncementNotice from './AnnouncementNotice';
function dismissed(id:string){try{return isAnnouncementDismissed(window.localStorage,id);}catch{return false;}}

/** REA의 ticker 우선 분기와 공지 유형별 표시를 연결한다. */
export default function AnnouncementBar({announcement,onDismiss}:{announcement:PublicAnnouncement;onDismiss?:(today:boolean)=>void}){
 const [open,setOpen]=useState(false);
 useEffect(()=>{const timer=window.setTimeout(()=>setOpen(!dismissed(announcement.id)),0);return()=>window.clearTimeout(timer);},[announcement.id]);
 if(!open)return null;
 const hide=()=>{setOpen(false);onDismiss?.(false);};
 const hideToday=()=>{try{dismissAnnouncementToday(window.localStorage,announcement.id);}catch{/* localStorage getter도 차단될 수 있다 */}setOpen(false);onDismiss?.(true);};
 if(announcement.metadata.display==='ticker')return <AnnouncementTicker announcement={announcement} onDismissToday={hideToday}/>;
 if(announcement.type==='event')return announcement.metadata.image&&announcement.metadata.display!=='notice'?<AnnouncementBanner announcement={announcement} onClose={hide} onDismissToday={hideToday}/>:null;
 return <AnnouncementNotice key={announcement.type} announcement={announcement} onClose={hide} onDismissToday={hideToday}/>;
}
