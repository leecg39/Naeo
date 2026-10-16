'use client';

import { text, type BehaviorTools, type InstallBehavior } from '@/lib/behavior';
import { api, ApiError } from '@/lib/api-client';
import { uploadPhoto } from '@/components/writing/DraftMedia';
import { OPEN_DRAFT_EVENT } from '@/components/writing/DraftsWorkspace';

// Exact writing subcategories and order observed in the source dropdown.
// 생성은 이 서비스의 /api/generations(서버 AI 공급자)로 요청한다. 원본 서비스 API는 호출하지 않는다.
const TOPICS = ['영화','방송','스타·연예인','애니메이션','IT·테크','상품리뷰','자동차','교육','어학·외국어','경제','사회','일상·생각','(미분류)','리빙','원예·재배','반려동물','건강','육아','레시피','스포츠','게임','취미','사진','좋은글·이미지','공연·전시','음악','책','예술','패션','뷰티','국내여행','해외여행','푸드'];

export const installWrite: InstallBehavior = (root, tools) => {
  const main = root.querySelector('main') || root;
  const keyword = main.querySelector<HTMLInputElement>('input[maxlength="60"]');
  const combo = main.querySelector<HTMLElement>('[role="combobox"]');
  const generate = [...main.querySelectorAll<HTMLButtonElement>('button')].find(b => /^글 생성하기/.test(text(b)));
  if (!keyword || !combo || !generate) return;
  const categoryInput = combo.parentElement?.querySelector<HTMLInputElement>('.MuiSelect-nativeInput');
  const fileInput = main.querySelector<HTMLInputElement>('input[type="file"]');
  const uploadArea = main.querySelector<HTMLElement>('[aria-label="사진 선택"]');
  const imageButtons = [...main.querySelectorAll<HTMLButtonElement>('button[aria-pressed][value]')];
  const experience = main.querySelector<HTMLTextAreaElement>('textarea[maxlength="1000"]');
  const titleInput = [...main.querySelectorAll<HTMLInputElement>('input[type="text"]')].find(el => el !== keyword);
  const instructions = [...main.querySelectorAll<HTMLTextAreaElement>('textarea:not([aria-hidden="true"])')].find(el => el !== experience);
  const imageSummary = [...main.querySelectorAll<HTMLElement>('p')].find(el => text(el).startsWith('→ 총'));
  const photoCounter = [...main.querySelectorAll<HTMLElement>('span')].find(el => /^사진 \d+\/20$/.test(text(el)));
  const cleanups: (() => void)[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const photos: { file: File; url: string }[] = [];
  let category = categoryInput?.value || '';
  let imageCount = Number(imageButtons.find(b => b.getAttribute('aria-pressed') === 'true')?.value || 3);
  let generating = false;
  let disposed = false;
  let menu: HTMLDivElement | null = null;
  const previews = document.createElement('div');
  previews.setAttribute('aria-label', '선택한 사진');
  previews.style.cssText = 'display:none;grid-template-columns:repeat(auto-fill,minmax(95px,1fr));gap:10px;margin-top:12px';
  uploadArea?.insertAdjacentElement('afterend', previews);
  const progress = document.createElement('p');
  progress.setAttribute('role', 'status');
  progress.style.cssText = 'display:none;margin:12px 0 0;font-size:13px;color:var(--primary)';
  generate.insertAdjacentElement('afterend', progress);
  const originalGenerate = { text: generate.textContent, disabled: generate.disabled, tabIndex: generate.tabIndex };
  const originalSummary = imageSummary?.textContent;
  const originalCounter = photoCounter?.textContent;
  const originalUploadTab = uploadArea?.getAttribute('tabindex');
  const listeners = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Document, name: K, handler: (event: HTMLElementEventMap[K]) => void) => {
    el.addEventListener(name, handler as EventListener);
    cleanups.push(() => el.removeEventListener(name, handler as EventListener));
  };
  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => { timers.delete(timer); if (!disposed) fn(); }, ms);
    timers.add(timer);
  };
  const fieldState = (field: HTMLElement, filled: boolean, focused = false) => {
    const control = field.closest('.MuiFormControl-root');
    const label = control?.querySelector<HTMLElement>('label');
    const outline = field.closest('.MuiInputBase-root');
    outline?.classList.toggle('Mui-focused', focused);
    label?.classList.toggle('Mui-focused', focused);
    label?.classList.toggle('MuiInputLabel-shrink', filled || focused);
    label?.setAttribute('data-shrink', String(filled || focused));
    // Captured Emotion classes describe the initial empty state. MUI's dynamic
    // floating-label transform is recreated for interactive inputs.
    if (label) {
      label.style.transform = filled || focused ? 'translate(14px, -9px) scale(0.75)' : '';
      label.style.color = focused ? 'var(--primary)' : '';
    }
    const legend = control?.querySelector<HTMLElement>('legend');
    if (legend) legend.style.maxWidth = filled || focused ? '100%' : '';
  };
  const aiImages = () => Math.max(0, imageCount - photos.length);
  // AI 이미지 공급자가 설정됐을 때만 장당 비용을 더한다(서버가 미설정이면 data-image-cost=0).
  const imageCost = Number(generate.dataset.imageCost || 0);
  const tokens = () => 10 + imageCost * aiImages();
  const sync = () => {
    const valid = keyword.value.trim().length > 0 && category.length > 0;
    generate.disabled = !valid || generating;
    generate.classList.toggle('Mui-disabled', generate.disabled);
    generate.tabIndex = generate.disabled ? -1 : 0;
    if (!generating) generate.textContent = `글 생성하기 (${tokens()}토큰)`;
    for (const button of imageButtons) {
      const selected = Number(button.value) === imageCount;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('Mui-selected', selected);
    }
    if (imageSummary) imageSummary.textContent = imageCost
      ? `→ 내 사진 ${photos.length}장 + AI 이미지 ${aiImages()}장이 들어가요`
      : photos.length
        ? `→ 내 사진 ${photos.length}장이 들어가요${aiImages() ? ` · AI 이미지 ${aiImages()}장은 미설정이라 만들지 않아요` : ''}`
        : `→ AI 이미지 ${imageCount}장은 미설정이라 만들지 않아요. 글만 만들어지고, 내 사진을 올리면 함께 들어가요.`;
    if (photoCounter) photoCounter.textContent = `사진 ${photos.length}/20`;
  };
  const renderPhotos = () => {
    previews.replaceChildren();
    previews.style.display = photos.length ? 'grid' : 'none';
    photos.forEach((photo, index) => {
      const figure = document.createElement('figure');
      figure.style.cssText = 'position:relative;margin:0';
      const image = document.createElement('img');
      image.src = photo.url;
      image.alt = photo.file.name;
      image.style.cssText = 'width:100%;height:90px;object-fit:cover;border-radius:6px';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `${photo.file.name} 사진 삭제`);
      remove.style.cssText = 'position:absolute;right:4px;top:4px;background:#121212;color:#fff;border:1px solid #555;border-radius:50%;width:24px;height:24px;cursor:pointer;line-height:18px';
      remove.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        URL.revokeObjectURL(photo.url);
        photos.splice(index, 1);
        renderPhotos();
        sync();
      };
      figure.append(image, remove);
      previews.append(figure);
    });
  };
  const addPhotos = (files: FileList | File[]) => {
    const all = Array.from(files);
    const valid = all.filter(file => ['image/jpeg','image/png','image/webp'].includes(file.type));
    if (valid.length !== all.length) tools.toast('JPG, PNG, WEBP 사진을 선택해 주세요.');
    if (valid.length + photos.length > 20) tools.toast('사진은 최대 20장까지 선택할 수 있어요.');
    for (const file of valid.slice(0, 20 - photos.length)) photos.push({ file, url: URL.createObjectURL(file) });
    renderPhotos();
    sync();
    if (fileInput) fileInput.value = '';
  };
  const closeMenu = (refocus = false) => {
    menu?.remove();
    menu = null;
    combo.setAttribute('aria-expanded', 'false');
    combo.removeAttribute('aria-controls');
    if (refocus) combo.focus();
    fieldState(combo, !!category, refocus);
  };
  const openMenu = () => {
    if (menu) { closeMenu(true); return; }
    menu = document.createElement('div');
    menu.id = 'naeo-write-topics';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', '소분류');
    const rect = combo.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const maxHeight = Math.min(320, Math.max(120, spaceBelow < 150 ? rect.top - 12 : spaceBelow));
    const top = spaceBelow < 150 ? Math.max(8, rect.top - maxHeight) : rect.bottom + 4;
    menu.style.cssText = `position:fixed;z-index:1500;left:${Math.max(8, rect.left)}px;top:${top}px;width:${Math.min(rect.width, window.innerWidth - 16)}px;max-height:${maxHeight}px;overflow:auto;padding:8px 0;border:1px solid var(--border);border-radius:6px;background:var(--card,#1a1a1a);color:var(--foreground,#e0e0e0);box-shadow:0 8px 28px #0008;font:inherit`;
    TOPICS.forEach(topic => {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(category === topic));
      option.textContent = topic;
      option.style.cssText = `display:block;width:100%;text-align:left;border:0;padding:10px 16px;font:inherit;color:inherit;cursor:pointer;background:${category === topic ? 'rgba(3,199,90,.14)' : 'transparent'}`;
      option.onfocus = () => { option.style.background = 'rgba(3,199,90,.14)'; };
      option.onblur = () => { option.style.background = category === topic ? 'rgba(3,199,90,.14)' : 'transparent'; };
      option.onclick = event => {
        event.preventDefault();
        category = topic;
        combo.textContent = topic;
        if (categoryInput) categoryInput.value = topic;
        closeMenu(true);
        sync();
      };
      option.onkeydown = event => {
        const options = [...(menu?.querySelectorAll<HTMLButtonElement>('button') || [])];
        const index = options.indexOf(option);
        const next = event.key === 'ArrowDown' ? options[(index + 1) % options.length] : event.key === 'ArrowUp' ? options[(index - 1 + options.length) % options.length] : event.key === 'Home' ? options[0] : event.key === 'End' ? options[options.length - 1] : null;
        if (next) { event.preventDefault(); next.focus(); }
        if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
        if (event.key === 'Tab') closeMenu(false);
      };
      menu?.append(option);
    });
    document.body.append(menu);
    combo.setAttribute('aria-expanded', 'true');
    combo.setAttribute('aria-controls', menu.id);
    fieldState(combo, !!category, true);
    (menu.querySelector<HTMLButtonElement>('[aria-selected="true"]') || menu.querySelector('button'))?.focus();
  };
  type Job = { id: string; state: string; draftId: string | null; errorMessage: string | null };
  const finish = (message: string) => {
    generating = false;
    generate.removeAttribute('aria-busy');
    progress.style.display = 'none';
    sync();
    tools.toast(message);
  };
  const poll = (jobId: string, round = 0) => {
    if (round > 120) { finish('생성이 오래 걸리고 있어요. 아래 "최근 AI 생성"에서 결과를 확인해 주세요.'); return; }
    later(async () => {
      try {
        const job = await api<Job>(`/api/generations/${jobId}`);
        if (job.state === 'queued' || job.state === 'running') {
          progress.textContent = job.state === 'queued' ? '대기 중 · 작업을 차례로 처리하고 있어요' : 'AI가 글을 쓰고 있어요';
          poll(jobId, round + 1); return;
        }
        if (job.state === 'succeeded' && job.draftId) {
          finish('글을 만들었어요. 아래 "내 초안"에서 고쳐 쓰세요.');
          window.dispatchEvent(new CustomEvent(OPEN_DRAFT_EVENT, { detail: job.draftId }));
          return;
        }
        finish(job.state === 'canceled' ? '생성을 취소했어요. 토큰은 환급됐어요.' : `${job.errorMessage || '생성에 실패했어요.'} 토큰은 환급됐어요.`);
      } catch (error) { finish(error instanceof Error ? error.message : '생성 상태를 확인하지 못했어요.'); }
    }, round === 0 ? 500 : 2000);
  };
  const generateDraft = () => {
    if (generating || !keyword.value.trim() || !category) return;
    if (!imageCost && aiImages() > 0) tools.toast(`AI 이미지 ${aiImages()}장은 미설정이라 빼고, 글${photos.length ? `과 내 사진 ${photos.length}장` : ''}만 만들어요.`);
    generating = true;
    sync();
    progress.style.display = 'block';
    progress.textContent = photos.length ? `내 사진 ${photos.length}장을 올리고 있어요` : '생성을 요청하고 있어요';
    generate.textContent = 'AI 글 생성 요청 중…';
    generate.setAttribute('aria-busy', 'true');
    const request = {
      keyword: keyword.value.trim(), category, title: titleInput?.value.trim() || '',
      experience: experience?.value.trim() || '', instructions: instructions?.value.trim() || '',
      // AI 이미지 공급자가 설정됐을 때만 실제 장수를 요청한다(미설정이면 서버도 503).
      aiImages: imageCost ? aiImages() : 0, idempotencyKey: crypto.randomUUID(),
      ...(() => { const id = document.querySelector<HTMLSelectElement>('#writing-template')?.value; return id ? { templateId: id } : {}; })(),
    };
    void (async () => {
      try {
        const photoIds: string[] = [];
        for (const photo of photos) photoIds.push((await uploadPhoto(photo.file)).publicId);
        progress.textContent = '생성 작업을 등록했어요';
        const job = await api<Job>('/api/generations', { method: 'POST', body: { ...request, photoIds } });
        poll(job.id);
      } catch (error) {
        const notConfigured = error instanceof ApiError && /NOT_CONFIGURED/.test(error.code);
        finish(notConfigured ? `${error.message}` : error instanceof Error ? error.message : '생성을 요청하지 못했어요.');
      }
    })();
  };
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const target = event.target;
    if (target.closest('[role="combobox"]') === combo) { event.preventDefault(); openMenu(); return; }
    if (uploadArea?.contains(target)) { event.preventDefault(); fileInput?.click(); return; }
    const imageButton = target.closest<HTMLButtonElement>('button[aria-pressed][value]');
    if (imageButton && imageButtons.includes(imageButton)) { event.preventDefault(); imageCount = Number(imageButton.value); sync(); return; }
    const row = target.closest<HTMLElement>('tr[role="button"][aria-label^="키워드 "]');
    if (row) {
      event.preventDefault();
      keyword.value = (row.getAttribute('aria-label') || '').replace(/^키워드 /, '').replace(/ 선택$/, '').slice(0,60);
      fieldState(keyword, !!keyword.value, true);
      keyword.focus();
      sync();
      return;
    }
    if (generate.contains(target)) { event.preventDefault(); generateDraft(); }
  };
  listeners(root, 'click', onClick);
  listeners(document, 'pointerdown', event => {
    if (menu && event.target instanceof Node && !menu.contains(event.target) && !combo.contains(event.target)) closeMenu();
  });
  listeners(combo, 'keydown', event => {
    if (['Enter',' ','ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); if (!menu) openMenu(); }
    if (event.key === 'Escape') closeMenu(true);
  });
  for (const field of [keyword, titleInput, experience, instructions].filter((el): el is HTMLInputElement | HTMLTextAreaElement => !!el)) {
    listeners(field, 'focus', () => fieldState(field, !!field.value, true));
    listeners(field, 'blur', () => fieldState(field, !!field.value));
    listeners(field, 'input', () => {
      fieldState(field, !!field.value, document.activeElement === field);
      if (field instanceof HTMLTextAreaElement) { field.style.height = '46px'; field.style.height = `${Math.max(46, field.scrollHeight)}px`; }
      sync();
    });
  }
  if (fileInput) listeners(fileInput, 'change', () => { if (fileInput.files) addPhotos(fileInput.files); });
  if (uploadArea) {
    uploadArea.tabIndex = 0;
    listeners(uploadArea, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput?.click(); } });
    listeners(uploadArea, 'dragover', event => { event.preventDefault(); });
    listeners(uploadArea, 'drop', event => { event.preventDefault(); if (event.dataTransfer?.files) addPhotos(event.dataTransfer.files); });
  }
  for (const row of main.querySelectorAll<HTMLElement>('tr[role="button"]')) {
    const prior = row.getAttribute('tabindex');
    row.tabIndex = 0;
    listeners(row, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.click(); } });
    cleanups.push(() => prior === null ? row.removeAttribute('tabindex') : row.setAttribute('tabindex', prior));
  }
  const requestedKeyword = new URLSearchParams(window.location.search).get('keyword');
  if (requestedKeyword) { keyword.value = requestedKeyword.slice(0,60); fieldState(keyword, true); sync(); }
  return () => {
    disposed = true;
    cleanups.forEach(fn => fn());
    timers.forEach(clearTimeout);
    photos.forEach(photo => URL.revokeObjectURL(photo.url));
    previews.remove();
    progress.remove();
    closeMenu();
    generate.textContent = originalGenerate.text;
    generate.disabled = originalGenerate.disabled;
    generate.tabIndex = originalGenerate.tabIndex;
    generate.classList.toggle('Mui-disabled', originalGenerate.disabled);
    generate.removeAttribute('aria-busy');
    if (imageSummary && originalSummary != null) imageSummary.textContent = originalSummary;
    if (photoCounter && originalCounter != null) photoCounter.textContent = originalCounter;
    if (uploadArea) { if (originalUploadTab == null) uploadArea.removeAttribute('tabindex'); else uploadArea.setAttribute('tabindex', originalUploadTab); }
  };
};
