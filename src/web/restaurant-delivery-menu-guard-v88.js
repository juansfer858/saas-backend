(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const MENU_PATH = '/api/v1/restaurante/menu';
  const MENU_TIMEOUT_MS = 12000;

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.pathname + input.search;
    return String(input?.url || '');
  }

  function isDeliveryMenuRequest(input) {
    const url = requestUrl(input);
    return url === MENU_PATH || url.startsWith(`${MENU_PATH}?`);
  }

  window.fetch = function deliveryMenuGuard(input, init = {}) {
    if (!isDeliveryMenuRequest(input)) return nativeFetch(input, init);

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
    }, MENU_TIMEOUT_MS);

    return nativeFetch(input, { ...init, signal: controller.signal })
      .catch((error) => {
        if (timedOut) {
          throw new Error('La carta tardó demasiado en responder. Cierra esta ventana y vuelve a intentarlo.');
        }
        throw error;
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (upstreamSignal) upstreamSignal.removeEventListener?.('abort', onUpstreamAbort);
      });
  };

  window.VantixGCDeliveryMenuGuardV88 = Object.freeze({
    timeoutMs: MENU_TIMEOUT_MS,
    path: MENU_PATH
  });
})();
