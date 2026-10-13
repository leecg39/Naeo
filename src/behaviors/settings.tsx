'use client';

import { useState } from 'react';
import type { InstallBehavior } from '@/lib/behavior';
import { text } from '@/lib/behavior';
import { profile, readStore, writeStore } from '@/lib/demo-store';

const TOPICS = ['문학·책', '영화', '미술·디자인', '공연·전시', '음악', '드라마', '스타·연예인', '만화·애니', '방송', '일상·생각', '육아·결혼', '반려동물', '좋은글·이미지', '패션·미용', '인테리어·DIY', '요리·레시피', '상품리뷰', '원예·재배', '게임', '스포츠', '사진', '자동차', '취미', '국내여행', '세계여행', '맛집', 'IT·컴퓨터', '사회·정치', '건강·의학', '비즈니스·경제', '어학·외국어', '교육·학문'];
const CHECKED = 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z';
const UNCHECKED = 'M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z';
const fieldStyle = { width: '100%', border: '1px solid #444', borderRadius: 6, padding: '11px 13px', color: '#e0e0e0', background: '#222', font: 'inherit' };

type Contact = { name: string; phone: string; email: string; emailMode: 'account' | 'custom'; verified: boolean; required: boolean; marketing: boolean };

function PhoneVerification({ onVerified }: { onVerified: () => void }) {
 const [code, setCode] = useState('');
 const [error, setError] = useState('');
 return <form onSubmit={event => { event.preventDefault(); if (code.trim() !== '123456') { setError('인증번호가 일치하지 않아요. 123456을 입력해주세요.'); return; } onVerified(); }}>
  <p style={{ color: '#a3a3a3', margin: '0 0 16px' }}>데모 인증번호는 <strong style={{ color: '#03c75a' }}>123456</strong>입니다. 문자는 발송되지 않습니다.</p>
  <label htmlFor="settings-phone-code">인증번호</label>
  <input id="settings-phone-code" style={{ ...fieldStyle, marginTop: 8 }} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, '')); setError(''); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'settings-phone-error' : undefined} />
  {error && <p id="settings-phone-error" role="alert" style={{ color: '#ff8585', fontSize: 13 }}>{error}</p>}
  <button type="submit" className="naeo-button" style={{ width: '100%', marginTop: 16, background: '#03c75a', color: '#fff', padding: 11, borderRadius: 6 }}>인증 확인</button>
 </form>;
}

function ConfirmAction({ description, label, onConfirm, onCancel, danger = false }: { description: string; label: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
 return <div><p style={{ margin: '0 0 24px', color: '#a3a3a3', lineHeight: 1.7 }}>{description}</p><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
  <button type="button" className="naeo-button" onClick={onCancel} style={{ border: '1px solid #444', padding: '9px 16px', borderRadius: 6 }}>취소</button>
  <button type="button" className="naeo-button" onClick={onConfirm} style={{ background: danger ? '#c7463b' : '#03c75a', color: 'white', padding: '9px 16px', borderRadius: 6 }}>{label}</button>
 </div></div>;
}

function enabled(button: HTMLButtonElement | null, allow: boolean) {
 if (!button) return;
 button.disabled = !allow;
 button.classList.toggle('Mui-disabled', !allow);
 button.tabIndex = allow ? 0 : -1;
}

function checked(input: HTMLInputElement, value: boolean) {
 input.checked = value;
 input.parentElement?.classList.toggle('Mui-checked', value);
 if (input.type === 'radio') {
  const dot = input.parentElement?.querySelectorAll<SVGElement>('svg')[1];
  if (dot) dot.style.transform = value ? 'scale(1)' : 'scale(0)';
 } else if (input.getAttribute('role') !== 'switch') {
  input.parentElement?.querySelector('svg path')?.setAttribute('d', value ? CHECKED : UNCHECKED);
 }
}

function blogId(value: string) {
 const trimmed = value.trim();
 if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/.test(trimmed)) return trimmed;
 try {
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (!['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname.toLowerCase())) return null;
  const id = url.searchParams.get('blogId') || url.pathname.split('/').filter(Boolean)[0] || '';
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/.test(id) ? id : null;
 } catch { return null; }
}

export const installSettings: InstallBehavior = (root, tools) => {
 if (tools.pathname !== '/dashboard/settings') return;
 const nickname = root.querySelector<HTMLInputElement>('input[placeholder="닉네임을 입력하세요"]');
 const nicknameSave = nickname?.closest('.mui-dx14h6')?.querySelector<HTMLButtonElement>('button') || null;
 const blog = root.querySelector<HTMLInputElement>('input[placeholder^="예: https://blog.naver.com"]');
 const blogSave = blog?.closest('.mui-nmy5ba')?.querySelector<HTMLButtonElement>('button') || null;
 const form = root.querySelector<HTMLFormElement>('form');
 const nameInput = form?.querySelector<HTMLInputElement>('input[autocomplete="name"]');
 const phoneInput = form?.querySelector<HTMLInputElement>('input[autocomplete="tel"]');
 const phoneButton = form?.querySelector<HTMLButtonElement>('[data-tour="phone-verify"]') || null;
 const contactSave = form?.querySelector<HTMLButtonElement>('button[type="submit"]') || null;
 const radios = [...(form?.querySelectorAll<HTMLInputElement>('input[type="radio"]') || [])];
 const consents = [...(form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') || [])];
 const switches = [...root.querySelectorAll<HTMLInputElement>('input[role="switch"]')];
 const combo = root.querySelector<HTMLElement>('[role="combobox"]');
 const topicSection = combo?.closest('.mui-16r22a5');
 const topicSave = [...(topicSection?.querySelectorAll<HTMLButtonElement>('button') || [])].find(button => text(button) === '저장') || null;
 const coupon = root.querySelector<HTMLInputElement>('input[placeholder="쿠폰 코드 입력"]');
 const couponSave = coupon?.parentElement?.parentElement?.parentElement?.querySelector<HTMLButtonElement>('button') || null;
 const basicButton = [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => text(button) === '현재 요금제') || null;
 const freeLink = [...root.querySelectorAll<HTMLAnchorElement>('a')].find(link => text(link) === '구독 해지하기') || null;
 const savedContact = readStore<Contact>('settings-contact', { name: '', phone: '', email: 'demo@example.com', emailMode: 'account', verified: false, required: true, marketing: true });
 let verifiedPhone = savedContact.verified ? savedContact.phone.replace(/\D/g, '') : '';
 let topic = readStore<string>('settings-topic', '');
 let savedTopic = topic;
 let topicMenu: HTMLDivElement | null = null;
 let disposed = false;
 const additions: HTMLElement[] = [];
 const email = document.createElement('input');
 email.type = 'email'; email.autocomplete = 'email'; email.placeholder = '이메일 주소를 입력하세요'; email.setAttribute('aria-label', '연락 받을 이메일');
 email.dataset.settingsEmail = 'true';
 Object.assign(email.style, fieldStyle, { borderRadius: '6px', marginTop: '8px', marginBottom: '12px' });
 email.value = savedContact.emailMode === 'custom' ? savedContact.email : '';
 const radioGroup = radios[0]?.closest('[role="radiogroup"]') || radios[0]?.closest('label')?.parentElement;
 radioGroup?.insertAdjacentElement('afterend', email);
 if (email.parentElement) additions.push(email);

 if (nickname) nickname.value = profile().nickname;
 if (blog) blog.value = `https://blog.naver.com/${profile().blogId}`;
 if (nameInput) nameInput.value = savedContact.name;
 if (phoneInput) phoneInput.value = savedContact.phone;
 radios.forEach(input => checked(input, input.value === savedContact.emailMode));
 if (consents.length === 3) {
  checked(consents[1], savedContact.required); checked(consents[2], savedContact.marketing);
  checked(consents[0], savedContact.required && savedContact.marketing);
 }
 if (switches[0]) { switches[0].setAttribute('aria-label', '랭킹 프로필 공개'); checked(switches[0], readStore('settings-ranking-public', true)); }
 if (switches[1]) { switches[1].setAttribute('aria-label', '자동 스캔'); checked(switches[1], readStore('settings-autoscan', true)); }
 if (combo && topic) combo.textContent = topic;

 function customEmail() { return radios.some(radio => radio.value === 'custom' && radio.checked); }
 function normalizedPhone() { return phoneInput?.value.replace(/\D/g, '') || ''; }
 function validContact() {
  const address = customEmail() ? email.value.trim() : 'demo@example.com';
  return Boolean(nameInput?.value.trim() && normalizedPhone() === verifiedPhone && /^010\d{8}$/.test(verifiedPhone) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && consents[1]?.checked);
 }
 function fieldLabel(element: HTMLElement | null | undefined, value: string) {
  const control = element?.closest('.MuiFormControl-root');
  if (!control) return;
  const focused = document.activeElement === element;
  const shrink = Boolean(value) || focused;
  const label = control.querySelector<HTMLElement>('.MuiInputLabel-root');
  const outline = control.querySelector<HTMLElement>('.MuiOutlinedInput-root');
  outline?.classList.toggle('Mui-focused', focused);
  if (label) {
   label.classList.toggle('Mui-focused', focused);
   label.classList.toggle('MuiInputLabel-shrink', shrink);
   label.setAttribute('data-shrink', String(shrink));
   label.style.transform = shrink ? 'translate(14px, -9px) scale(0.75)' : '';
  }
  const legend = control.querySelector<HTMLElement>('legend');
  if (legend && label) legend.style.maxWidth = shrink ? '100%' : '0.01px';
 }
 function refresh() {
  enabled(nicknameSave, Boolean(nickname?.value.trim() && nickname.value.trim() !== profile().nickname));
  enabled(blogSave, Boolean(blog?.value.trim() && blog.value.trim() !== `https://blog.naver.com/${profile().blogId}`));
  enabled(phoneButton, /^010\d{8}$/.test(normalizedPhone()));
  if (phoneButton) phoneButton.textContent = normalizedPhone() && normalizedPhone() === verifiedPhone ? '인증 완료' : '인증번호 받기';
  email.hidden = !customEmail();
  enabled(contactSave, validContact());
  if (contactSave) contactSave.textContent = verifiedPhone && normalizedPhone() === verifiedPhone ? '연락처 저장' : '휴대폰 인증 후 저장할 수 있어요';
  enabled(topicSave, topic !== savedTopic);
  enabled(couponSave, Boolean(coupon?.value.trim()));
  const isBasic = profile().plan === 'basic';
  enabled(basicButton, !isBasic);
  if (basicButton) basicButton.textContent = isBasic ? '현재 요금제' : '베이직 체험하기';
  if (freeLink) { freeLink.textContent = isBasic ? '구독 해지하기' : '현재 요금제'; freeLink.setAttribute('aria-disabled', String(!isBasic)); }
  [nameInput, phoneInput, nickname, blog, coupon].forEach(input => fieldLabel(input, input?.value || ''));
  fieldLabel(combo, topic);
  if (switches[1]) {
   const card = switches[1].closest('.mui-i3pbo');
   const badge = card && [...card.querySelectorAll<HTMLElement>('span')].find(el => el.children.length === 0 && ['활성', '비활성'].includes(text(el)));
   if (badge) badge.textContent = switches[1].checked ? '활성' : '비활성';
  }
 }

 function closeTopics() {
  topicMenu?.remove(); topicMenu = null;
  combo?.setAttribute('aria-expanded', 'false');
 }
 function openTopics() {
  if (!combo) return;
  if (topicMenu) { closeTopics(); return; }
  const rect = combo.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', '서브 주제'); menu.id = 'settings-topic-options';
  Object.assign(menu.style, { position: 'fixed', zIndex: '1500', left: `${Math.max(8, rect.left)}px`, top: `${Math.min(rect.bottom + 5, window.innerHeight - 280)}px`, width: `${Math.min(rect.width, window.innerWidth - 16)}px`, maxHeight: '270px', overflowY: 'auto', background: '#242424', border: '1px solid #444', borderRadius: '6px', padding: '6px', boxShadow: '0 8px 30px #0008' });
  for (const value of ['', ...TOPICS]) {
   const option = document.createElement('button'); option.type = 'button'; option.dataset.settingsTopic = value; option.textContent = value || '선택 안 함';
   option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(value === topic));
   Object.assign(option.style, { display: 'block', width: '100%', textAlign: 'left', color: value === topic ? '#03c75a' : '#e0e0e0', background: value === topic ? '#03c75a18' : 'transparent', padding: '9px 12px', border: '0', borderRadius: '4px', cursor: 'pointer', font: 'inherit', fontSize: '14px' });
   menu.append(option);
  }
  root.append(menu); topicMenu = menu;
  combo.setAttribute('aria-expanded', 'true'); combo.setAttribute('aria-controls', menu.id);
  (menu.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus();
 }
 function confirmPlan(plan: 'basic' | 'free') {
  tools.openDialog(plan === 'free' ? '구독 해지' : '베이직 체험', <ConfirmAction description={plan === 'free' ? '이 브라우저의 데모 요금제를 무료로 변경합니다. 실제 구독이나 결제에는 영향을 주지 않습니다.' : '이 브라우저에서 베이직 기능을 체험합니다. 실제 결제는 진행되지 않습니다.'} label={plan === 'free' ? '무료로 변경' : '체험 시작'} onCancel={tools.closeDialog} onConfirm={() => { writeStore('profile', { ...profile(), plan }); if (!disposed) refresh(); tools.closeDialog(); tools.toast(plan === 'free' ? '무료 요금제로 변경했어요.' : '베이직 체험을 시작했어요.'); }} />);
 }
 function saveContact(event: Event) {
  event.preventDefault();
  if (!validContact()) { tools.toast('이름, 인증된 휴대폰 번호, 이메일과 필수 동의를 확인해주세요.'); return; }
  writeStore<Contact>('settings-contact', { name: nameInput!.value.trim(), phone: phoneInput!.value.trim(), email: customEmail() ? email.value.trim() : 'demo@example.com', emailMode: customEmail() ? 'custom' : 'account', verified: true, required: Boolean(consents[1]?.checked), marketing: Boolean(consents[2]?.checked) });
  tools.toast('연락처를 저장했어요.');
 }
 function click(event: MouseEvent) {
  const element = event.target instanceof Element ? event.target : null;
  if (!element) return;
  const button = element.closest<HTMLElement>('button, a, [role="combobox"]');
  if (!button || !root.contains(button)) return;
  if (button.hasAttribute('data-settings-topic')) {
   event.preventDefault(); topic = button.dataset.settingsTopic || ''; if (combo) combo.textContent = topic || '\u200b'; closeTopics(); combo?.focus(); refresh(); return;
  }
  if (button === combo) { event.preventDefault(); openTopics(); return; }
  if (button === nicknameSave) {
   event.preventDefault(); const value = nickname?.value.trim() || '';
   if (!value || value.length > 30) { tools.toast('닉네임을 1~30자로 입력해주세요.'); return; }
   writeStore('profile', { ...profile(), nickname: value }); refresh(); tools.toast('닉네임을 저장했어요.'); return;
  }
  if (button === blogSave) {
   event.preventDefault(); const id = blogId(blog?.value || '');
   if (!id) { blog?.setAttribute('aria-invalid', 'true'); tools.toast('올바른 네이버 블로그 주소 또는 아이디를 입력해주세요.'); return; }
   writeStore('profile', { ...profile(), blogId: id }); if (blog) { blog.value = `https://blog.naver.com/${id}`; blog.setAttribute('aria-invalid', 'false'); } refresh(); tools.toast('블로그 주소를 저장했어요.'); return;
  }
  if (button === phoneButton) {
   event.preventDefault(); const phone = normalizedPhone(); if (!/^010\d{8}$/.test(phone)) { tools.toast('올바른 휴대폰 번호를 입력해주세요.'); return; }
   tools.openDialog('휴대폰 인증', <PhoneVerification onVerified={() => { verifiedPhone = phone; if (!disposed) refresh(); tools.closeDialog(); tools.toast('휴대폰 인증을 완료했어요.'); }} />); return;
  }
  if (button === contactSave) { saveContact(event); return; }
  if (button === topicSave) { event.preventDefault(); savedTopic = topic; writeStore('settings-topic', topic); refresh(); tools.toast('서브 주제를 저장했어요.'); return; }
  if (button === couponSave) {
   event.preventDefault(); const code = coupon?.value.trim().toUpperCase();
   if (code !== 'NAEO-DEMO') { tools.toast('유효하지 않은 쿠폰이에요. 데모 쿠폰: NAEO-DEMO'); return; }
   if (readStore('settings-coupon-used', false)) { tools.toast('이미 사용한 쿠폰이에요.'); return; }
   writeStore('profile', { ...profile(), credits: profile().credits + 10 }); writeStore('settings-coupon-used', true);
   if (coupon) coupon.value = ''; refresh(); tools.toast('쿠폰을 적용했어요. 분석 크레딧 10회가 추가됐어요.'); return;
  }
  const label = text(button);
  if (label === '대시보드로 돌아가기') { event.preventDefault(); tools.navigate('/dashboard'); return; }
  if (label === '다시 확인' && topicSection?.contains(button)) { event.preventDefault(); tools.toast('메인 주제는 비즈니스·경제로 확인됐어요.'); return; }
  if (button === basicButton) { event.preventDefault(); confirmPlan('basic'); return; }
  if (button === freeLink || /^구독 해지/.test(label)) { event.preventDefault(); if (profile().plan === 'free') tools.toast('현재 무료 요금제를 이용 중이에요.'); else confirmPlan('free'); return; }
  if (label === '회원 탈퇴') {
   event.preventDefault(); tools.openDialog('회원 탈퇴', <ConfirmAction danger description="이 브라우저에 저장한 NAEO 데모 프로필, 작성한 글과 설정을 삭제합니다. 실제 NAEO 계정은 변경되지 않습니다." label="데모 데이터 삭제" onCancel={tools.closeDialog} onConfirm={() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('naeo-clone:')) localStorage.removeItem(key);
    window.dispatchEvent(new CustomEvent('naeo-store', { detail: 'reset' })); tools.closeDialog(); tools.toast('데모 데이터를 삭제했어요.'); tools.navigate('/');
   }} />); return;
  }
  if (label === '내용 보기' || label === '내용 접기') {
   const panel = button.parentElement?.querySelector<HTMLElement>('.MuiCollapse-root');
   if (!panel) return; event.preventDefault();
   const expanded = button.getAttribute('aria-expanded') !== 'true'; button.setAttribute('aria-expanded', String(expanded));
   panel.classList.toggle('MuiCollapse-hidden', !expanded); panel.classList.toggle('MuiCollapse-entered', expanded);
   panel.style.height = expanded ? `${panel.scrollHeight}px` : '0px'; panel.style.visibility = expanded ? 'visible' : 'hidden';
   const arrow = button.querySelector<SVGElement>('svg'); if (arrow) { arrow.style.transition = 'transform 200ms'; arrow.style.transform = expanded ? 'rotate(180deg)' : ''; }
   const labelNode = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE); if (labelNode) labelNode.textContent = expanded ? '내용 접기' : '내용 보기';
  }
 }
 function change(event: Event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (radios.includes(input)) radios.forEach(radio => checked(radio, radio === input));
  if (consents.includes(input)) {
   if (input === consents[0]) { consents.slice(1).forEach(consent => checked(consent, input.checked)); }
   else checked(consents[0], Boolean(consents[1]?.checked && consents[2]?.checked));
   checked(input, input.checked);
   if (consents[0]) { consents[0].indeterminate = Boolean(consents[1]?.checked !== consents[2]?.checked); consents[0].setAttribute('data-indeterminate', String(consents[0].indeterminate)); }
  }
  if (switches.includes(input)) {
   checked(input, input.checked); writeStore(input === switches[0] ? 'settings-ranking-public' : 'settings-autoscan', input.checked);
   tools.toast(input === switches[0] ? (input.checked ? '랭킹 프로필을 공개했어요.' : '랭킹 프로필을 비공개로 변경했어요.') : (input.checked ? '자동 스캔을 켰어요.' : '자동 스캔을 껐어요.'));
  }
  refresh();
 }
 function input() { refresh(); }
 function keydown(event: KeyboardEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (target === combo && ['Enter', ' ', 'ArrowDown'].includes(event.key)) { event.preventDefault(); openTopics(); return; }
  if (!topicMenu) return;
  if (event.key === 'Escape') { event.preventDefault(); closeTopics(); combo?.focus(); return; }
  if (!target || !topicMenu.contains(target)) return;
  const options = [...topicMenu.querySelectorAll<HTMLButtonElement>('button')];
  const current = options.indexOf(target as HTMLButtonElement);
  const next = event.key === 'ArrowDown' ? (current + 1) % options.length : event.key === 'ArrowUp' ? (current + options.length - 1) % options.length : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1;
  if (next >= 0) { event.preventDefault(); options[next].focus(); }
 }
 function outside(event: PointerEvent) { if (topicMenu && event.target instanceof Node && !topicMenu.contains(event.target) && !combo?.contains(event.target)) closeTopics(); }
 root.addEventListener('click', click);
 root.addEventListener('input', input);
 root.addEventListener('change', change);
 root.addEventListener('focusin', input);
 root.addEventListener('focusout', input);
 root.addEventListener('keydown', keydown);
 form?.addEventListener('submit', saveContact);
 document.addEventListener('pointerdown', outside);
 window.addEventListener('resize', closeTopics);
 refresh();
 return () => {
  disposed = true; closeTopics(); additions.forEach(element => element.remove());
  root.removeEventListener('click', click); root.removeEventListener('input', input); root.removeEventListener('change', change); root.removeEventListener('keydown', keydown); root.removeEventListener('focusin', input); root.removeEventListener('focusout', input);
  form?.removeEventListener('submit', saveContact); document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', closeTopics);
 };
};
