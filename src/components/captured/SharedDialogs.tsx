'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import AuthForm from '@/components/account/AuthForm';

export type SharedDialog = { kind: 'auth' } | { kind: 'content'; title: string; content: ReactNode; wide?:boolean } | null;
export interface SharedDialogsProps {
  dialog: SharedDialog;
  menuOpen: boolean;
  toast: string | null;
  onClose: () => void;
  onNavigate: (href: string) => void;
  onAuth: () => void;
}

const navigation = [
  ['AI 글쓰기', '/mcp'], ['랭킹', '/ranking'], ['네이버 메이트', '/mate'],
  ['이벤트', '/event'], ['매거진', '/blog'], ['요금제', '/pricing'],
];

export default function SharedDialogs({ dialog, menuOpen, toast, onClose, onNavigate, onAuth }: SharedDialogsProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const container = useRef<HTMLDivElement>(null);
  const open = !!dialog || menuOpen;
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => container.current?.querySelector<HTMLElement>('button,a[href],input,[tabindex="0"]')?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab' || !container.current) return;
      const items = Array.from(container.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea,select,[tabindex="0"]')).filter(el => el.getClientRects().length > 0);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !container.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = overflow;
      active?.focus();
    };
  }, [open, onClose]);

  if (!mounted) return null;
  return createPortal(<div className="naeo-shared-overlays">
    {open && <div className={`naeo-overlay ${menuOpen ? 'naeo-menu-overlay' : ''}`} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={container} role="dialog" aria-modal="true" aria-labelledby="naeo-shared-dialog-title" className={menuOpen ? 'naeo-mobile-menu' : 'naeo-shared-dialog'} style={dialog?.kind==='content'&&dialog.wide?{width:'min(960px, 100%)'}:undefined}>
        <div className="naeo-dialog-heading">
          <h2 id="naeo-shared-dialog-title">{menuOpen ? 'NAEO' : dialog?.kind === 'auth' ? 'NAEO 시작하기' : dialog?.title}</h2>
          <button type="button" className="naeo-dialog-close" aria-label="닫기" onClick={onClose}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
        {menuOpen ? <>
          <nav aria-label="모바일 메뉴">{navigation.map(([label, href]) => <a href={href} key={href} onClick={event => { event.preventDefault(); onClose(); onNavigate(href); }}>{label}</a>)}</nav>
          <button type="button" className="naeo-overlay-primary" onClick={onAuth}>시작하기</button>
        </> : dialog?.kind === 'auth' ? <div className="naeo-auth-content">
          <p>네이버 블로그를 더 쉽게, NAEO와 함께</p>
          <AuthForm onSuccess={onClose}/>
        </div> : <div className="naeo-dialog-content">{dialog?.content}</div>}
      </div>
    </div>}
    {toast && <div role="status" aria-live="polite" className="naeo-shared-toast">{toast}</div>}
  </div>, document.body);
}
