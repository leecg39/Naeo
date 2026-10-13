'use client';
import {useEffect} from 'react';
import {usePathname} from 'next/navigation';

/** 방문·체류 기록. 추적 거부(DNT·GPC)·관리/개발 경로는 보내지 않는다. 실패해도 화면에는 영향이 없다. */
export default function PageViewTracker(){
 const path=usePathname();
 useEffect(()=>{
  const nav=navigator as Navigator&{globalPrivacyControl?:boolean};
  if(!path||/^\/(admin|api|dev)(\/|$)/.test(path)||nav.doNotTrack==='1'||nav.globalPrivacyControl)return;
  let viewId:string|null=null,sent=false;
  const started=performance.now();
  const send=()=>{
   if(!viewId||sent)return;sent=true;
   void fetch('/api/analytics/dwell',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({viewId,ms:Math.round(performance.now()-started)})}).catch(()=>undefined);
  };
  void fetch('/api/analytics/view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:location.pathname,referrer:document.referrer})})
   .then(r=>r.status===201?r.json():null).then(j=>{viewId=j?.data?.viewId??null;}).catch(()=>undefined);
  const hide=()=>{if(document.visibilityState==='hidden')send();};
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',send);
  return()=>{send();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',send);};
 },[path]);
 return null;
}
