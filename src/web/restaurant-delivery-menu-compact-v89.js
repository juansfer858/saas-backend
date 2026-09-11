(() => {
  'use strict';

  const previousFetch = window.fetch.bind(window);
  const MENU_PATH = '/api/v1/restaurante/menu';
  const COMPACT_PATH = '/api/v1/restaurante/domicilios/carta';
  const TIMEOUT_MS = 8000;

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.pathname + input.search;
    return String(input?.url || '');
  }

  function isMenuRequest(input) {
    const url = requestUrl(input);
    return url === MENU_PATH || url.startsWith(`${MENU_PATH}?`);
  }

  function mappedUrl(input) {
    const url = requestUrl(input);
    const queryAt = url.indexOf('?');
    return queryAt >= 0 ? `${COMPACT_PATH}${url.slice(queryAt)}` : COMPACT_PATH;
  }

  window.fetch = function deliveryCompactMenuFetch(input, init = {}) {
    if (!isMenuRequest(input)) return previousFetch(input, init);

    const controller = new AbortController();
    const upstreamSignal = init.signal || (typeof input === 'object' ? input?.signal : null);
    let timedOut = false;

    const onUpstreamAbort = () => controller.abort();
    if (upstreamSignal) {
      if (upstreamSignal.aborted) controller.abort();
      else upstreamSignal.addEventListener('abort', onUpstreamAbort, { once: true });
    }

    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);

    return previousFetch(mappedUrl(input), { ...init, signal: controller.signal })
      .catch((error) => {
        if (timedOut) throw new Error('La carta tardó demasiado en responder. Vuelve a intentarlo.');
        throw error;
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (upstreamSignal) upstreamSignal.removeEventListener?.('abort', onUpstreamAbort);
      });
  };

  window.VantixGCDeliveryMenuCompactV89 = Object.freeze({
    source: MENU_PATH,
    target: COMPACT_PATH,
    timeoutMs: TIMEOUT_MS
  });
})();
