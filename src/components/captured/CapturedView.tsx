'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { CapturedPageData } from '@/types/site';
import type { BehaviorTools, InstallBehavior } from '@/lib/behavior';
import { NodeRenderer } from './NodeRenderer';
import SharedDialogs, { type SharedDialog } from './SharedDialogs';
import './captured.css';

const AUTH_PATH = /^\/(?:api\/auth|auth|login|signin|signup|register)(?:[/?#]|$)/i;
const API_PATH = /^\/api(?:[/?#]|$)/i;
const PUBLIC_START = /^(?:시작하기|무료로\s*시작하기|7일\s*무료\s*체험\s*시작하기|네이버로\s*시작하기|네이버로\s*로그인)$/;

function lightPalette(css: string) {
  const palette: Record<string, string> = { '#121212': '#ffffff', '#e0e0e0': '#111827', '#a3a3a3': '#6b7280', '#1a1a1a': '#f7f9fa' };
  return css.replace(/#(?:121212|e0e0e0|a3a3a3|1a1a1a)\b/gi, color => palette[color.toLowerCase()])
    .replace(/rgba\(18,\s*18,\s*18,/g, 'rgba(255,255,255,');
}

function localHref(href: string): string | null {
  try {
    const url = new URL(href, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.origin === window.location.origin || ['naeo.kr', 'www.naeo.kr'].includes(url.hostname)) return `${url.pathname}${url.search}${url.hash}`;
  } catch { /* Invalid links cannot initiate navigation. */ }
  return null;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return; } catch { /* Native fallback below. */ }
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('clipboard unavailable');
}

export default function CapturedView({ data, install,slots }: { data: CapturedPageData; install?: InstallBehavior;slots?:Record<string,ReactNode> }) {
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [dialog, setDialog] = useState<SharedDialog>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeDialog = useCallback(() => { setDialog(null); setMenuOpen(false); }, []);
  const openAuth = useCallback(() => { setMenuOpen(false); setDialog({ kind: 'auth' }); }, []);
  const openDialog = useCallback((title: string, content: ReactNode, wide?: boolean) => { setMenuOpen(false); setDialog({ kind: 'content', title, content, wide }); }, []);
  const toast = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setMessage(text);
    toastTimer.current = setTimeout(() => setMessage(null), 3200);
  }, []);
  const navigate = useCallback((href: string) => {
    const target = localHref(href);
    if (!target) return;
    if (AUTH_PATH.test(target)) { openAuth(); return; }
    if (API_PATH.test(target)) { toast('로컬 데모에서는 실제 서비스에 요청하지 않습니다.'); return; }
    closeDialog();
    router.push(target);
  }, [router, openAuth, closeDialog, toast]);
  const tools = useMemo<BehaviorTools>(() => ({ pathname: data.path, toast, navigate, openAuth, openDialog, closeDialog }), [data.path, toast, navigate, openAuth, openDialog, closeDialog]);

  useEffect(() => {
    try { setTheme(localStorage.getItem('naeo-clone:theme') === 'light' ? 'light' : 'dark'); } catch { /* Storage may be disabled. */ }
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const timeouts = new Set<ReturnType<typeof setTimeout>>();
    const accordionTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
    const schedule = (fn: () => void, duration: number) => {
      const timer = setTimeout(() => { timeouts.delete(timer); fn(); }, duration);
      timeouts.add(timer);
      return timer;
    };
    // The page adapter gets the first chance to handle its own controls.
    const cleanup = install?.(element, tools);
    element.querySelectorAll<HTMLImageElement>('.mdx-img-skeleton img').forEach(image => {
      if (image.complete && image.naturalWidth > 0) {
        image.classList.add('loaded');
        image.closest('.mdx-img-skeleton')?.classList.add('loaded');
      }
    });
    element.dataset.naeoReady = 'true';
    const isApp = /^\/(?:dashboard|admin)(?:\/|$)/.test(data.path);
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const target = event.target;
      if (target.closest('[data-naeo-live]')) return;
      const button = target.closest<HTMLElement>('button,[role="button"]');
      const label = button?.getAttribute('aria-label') || '';
      const buttonText = button?.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (button && element.contains(button)) {
        if (label === '테마 전환') {
          event.preventDefault();
          setTheme(current => {
            const next = current === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem('naeo-clone:theme', next); } catch { /* Storage may be disabled. */ }
            return next;
          });
          return;
        }
        if (label === '메뉴 열기') { event.preventDefault(); setMenuOpen(true); return; }
        const accordion = button.closest<HTMLElement>('.MuiAccordion-root');
        if (accordion && button.hasAttribute('aria-expanded')) {
          event.preventDefault();
          const expanded = button.getAttribute('aria-expanded') !== 'true';
          const collapse = accordion.querySelector<HTMLElement>('.MuiCollapse-root');
          button.setAttribute('aria-expanded', String(expanded));
          [accordion, button, button.querySelector('.MuiAccordionSummary-content'), button.querySelector('.MuiAccordionSummary-expandIconWrapper')].forEach(item => item?.classList.toggle('Mui-expanded', expanded));
          const icon = button.querySelector<HTMLElement>('.MuiAccordionSummary-expandIconWrapper');
          if (icon) { icon.style.transition = 'transform 250ms ease'; icon.style.transform = expanded ? 'rotate(180deg)' : 'rotate(0deg)'; }
          if (collapse) {
            const previous = accordionTimers.get(collapse);
            if (previous) { clearTimeout(previous); timeouts.delete(previous); }
            collapse.style.transition = 'height 250ms ease';
            collapse.style.overflow = 'hidden';
            collapse.style.visibility = 'visible';
            collapse.classList.remove('MuiCollapse-hidden');
            collapse.classList.toggle('MuiCollapse-entered', expanded);
            collapse.style.height = `${collapse.getBoundingClientRect().height}px`;
            void collapse.offsetHeight;
            collapse.style.height = expanded ? `${collapse.scrollHeight}px` : '0px';
            collapse.setAttribute('aria-hidden', String(!expanded));
            accordionTimers.set(collapse, schedule(() => {
              collapse.style.height = expanded ? 'auto' : '0px';
              collapse.style.visibility = expanded ? 'visible' : 'hidden';
              collapse.classList.toggle('MuiCollapse-hidden', !expanded);
            }, 250));
          }
          return;
        }
        if (!isApp && PUBLIC_START.test(buttonText)) { event.preventDefault(); openAuth(); return; }
        if (/복사|copy/i.test(`${label} ${buttonText}`)) {
          event.preventDefault();
          let value = button.getAttribute('data-copy') || '';
          if (!value && !/링크|url/i.test(`${label} ${buttonText}`)) {
            let container: Element | null = button.closest('pre') || button.parentElement;
            for (let depth = 0; container && depth < 3; depth++, container = container.parentElement) {
              const code = container.matches('pre,code') ? container : container.querySelector('pre,code');
              if (code) { value = code.textContent?.trim() || ''; break; }
            }
          }
          void copyText(value || window.location.href).then(() => {
            button.dataset.copied = 'true';
            button.setAttribute('aria-label', '복사됨');
            toast('복사했습니다.');
            schedule(() => { delete button.dataset.copied; if (label) button.setAttribute('aria-label', label); else button.removeAttribute('aria-label'); }, 2000);
          }).catch(() => toast('복사하지 못했습니다. 내용을 선택해 복사해 주세요.'));
          return;
        }
        if (/^(?:닫기|배너 닫기|close)$/i.test(label || buttonText)) {
          const banner = button.closest<HTMLElement>('[role="status"]');
          if (banner) { event.preventDefault(); banner.hidden = true; return; }
        }
      }
      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || !element.contains(anchor)) return;
      const href = anchor.getAttribute('href') || '';
      const local = localHref(href);
      if (local && AUTH_PATH.test(local)) { event.preventDefault(); openAuth(); return; }
      if (local && API_PATH.test(local)) { event.preventDefault(); toast('로컬 데모에서는 실제 서비스에 요청하지 않습니다.'); return; }
      if (!isApp && PUBLIC_START.test(anchor.textContent?.replace(/\s+/g, ' ').trim() || '')) { event.preventDefault(); openAuth(); return; }
      if (local && anchor.target !== '_blank' && !anchor.hasAttribute('download') && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
        if (href.startsWith('#')) return;
        event.preventDefault();
        navigate(local);
      }
    };
    const onSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[data-naeo-live]'))) return;
      event.preventDefault();
      toast('로컬 데모에서는 실제 서비스에 양식을 전송하지 않습니다.');
    };
    element.addEventListener('click', onClick);
    element.addEventListener('submit', onSubmit);
    return () => {
      delete element.dataset.naeoReady;
      cleanup?.();
      element.removeEventListener('click', onClick);
      element.removeEventListener('submit', onSubmit);
      timeouts.forEach(clearTimeout);
    };
  }, [data.path, data.body, install, tools, openAuth, navigate, toast]);

  const css = useMemo(() => theme === 'light' ? lightPalette(data.css) : data.css, [data.css, theme]);
  return <>
    <style data-naeo-captured-styles={data.path}>{css}</style>
    <div ref={root} data-naeo-captured-root={data.path}><NodeRenderer nodes={data.body} slots={slots}/></div>
    <SharedDialogs dialog={dialog} menuOpen={menuOpen} toast={message} onClose={closeDialog} onNavigate={navigate} onAuth={openAuth} />
  </>;
}
