'use client';

import { useState } from 'react';
import { text, type BehaviorTools, type InstallBehavior } from '@/lib/behavior';
import { saveDraft } from '@/lib/demo-store';
import type { Draft } from '@/types/site';

// Exact writing subcategories and order observed in the source dropdown.
// Generation is local and never calls the source API.
const TOPICS = ['영화','방송','스타·연예인','애니메이션','IT·테크','상품리뷰','자동차','교육','어학·외국어','경제','사회','일상·생각','(미분류)','리빙','원예·재배','반려동물','건강','육아','레시피','스포츠','게임','취미','사진','좋은글·이미지','공연·전시','음악','책','예술','패션','뷰티','국내여행','해외여행','푸드'];

function DraftPreview({ draft, tools }: { draft: Draft; tools: BehaviorTools }) {
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);
  const [saved, setSaved] = useState(false);
  const valid = !!title.trim() && !!content.trim();
  const asMarkdown = () => `# ${title.trim()}\n\n${content.trim()}\n`;
  return <div style={{ display: 'grid', gap: 16 }}>
    <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>체험용 샘플 글이에요. 내용을 직접 수정하고 이 브라우저의 발행 대기함에 저장할 수 있어요.</p>
    <label style={{ display: 'grid', gap: 6 }}>제목<input className="naeo-field" value={title} onChange={e => { setTitle(e.target.value); setSaved(false); }} /></label>
    <label style={{ display: 'grid', gap: 6 }}>본문<textarea className="naeo-field" value={content} rows={15} style={{ resize: 'vertical', lineHeight: 1.8 }} onChange={e => { setContent(e.target.value); setSaved(false); }} /></label>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button className="naeo-button" disabled={!valid} onClick={() => {
        saveDraft({ ...draft, title: title.trim(), content: content.trim() });
        setSaved(true);
        tools.toast('이 브라우저의 발행 대기함에 저장했어요.');
      }}>{saved ? '저장 완료' : '발행 대기함에 저장'}</button>
      <button className="naeo-button" disabled={!valid} onClick={async () => {
        try { await navigator.clipboard.writeText(asMarkdown()); tools.toast('글을 복사했어요.'); }
        catch { tools.toast('복사 권한을 확인하거나 본문을 선택해 복사해 주세요.'); }
      }}>글 복사</button>
      <button className="naeo-button" disabled={!valid} onClick={() => {
        const url = URL.createObjectURL(new Blob([asMarkdown()], { type: 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${title.trim().replace(/[\\/:*?"<>|]/g, '-').slice(0,80) || 'naeo-draft'}.md`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>다운로드</button>
    </div>
    {saved && <p role="status" style={{ margin: 0, color: 'var(--primary)' }}>수정한 글을 저장했어요. 실제 블로그에 발행되지는 않아요.</p>}
  </div>;
}

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
  const tokens = () => 10 + 3 * aiImages();
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
    if (imageSummary) imageSummary.textContent = photos.length
      ? `→ 총 ${Math.max(imageCount, photos.length)}장 예상 = 내 사진 ${photos.length} + AI ${aiImages()}${aiImages() ? '(썸네일 포함)' : ''}`
      : `→ 총 ${imageCount}장 예상 = AI ${imageCount}(썸네일 포함)`;
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
  const generateDraft = () => {
    if (generating || !keyword.value.trim() || !category) return;
    generating = true;
    sync();
    progress.style.display = 'block';
    progress.textContent = '1/3 · 지시서를 준비하고 있어요';
    generate.textContent = '샘플 글 생성 중…';
    generate.setAttribute('aria-busy', 'true');
    const chosenKeyword = keyword.value.trim();
    const chosenTitle = titleInput?.value.trim() || `${chosenKeyword}, 알아두면 좋은 핵심 정리`;
    const chosenExperience = experience?.value.trim();
    const chosenInstructions = instructions?.value.trim();
    const chosenCategory = category;
    const chosenImages = Math.max(imageCount, photos.length);
    later(() => { progress.textContent = '2/3 · 입력한 경험과 요청사항을 글에 담고 있어요'; }, 400);
    later(() => { progress.textContent = '3/3 · 편집 가능한 샘플 글을 완성하고 있어요'; }, 800);
    later(() => {
      generating = false;
      generate.removeAttribute('aria-busy');
      progress.style.display = 'none';
      sync();
      const content = [
        '※ NAEO 클론에서 만든 체험용 샘플 글입니다. 실제 정보는 확인 후 수정해 주세요.',
        `## ${chosenKeyword}을(를) 알아보는 이유\n\n${chosenCategory} 주제로 ${chosenKeyword}에 관해 정리하는 글입니다. 독자가 궁금해할 핵심부터 차근차근 설명해 볼게요.`,
        `## 먼저 확인할 내용\n\n- ${chosenKeyword}의 기본 개념과 필요한 준비물을 확인해요.\n- 직접 비교한 정보와 출처를 추가해요.\n- 실제로 적용할 때 주의할 점을 정리해요.`,
        chosenExperience ? `## 내 경험·생각\n\n${chosenExperience}` : '## 직접 경험한 내용을 더해 주세요\n\n직접 확인한 내용이나 나만의 팁을 이곳에 적으면 독자에게 더 유용한 글이 돼요.',
        chosenInstructions ? `## 작성 요청사항\n\n${chosenInstructions}\n\n위 요청에 맞는 실제 내용을 확인하여 보완해 주세요.` : '',
        `## 마무리\n\n${chosenKeyword}에 관한 정보를 실제 상황에 맞게 확인하고, 새로 알게 된 내용을 덧붙여 보세요.`,
      ].filter(Boolean).join('\n\n');
      const draft: Draft = { id: `draft-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, title: chosenTitle, keyword: chosenKeyword, content, createdAt: new Date().toISOString(), status: 'draft', imageCount: chosenImages };
      tools.openDialog('완성된 글 미리보기', <DraftPreview draft={draft} tools={tools} />);
    }, 1200);
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
