import { buildDraftTransfer, DEFAULT_SERVICE_BASE, EXTENSION_ID, normalizeServiceBase, parseMcpToolData, permissionOrigin } from './shared.js';

const $ = (selector) => document.querySelector(selector);
const storage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (values) => chrome.storage.local.set(values),
  remove: (keys) => chrome.storage.local.remove(keys),
};

let serviceBase = DEFAULT_SERVICE_BASE;
let selectedDraft = null;
let transfer = null;
let applied = new Set();
let rpcId = 1;
let connecting = false;

function showStatus(message = '', error = false) {
  const node = $('#status');
  node.textContent = message;
  node.classList.toggle('error', error);
  if (message) node.focus({ preventScroll: true });
}

function setView(name) {
  $('#setup').classList.toggle('hidden', name !== 'setup');
  $('#drafts-view').classList.toggle('hidden', name !== 'drafts');
  $('#transfer-view').classList.toggle('hidden', name !== 'transfer');
}

async function withBusy(button, action) {
  button.disabled = true;
  try { return await action(); }
  catch (error) { showStatus(error instanceof Error ? error.message : '작업을 완료하지 못했습니다.', true); return null; }
  finally { button.disabled = false; }
}

function setConnecting(busy) {
  connecting = busy;
  $('#connect').disabled = busy;
  $('#service-base').disabled = busy;
  $('#reset-auth').disabled = busy;
  $('#connect').textContent = busy ? '로그인 진행 중…' : 'NAEO로 로그인';
}

async function ensureServicePermission(base) {
  const origins = [permissionOrigin(base)];
  return chrome.permissions.request({ origins });
}

async function connect() {
  if (connecting) return;
  setConnecting(true);
  $('#reset-auth').classList.toggle('hidden', true);
  try {
    const base = normalizeServiceBase($('#service-base').value);
    if (!await ensureServicePermission(base)) throw new Error('NAEO 주소 접근 권한이 필요합니다.');
    showStatus('열린 NAEO 로그인 창에서 로그인과 연결 승인을 완료해주세요.');
    const result = await chrome.runtime.sendMessage({ type: 'connectNaeo', serviceBase: base });
    $('#reset-auth').classList.toggle('hidden', result?.code !== 'AUTH_WINDOW_OPEN');
    if (!result?.ok) throw new Error(result?.error || '로그인을 완료하지 못했습니다. 확장 프로그램을 새로고침한 뒤 다시 시도해주세요.');
    serviceBase = result.serviceBase;
    setView('drafts'); showStatus('NAEO 계정을 연결했습니다.'); await loadDrafts();
  } catch (error) { showStatus(error.message, true); }
  finally { setConnecting(false); }
}

async function refreshTokens(current) {
  const response = await fetch(new URL('/api/oauth/token', serviceBase), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refreshToken, client_id: `naeo-extension-${chrome.runtime.id}`, resource: `${serviceBase}/api/mcp` }),
  });
  const body = await response.json();
  if (!response.ok) { await storage.remove('tokens'); throw new Error(body.error_description || '연결이 만료되었습니다. 다시 로그인해주세요.'); }
  const tokens = { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + (body.expires_in * 1000), scope: body.scope };
  await storage.set({ tokens }); return tokens;
}

async function validTokens(force = false) {
  const { tokens } = await storage.get('tokens');
  if (!tokens?.refreshToken) throw new Error('NAEO 계정을 먼저 연결해주세요.');
  if (!force && tokens.accessToken && tokens.expiresAt > Date.now() + 30_000) return tokens;
  return refreshTokens(tokens);
}

async function mcpCall(name, args = {}, retried = false) {
  const tokens = await validTokens();
  const response = await fetch(new URL('/api/mcp', serviceBase), {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (response.status === 401 && !retried) { await validTokens(true); return mcpCall(name, args, true); }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'NAEO 서버에 연결하지 못했습니다.');
  return parseMcpToolData(payload);
}

async function loadDrafts(query = '') {
  const data = await mcpCall('naeo_list_drafts', { q: query });
  const list = $('#draft-list'); list.replaceChildren();
  if (!data.drafts?.length) {
    const item = document.createElement('li'); item.className = 'hint'; item.textContent = '저장한 글이 없습니다.'; list.append(item); return;
  }
  for (const draft of data.drafts) {
    const item = document.createElement('li');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'draft-button';
    const title = document.createElement('strong'); title.textContent = draft.title || '제목 없음';
    const expiry = draft.expiresAt ? ` · ${new Date(draft.expiresAt).toLocaleDateString('ko-KR')} 자동 삭제` : '';
    const meta = document.createElement('span'); meta.className = 'draft-meta'; meta.textContent = `${draft.status} · ${new Date(draft.updatedAt).toLocaleString('ko-KR')} 저장${expiry}`;
    button.append(title, meta); button.addEventListener('click', () => withBusy(button, () => openDraft(draft.id))); item.append(button); list.append(item);
  }
}

async function openDraft(id) {
  selectedDraft = await mcpCall('naeo_get_draft', { id });
  transfer = buildDraftTransfer(selectedDraft);
  const saved = await storage.get(`progress:${id}`);
  applied = new Set(saved[`progress:${id}`]?.applied || []);
  $('#draft-title').textContent = selectedDraft.title || '제목 없음';
  renderTransfer(); setView('transfer'); showStatus('');
}

function renderTransfer() {
  const list = $('#transfer-list'); list.replaceChildren();
  for (const row of transfer.rows) {
    const item = document.createElement('li');
    const button = document.createElement('button'); button.type = 'button'; button.className = `row-button${applied.has(row.key) ? ' done' : ''}`;
    button.dataset.key = row.key;
    const top = document.createElement('span'); top.className = 'row-top';
    const kind = document.createElement('span'); kind.className = 'row-kind'; kind.textContent = row.label;
    const action = document.createElement('span'); action.className = 'row-action'; action.textContent = applied.has(row.key) ? '✓ 적용됨' : row.action;
    const preview = document.createElement('span'); preview.className = 'row-preview'; preview.textContent = row.preview;
    top.append(kind, action); button.append(top, preview);
    button.addEventListener('click', () => withBusy(button, () => applyRow(row)));
    item.append(button); list.append(item);
  }
  $('#progress-text').textContent = `${applied.size} / ${transfer.rows.length} 적용`;
}

async function writeClipboard(row) {
  if (row.kind === 'image') {
    const response = await fetch(row.url);
    if (!response.ok) throw new Error('사진을 가져오지 못했습니다. 사진 링크가 꺼졌는지 확인해주세요.');
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
    const png = await canvas.convertToBlob({ type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return;
  }
  if (row.kind === 'heading') return;
  const parts = { 'text/plain': new Blob([row.text], { type: 'text/plain' }) };
  if (row.html) parts['text/html'] = new Blob([row.html], { type: 'text/html' });
  await navigator.clipboard.write([new ClipboardItem(parts)]);
}

async function applyRow(row) {
  await writeClipboard(row);
  const focus = await chrome.runtime.sendMessage({
    type: 'focusEditor',
    target: { kind: row.kind, text: row.target || '', imageAnchorIndex: row.imageAnchorIndex || 0 },
  });
  if (!focus?.ok) {
    const copied = row.kind === 'heading' ? '' : '클립보드 복사는 완료했습니다. ';
    throw new Error(`${copied}네이버 블로그 글쓰기 탭을 활성화한 뒤 다시 눌러주세요.`);
  }
  applied.add(row.key);
  await storage.set({ [`progress:${selectedDraft.id}`]: { applied: [...applied], updatedAt: Date.now() } });
  renderTransfer();
  showStatus(row.kind === 'heading' ? '해당 줄을 선택했습니다. 네이버 툴바에서 소제목을 골라주세요.' : '복사했습니다. 선택된 위치에서 ⌘V 또는 Ctrl+V를 누르세요.');
}

async function disconnect() {
  const { tokens } = await storage.get('tokens');
  if (tokens?.refreshToken) {
    const response = await fetch(new URL('/api/oauth/revoke', serviceBase), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refreshToken }) });
    if (!response.ok) throw new Error('서버에서 연결을 해제하지 못했습니다. 네트워크를 확인하고 다시 시도해주세요.');
  }
  const all = await storage.get(null);
  await storage.remove(['tokens', ...Object.keys(all).filter((key) => key.startsWith('progress:'))]);
  await chrome.permissions.remove({ origins: [permissionOrigin(serviceBase)] }).catch(() => false);
  selectedDraft = null; transfer = null; applied = new Set(); setView('setup'); showStatus('연결을 해제했습니다.');
}

async function init() {
  $('#extension-id').textContent = chrome.runtime.id || EXTENSION_ID;
  const state = await chrome.runtime.sendMessage({ type: 'getAuthState' });
  if (state?.pending) {
    $('#service-base').value = state.serviceBase;
    showStatus('로그인이 진행 중입니다. 열려 있는 NAEO 로그인 창에서 계속해주세요.');
    const result = await chrome.runtime.sendMessage({ type: 'waitForAuth' });
    $('#reset-auth').classList.toggle('hidden', result?.code !== 'AUTH_WINDOW_OPEN');
    if (!result?.ok) showStatus(result?.error || '로그인이 중단되었습니다. 다시 시도해주세요.', true);
    else if (result.connected) showStatus('NAEO 계정을 연결했습니다.');
  }
  const saved = await storage.get(['serviceBase', 'tokens']);
  try { serviceBase = normalizeServiceBase(saved.serviceBase || DEFAULT_SERVICE_BASE); } catch { serviceBase = DEFAULT_SERVICE_BASE; }
  $('#service-base').value = serviceBase;
  if (saved.tokens?.refreshToken) {
    setView('drafts');
    try { await loadDrafts(); } catch (error) { showStatus(error.message, true); if (!((await storage.get('tokens')).tokens)) setView('setup'); }
  } else setView('setup');
}

$('#connect').addEventListener('click', connect);
$('#reset-auth').addEventListener('click', () => withBusy($('#reset-auth'), async () => {
  const result = await chrome.runtime.sendMessage({ type: 'resetNaeoAuth', serviceBase: normalizeServiceBase($('#service-base').value) });
  if (!result?.ok) throw new Error(result?.error || '이전 로그인 창을 닫지 못했습니다. 직접 창을 닫아주세요.');
  $('#reset-auth').classList.toggle('hidden', true);
  showStatus('이전 로그인 창을 닫았습니다. NAEO로 로그인을 다시 눌러주세요.');
}));
$('#disconnect').addEventListener('click', () => withBusy($('#disconnect'), disconnect));
$('#refresh-drafts').addEventListener('click', () => withBusy($('#refresh-drafts'), () => loadDrafts($('#draft-search').value.trim())));
$('#search-form').addEventListener('submit', (event) => { event.preventDefault(); withBusy(event.submitter || $('#refresh-drafts'), () => loadDrafts($('#draft-search').value.trim())); });
$('#back-to-drafts').addEventListener('click', () => { setView('drafts'); showStatus(''); });
$('#open-writer').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openNaverWriter' }));
$('#reset-progress').addEventListener('click', async () => { if (!selectedDraft) return; applied.clear(); await storage.remove(`progress:${selectedDraft.id}`); renderTransfer(); showStatus('진행 상태를 초기화했습니다.'); });

setConnecting(true);
init().catch((error) => showStatus(error.message, true)).finally(() => setConnecting(false));
