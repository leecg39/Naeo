'use client';

import {useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {createPortal} from 'react-dom';
import {useRouter} from 'next/navigation';
import {api, ApiError} from '@/lib/api-client';
import type {DashboardSubject} from '@/lib/dashboard-visualization';
import styles from './DashboardBlogChange.module.css';

const validId = /^[a-z0-9][a-z0-9_-]{1,49}$/;

function blogId(value:string):string|null {
 const text = value.trim().toLowerCase();
 if (validId.test(text)) return text;
 try {
  const url = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`);
  if (!['https:','http:'].includes(url.protocol) || !['blog.naver.com','m.blog.naver.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
  // URLSearchParams preserves the case of keys in the original input.
  const original = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
  const queryId = original.searchParams.get('blogId') ?? original.searchParams.get('blogid');
  const id = (queryId ?? url.pathname.split('/').filter(Boolean)[0] ?? '').toLowerCase();
  return validId.test(id) ? id : null;
 } catch {return null;}
}

export default function DashboardBlogChange({subjects,selected}:{subjects:DashboardSubject[];selected:string|null}) {
 const router = useRouter();
 const [open,setOpen] = useState(false);
 const [value,setValue] = useState('');
 const [busy,setBusy] = useState(false);
 const [error,setError] = useState('');
 const [authError,setAuthError] = useState(false);
 const [position,setPosition] = useState({top:0,left:0});
 const button = useRef<HTMLButtonElement>(null);
 const panel = useRef<HTMLDivElement>(null);
 const input = useRef<HTMLInputElement>(null);
 const saving = useRef(false);
 const id = useId();
 const owned = subjects.filter(subject => subject.connected);

 const close = () => {
  if (saving.current) return;
  setOpen(false);
  button.current?.focus();
 };
 const show = () => {
  const bounds = button.current?.getBoundingClientRect();
  if (!bounds) return;
  setPosition({top:Math.max(12,Math.min(bounds.bottom+8,window.innerHeight-340)),left:Math.max(12,Math.min(bounds.left,window.innerWidth-Math.min(380,window.innerWidth-24)-12))});
  setValue(selected ? `https://blog.naver.com/${selected}` : '');
  setError('');setAuthError(false);setOpen(true);
 };
 useEffect(() => {
  if (!open) return;
  input.current?.focus();
  const reposition = () => {
   const bounds = button.current?.getBoundingClientRect();
   if (bounds) setPosition({top:Math.max(12,Math.min(bounds.bottom+8,window.innerHeight-340)),left:Math.max(12,Math.min(bounds.left,window.innerWidth-Math.min(380,window.innerWidth-24)-12))});
  };
  const dismiss = (event:PointerEvent) => {
   if (!saving.current && event.target instanceof Node && !panel.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false);
  };
  const escape = (event:KeyboardEvent) => {
   if (event.key === 'Escape' && !saving.current) {event.preventDefault();setOpen(false);button.current?.focus();}
  };
  window.addEventListener('resize',reposition);
  window.addEventListener('scroll',reposition,true);
  document.addEventListener('pointerdown',dismiss);
  document.addEventListener('keydown',escape);
  return () => {
   window.removeEventListener('resize',reposition);
   window.removeEventListener('scroll',reposition,true);
   document.removeEventListener('pointerdown',dismiss);
   document.removeEventListener('keydown',escape);
  };
 },[open]);

 const select = (naverId:string) => {
  setOpen(false);
  router.push(`/dashboard?blog=${encodeURIComponent(naverId)}`);
  router.refresh();
 };
 async function save(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (saving.current) return;
  const naverId = blogId(value);
  setError('');setAuthError(false);
  if (!naverId) {setError('네이버 블로그 주소 또는 올바른 블로그 ID를 입력해 주세요.');input.current?.focus();return;}
  if (owned.some(subject => subject.naverId.toLowerCase() === naverId)) {select(naverId);return;}
  saving.current = true;setBusy(true);
  try {
   const blog = await api<{naverId:string}>('/api/blogs',{method:'POST',body:{naverId,title:naverId,isPrimary:false}});
   select(blog.naverId);
  } catch (error) {
   if (error instanceof ApiError && error.code === 'BLOG_EXISTS') {select(naverId);return;}
   setError(error instanceof Error ? error.message : '블로그를 저장하지 못했습니다. 다시 시도해 주세요.');
   setAuthError(error instanceof ApiError && error.status === 401);
  } finally {saving.current = false;setBusy(false);}
 }

 return <span className={styles.root} data-naeo-live="dashboard-blog-change"><button type="button" ref={button} className={styles.trigger} aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined} onClick={() => open ? close() : show()}>변경</button>{open && createPortal(<div ref={panel} id={`${id}-panel`} className={styles.panel} style={{top:position.top,left:position.left}} data-naeo-live="dashboard-blog-change" role="region" aria-labelledby={`${id}-title`}>
  <h2 id={`${id}-title`}>표시할 블로그</h2>
  {subjects.length > 0 && <label className={styles.field} htmlFor={`${id}-owned`}><span>분석할 블로그 선택</span><select id={`${id}-owned`} disabled={busy} value={subjects.some(subject => subject.naverId === selected) ? selected! : ''} onChange={event => {if(event.target.value) select(event.target.value);}}><option value="" disabled>블로그를 선택하세요</option>{subjects.map(subject => <option key={subject.naverId} value={subject.naverId}>{subject.title || subject.naverId}{subject.primary ? ' · 대표' : !subject.connected ? ' · 분석 기록' : ''}</option>)}</select></label>}
  <form onSubmit={save} aria-busy={busy}>
   <label className={styles.field} htmlFor={`${id}-url`}><span>블로그 주소 또는 ID</span><input ref={input} id={`${id}-url`} type="text" value={value} onChange={event => setValue(event.target.value)} placeholder="https://blog.naver.com/my_blog" maxLength={2048} disabled={busy} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={!!error} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} required/></label>
   <p className={styles.hint} id={`${id}-hint`}>등록하지 않은 블로그는 새로 추가됩니다.</p>
   {error && <p id={`${id}-error`} role="alert" className={styles.error}>{error}{authError && <> <a href="/login?next=%2Fdashboard">로그인하기</a></>}</p>}
   <div className={styles.actions}><button type="submit" className={styles.save} disabled={busy}>{busy ? '저장 중…' : '저장'}</button><button type="button" onClick={close} disabled={busy}>취소</button></div>
  </form>
 </div>,document.body)}</span>;
}
