import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { TextEncoder } from 'node:util';
import { URLSearchParams } from 'node:url';
import test from 'node:test';
import { EXTENSION_ID } from '../extension/shared.js';
import { isNaeoAuthUrl } from '../extension/auth.js';

async function waitFor(check) {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await setImmediate();
  }
  assert.fail('Expected extension state was not reached');
}

// Execute the real worker and separate side-panel documents with one shared
// browser identity API. A second outstanding flow fails just as Chrome does.
async function loadScript(name, globals) {
  const url = new URL(`../extension/${name}`, import.meta.url);
  let source = await readFile(url, 'utf8');
  const imports = [...source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)];
  for (const match of imports) {
    const module = await import(new URL(match[2], url));
    for (const name of match[1].split(',').map(value => value.trim())) globals[name] = module[name];
    source = source.replace(match[0], '');
  }
  runInNewContext(source, globals, { filename: name });
}

function node() {
  const classes = new Set();
  const handlers = {};
  return {
    disabled: false, value: '', textContent: '', dataset: {},
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
    addEventListener(type, handler) { handlers[type] = handler; },
    click() { return handlers.click?.(); },
    append() {}, replaceChildren() {}, focus() {},
  };
}

async function fixture(settings = {}) {
  const listeners = [], launches = [], messages = [], exchanges = [];
  const saved = { serviceBase: 'http://127.0.0.1:3000' };
  const windows = settings.windows || [], removedWindows = [];
  let pending = null;
  const chrome = {
    runtime: {
      id: EXTENSION_ID, getURL: path => `chrome-extension://${EXTENSION_ID}/${path}`,
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener(listener) { listeners.push(listener); } },
      sendMessage(message) {
        messages.push(message);
        return new Promise(resolve => {
          const sender = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/sidepanel.html` };
          if (!listeners.some(listener => listener(message, sender, resolve))) resolve(undefined);
        });
      },
    },
    storage: { local: {
      async get(keys) { return keys === null ? { ...saved } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, saved[key]])); },
      async set(values) { Object.assign(saved, values); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete saved[key]; },
    } },
    permissions: { async request() { return true; }, async contains() { return true; } },
    tabs: { async query() { return windows.flatMap(window => window.tabs.map(tab => ({ ...tab, windowId: window.id }))); } },
    windows: {
      async get(id) { return settings.currentWindow || windows.find(window => window.id === id); },
      async remove(id) { removedWindows.push(id); },
    },
    identity: {
      getRedirectURL: () => `https://${EXTENSION_ID}.chromiumapp.org/`,
      launchWebAuthFlow(details) {
        launches.push(details);
        if (pending) return Promise.reject(new Error('Only one web auth flow is allowed at a time.'));
        return new Promise((resolve, reject) => { pending = { resolve, reject, url: new URL(details.url) }; });
      },
    },
  };
  const fetch = async (url, options) => {
    if (new URL(url).pathname === '/api/oauth/token') {
      exchanges.push(options);
      if (settings.tokenResponse) return settings.tokenResponse(options);
      return { ok: true, async json() { return { access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 3600, scope: 'naeo:read' }; } };
    }
    return { ok: true, async json() { return { result: { structuredContent: { drafts: [] } } }; } };
  };
  const globals = () => ({ chrome, crypto: webcrypto, URL, URLSearchParams, fetch });
  await loadScript('service-worker.js', globals());
  return {
    chrome, launches, messages, exchanges, saved, removedWindows,
    sendFrom(message, sender) {
      return new Promise(resolve => {
        if (!listeners.some(listener => listener(message, sender, resolve))) resolve(undefined);
      });
    },
    async panel() {
      const nodes = new Map();
      const get = selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); };
      await loadScript('sidepanel.js', { ...globals(), document: { querySelector: get, createElement: node } });
      await waitFor(() => get('#service-base').value);
      return { get, click: () => get('#connect').click() };
    },
    finish(error, overrides = {}, origin = `https://${EXTENSION_ID}.chromiumapp.org`) {
      const flow = pending; pending = null;
      if (error) { flow.reject(new Error(error)); return; }
      const query = new URLSearchParams({ state: flow.url.searchParams.get('state'), code: 'test-code', ...overrides });
      flow.resolve(`${origin}/?${query}`);
    },
  };
}

test('two side panels share one auth window and exchange its code only once', async () => {
  const f = await fixture(), first = await f.panel(), second = await f.panel();
  const a = first.click();
  await waitFor(() => f.launches.length === 1);
  const b = second.click();
  await waitFor(() => f.launches.length > 1 || f.messages.filter(m => m.type === 'connectNaeo').length === 2);
  f.finish();
  await Promise.all([a, b]);
  assert.equal(f.launches.length, 1);
  assert.equal(f.exchanges.length, 1);
  assert.equal(first.get('#drafts-view').classList.contains('hidden'), false);
  assert.equal(second.get('#drafts-view').classList.contains('hidden'), false);
});

test('a reopened panel waits for the existing flow, then displays the saved connection', async () => {
  const f = await fixture(), first = await f.panel();
  const pending = first.click();
  await waitFor(() => f.launches.length === 1);
  const reopened = await f.panel();
  await waitFor(() => f.messages.some(m => m.type === 'waitForAuth'));
  assert.equal(reopened.get('#connect').disabled, true);
  assert.equal(reopened.get('#service-base').disabled, true);
  await reopened.click();
  assert.equal(f.launches.length, 1);
  f.finish();
  await pending;
  await waitFor(() => !reopened.get('#connect').disabled);
  assert.equal(f.exchanges.length, 1);
  assert.equal(reopened.get('#drafts-view').classList.contains('hidden'), false);
});

test('closing the initiating panel cannot lose tokens, and idle panels do not launch login', async () => {
  const f = await fixture();
  // Start as a panel, but no panel waits for the response or saves the tokens.
  const pending = f.chrome.runtime.sendMessage({ type: 'connectNaeo', serviceBase: f.saved.serviceBase });
  await waitFor(() => f.launches.length === 1);
  f.finish();
  assert.equal((await pending).ok, true);
  assert.equal(f.saved.tokens.refreshToken, 'refresh');
  const reopened = await f.panel();
  await waitFor(() => !reopened.get('#connect').disabled);
  assert.equal(f.launches.length, 1);
  assert.equal(reopened.get('#drafts-view').classList.contains('hidden'), false);
});

test('cancelled login releases the lock and enables a new attempt', async () => {
  const f = await fixture(), panel = await f.panel();
  const cancelled = panel.click();
  await waitFor(() => f.launches.length === 1);
  f.finish('The user did not approve access.');
  await cancelled;
  assert.match(panel.get('#status').textContent, /로그인이 취소/);
  assert.equal(panel.get('#connect').disabled, false);
  assert.equal(f.saved.tokens, undefined);
  const retry = panel.click();
  await waitFor(() => f.launches.length === 2);
  f.finish();
  await retry;
  assert.equal(f.exchanges.length, 1);
});

test('an orphaned Chrome auth window gives recovery guidance and does not leave a stuck lock', async () => {
  const f = await fixture(), panel = await f.panel();
  const original = f.chrome.identity.launchWebAuthFlow;
  f.chrome.identity.launchWebAuthFlow = async () => { throw new Error('Only one web auth flow is allowed at a time.'); };
  await panel.click();
  assert.match(panel.get('#status').textContent, /이전에 연 NAEO 로그인 창/);
  assert.doesNotMatch(panel.get('#status').textContent, /Only one web auth flow/);
  assert.equal(panel.get('#connect').disabled, false);
  f.chrome.identity.launchWebAuthFlow = original;
  const retry = panel.click();
  await waitFor(() => f.launches.length === 1);
  f.finish();
  await retry;
  assert.equal(f.saved.tokens.refreshToken, 'refresh');
});

test('another service address cannot replace the in-flight origin or PKCE flow', async () => {
  const f = await fixture(), first = await f.panel(), second = await f.panel();
  const pending = first.click();
  await waitFor(() => f.launches.length === 1);
  second.get('#service-base').value = 'https://other.example';
  await second.click();
  assert.match(second.get('#status').textContent, /다른 NAEO 주소/);
  assert.equal(f.saved.serviceBase, 'http://127.0.0.1:3000');
  f.finish();
  await pending;
  assert.equal(f.launches.length, 1);
  const body = f.exchanges[0].body;
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')));
  const { Buffer } = await import('node:buffer');
  assert.equal(Buffer.from(digest).toString('base64url'), new URL(f.launches[0].url).searchParams.get('code_challenge'));
});

for (const invalid of ['state', 'origin']) {
  test(`invalid callback ${invalid} is rejected before token exchange`, async () => {
    const f = await fixture(), panel = await f.panel();
    const pending = panel.click();
    await waitFor(() => f.launches.length === 1);
    if (invalid === 'state') f.finish(null, { state: 'wrong-state' });
    else f.finish(null, {}, 'https://evil.example');
    await pending;
    assert.match(panel.get('#status').textContent, /로그인 상태 확인에 실패/);
    assert.equal(f.exchanges.length, 0);
    assert.equal(f.saved.tokens, undefined);
    assert.equal(panel.get('#connect').disabled, false);
  });
}

test('the shared lock remains held until the code exchange and token storage finish', async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const f = await fixture({ tokenResponse: () => response });
  const first = await f.panel(), second = await f.panel();
  const a = first.click();
  await waitFor(() => f.launches.length === 1);
  f.finish();
  await waitFor(() => f.exchanges.length === 1);
  const b = second.click();
  await waitFor(() => f.messages.filter(m => m.type === 'connectNaeo').length === 2);
  assert.equal(f.launches.length, 1);
  release({ ok: true, async json() { return { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'naeo:read' }; } });
  await Promise.all([a, b]);
  assert.equal(f.exchanges.length, 1);
  assert.equal(f.saved.tokens.refreshToken, 'refresh');
});

test('failed token exchange preserves the previous connection and allows retry', async () => {
  const f = await fixture({ tokenResponse: async () => ({ ok: false, async json() { return { error_description: '인증 코드가 만료되었습니다.' }; } }) });
  const panel = await f.panel();
  f.saved.tokens = { accessToken: 'old-access', refreshToken: 'old-refresh' };
  panel.get('#service-base').value = 'https://other.example';
  const pending = panel.click();
  await waitFor(() => f.launches.length === 1);
  f.finish();
  await pending;
  assert.match(panel.get('#status').textContent, /인증 코드가 만료/);
  assert.equal(f.saved.serviceBase, 'http://127.0.0.1:3000');
  assert.equal(f.saved.tokens.refreshToken, 'old-refresh');
  assert.equal(panel.get('#connect').disabled, false);
  assert.equal((await f.chrome.runtime.sendMessage({ type: 'getAuthState' })).pending, false);
});

test('recovery closes only matching single-tab auth popups and leaves other windows alone', async () => {
  const own = `http://127.0.0.1:3000/oauth/consent?client_id=naeo-extension-${EXTENSION_ID}`;
  const windows = [
    { id: 1, type: 'popup', tabs: [{ url: own }] },
    { id: 2, type: 'normal', tabs: [{ url: own }] },
    { id: 3, type: 'popup', tabs: [{ url: own }, { url: 'http://127.0.0.1:3000/' }] },
    { id: 4, type: 'popup', tabs: [{ url: own.replace(EXTENSION_ID, 'a'.repeat(32)) }] },
    { id: 5, type: 'popup', tabs: [{ url: own.replace(':3000', ':3001') }] },
  ];
  const f = await fixture({ windows }), panel = await f.panel();
  f.chrome.identity.launchWebAuthFlow = async () => { throw new Error('Only one web auth flow is allowed at a time.'); };
  await panel.click();
  assert.equal(panel.get('#reset-auth').classList.contains('hidden'), false);
  await panel.get('#reset-auth').click();
  assert.deepEqual(f.removedWindows, [1]);
  assert.equal(panel.get('#reset-auth').classList.contains('hidden'), true);
  assert.match(panel.get('#status').textContent, /이전 로그인 창을 닫았습니다/);
});

test('recovery rechecks navigation and refuses to close a live managed login', async () => {
  const own = `http://127.0.0.1:3000/auth/extension?extension_id=${EXTENSION_ID}`;
  const f = await fixture({ windows: [{ id: 1, type: 'popup', tabs: [{ url: own }] }], currentWindow: { id: 1, type: 'popup', tabs: [{ url: 'https://accounts.example/login' }] } });
  const reset = await f.chrome.runtime.sendMessage({ type: 'resetNaeoAuth', serviceBase: f.saved.serviceBase });
  assert.equal(reset.ok, false);
  assert.match(reset.error, /직접 닫아/);
  assert.deepEqual(f.removedWindows, []);
  const pending = f.chrome.runtime.sendMessage({ type: 'connectNaeo', serviceBase: f.saved.serviceBase });
  await waitFor(() => f.launches.length === 1);
  const busy = await f.chrome.runtime.sendMessage({ type: 'resetNaeoAuth', serviceBase: f.saved.serviceBase });
  assert.equal(busy.ok, false);
  assert.match(busy.error, /로그인이 진행 중/);
  f.finish();
  await pending;
});

test('only the extension panel can start or reset authentication', async () => {
  const f = await fixture();
  for (const type of ['connectNaeo', 'resetNaeoAuth']) {
    const denied = await f.sendFrom({ type, serviceBase: f.saved.serviceBase }, { id: EXTENSION_ID, url: 'https://blog.naver.com/' });
    assert.equal(denied.ok, false);
  }
  assert.equal(f.launches.length, 0);
  assert.deepEqual(f.removedWindows, []);
});

test('auth window identification checks the exact origin, route and extension, including login return URLs', () => {
  const base = 'http://127.0.0.1:3000';
  const consent = `/oauth/consent?client_id=naeo-extension-${EXTENSION_ID}`;
  assert.equal(isNaeoAuthUrl(`${base}${consent}`, base, EXTENSION_ID), true);
  assert.equal(isNaeoAuthUrl(`${base}/login?next=${encodeURIComponent(consent)}`, base, EXTENSION_ID), true);
  for (const url of [
    `${base}/dashboard?extension_id=${EXTENSION_ID}`, `${base}/login?next=${encodeURIComponent(`https://evil.example${consent}`)}`,
    `${base.replace(':3000', ':3001')}${consent}`, `${base}/oauth/consent?client_id=other`, 'invalid-url',
  ]) assert.equal(isNaeoAuthUrl(url, base, EXTENSION_ID), false, url);
});
