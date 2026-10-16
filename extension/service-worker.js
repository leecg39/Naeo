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
  if (target.kind === 'heading' || target.kind === 'image') element = selectText(target.text);
  if (!element && target.kind === 'title') {
    element = editables.find((candidate) => /제목|title/i.test([
      candidate.getAttribute('placeholder'), candidate.getAttribute('aria-label'), candidate.getAttribute('data-placeholder'), candidate.className,
    ].filter(Boolean).join(' ')));
  }
  if (!element) {
    const active = document.activeElement;
    if (active && editables.includes(active)) element = active;
  }
  if (!element) {
    element = editables
      .filter((candidate) => target.kind === 'title' || !/제목|title/i.test([candidate.getAttribute('placeholder'), candidate.getAttribute('aria-label')].filter(Boolean).join(' ')))
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
