(() => {
  'use strict';
  const SESSION_KEY = 'vantixgc_core_session_v1';

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  function tokenPayload(token) {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return null;
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
      return JSON.parse(decodeURIComponent(escape(atob(normalized))));
    } catch { return null; }
  }

  async function renewIfNeeded(session) {
    if (!session?.token || !session?.subdomain) return session;
    const payload = tokenPayload(session.token);
    if (session.persistent === true && !payload?.exp) return session;
    try {
      const response = await fetch('/api/v1/restaurante/dispositivos-mesero/renovar-sesion', {
        method:'POST',
        cache:'no-store',
        headers:{
          'Content-Type':'application/json',
          Authorization:`Bearer ${session.token}`,
          'x-tenant-subdomain':session.subdomain
        },
        body:'{}'
      });
      if (!response.ok) return session;
      const body = await response.json().catch(() => null);
      const renewed = body?.data?.session;
      if (!renewed?.token) return session;
      const merged = { ...session, ...renewed, persistent:true };
      localStorage.setItem(SESSION_KEY, JSON.stringify(merged));
      document.documentElement.dataset.waiterPersistent = '1';
      return merged;
    } catch { return session; }
  }

  renewIfNeeded(readSession());
  window.VantixGCWaiterSessionV8 = Object.freeze({ version:'8.0.0', persistent:true, renewIfNeeded });
})();

(() => {
  'use strict';
  const MARKER = 'VANTIX_WAITER_ORDER_REVIEW_V12';
  const SYNC_MARKER = 'VANTIX_WAITER_ORDER_REVIEW_SYNC_V13';
  const HARD_GATE_MARKER = 'VANTIX_WAITER_ORDER_REVIEW_HARD_GATE_V14';
  const ENTRY_MARKER = 'VANTIX_WAITER_TABLET_REVIEW_ENTRY_V15';
  const RETRIES_MS = [0, 180, 450, 900, 1800, 3200];
  const ENTRY_RETRIES_MS = [0, 120, 320, 700, 1300, 2600, 4200];
  let timers = [];
  let entryTimers = [];

  function clearReviewTimers() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  }

  function clearEntryTimers() {
    for (const timer of entryTimers) clearTimeout(timer);
    entryTimers = [];
  }

  function pendingRows(root) {
    return [...root.querySelectorAll('.wv-order-list .wv-item')]
      .filter((row) => /Por enviar/i.test(row.textContent || ''));
  }

  function sentRows(root) {
    return [...root.querySelectorAll('.wv-order-list .wv-item')]
      .filter((row) => /Enviado/i.test(row.textContent || ''));
  }

  function ensureReviewEntryButton() {
    const root = document.querySelector('#wvOrder');
    const actions = root?.querySelector('.wv-actions');
    if (!root || !actions) return false;

    const hint = [...actions.querySelectorAll('.wv-msg')]
      .find((node) => /Revisa el pedido antes de enviarlo/i.test(node.textContent || ''));
    const existing = actions.querySelector('[data-wv-review-entry]');

    if (!hint) {
      existing?.remove();
      return false;
    }

    if (existing) return true;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wv-btn wv-review-entry';
    button.dataset.wvReviewEntry = 'true';
    button.textContent = 'REVISAR PEDIDO';
    button.setAttribute('aria-label', 'Revisar el pedido antes de confirmarlo');
    actions.insertBefore(button, hint);
    return true;
  }

  function scheduleReviewEntry() {
    clearEntryTimers();
    entryTimers = ENTRY_RETRIES_MS.map((delay) => setTimeout(ensureReviewEntryButton, delay));
  }

  function enhanceOrderReview() {
    const root = document.querySelector('#wvOrder');
    if (!root) return false;
    const header = root.querySelector('.wv-order-head small');
    const list = root.querySelector('.wv-order-list');
    const action = root.querySelector('[data-action="confirm-send-draft"]');
    const pending = pendingRows(root);
    const sent = sentRows(root);
    const oldNote = root.querySelector('[data-wv-order-review-note]');
    const oldPendingLabel = root.querySelector('[data-wv-pending-label]');
    const oldSentLabel = root.querySelector('[data-wv-sent-label]');
    oldNote?.remove();
    oldPendingLabel?.remove();
    oldSentLabel?.remove();

    if (pending.length) {
      root.dataset.orderReview = action ? 'confirm' : 'syncing';
      if (header) header.textContent = action ? 'Pedido por confirmar' : 'Revisando pedido';

      const note = document.createElement('div');
      note.dataset.wvOrderReviewNote = 'true';
      note.className = 'wv-order-review-note';
      note.innerHTML = action
        ? '<b>Revisa antes de enviar</b><span>Confirma productos, cantidades, persona y notas. Nada se envía hasta pulsar “Confirmar pedido”.</span>'
        : '<b>Preparando revisión</b><span>Estamos sincronizando las últimas cantidades. Todavía no se puede enviar a cocina.</span>';
      root.querySelector('.wv-order-head')?.insertAdjacentElement('afterend', note);

      if (list) {
        const pendingLabel = document.createElement('div');
        pendingLabel.dataset.wvPendingLabel = 'true';
        pendingLabel.className = 'wv-order-section-label pending';
        pendingLabel.textContent = `POR CONFIRMAR · ${pending.length} producto${pending.length === 1 ? '' : 's'}`;
        list.insertAdjacentElement('beforebegin', pendingLabel);

        if (sent.length) {
          const firstSent = sent[0];
          const sentLabel = document.createElement('div');
          sentLabel.dataset.wvSentLabel = 'true';
          sentLabel.className = 'wv-order-section-label sent';
          sentLabel.textContent = 'YA ENVIADO';
          firstSent.insertAdjacentElement('beforebegin', sentLabel);
        }
      }

      if (action) {
        const current = String(action.textContent || '');
        const amount = current.includes('·') ? current.split('·').slice(1).join('·').trim() : '';
        action.textContent = `CONFIRMAR PEDIDO${amount ? ` · ${amount}` : ''}`;
        action.setAttribute('aria-label', 'Confirmar pedido y enviarlo a cocina o barra');
        action.dataset.confirmOrder = 'true';
      }
      return true;
    }

    root.dataset.orderReview = 'history';
    if (header) header.textContent = 'Pedido en curso';
    return true;
  }

  function scheduleReview() {
    clearReviewTimers();
    timers = RETRIES_MS.map((delay) => setTimeout(enhanceOrderReview, delay));
  }

  document.addEventListener('click', (event) => {
    const entry = event.target?.closest?.('[data-wv-review-entry]');
    if (entry) {
      event.preventDefault();
      const toggle = document.querySelector('#wvOrderToggle');
      if (toggle) toggle.click();
      return;
    }

    const toggle = event.target?.closest?.('#wvOrderToggle');
    if (toggle) {
      scheduleReview();
      return;
    }

    if (event.target?.closest?.('#wvApp')) scheduleReviewEntry();
  }, false);

  window.addEventListener('vantix:waiter-order-review-ready', () => {
    clearEntryTimers();
    scheduleReview();
  });

  document.addEventListener('click', (event) => {
    const confirm = event.target?.closest?.('[data-action="confirm-send-draft"]');
    if (!confirm) return;
    confirm.textContent = 'CONFIRMANDO…';
    confirm.setAttribute('aria-busy', 'true');
  }, true);

  const style = document.createElement('style');
  style.textContent = `
    .wv-order-review-note{display:grid;gap:3px;margin:10px 0 8px;padding:10px 12px;border:1px solid #bbf7d0;border-radius:13px;background:#f0fdf4;color:#166534;line-height:1.3}
    .wv-order-review-note b{font-size:13px}.wv-order-review-note span{font-size:11px}
    .wv-order-section-label{margin:9px 0 5px;font-size:10px;font-weight:950;letter-spacing:.06em;color:#64748b}
    .wv-order-section-label.pending{color:#166534}.wv-order-section-label.sent{margin-top:14px}
    .wv-review-entry{min-height:58px!important;border-color:#0f1a2b!important;background:#0f1a2b!important;color:#fff!important;font-size:14px!important;letter-spacing:.01em}
    #wvOrder[data-order-review="confirm"] [data-action="confirm-send-draft"]{min-height:60px;font-size:15px;box-shadow:0 9px 20px rgba(22,132,84,.18)}
  `;
  document.head.appendChild(style);

  scheduleReviewEntry();

  window.VantixGCWaiterOrderReviewV12 = Object.freeze({
    marker:MARKER,
    syncMarker:SYNC_MARKER,
    hardGateMarker:HARD_GATE_MARKER,
    entryMarker:ENTRY_MARKER,
    confirmBeforeSend:true,
    syncedBeforeReview:true,
    tabletReviewEntry:true,
    noDirectKitchenSend:true,
    passiveEnhancement:true
  });
})();

(() => {
  'use strict';
  const MARKER = 'VANTIX_WAITER_AUTOPEDIDO_CODE_V16';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const RETRIES_MS = [0, 120, 320, 700, 1300, 2200];
  let timers = [];
  let requestSeq = 0;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  function activeTableId() {
    return document.querySelector('#wvTables .wv-table.active[data-table]')?.dataset.table || null;
  }

  function clearTimers() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  }

  function removeCard() {
    document.querySelector('[data-wv-autopedido-code]')?.remove();
  }

  function ensureCard(tableId) {
    const serviceBar = document.querySelector('#wvServiceBar');
    if (!serviceBar || activeTableId() !== tableId) return null;
    let card = document.querySelector('[data-wv-autopedido-code]');
    if (card && card.dataset.tableId !== tableId) {
      card.remove();
      card = null;
    }
    if (!card) {
      card = document.createElement('section');
      card.className = 'wv-card wv-autopedido-card';
      card.dataset.wvAutopedidoCode = 'true';
      card.dataset.tableId = tableId;
      serviceBar.insertAdjacentElement('afterend', card);
    }
    return card;
  }

  function renderLoading(tableId) {
    const card = ensureCard(tableId);
    if (!card) return false;
    card.dataset.loaded = '0';
    card.innerHTML = '<div><small>AUTOPEDIDO QR</small><b>Consultando código…</b><span>Este código autoriza los teléfonos de la mesa actual.</span></div>';
    return true;
  }

  function renderStatus(tableId, status) {
    const card = ensureCard(tableId);
    if (!card) return false;
    card.dataset.loaded = '1';
    if (!status?.open) {
      card.innerHTML = '<div><small>AUTOPEDIDO QR</small><b>Mesa cerrada</b><span>El código aparecerá cuando abras la mesa.</span></div>';
      return true;
    }
    card.innerHTML = `<div class="wv-autopedido-copy"><small>CÓDIGO PARA ACTIVAR AUTOPEDIDO</small><strong>${String(status.visitCode || '').replace(/[^0-9]/g, '').slice(0,4)}</strong><span>Dile estos 4 números a las personas de ${String(status.table?.name || 'la mesa').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]))}. ${Number(status.activeDevices || 0)} teléfono(s) autorizado(s).</span></div><button type="button" class="wv-btn wv-autopedido-rotate" data-wv-autopedido-rotate>CAMBIAR CÓDIGO</button>`;
    return true;
  }

  function renderError(tableId, text) {
    const card = ensureCard(tableId);
    if (!card) return false;
    card.dataset.loaded = '1';
    const safe = String(text || 'No fue posible consultar el código.').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
    card.innerHTML = `<div><small>AUTOPEDIDO QR</small><b>Código no disponible</b><span>${safe}</span></div>`;
    return true;
  }

  async function refreshCode(force = false) {
    const tableId = activeTableId();
    const serviceBar = document.querySelector('#wvServiceBar');
    if (!tableId || !serviceBar) {
      removeCard();
      return false;
    }
    const existing = document.querySelector('[data-wv-autopedido-code]');
    if (!force && existing?.dataset.tableId === tableId && existing.dataset.loaded === '1') return true;

    const session = readSession();
    if (!session?.token || !session?.subdomain) return false;
    const seq = ++requestSeq;
    renderLoading(tableId);
    try {
      const response = await fetch(`/api/v1/restaurante/mesas/${encodeURIComponent(tableId)}/qr-visita`, {
        cache:'no-store',
        headers:{ Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain }
      });
      let body = {};
      try { body = await response.json(); } catch {}
      if (seq !== requestSeq || activeTableId() !== tableId) return false;
      if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
      return renderStatus(tableId, body?.data || {});
    } catch (error) {
      if (seq === requestSeq && activeTableId() === tableId) renderError(tableId, error.message);
      return false;
    }
  }

  function scheduleCode(forceFirst = false) {
    clearTimers();
    timers = RETRIES_MS.map((delay, index) => setTimeout(() => {
      refreshCode(index === 0 && forceFirst).catch(() => {});
    }, delay));
  }

  async function rotateCode(button) {
    const tableId = button?.closest?.('[data-wv-autopedido-code]')?.dataset.tableId || activeTableId();
    const session = readSession();
    if (!tableId || !session?.token || !session?.subdomain) return;
    if (!confirm('¿Cambiar el código de autopedido? Los teléfonos autorizados tendrán que ingresar el nuevo código.')) return;
    button.disabled = true;
    button.textContent = 'CAMBIANDO…';
    try {
      const response = await fetch(`/api/v1/restaurante/mesas/${encodeURIComponent(tableId)}/qr-visita/regenerar`, {
        method:'POST',
        cache:'no-store',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain },
        body:'{}'
      });
      let body = {};
      try { body = await response.json(); } catch {}
      if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
      const current = document.querySelector('[data-wv-autopedido-code]');
      if (current?.dataset.tableId === tableId) {
        current.dataset.loaded = '0';
        current.innerHTML = `<div class="wv-autopedido-copy"><small>CÓDIGO PARA ACTIVAR AUTOPEDIDO</small><strong>${String(body?.data?.visitCode || '').replace(/[^0-9]/g, '').slice(0,4)}</strong><span>Código cambiado · 0 teléfonos autorizados.</span></div><button type="button" class="wv-btn wv-autopedido-rotate" data-wv-autopedido-rotate>CAMBIAR CÓDIGO</button>`;
        current.dataset.loaded = '1';
      }
    } catch (error) {
      renderError(tableId, error.message);
    } finally {
      const liveButton = document.querySelector('[data-wv-autopedido-rotate]');
      if (liveButton) { liveButton.disabled = false; liveButton.textContent = 'CAMBIAR CÓDIGO'; }
    }
  }

  document.addEventListener('click', (event) => {
    const rotate = event.target?.closest?.('[data-wv-autopedido-rotate]');
    if (rotate) {
      event.preventDefault();
      rotateCode(rotate).catch(() => {});
      return;
    }
    if (event.target?.closest?.('.wv-table[data-table], [data-action="open-table"]')) scheduleCode(true);
  }, false);

  document.addEventListener('change', (event) => {
    if (event.target?.id === 'wvZone') scheduleCode(true);
  }, false);

  window.addEventListener('online', () => scheduleCode(true));
  window.addEventListener('pageshow', () => scheduleCode(false));

  const style = document.createElement('style');
  style.textContent = `
    .wv-autopedido-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px;border-color:#b8d7c7;background:#eef8f2;color:#173f31}
    .wv-autopedido-card small{display:block;font-size:10px;font-weight:950;letter-spacing:.08em;color:#166534}.wv-autopedido-card b{display:block;margin-top:3px;font-size:14px}.wv-autopedido-card span{display:block;margin-top:3px;font-size:11px;line-height:1.35;color:#47675a}
    .wv-autopedido-copy strong{display:block;margin-top:2px;font-size:clamp(30px,7vw,42px);line-height:1;letter-spacing:.18em;font-variant-numeric:tabular-nums;color:#0f1a2b}
    .wv-autopedido-rotate{min-height:50px!important;white-space:nowrap!important}
    @media(max-width:520px){.wv-autopedido-card{grid-template-columns:1fr}.wv-autopedido-rotate{width:100%}}
  `;
  document.head.appendChild(style);

  scheduleCode(true);
  window.VantixGCWaiterAutopedidoCodeV16 = Object.freeze({ marker:MARKER, visitCodeVisible:true, noPolling:true, noMutationObserver:true });
})();
