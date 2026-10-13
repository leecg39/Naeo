import type { InstallBehavior } from '@/lib/behavior';
import { text } from '@/lib/behavior';
import { api, ApiError } from '@/lib/api-client';
import MyInquiries from '@/components/contact/MyInquiries';

/** Interactions for the captured magazine, changelog and contact form. */
export const installContent: InstallBehavior = (root, tools) => {
  const dispose: Array<() => void> = [];
  const saved = new Map<Element, Map<string, string | null>>();
  const generated = new Set<HTMLElement>();
  const remember = (el: Element, attr: string) => {
    if (!saved.has(el)) saved.set(el, new Map());
    if (!saved.get(el)!.has(attr)) saved.get(el)!.set(attr, el.getAttribute(attr));
  };
  const attr = (el: Element, key: string, value: string) => {
    remember(el, key);
    el.setAttribute(key, value);
  };
  const style = (el: HTMLElement, values: Partial<CSSStyleDeclaration>) => {
    remember(el, 'style');
    Object.assign(el.style, values);
  };
  const show = (el: HTMLElement, visible: boolean) => {
    remember(el, 'style');
    if (visible) {
      const original = saved.get(el)?.get('style');
      if (original == null) el.removeAttribute('style');
      else el.setAttribute('style', original);
    } else el.style.setProperty('display', 'none', 'important');
  };
  const on = (el: EventTarget, event: string, handler: EventListener) => {
    el.addEventListener(event, handler);
    dispose.push(() => el.removeEventListener(event, handler));
  };
  const add = (el: HTMLElement) => { generated.add(el); return el; };
  const announce = (parent: HTMLElement) => {
    const node = add(document.createElement('p'));
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.style.cssText = 'color:var(--muted,#a3a3a3);font-size:14px;margin:24px 0;';
    node.hidden = true;
    parent.append(node);
    return node;
  };
  const updateTabs = (tabs: HTMLElement[], selected: HTMLElement) => {
    const activeClass = tabs.find(el => el.getAttribute('aria-selected') === 'true')?.className;
    const inactiveClass = tabs.find(el => el.getAttribute('aria-selected') !== 'true')?.className;
    tabs.forEach(tab => {
      attr(tab, 'aria-selected', String(tab === selected));
      if (activeClass && inactiveClass) attr(tab, 'class', tab === selected ? activeClass : inactiveClass);
    });
  };

  if (tools.pathname === '/blog' || tools.pathname.startsWith('/blog/')) {
    const searches = [...root.querySelectorAll<HTMLInputElement>('input[aria-label="블로그 글 검색"]')];
    const cards = [...root.querySelectorAll<HTMLAnchorElement>('a.mui-1iiz5y,a.mui-1ga9ndx,a.mui-1lbah0i')];
    const sidebarRows = [...root.querySelectorAll<HTMLLIElement>('aside li,.MuiDrawer-root li')]
      .filter(li => li.querySelector('a[href^="/blog/"]'));
    const sections = [...new Set(cards.map(card => card.closest<HTMLElement>('section') || card.closest<HTMLElement>('.mui-10ib5jr')).filter((el): el is HTMLElement => !!el))];
    const tabs = [...root.querySelectorAll<HTMLElement>('[aria-label="블로그 카테고리"] [role="tab"]')];
    const categories: Record<string, string> = { '전체': '', '마케팅': 'marketing', '사용 가이드': 'guide', '언론 보도': 'news', '이벤트': 'event' };
    const tabLabels = tabs.map(tab => {
      const node = [...tab.childNodes].find(node => node.nodeType === 3 && node.textContent?.includes('('));
      const initial = node?.textContent || '';
      if (node) dispose.push(() => { node.textContent = initial; });
      return { node, initial, label: text(tab).replace(/\s*\(\d+\)$/, '') };
    });
    let category = '';
    let query = '';
    const content = root.querySelector<HTMLElement>('.mui-kefc5r') || root.querySelector<HTMLElement>('main') || root;
    const empty = announce(content);
    const sidebarEmpty = [...root.querySelectorAll<HTMLElement>('aside[aria-label="블로그 사이드바"],.MuiDrawer-paper')].map(sidebar => announce(sidebar));
    const filter = () => {
      let count = 0;
      cards.forEach(card => {
        const cardCategory = card.getAttribute('href')?.split('/')[2];
        const visible = (!category || category === cardCategory) && (!query || text(card).toLocaleLowerCase('ko').includes(query));
        show(card, visible);
        if (visible) count++;
      });
      tabLabels.forEach(({ node, initial, label }) => {
        if (!node) return;
        const matches = cards.filter(card => (!categories[label] || card.getAttribute('href')?.split('/')[2] === categories[label]) && text(card).toLocaleLowerCase('ko').includes(query)).length;
        node.textContent = query ? `${label} (${matches})` : initial;
      });
      sections.forEach(section => show(section, cards.some(card => section.contains(card) && card.style.display !== 'none')));
      empty.hidden = tools.pathname !== '/blog' || count > 0;
      empty.textContent = query ? `“${searches[0]?.value.trim() || query}” 검색 결과가 없습니다.` : '이 카테고리에는 아직 글이 없습니다.';
      sidebarRows.forEach(row => show(row, !query || text(row).toLocaleLowerCase('ko').includes(query)));
      sidebarEmpty.forEach(node => {
        const rows = sidebarRows.filter(row => node.parentElement?.contains(row));
        node.hidden = !query || rows.some(row => row.style.display !== 'none');
        node.textContent = '검색 결과가 없습니다.';
      });
    };
    searches.forEach(input => {
      on(input, 'input', () => {
        query = input.value.trim().toLocaleLowerCase('ko');
        searches.forEach(other => { if (other !== input) other.value = input.value; });
        filter();
      });
      on(input, 'keydown', event => {
        if ((event as KeyboardEvent).key !== 'Escape') return;
        input.value = '';
        searches.forEach(other => { other.value = ''; });
        query = '';
        filter();
      });
    });
    tabs.forEach(tab => on(tab, 'click', event => {
      event.preventDefault();
      category = tab.dataset.category ?? (categories[text(tab).replace(/\s*\(\d+\)$/, '')] || '');
      updateTabs(tabs, tab);
      filter();
    }));
    tabs.forEach((tab, index) => on(tab, 'keydown', event => {
      const key = (event as KeyboardEvent).key;
      const target = key === 'ArrowRight' ? (index + 1) % tabs.length : key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : key === 'Home' ? 0 : key === 'End' ? tabs.length - 1 : -1;
      if (target < 0) return;
      event.preventDefault();
      tabs[target].focus();
      tabs[target].click();
    }));

    const opener = root.querySelector<HTMLElement>('[aria-label="블로그 목차 열기"]');
    const closer = root.querySelector<HTMLElement>('[aria-label="사이드바 닫기"]');
    const drawer = closer?.closest<HTMLElement>('.MuiDrawer-root');
    const paper = drawer?.querySelector<HTMLElement>('.MuiDrawer-paper');
    const backdrop = drawer?.querySelector<HTMLElement>('.MuiBackdrop-root');
    let opened = false;
    const setDrawer = (open: boolean) => {
      if (!drawer || !paper) return;
      opened = open;
      attr(drawer, 'aria-hidden', String(!open));
      attr(drawer, 'class', drawer.className.replace(/\s*MuiModal-hidden/g, '') + (open ? '' : ' MuiModal-hidden'));
      style(drawer, { visibility: open ? 'visible' : 'hidden' });
      style(paper, { visibility: open ? 'visible' : 'hidden', transform: open ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 225ms ease' });
      if (backdrop) style(backdrop, { visibility: open ? 'visible' : 'hidden', opacity: open ? '1' : '0' });
      if (opener) attr(opener, 'aria-expanded', String(open));
      if (open) closer?.focus(); else opener?.focus();
    };
    if (opener) on(opener, 'click', event => { event.preventDefault(); setDrawer(true); });
    if (closer) on(closer, 'click', event => { event.preventDefault(); setDrawer(false); });
    if (backdrop) on(backdrop, 'click', event => { event.preventDefault(); setDrawer(false); });
    if (drawer) {
      on(drawer, 'click', event => {
        if ((event.target as Element).closest('a')) setDrawer(false);
      });
      on(document, 'keydown', event => {
        if (!opened) return;
        const key = event as KeyboardEvent;
        if (key.key === 'Escape') { key.preventDefault(); setDrawer(false); }
        if (key.key === 'Tab' && paper) {
          const focusable = [...paper.querySelectorAll<HTMLElement>('button,a[href],input,[tabindex="0"]')].filter(el => el.getClientRects().length);
          const first = focusable[0], last = focusable.at(-1);
          if (key.shiftKey && document.activeElement === first) { key.preventDefault(); last?.focus(); }
          else if (!key.shiftKey && document.activeElement === last) { key.preventDefault(); first?.focus(); }
        }
      });
    }

    if (tools.pathname.startsWith('/blog/')) {
      const anchors = [...root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
      const targets = anchors.map(anchor => {
        let id = anchor.getAttribute('href')!.slice(1);
        try { id = decodeURIComponent(id); } catch { /* Already decoded. */ }
        return { anchor, heading: document.getElementById(id) };
      }).filter(item => item.heading && root.contains(item.heading));
      targets.forEach(({ heading }) => style(heading!, { scrollMarginTop: '104px' }));
      if ('IntersectionObserver' in window && targets.length) {
        const active = (id: string) => targets.forEach(({ anchor, heading }) => {
          attr(anchor, 'aria-current', heading!.id === id ? 'location' : 'false');
          style(anchor, { color: heading!.id === id ? '#03c75a' : '' });
        });
        const observer = new IntersectionObserver(entries => {
          const top = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
          if (top) active(top.target.id);
        }, { rootMargin: '-104px 0px -65% 0px', threshold: 0 });
        targets.forEach(({ heading }) => observer.observe(heading!));
        dispose.push(() => observer.disconnect());
      }
      on(root, 'click', event => {
        const button = (event.target as Element).closest<HTMLElement>('button');
        if (!button || !/공유|링크 복사/.test(`${text(button)} ${button.getAttribute('aria-label') || ''}`)) return;
        event.preventDefault();
        const copyFallback = () => tools.openDialog('글 링크', <input className="naeo-field" aria-label="복사할 글 링크" defaultValue={location.href} onFocus={event => event.currentTarget.select()} />);
        if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(() => tools.toast('글 링크를 복사했습니다.')).catch(copyFallback);
        else copyFallback();
      });
    }
  }

  if (tools.pathname === '/updates' || tools.pathname.startsWith('/updates/')) {
    const cards = [...root.querySelectorAll<HTMLElement>('article[id]')];
    const tabs = [...root.querySelectorAll<HTMLElement>('[aria-label="업데이트 필터"] [role="tab"]')];
    const months = [...new Set(cards.map(card => card.parentElement?.parentElement?.parentElement).filter((el): el is HTMLElement => !!el))];
    const content = cards[0]?.parentElement?.parentElement?.parentElement?.parentElement || root;
    const empty = announce(content);
    const toggle = (card: HTMLElement, expanded?: boolean) => {
      const trigger = card.querySelector<HTMLElement>('[aria-controls]');
      if (!trigger) return;
      const open = expanded ?? trigger.getAttribute('aria-expanded') !== 'true';
      attr(trigger, 'aria-expanded', String(open));
      const controlled = card.querySelector<HTMLElement>(`[id="${trigger.getAttribute('aria-controls')}"]`);
      const collapse = controlled?.closest<HTMLElement>('.MuiCollapse-root') || card.querySelector<HTMLElement>('.MuiCollapse-root') || controlled;
      if (collapse) {
        style(collapse, { height: open ? 'auto' : '0px', minHeight: '0px', visibility: open ? 'visible' : 'hidden', overflow: 'hidden', transition: 'height 250ms ease' });
        if (controlled && controlled !== collapse) style(controlled, { visibility: open ? 'visible' : 'hidden' });
        if (controlled) attr(controlled, 'aria-hidden', String(!open));
      }
      const summary = trigger.querySelector<HTMLElement>('p.mui-f7fcvj');
      if (summary) show(summary, !open);
      const arrow = trigger.querySelector<SVGElement>('.mui-fm4r4t svg');
      if (arrow) { remember(arrow, 'style'); arrow.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)'; arrow.style.transition = 'transform 200ms ease'; }
    };
    tabs.forEach(tab => on(tab, 'click', event => {
      event.preventDefault();
      const category = text(tab).replace(/\s*\(\d+\)$/, '');
      updateTabs(tabs, tab);
      cards.forEach(card => {
        const tags = [...card.querySelectorAll('.MuiChip-label')].map(text);
        show(card.parentElement!, category === '전체' || tags.includes(category));
      });
      months.forEach(month => show(month, cards.some(card => month.contains(card) && card.parentElement?.style.display !== 'none')));
      empty.hidden = cards.some(card => card.parentElement?.style.display !== 'none');
      empty.textContent = '아직 등록된 업데이트가 없습니다.';
    }));
    tabs.forEach((tab, index) => on(tab, 'keydown', event => {
      const key = (event as KeyboardEvent).key;
      const target = key === 'ArrowRight' ? (index + 1) % tabs.length : key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : key === 'Home' ? 0 : key === 'End' ? tabs.length - 1 : -1;
      if (target < 0) return;
      event.preventDefault();
      tabs[target].focus();
      tabs[target].click();
    }));
    cards.forEach(card => {
      const trigger = card.querySelector<HTMLElement>('[aria-controls]');
      if (!trigger) return;
      on(trigger, 'click', event => { event.preventDefault(); toggle(card); });
      on(trigger, 'keydown', event => {
        if (!['Enter', ' '].includes((event as KeyboardEvent).key)) return;
        event.preventDefault();
        toggle(card);
      });
    });
    const focusRelease = () => {
      let slug = new URLSearchParams(location.search).get('focus') || location.hash.slice(1);
      if (!slug && tools.pathname.startsWith('/updates/')) slug = tools.pathname.split('/').at(-1) || '';
      const card = cards.find(card => card.id === slug);
      if (card) {
        if (card.parentElement?.style.display === 'none') tabs[0]?.click();
        toggle(card, true);
        style(card, { scrollMarginTop: '100px' });
        card.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    };
    focusRelease();
    on(window, 'popstate', focusRelease);
    on(window, 'hashchange', focusRelease);
  }

  if (tools.pathname === '/contact') {
    const combo = root.querySelector<HTMLElement>('[role="combobox"]');
    const email = root.querySelector<HTMLInputElement>('input[type="email"]');
    const subject = [...root.querySelectorAll<HTMLInputElement>('input[type="text"]')].find(input => !input.getAttribute('aria-hidden'));
    const message = root.querySelector<HTMLTextAreaElement>('textarea:not([aria-hidden="true"])');
    const submit = [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => text(button) === '문의 보내기');
    const fields = [email, subject, message].filter((field): field is HTMLInputElement | HTMLTextAreaElement => !!field);
    const errors = new Map<HTMLElement, HTMLElement>();
    fields.forEach(field => {
      const control = field.closest<HTMLElement>('.MuiFormControl-root');
      const label = control?.querySelector<HTMLElement>('label');
      const legend = control?.querySelector<HTMLElement>('legend');
      const floatLabel = (focused: boolean) => {
        const shrunk = focused || !!field.value;
        if (label) {
          attr(label, 'data-shrink', String(shrunk));
          style(label, { transform: shrunk ? 'translate(14px, -9px) scale(0.75)' : '', color: focused ? '#03c75a' : '' });
        }
        if (legend) style(legend, { maxWidth: shrunk ? '100%' : '0.01px' });
      };
      on(field, 'focus', () => floatLabel(true));
      on(field, 'blur', () => floatLabel(false));
      on(field, 'input', () => {
        field.setCustomValidity('');
        attr(field, 'aria-invalid', 'false');
        if (errors.has(field)) field.removeAttribute('aria-describedby');
        errors.get(field)?.remove();
        errors.delete(field);
        floatLabel(document.activeElement === field);
      });
    });
    // 캡처 당시 이메일 칸에 placeholder 값(demo@example.com)이 들어 있었다. 실제 문의가 엉뚱한 주소로 가지 않도록 비우고,
    // 로그인한 회원이면 계정 이메일을 기본값으로 넣는다.
    const setEmail = (value: string) => {
      if (!email) return;
      email.value = value;
      email.dispatchEvent(new Event('input', { bubbles: true }));
      email.dispatchEvent(new Event('blur'));
    };
    if (email && email.value === email.placeholder) setEmail('');
    let alive = true;
    dispose.push(() => { alive = false; });
    void api<{ user: { email: string } }>('/api/auth/me').then(me => { if (alive && email && !email.value) setEmail(me.user.email); }).catch(() => undefined);
    const invalid = (field: HTMLInputElement | HTMLTextAreaElement, message: string) => {
      field.setCustomValidity(message);
      attr(field, 'aria-invalid', 'true');
      const error = errors.get(field) || add(document.createElement('p'));
      error.id = `${field.id || 'contact-field'}-local-error`;
      error.textContent = message;
      error.style.cssText = 'color:#f87171;font-size:12px;margin:4px 14px 0;';
      error.setAttribute('role', 'alert');
      field.closest('.MuiFormControl-root')?.append(error);
      attr(field, 'aria-describedby', error.id);
      errors.set(field, error);
    };
    let menu: HTMLElement | null = null;
    let selectedType = '기타';
    const types = ['서비스 이용', '기술 문의', '기업/B2B 도입 문의', '파트너십', '기타'];
    const closeMenu = () => {
      menu?.remove(); menu = null;
      if (combo) attr(combo, 'aria-expanded', 'false');
    };
    const openMenu = () => {
      if (!combo || menu) return;
      attr(combo, 'aria-expanded', 'true');
      const parent = combo.parentElement!;
      style(parent, { position: 'relative' });
      menu = add(document.createElement('div'));
      menu.id = 'naeo-contact-types';
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', '문의 유형');
      menu.style.cssText = 'position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:1301;padding:6px 0;background:#242424;color:#e0e0e0;border:1px solid #ffffff20;border-radius:6px;box-shadow:0 8px 24px #0008;';
      attr(combo, 'aria-controls', menu.id);
      types.forEach((type, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(type === selectedType));
        option.textContent = type;
        option.style.cssText = `display:block;width:100%;padding:10px 14px;text-align:left;font:inherit;font-size:14px;border:0;color:inherit;cursor:pointer;background:${type === selectedType ? '#03c75a25' : 'transparent'};`;
        option.addEventListener('mouseenter', () => { option.style.background = '#ffffff14'; });
        option.addEventListener('mouseleave', () => { option.style.background = type === selectedType ? '#03c75a25' : 'transparent'; });
        option.addEventListener('click', event => {
          event.preventDefault();
          selectedType = type;
          combo.textContent = type;
          const input = parent.querySelector<HTMLInputElement>('input');
          if (input) input.value = ['service', 'technical', 'business', 'partnership', 'etc'][index];
          closeMenu();
          combo.focus();
        });
        option.addEventListener('keydown', event => {
          if (event.key === 'Escape') { event.preventDefault(); closeMenu(); combo.focus(); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const options = [...menu!.querySelectorAll<HTMLButtonElement>('button')];
            options[(index + (event.key === 'ArrowDown' ? 1 : types.length - 1)) % types.length].focus();
          }
        });
        menu!.append(option);
      });
      parent.append(menu);
      menu.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    };
    if (combo) {
      const initialText = combo.textContent;
      dispose.push(() => { combo.textContent = initialText; });
      on(combo, 'click', event => { event.preventDefault(); if (menu) closeMenu(); else openMenu(); });
      on(combo, 'keydown', event => {
        if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes((event as KeyboardEvent).key)) { event.preventDefault(); openMenu(); }
      });
      on(document, 'pointerdown', event => { if (menu && !combo.parentElement?.contains(event.target as Node)) closeMenu(); });
    }
    const typeValue = () => ['service', 'technical', 'business', 'partnership', 'etc'][Math.max(0, types.indexOf(selectedType))];
    const showServerErrors = (error: ApiError) => {
      const details = Array.isArray(error.details) ? error.details as { path?: string; message?: string }[] : [];
      const target = (path: string) => path === 'email' ? email : path === 'message' ? message : path === 'subject' ? subject : undefined;
      const marked = details.map(d => { const field = target(d.path || ''); if (field) invalid(field, d.path === 'email' ? '회신받을 이메일 주소를 올바르게 입력해주세요.' : d.message || '입력 내용을 확인해주세요.'); return field; }).filter(Boolean);
      if (marked.length) marked[0]!.focus(); else tools.toast(error.message);
    };
    const clearForm = () => [subject, message].forEach(field => {
      if (!field) return;
      field.value = '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('blur'));
    });
    const openHistory = () => tools.openDialog('내 문의 내역', <MyInquiries onLogin={() => { tools.closeDialog(); tools.navigate('/login?next=/contact'); }} />);
    let sending = false;
    if (submit) on(submit, 'click', async event => {
      event.preventDefault();
      if (!email || !message || sending) return;
      fields.forEach(field => field.setCustomValidity(''));
      let failed = false;
      if (!email.value.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
        invalid(email, '회신받을 이메일 주소를 올바르게 입력해주세요.');
        failed = true;
      }
      if (!message.value.trim()) { invalid(message, '문의 내용을 입력해주세요.'); failed = true; }
      if (failed) { (email.getAttribute('aria-invalid') === 'true' ? email : message).focus(); return; }
      sending = true;
      attr(submit, 'aria-busy', 'true');
      submit.disabled = true;
      try {
        const created = await api<{ received?: true; id?: string }>('/api/inquiries', { method: 'POST', body: { type: typeValue(), email: email.value.trim(), subject: subject?.value.trim() || '', message: message.value.trim() } });
        const member = !!created.id;
        clearForm();
        tools.openDialog('문의가 접수되었습니다', <div style={{ display: 'grid', gap: 16 }}>
          <p>{member ? '답변이 등록되면 내 문의 내역에서 확인할 수 있습니다. 답변 전에는 문의를 수정·삭제할 수 있습니다.' : '남겨주신 회신 이메일로 답변을 안내드립니다.'}</p>
          <p style={{ color: '#a3a3a3', fontSize: 14 }}>문의 유형: {selectedType}<br />회신받을 이메일: {email.value.trim()}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{member && <button className="naeo-button" onClick={openHistory}>내 문의 내역</button>}<button className="naeo-button" onClick={tools.closeDialog}>확인</button></div>
        </div>);
      } catch (error) {
        if (error instanceof ApiError && error.status === 400) showServerErrors(error);
        else tools.toast(error instanceof Error ? error.message : '문의를 보내지 못했습니다. 잠시 후 다시 시도해주세요.');
      } finally {
        sending = false;
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
      }
    });
    if (submit?.parentElement) {
      const history = add(document.createElement('button')) as HTMLButtonElement;
      history.type = 'button';
      history.textContent = '내 문의 내역';
      history.className = submit.className.replace(/MuiButton-contained\S*/g, '').replace(/\s+/g, ' ');
      history.style.cssText = 'margin-top:12px;width:100%;min-height:44px;background:transparent;border:1px solid #ffffff30;border-radius:8px;color:inherit;font:inherit;font-size:15px;cursor:pointer;';
      history.addEventListener('click', openHistory);
      submit.insertAdjacentElement('afterend', history);
    }
    dispose.push(closeMenu, () => fields.forEach(field => field.setCustomValidity('')));
  }

  return () => {
    dispose.reverse().forEach(clean => clean());
    generated.forEach(el => el.remove());
    saved.forEach((attrs, el) => attrs.forEach((value, key) => { if (value == null) el.removeAttribute(key); else el.setAttribute(key, value); }));
  };
};
