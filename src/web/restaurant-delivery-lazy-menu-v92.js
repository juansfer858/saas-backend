/* VANTIX_RESTAURANT_DELIVERY_LAZY_MENU_V92 */
(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_DELIVERY_LAZY_MENU_V92';
  const V91_MARKER = 'VANTIX_RESTAURANT_DELIVERY_ORDERS_MENU_V91';
  const V91_SRC = '/app/restaurant-delivery-orders-menu-v91.js?v=v91';
  if (window[MARKER]) return;

  let loaderPromise = null;
  let launching = false;

  function loadV91() {
    if (window[V91_MARKER]) return Promise.resolve();
    if (loaderPromise) return loaderPromise;

    loaderPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-delivery-v91-runtime="1"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once:true });
        existing.addEventListener('error', () => reject(new Error('No se pudo cargar la Carta de Pedidos.')), { once:true });
        return;
      }

      const script = document.createElement('script');
      script.src = V91_SRC;
      script.async = true;
      script.dataset.deliveryV91Runtime = '1';
      script.addEventListener('load', () => resolve(), { once:true });
      script.addEventListener('error', () => reject(new Error('No se pudo cargar la Carta de Pedidos.')), { once:true });
      document.head.appendChild(script);
    }).catch((error) => {
      loaderPromise = null;
      throw error;
    });

    return loaderPromise;
  }

  function setBusy(button, busy) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.v92OriginalText) button.dataset.v92OriginalText = button.textContent || '+ NUEVO DOMICILIO';
      button.disabled = true;
      button.textContent = 'ABRIENDO CARTA…';
      button.setAttribute('aria-busy', 'true');
    } else {
      button.disabled = false;
      button.textContent = button.dataset.v92OriginalText || '+ NUEVO DOMICILIO';
      button.removeAttribute('aria-busy');
    }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target?.closest?.('[data-new-delivery]');
    if (!button || window[V91_MARKER]) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (launching) return;

    launching = true;
    setBusy(button, true);
    try {
      await loadV91();
      setBusy(button, false);
      queueMicrotask(() => button.click());
    } catch (error) {
      setBusy(button, false);
      alert(error?.message || 'No se pudo abrir la Carta de Pedidos.');
    } finally {
      launching = false;
    }
  }, true);

  document.documentElement.dataset.deliveryLazyMenuV92 = '1';
  window[MARKER] = Object.freeze({
    version:'92.0.0',
    loadOnModuleEntry:false,
    loadOnNewDelivery:true,
    menuRuntime:V91_SRC
  });
})();
