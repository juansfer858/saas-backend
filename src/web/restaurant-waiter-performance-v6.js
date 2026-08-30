(() => {
  'use strict';
  const MARKER = 'VANTIX_WAITER_INTERACTION_STABILITY_V6';
  const nativeFetch = window.fetch.bind(window);
  const responseCache = new Map();
  const inflight = new Map();
  let mutationDepth = 0;
  let busyTimer = null;

  const ttlFor = (url, method) => {
    if (method !== 'GET') return 0;
    const path = url.pathname;
    if (path === '/api/v1/restaurante/ui-context') return 30000;
    if (path === '/api/v1/restaurante/zonas') return 15000;
    if (path === '/api/v1/restaurante/menu') return 30000;
    if (path === '/api/v1/restaurante/mesas') return 900;
    if (/\/api\/v1\/restaurante\/sesiones\/[^/]+\/pedido-borrador$/.test(path)) return 650;
    if (path === '/api/v1/restaurante/pedidos') return 650;
    return 0;
  };

  function requestUrl(input) {
    try { return new URL(typeof input === 'string' ? input : input.url, location.origin); }
    catch { return null; }
  }

  function requestMethod(input, init) {
    return String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
  }

  function authKey(init) {
    const headers = new Headers(init?.headers || {});
    return `${headers.get('x-tenant-subdomain') || ''}|${headers.get('authorization') || ''}`;
  }

  function keyFor(url, init) {
    return `${authKey(init)}|${url.pathname}${url.search}`;
  }

  async function snapshot(response) {
    const clone = response.clone();
    return {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body: await clone.text()
    };
  }

  function responseFrom(data) {
    return new Response(data.body, { status:data.status, statusText:data.statusText, headers:data.headers });
  }

  function clearMatching(predicate) {
    for (const key of responseCache.keys()) if (predicate(key)) responseCache.delete(key);
  }

  function invalidateForMutation(url) {
    const path = url.pathname;
    clearMatching((key) => {
      if (key.includes('|/api/v1/restaurante/mesas')) return true;
      if (path.includes('/pedido-borrador') && (key.includes('/pedido-borrador') || key.includes('|/api/v1/restaurante/pedidos'))) return true;
      if (path.includes('/pedidos') && (key.includes('/pedido-borrador') || key.includes('|/api/v1/restaurante/pedidos'))) return true;
      if (path.includes('/sesiones/') && (key.includes('/pedido-borrador') || key.includes('|/api/v1/restaurante/pedidos'))) return true;
      return false;
    });
  }

  function ensureBusyUi() {
    if (document.querySelector('#waiterInteractionStyleV6')) return;
    const style = document.createElement('style');
    style.id = 'waiterInteractionStyleV6';
    style.textContent = `
      #waiterInteractionBusyV6{position:fixed;z-index:500;left:50%;bottom:max(12px,env(safe-area-inset-bottom));transform:translateX(-50%);display:none;align-items:center;gap:8px;min-height:38px;padding:8px 13px;border-radius:999px;background:#111c2b;color:#fff;font:700 12px/1.2 Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(15,23,42,.24);pointer-events:none}
      #waiterInteractionBusyV6 i{width:12px;height:12px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;animation:waiterSpinV6 .7s linear infinite}
      html[data-waiter-mutation-busy="1"] #waiterInteractionBusyV6{display:flex}
      html[data-waiter-mutation-busy="1"] #view [data-draft-plus],html[data-waiter-mutation-busy="1"] #view [data-draft-minus],html[data-waiter-mutation-busy="1"] #view #sendDraft,html[data-waiter-mutation-busy="1"] #view #prepareAccount,html[data-waiter-mutation-busy="1"] #view #sendToCash,html[data-waiter-mutation-busy="1"] #view #waiterOpenTable{pointer-events:none;opacity:.65}
      @keyframes waiterSpinV6{to{transform:rotate(360deg)}}
    `;
    document.head.appendChild(style);
    const busy = document.createElement('div');
    busy.id = 'waiterInteractionBusyV6';
    busy.innerHTML = '<i></i><span>Actualizando…</span>';
    document.body.appendChild(busy);
  }

  function setMutationBusy(active) {
    ensureBusyUi();
    if (busyTimer) { clearTimeout(busyTimer); busyTimer = null; }
    if (active) {
      busyTimer = setTimeout(() => { document.documentElement.dataset.waiterMutationBusy = '1'; }, 120);
    } else {
      delete document.documentElement.dataset.waiterMutationBusy;
    }
  }

  window.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    if (!url || url.origin !== location.origin || !url.pathname.startsWith('/api/v1/restaurante/')) return nativeFetch(input, init);
    const method = requestMethod(input, init);
    const ttl = ttlFor(url, method);
    const cacheKey = keyFor(url, init);

    if (method === 'GET' && ttl > 0) {
      const cached = responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return responseFrom(cached.data);
      if (inflight.has(cacheKey)) return responseFrom(await inflight.get(cacheKey));
      const pending = nativeFetch(input, init).then(async (response) => {
        const data = await snapshot(response);
        if (response.ok) responseCache.set(cacheKey, { data, expiresAt:Date.now() + ttl });
        return data;
      }).finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, pending);
      return responseFrom(await pending);
    }

    if (method !== 'GET' && method !== 'HEAD') {
      mutationDepth += 1;
      setMutationBusy(true);
      invalidateForMutation(url);
      try {
        const response = await nativeFetch(input, init);
        invalidateForMutation(url);
        return response;
      } finally {
        mutationDepth = Math.max(0, mutationDepth - 1);
        if (!mutationDepth) setMutationBusy(false);
      }
    }

    return nativeFetch(input, init);
  };

  document.addEventListener('click', (event) => {
    if (mutationDepth < 1) return;
    const target = event.target.closest('#view [data-draft-plus],#view [data-draft-minus],#view #sendDraft,#view #prepareAccount,#view #sendToCash,#view #waiterOpenTable');
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.VantixGCWaiterInteractionV6 = Object.freeze({ marker:MARKER, clearCache:() => responseCache.clear() });
})();
