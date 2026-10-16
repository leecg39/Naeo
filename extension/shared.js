const encoder = new TextEncoder();

export const DEFAULT_SERVICE_BASE = 'https://www.naeo.kr';
export const EXTENSION_ID = 'lacdnccodopejadkbeannbcmbljiodik';

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const safeHttpUrl = (raw) => {
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

export function normalizeServiceBase(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); }
  catch { throw new Error('올바른 NAEO 서비스 주소를 입력해주세요.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('배포 주소는 HTTPS여야 합니다. 로컬 개발 주소만 HTTP를 쓸 수 있습니다.');
  }
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('서비스 루트 주소만 입력해주세요. 경로·계정·검색값은 넣을 수 없습니다.');
  }
  return url.origin;
}

export function permissionOrigin(base) {
  const url = new URL(normalizeServiceBase(base));
  return `${url.protocol}//${url.hostname}/*`;
}

const base64url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

export async function createPkce(cryptoApi = globalThis.crypto) {
  const random = new Uint8Array(32);
  cryptoApi.getRandomValues(random);
  const verifier = base64url(random);
  const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', encoder.encode(verifier)));
  return { verifier, challenge: base64url(digest) };
}

export function parseMcpToolData(payload) {
  if (payload?.error) throw new Error(payload.error.message || 'MCP 호출에 실패했습니다.');
  const result = payload?.result;
  if (!result) throw new Error('MCP 응답 형식이 올바르지 않습니다.');
  if (result.isError) throw new Error(result.content?.[0]?.text || 'NAEO 작업을 완료하지 못했습니다.');
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find?.((item) => item.type === 'text')?.text;
  if (!text) throw new Error('MCP 응답에 결과가 없습니다.');
  try { return JSON.parse(text); } catch { throw new Error('MCP 결과를 읽을 수 없습니다.'); }
}

const inlineHtml = (source) => {
  const text = String(source || '');
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g;
  let html = '', cursor = 0;
  for (const match of text.matchAll(pattern)) {
    html += escapeHtml(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('`')) html += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
    else if (token.startsWith('**')) html += `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link && safeHttpUrl(link[2]);
      html += href ? `<a href="${escapeHtml(href)}">${escapeHtml(link[1])}</a>` : escapeHtml(token);
    }
    cursor = (match.index || 0) + token.length;
  }
  return html + escapeHtml(text.slice(cursor));
};

const imageMatch = (line) => /^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)\s*$/.exec(line.trim());
const headingMatch = (line) => /^(#{1,6})\s+(.+?)\s*$/.exec(line);
const tableDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

export function markerForImage(index, alt = '') {
  const clean = String(alt).replace(/[\r\n〔〕]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `〔NAEO 사진 ${index + 1}${clean ? `: ${clean}` : ''}〕`;
}

export function parseDraftBlocks(markdown = '') {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let imageIndex = 0;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (/^```/.test(line.trim())) {
      const language = line.trim().slice(3).trim();
      const body = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i++]);
      if (i < lines.length) i += 1;
      blocks.push({ kind: 'code', language, text: body.join('\n') });
      continue;
    }
    const image = imageMatch(line);
    if (image) {
      blocks.push({ kind: 'image', alt: image[1], url: image[2], marker: markerForImage(imageIndex, image[1]), index: imageIndex });
      imageIndex += 1; i += 1; continue;
    }
    const heading = headingMatch(line);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] }); i += 1; continue; }
    if (line.includes('|') && i + 1 < lines.length && tableDivider(lines[i + 1])) {
      const rows = [cells(line)]; i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ kind: 'table', rows }); continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', text: quote.join('\n') }); continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ''));
      blocks.push({ kind: 'list', ordered: false, items }); continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      blocks.push({ kind: 'list', ordered: true, items }); continue;
    }
    const paragraph = [line.trim()]; i += 1;
    while (i < lines.length && lines[i].trim() && !headingMatch(lines[i]) && !imageMatch(lines[i]) && !/^```|^>\s?|^\s*[-*+]\s+|^\s*\d+[.)]\s+/.test(lines[i])) {
      if (lines[i].includes('|') && i + 1 < lines.length && tableDivider(lines[i + 1])) break;
      paragraph.push(lines[i++].trim());
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

const blockPlain = (block) => {
  if (block.kind === 'image') return block.marker;
  if (block.kind === 'table') return block.rows.map((row) => row.join('\t')).join('\n');
  if (block.kind === 'list') return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : '•'} ${item}`).join('\n');
  return block.text || '';
};

const blockHtml = (block) => {
  if (block.kind === 'image') return `<p>${escapeHtml(block.marker)}</p>`;
  if (block.kind === 'heading') return `<p>${inlineHtml(block.text)}</p>`;
  if (block.kind === 'paragraph') return `<p>${block.text.split('\n').map(inlineHtml).join('<br>')}</p>`;
  if (block.kind === 'quote') return `<blockquote><p>${block.text.split('\n').map(inlineHtml).join('<br>')}</p></blockquote>`;
  if (block.kind === 'code') return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
  if (block.kind === 'list') {
    const tag = block.ordered ? 'ol' : 'ul';
    return `<${tag}>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</${tag}>`;
  }
  if (block.kind === 'table') {
    const [head = [], ...rows] = block.rows;
    return `<table><thead><tr>${head.map((cell) => `<th>${inlineHtml(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  return '';
};

export function buildDraftTransfer(draft) {
  const blocks = parseDraftBlocks(draft.body || '');
  const representative = blocks[0]?.kind === 'image' ? blocks[0] : null;
  const bodyBlocks = representative ? blocks.slice(1) : blocks;
  const plain = bodyBlocks.map(blockPlain).filter(Boolean).join('\n\n');
  const html = bodyBlocks.map(blockHtml).join('');
  const rows = [{ key: 'title', kind: 'title', label: '제목', action: '제목 복사 + 위치', preview: draft.title || '제목 없음', text: draft.title || '' }];
  if (representative) rows.push({ key: `image:${representative.index}`, kind: 'image', label: '대표 사진', action: '사진 복사 + 위치', preview: representative.alt || '대표 사진', url: representative.url, target: '' });
  rows.push({ key: 'body', kind: 'body', label: '본문', action: '본문 복사 + 위치', preview: plain.slice(0, 100) || '본문 없음', text: plain, html });
  for (const block of blocks) {
    if (block === representative) continue;
    if (block.kind === 'heading') rows.push({ key: `heading:${rows.length}`, kind: 'heading', label: '소제목', action: '소제목으로 변환', preview: block.text, target: block.text });
    if (block.kind === 'image') rows.push({ key: `image:${block.index}`, kind: 'image', label: '사진', action: '사진 복사 + 위치', preview: block.alt || `사진 ${block.index + 1}`, url: block.url, target: block.marker });
  }
  return { blocks, rows, plain, html, representative };
}
