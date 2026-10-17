import { createPkce, normalizeServiceBase, permissionOrigin } from './shared.js';

export function authErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/Only one web auth flow is allowed at a time/i.test(message)) {
    return '이전에 연 NAEO 로그인 창이 아직 열려 있습니다. 해당 창을 닫거나 아래의 이전 로그인 창 닫기를 누른 뒤 다시 로그인해주세요.';
  }
  if (/user (?:did not approve|cancelled|canceled)|access_denied/i.test(message)) {
    return '로그인이 취소되었습니다. 다시 연결하려면 NAEO로 로그인을 눌러주세요.';
  }
  if (/Failed to fetch|NetworkError|page could not be loaded/i.test(message)) {
    return 'NAEO 서버에 연결하지 못했습니다. 서비스 주소와 서버 실행 상태를 확인한 뒤 다시 시도해주세요.';
  }
  if (error?.name === 'TimeoutError') return '로그인 응답 시간이 초과되었습니다. 서버 상태를 확인한 뒤 다시 시도해주세요.';
  return message || '로그인을 완료하지 못했습니다. 다시 시도해주세요.';
}

export function isNaeoAuthUrl(raw, serviceBase, extensionId) {
  try {
    let url = new URL(raw);
    if (url.origin !== serviceBase) return false;
    if (url.pathname === '/login') url = new URL(url.searchParams.get('next') || '', serviceBase);
    if (url.origin !== serviceBase) return false;
    return (url.pathname === '/auth/extension' && url.searchParams.get('extension_id') === extensionId)
      || (url.pathname === '/oauth/consent' && url.searchParams.get('client_id') === `naeo-extension-${extensionId}`);
  } catch { return false; }
}

/** The service worker owns the entire PKCE flow, even if its side panel closes.
 * Chrome 116+ keeps launchWebAuthFlow's worker alive while the window is open.
 * Hold the single-flight lock through token storage, not just the popup result.
 */
export function createAuthController(api, fetcher = globalThis.fetch) {
  let active = null;
  let recovering = false;

  async function authorize(serviceBase) {
    if (!await api.permissions.contains({ origins: [permissionOrigin(serviceBase)] })) {
      throw new Error('NAEO 주소 접근 권한이 필요합니다. 패널에서 다시 로그인해주세요.');
    }
    const { verifier, challenge } = await createPkce();
    const state = globalThis.crypto.randomUUID();
    const redirectUri = api.identity.getRedirectURL();
    const auth = new URL('/auth/extension', serviceBase);
    auth.search = new URLSearchParams({ extension_id: api.runtime.id, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'naeo:read' });
    const result = await api.identity.launchWebAuthFlow({ url: auth.href, interactive: true });
    if (!result) throw new Error('User did not approve access.');
    const callback = new URL(result), expected = new URL(redirectUri);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.hash
      || callback.searchParams.get('state') !== state) {
      throw new Error('로그인 상태 확인에 실패했습니다. 다시 연결해주세요.');
    }
    if (callback.searchParams.get('error')) throw new Error(`로그인 요청이 거절되었습니다: ${callback.searchParams.get('error')}`);
    const code = callback.searchParams.get('code');
    if (!code) throw new Error('로그인 코드를 받지 못했습니다.');
    const response = await fetcher(new URL('/api/oauth/token', serviceBase), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: globalThis.AbortSignal.timeout(20_000),
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: `naeo-extension-${api.runtime.id}`, code_verifier: verifier, resource: `${serviceBase}/api/mcp` }),
    });
    const tokens = await response.json();
    if (!response.ok) throw new Error(tokens.error_description || '토큰을 발급받지 못했습니다.');
    if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
      throw new Error('로그인 응답이 올바르지 않습니다. 다시 연결해주세요.');
    }
    // Persist here, before replying: the panel that initiated login may be gone.
    // Commit the origin and its tokens together so a failed login cannot mix servers.
    await api.storage.local.set({ serviceBase, tokens: {
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000, scope: tokens.scope,
    } });
    return { ok: true, connected: true, serviceBase };
  }

  return {
    state: () => ({ pending: active !== null, ...(active ? { serviceBase: active.serviceBase } : {}) }),
    wait: () => active?.promise || Promise.resolve({ ok: true, connected: false }),
    async reset(rawBase) {
      if (active || recovering) return { ok: false, error: '로그인이 진행 중입니다. 열린 로그인 창에서 완료하거나 취소해주세요.' };
      recovering = true;
      try {
        const serviceBase = normalizeServiceBase(rawBase);
        if (!await api.permissions.contains({ origins: [permissionOrigin(serviceBase)] })) {
          throw new Error('NAEO 주소 접근 권한이 필요합니다.');
        }
        const tabs = await api.tabs.query({ url: permissionOrigin(serviceBase) });
        let closed = 0;
        for (const tab of tabs) {
          if (!isNaeoAuthUrl(tab.url, serviceBase, api.runtime.id)) continue;
          // Re-read immediately before closing. Never close a regular browser
          // window, another extension's login, or a window that has navigated away.
          const window = await api.windows.get(tab.windowId, { populate: true }).catch(() => null);
          if (window?.type !== 'popup' || window.tabs?.length !== 1
            || !isNaeoAuthUrl(window.tabs[0].url, serviceBase, api.runtime.id)) continue;
          await api.windows.remove(window.id);
          closed += 1;
        }
        if (!closed) throw new Error('이전 로그인 창을 찾지 못했습니다. NAEO 로그인 창을 직접 닫아주세요. 창이 보이지 않으면 브라우저를 다시 시작한 뒤 로그인해주세요.');
        return { ok: true, closed };
      } catch (error) { return { ok: false, error: authErrorMessage(error) }; }
      finally { recovering = false; }
    },
    connect(rawBase) {
      let serviceBase;
      try { serviceBase = normalizeServiceBase(rawBase); }
      catch (error) { return Promise.resolve({ ok: false, error: authErrorMessage(error) }); }
      if (recovering) return Promise.resolve({ ok: false, error: '이전 로그인 창을 정리하고 있습니다. 잠시 후 다시 눌러주세요.' });
      if (active) {
        if (active.serviceBase === serviceBase) return active.promise;
        return Promise.resolve({ ok: false, error: '다른 NAEO 주소의 로그인이 진행 중입니다. 열린 로그인 창을 먼저 완료하거나 닫아주세요.' });
      }
      const attempt = { serviceBase, promise: null };
      active = attempt;
      attempt.promise = authorize(serviceBase)
        .catch(error => ({ ok: false, error: authErrorMessage(error),
          ...(/Only one web auth flow is allowed at a time/i.test(error?.message || '') ? { code: 'AUTH_WINDOW_OPEN' } : {}),
        }))
        .finally(() => { if (active === attempt) active = null; });
      return attempt.promise;
    },
  };
}
