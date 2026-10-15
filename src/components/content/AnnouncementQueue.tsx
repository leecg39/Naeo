'use client';
import {useEffect,useState} from 'react';
import type {PublicAnnouncement} from '@/server/content/announcements';
import {dismissAnnouncementToday,isAnnouncementDismissed} from './announcement-dismissal';
import AnnouncementBar from './AnnouncementBar';

export default function AnnouncementQueue({announcements}:{announcements:PublicAnnouncement[]}){
 const [hidden,setHidden]=useState<Set<string>>(new Set()),[ready,setReady]=useState(false);
 useEffect(()=>{const timer=window.setTimeout(()=>{
  const stored=new Set<string>();
  try{for(const a of announcements)if(isAnnouncementDismissed(window.localStorage,a.id))stored.add(a.id);}catch{/* 저장소가 없으면 공지를 표시한다. */}
  setHidden(previous=>new Set([...previous,...stored]));setReady(true);
 },0);return()=>window.clearTimeout(timer);},[announcements]);
 if(!ready)return null;
 const current=announcements.find(a=>!hidden.has(a.id));
 if(!current)return null;
 const dismiss=(today:boolean)=>{
  const next=new Set([...hidden,current.id]);
  if(today){try{for(const id of next)dismissAnnouncementToday(window.localStorage,id);}catch{/* 현재 화면에서는 계속 닫을 수 있다. */}}
  setHidden(next);
 };
 return <AnnouncementBar key={current.id} announcement={current} onDismiss={dismiss}/>;
}
