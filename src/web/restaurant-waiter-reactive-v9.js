(() => {
  'use strict';

  const MARKER = 'VANTIX_WAITER_REACTIVE_SERVICE_V9';
  const nativeFetch = window.fetch.bind(window);
  let pendingBilling = null;
  let pendingGuests = null;
  let releaseTimer = null;

  const serviceBar = () => document.querySelector('#wvServiceBar');
  const billingButtons = () => [...document.querySelectorAll('#wvServiceBar [data-billing]')];
  const addPersonButton = () => document.querySelector('#wvServiceBar [data-action="add-person"]');

  function selectedBillingFromDom() {
    return billingButtons().find((button) => button.classList.contains('primary'))?.dataset.billing || null;
  }

  function paintBilling(mode) {
    for (const button of billingButtons()) {
      const active = button.dataset.billing === mode;
      button.classList.toggle('primary', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function helperNode() {
    const rows = serviceBar()?.querySelectorAll('.wv-servicebar-row');
    return rows && rows.length > 1 ? rows[1] : null;
  }

  function readGuestCount() {
    const match = String(helperNode()?.textContent || '').match(/(\d+)\s+persona/i);
    return match ? Number(match[1]) : null;
  }

  function paintGuestCount(count) {
    const row = helperNode();
    if (!row || !Number.isFinite(Number(count))) return;
    if (selectedBillingFromDom() === 'INDIVIDUAL') return;
    row.innerHTML = `<span class="wv-v9-guest-summary">${Number(count)} persona(s) · cuenta conjunta</span>`;
  }

  function lockServiceControls(locked) {
    for (const button of [...billingButtons(), addPersonButton()].filter(Boolean)) {
      button.style.pointerEvents = locked ? 'none' : '';
      button.setAttribute('aria-busy', locked ? 'true' : 'false');
      button.classList.toggle('wv-service-saving', locked);
    }
    if (!locked && releaseTimer) {
      clearTimeout(releaseTimer);
      releaseTimer = null;
    }
  }

  function fallbackRelease() {
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      lockServiceControls(false);
      if (pendingBilling) {
        paintBilling(pendingBilling.previous);
        pendingBilling = null;
      }
      if (pendingGuests) {
        paintGuestCount(pendingGuests.previous);
        pendingGuests = null;
      }
    }, 8000);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('#wvServiceBar button');
    if (!button) return;

    if (button.dataset.billing) {
      const previous = selectedBillingFromDom();
      const desired = button.dataset.billing;
      if (previous === desired) return;
      pendingBilling = { previous, desired };
      paintBilling(desired);
      lockServiceControls(true);
      fallbackRelease();
      return;
    }

    if (button.dataset.action === 'add-person') {
      const previous = readGuestCount();
      if (!Number.isFinite(previous)) return;
      pendingGuests = { previous, desired: previous + 1 };
      paintGuestCount(previous + 1);
      lockServiceControls(true);
      fallbackRelease();
    }
  }, true);

  window.fetch = async (input, init = {}) => {
    let pathname = '';
    try { pathname = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname; } catch {}
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
    const serviceMutation = method === 'PATCH' && /^\/api\/v1\/restaurante\/sesiones\/[^/]+\/servicio$/.test(pathname);
    if (!serviceMutation) return nativeFetch(input, init);

    let payload = {};
    try { payload = JSON.parse(String(init?.body || '{}')); } catch {}
    try {
      const response = await nativeFetch(input, init);
      if (!response.ok) {
        if (Object.prototype.hasOwnProperty.call(payload, 'billingMode') && pendingBilling) paintBilling(pendingBilling.previous);
        if (Object.prototype.hasOwnProperty.call(payload, 'guestCount') && pendingGuests) paintGuestCount(pendingGuests.previous);
      }
      return response;
    } finally {
      if (Object.prototype.hasOwnProperty.call(payload, 'billingMode')) pendingBilling = null;
      if (Object.prototype.hasOwnProperty.call(payload, 'guestCount')) pendingGuests = null;
      lockServiceControls(false);
    }
  };

  const style = document.createElement('style');
  style.textContent = `
    #wvServiceBar .wv-btn{transition:background-color .08s ease,border-color .08s ease,color .08s ease,transform .08s ease,box-shadow .08s ease}
    #wvServiceBar .wv-btn:active{transform:scale(.985)}
    #wvServiceBar .wv-btn.primary{box-shadow:0 0 0 2px rgba(22,132,84,.13)}
    #wvServiceBar .wv-service-saving{cursor:progress}
    .wv-v9-guest-summary{font-size:12px;font-weight:800}
  `;
  document.head.appendChild(style);

  window.VantixGCWaiterReactiveV9 = Object.freeze({ marker:MARKER, version:'9.0.0' });
})();
