'use strict';

const MARKER = 'VANTIX_WAITER_CLOSE_EMPTY_OPENING_V74';

const waiterCloseEmptyV74Runtime = `
;(() => {
  'use strict';
  const MARKER = '${MARKER}';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  let timer = null;
  let epoch = 0;
  let observer = null;

  function currentSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  function headers() {
    const session = currentSession();
    if (!session?.token || !session?.subdomain) return null;
    return {
      'Content-Type':'application/json',
      Authorization:'Bearer ' + session.token,
      'x-tenant-subdomain':session.subdomain
    };
  }

  function activeTableId() {
    return document.querySelector('.wv-table.active[data-table]')?.dataset?.table || null;
  }

  function removeButton() {
    document.querySelector('[data-v74-close-empty-row]')?.remove();
  }

  function showMessage(text, error = false) {
    const root = document.querySelector('#wvMessage');
    if (!root) return;
    const div = document.createElement('div');
    div.className = 'wv-msg' + (error ? ' err' : '');
    div.textContent = String(text || '');
    root.replaceChildren(div);
  }

  function ensureButton(tableId) {
    const bar = document.querySelector('#wvServiceBar');
    if (!bar || activeTableId() !== tableId) return;
    let row = bar.querySelector('[data-v74-close-empty-row]');
    if (!row) {
      row = document.createElement('div');
      row.dataset.v74CloseEmptyRow = '1';
      row.className = 'wv-servicebar-row';
      row.style.cssText = 'grid-template-columns:1fr;margin-top:7px';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wv-btn';
      button.dataset.v74CloseEmpty = tableId;
      button.style.cssText = 'border-color:#b42318;color:#b42318;background:#fff7f6';
      button.textContent = 'Cerrar mesa abierta por error';
      row.appendChild(button);
      bar.appendChild(row);
    } else {
      const button = row.querySelector('[data-v74-close-empty]');
      if (button) button.dataset.v74CloseEmpty = tableId;
    }
  }

  async function refreshEligibility() {
    const tableId = activeTableId();
    const authHeaders = headers();
    const myEpoch = ++epoch;
    if (!tableId || !authHeaders || !document.querySelector('#wvServiceBar')) {
      removeButton();
      return;
    }
    try {
      const response = await fetch('/api/v1/restaurante/mesas/' + encodeURIComponent(tableId) + '/detalle-v67', {
        method:'GET', cache:'no-store', headers:authHeaders
      });
      let body = null;
      try { body = await response.json(); } catch {}
      if (myEpoch !== epoch || activeTableId() !== tableId) return;
      if (!response.ok || body?.data?.canCancelOpening !== true) {
        removeButton();
        return;
      }
      ensureButton(tableId);
    } catch {
      if (myEpoch === epoch) removeButton();
    }
  }

  function schedule(delay = 120) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      refreshEligibility().catch(() => {});
    }, delay);
  }

  async function cancelOpening(button, tableId) {
    if (!tableId || activeTableId() !== tableId) return;
    if (!confirm('La mesa está vacía y se cerrará porque fue abierta por error. ¿Continuar?')) return;
    const authHeaders = headers();
    if (!authHeaders) return showMessage('El dispositivo perdió la vinculación.', true);
    button.disabled = true;
    button.textContent = 'Cerrando mesa…';
    try {
      const response = await fetch('/api/v1/restaurante/mesas/' + encodeURIComponent(tableId) + '/cancelar-apertura-v67', {
        method:'POST', cache:'no-store', headers:authHeaders, body:'{}'
      });
      let body = null;
      try { body = await response.json(); } catch {}
      if (!response.ok) throw new Error(body?.error?.message || body?.message || 'No fue posible cerrar la mesa.');
      showMessage('Mesa cerrada. La apertura vacía fue descartada.');
      setTimeout(() => location.reload(), 250);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Cerrar mesa abierta por error';
      showMessage(error?.message || 'No fue posible cerrar la mesa.', true);
      schedule(300);
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-v74-close-empty]');
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      cancelOpening(button, button.dataset.v74CloseEmpty).catch(() => {});
      return;
    }
    if (event.target?.closest?.('[data-table]')) schedule(180);
  }, true);

  document.addEventListener('change', (event) => {
    if (event.target?.id === 'wvZone') schedule(180);
  }, true);

  function start() {
    if (observer) return;
    const root = document.querySelector('#wvApp') || document.body;
    observer = new MutationObserver(() => schedule(160));
    observer.observe(root, { childList:true, subtree:true, attributes:true, attributeFilter:['class','data-table'] });
    schedule(80);
    document.documentElement.dataset.waiterCloseEmptyV74 = '1';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();

  window.VantixGCWaiterCloseEmptyV74 = Object.freeze({ marker:MARKER, ownerOnly:true, emptyOnly:true });
})();
`;

function installRestaurantWaiterCloseEmptyV74(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-waiter-runtime-v7.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n${waiterCloseEmptyV74Runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Waiter-Close-Empty', 'v74-owner-only');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, waiterCloseEmptyV74Runtime, installRestaurantWaiterCloseEmptyV74 };
