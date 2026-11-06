// Only used in the explicit phone login window. Credentials are sent solely to
// the origin-restricted native channel after the user taps Save Login.
(() => {
  if (location.origin !== 'https://chat.deepseek.com' || window.top !== window || window.MosuanAuth) return;
  const captured = {};
  const allowed = new Set(['authorization', 'x-hif-dliq', 'x-hif-leim', 'x-client-platform', 'x-client-version', 'x-app-version', 'x-client-locale', 'x-client-timezone-offset']);
  const header = (name, value) => { name = String(name).toLowerCase(); if (allowed.has(name) && typeof value === 'string' && value.length < 20000 && !/[\r\n\0]/.test(value)) captured[name] = value; };
  const privateUrl = value => { try { const url = new URL(value, location.href); return url.origin === location.origin && url.pathname.startsWith('/api/'); } catch { return false; } };
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    try {
      const resource = args[0];
      if (privateUrl(typeof resource === 'string' || resource instanceof URL ? resource : resource.url)) {
        new Headers(resource instanceof Request ? resource.headers : undefined).forEach((value, name) => header(name, value));
        new Headers(args[1]?.headers).forEach((value, name) => header(name, value));
      }
    } catch {}
    return originalFetch.apply(this, args);
  };
  const urls = new WeakMap(), xhrOpen = XMLHttpRequest.prototype.open, xhrHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (...args) { urls.set(this, privateUrl(args[1])); return xhrOpen.apply(this, args); };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) { if (urls.get(this)) header(name, value); return xhrHeader.call(this, name, value); };
  const token = value => {
    for (let depth = 0; depth < 4; depth++) {
      if (typeof value === 'string') { try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object') { value = parsed; continue; } } catch {} return value.replace(/^Bearer\s+/i, '').trim(); }
      if (!value || typeof value !== 'object') return '';
      value = value.value || value.token || value.access_token || value.accessToken;
    }
    return '';
  };
  window.MosuanAuth = { save() {
    let access = '';
    try { for (const store of [localStorage, sessionStorage]) {
      if (access) break;
      for (const key of ['userToken', 'token', 'auth_token', 'access_token', 'accessToken']) { access = token(store.getItem(key)); if (access) break; }
    } } catch {}
    if (!access) access = token(captured.authorization);
    if (!access || access.length < 20 || /[\r\n\0]/.test(access)) { window.MosuanAuthChannel.postMessage(JSON.stringify({ kind: 'missing' })); return; }
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const wasmUrl = resources.reverse().find(value => { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'fe-static.deepseek.com' && url.pathname.endsWith('.wasm') && !url.search && !url.hash; } catch { return false; } });
    const headers = { ...captured }; delete headers.authorization;
    window.MosuanAuthChannel.postMessage(JSON.stringify({ kind: 'credentials', auth: { token: access, headers, ...(wasmUrl ? { wasmUrl } : {}) } }));
  } };
})();
