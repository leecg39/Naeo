const NAVER_WRITER = 'https://blog.naver.com/GoBlogWrite.naver';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

function focusInFrame(target) {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 2 && rect.height > 2 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const editables = [...document.querySelectorAll('input, textarea, [contenteditable]:not([contenteditable="false"])')].filter(visible);
  const isTitle = (element) => /제목|title/i.test([
    element.getAttribute('placeholder'), element.getAttribute('aria-label'), element.getAttribute('data-placeholder'), element.className,
  ].filter(Boolean).join(' '));
  const activateNaverEditorElement = (element) => {
    if (!element || !visible(element)) return null;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView;
    const init = {
      bubbles: true,
      cancelable: true,
      view,
      clientX: rect.left + Math.min(24, Math.max(4, rect.width / 4)),
      clientY: rect.top + (rect.height / 2),
      button: 0,
      buttons: 1,
    };
    if (view.PointerEvent) {
      element.dispatchEvent(new view.PointerEvent('pointerdown', {
        ...init,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      }));
    }
    element.dispatchEvent(new view.MouseEvent('mousedown', init));
    const caretTarget = element.querySelector('.__se-node') || element;
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(caretTarget);
    range.collapse(false);
    const selection = element.ownerDocument.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.ownerDocument.dispatchEvent(new view.Event('selectionchange'));
    if (view.PointerEvent) {
      element.dispatchEvent(new view.PointerEvent('pointerup', {
        ...init,
        buttons: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      }));
    }
    element.dispatchEvent(new view.MouseEvent('mouseup', { ...init, buttons: 0 }));
    element.dispatchEvent(new view.MouseEvent('click', { ...init, buttons: 0 }));
    return element;
  };
  const naverTitle = () => document.querySelector([
    '.se-component.se-documentTitle .se-text-paragraph',
    '[data-a11y-title="제목"] .se-text-paragraph',
    '.se-title-text .se-text-paragraph',
  ].join(', '));
  const naverBody = () => document.querySelector([
    '.se-component.se-text[data-a11y-title="본문"] .se-text-paragraph',
    '.se-component.se-text:not(.se-documentTitle) .se-text-paragraph',
  ].join(', '));
  const selectNaverText = (needle, occurrence = 0, placeAtStart = false) => {
    if (!needle) return null;
    const root = document.querySelector('.se-component:not(.se-documentTitle)')?.parentElement;
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let seen = 0;
    while (node) {
      const start = node.nodeValue?.indexOf(needle) ?? -1;
      if (start >= 0 && !node.parentElement?.closest('.se-documentTitle')) {
        if (seen < occurrence) {
          seen += 1;
          node = walker.nextNode();
          continue;
        }
        const element = node.parentElement?.closest('.se-text-paragraph') || node.parentElement;
        if (!element || !visible(element)) return null;
        element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const rect = element.getBoundingClientRect();
        const view = element.ownerDocument.defaultView;
        const init = {
          bubbles: true,
          cancelable: true,
          view,
          clientX: placeAtStart ? rect.left + 1 : rect.left + Math.min(24, Math.max(4, rect.width / 4)),
          clientY: rect.top + (rect.height / 2),
          button: 0,
          buttons: 1,
        };
        if (view.PointerEvent) {
          element.dispatchEvent(new view.PointerEvent('pointerdown', {
            ...init,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
          }));
        }
        element.dispatchEvent(new view.MouseEvent('mousedown', init));
        if (view.PointerEvent) {
          element.dispatchEvent(new view.PointerEvent('pointerup', {
            ...init,
            buttons: 0,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
          }));
        }
        element.dispatchEvent(new view.MouseEvent('mouseup', { ...init, buttons: 0 }));
        element.dispatchEvent(new view.MouseEvent('click', { ...init, buttons: 0 }));
        const range = element.ownerDocument.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + needle.length);
        const selection = element.ownerDocument.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        element.ownerDocument.dispatchEvent(new view.Event('selectionchange'));
        return element;
      }
      node = walker.nextNode();
    }
    return null;
  };
  const selectText = (needle) => {
    if (!needle) return null;
    const roots = editables.filter((element) => element.matches('[contenteditable]:not([contenteditable="false"])'));
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const at = node.nodeValue?.indexOf(needle) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at); range.setEnd(node, at + needle.length);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        root.focus({ preventScroll: false });
        node.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return root;
      }
    }
    return null;
  };
  let element = null;
  if (target.kind === 'title') {
    element = activateNaverEditorElement(naverTitle());
    if (element) return { ok: true, tag: element.tagName, strategy: 'naver-title' };
  }
  if (target.kind === 'body') {
    element = activateNaverEditorElement(naverBody());
    if (element) return { ok: true, tag: element.tagName, strategy: 'naver-body' };
  }
  if (target.kind === 'heading' || target.kind === 'image') {
    element = selectNaverText(target.text, target.imageAnchorIndex || 0, target.kind === 'image');
    if (element) return { ok: true, tag: element.tagName, strategy: `naver-${target.kind}` };
    element = selectText(target.text);
  }
  if (!element && target.kind === 'title') {
    element = editables.find(isTitle);
  }
  if (!element) {
    const active = document.activeElement;
    if (active && editables.includes(active) && (target.kind === 'title' || !isTitle(active))) element = active;
  }
  if (!element) {
    element = editables
      .filter((candidate) => target.kind === 'title' || !isTitle(candidate))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        return (br.width * br.height) - (ar.width * ar.height);
      })[0];
  }
  if (!element) return { ok: false };
  element.focus({ preventScroll: false });
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return { ok: true, tag: element.tagName };
}

async function focusEditor(target) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(?:m\.)?blog\.naver\.com\//.test(tab.url || '')) {
    return { ok: false, reason: 'NAVER_WRITER_NOT_ACTIVE' };
  }
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: focusInFrame, args: [target] });
  return results.map((item) => item.result).find((item) => item?.ok) || { ok: false, reason: 'EDITOR_NOT_FOUND' };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'openNaverWriter') {
    chrome.tabs.create({ url: NAVER_WRITER }).then(() => sendResponse({ ok: true }), (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'focusEditor') {
    focusEditor(message.target || {}).then(sendResponse, (error) => sendResponse({ ok: false, reason: 'FOCUS_FAILED', error: error.message }));
    return true;
  }
  return false;
});
