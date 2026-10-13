'use client';
import type { InstallBehavior } from '@/lib/behavior';
import { useEffect, useState } from 'react';
import { apiResponse, ApiError, type PageResult } from '@/lib/api-client';
import type { DraftSummary } from '@/server/writing/drafts';
import LogoutButton from '@/components/account/LogoutButton';
/** 내 글 · 발행 대기함: 서버에 저장된 내 초안(최근 20개). */
function DraftList(){
 const [items,setItems]=useState<DraftSummary[]|null>(null),[message,setMessage]=useState('');
 useEffect(()=>{let live=true;void apiResponse<PageResult<DraftSummary>>('/api/drafts?pageSize=20').then(r=>{if(live)setItems(r.data);}).catch(e=>{if(live)setMessage(e instanceof ApiError&&e.status===401?'로그인하면 내 글을 볼 수 있습니다.':'내 글을 불러오지 못했습니다.');});return()=>{live=false;};},[]);
 if(message)return <p>{message}</p>;
 if(!items)return <p role="status">불러오는 중…</p>;
 return <div>{items.length?<ul style={{listStyle:'none',padding:0,display:'grid',gap:8}}>{items.map(d=><li key={d.id}><a className="naeo-button" href={`/dashboard/write?draft=${d.id}`}>{d.title}</a></li>)}</ul>:<p>저장된 글이 없습니다. AI 글쓰기에서 글을 만들어 보세요.</p>}<a className="naeo-button" href="/dashboard/write">글쓰기로 이동</a></div>;
}
export const installAuxiliary:InstallBehavior=(root,tools)=>{
 const timers:number[]=[];let observer:IntersectionObserver|undefined;

 // Captured animation frames become live again without changing the source layout.
 if(tools.pathname!=='/'){observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const el=entry.target as HTMLElement;el.style.transition='opacity 400ms ease, transform 400ms ease';el.style.opacity='1';el.style.transform='none';observer?.unobserve(el)}},{threshold:.05});root.querySelectorAll<HTMLElement>('[style]').forEach(el=>{if(el.style.opacity==='0'&&/translate/.test(el.style.transform)&&!el.closest('[aria-hidden=true],.MuiCollapse-root'))observer?.observe(el)});timers.push(window.setTimeout(()=>observer?.disconnect(),90000));}
 const onClick=(e:MouseEvent)=>{if(e.defaultPrevented||!(e.target instanceof Element))return;const b=e.target.closest<HTMLElement>('button,[role=button]');if(!b)return;const label=b.getAttribute('aria-label')||'',text=b.textContent?.replace(/\s+/g,' ').trim()||'';
  if(label==='더보기 메뉴'||label==='MY 메뉴'||text==='NAEO 블로거'){e.preventDefault();tools.openDialog('내 계정',<div style={{display:'grid',gap:12}}><a className="naeo-button" href="/dashboard">대시보드</a><a className="naeo-button secondary" href="/dashboard/settings">계정 설정</a><button className="naeo-button secondary" onClick={()=>tools.openDialog('내 글 · 발행 대기함',<DraftList/>)}>내 글 · 발행 대기함</button><LogoutButton/></div>);return}
  if(/^\/(login|auth|oauth)/.test(tools.pathname)&&/네이버|Google|구글|로그인|허용|시작/.test(text)){e.preventDefault();tools.openAuth();return}
  if(tools.pathname==='/preview'&&/다시|돌아|글|대시보드/.test(text)){e.preventDefault();tools.openDialog('내 글 · 발행 대기함',<DraftList/>);return}
 };
 root.addEventListener('click',onClick);
 // Public utility pages can read local drafts without talking to the original service.
 return()=>{root.removeEventListener('click',onClick);timers.forEach(clearTimeout);observer?.disconnect()};
};
