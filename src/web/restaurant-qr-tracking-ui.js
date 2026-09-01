(() => {
  const qrToken = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  if (!qrToken) return;

  const qrApiPrefix = `/api/public/restaurante/qr/${encodeURIComponent(qrToken)}`;
  const delegatedFetch = window.fetch.bind(window);
  const S = {
    orders: [],
    sessionId: null,
    seatNumber: null,
    table: null,
    account: { state:'OPEN', requested:false },
    accountSubmitting: false,
    streamAbort: null,
    reconnectTimer: null,
    stopped: false,
    loading: false
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (value) => new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(Number(value || 0));

  function targetUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function requestMethod(input, init) {
    return String(init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
  }

  function orderStatus(state) {
    const map = {
      ENVIADO: { label:'PEDIDO RECIBIDO', detail:'Tu pedido fue recibido. En breve comenzará la preparación.', tone:'received' },
      EN_PREPARACION: { label:'EN PREPARACIÓN', detail:'Cocina, Barra o Postres están trabajando en tu pedido.', tone:'preparing' },
      LISTO: { label:'LISTO PARA SERVIR', detail:'Tu pedido ya está listo para llevarlo a la mesa.', tone:'ready' },
      ENTREGADO: { label:'ENTREGADO', detail:'El pedido fue entregado en la mesa.', tone:'delivered' },
      CANCELADO: { label:'CANCELADO', detail:'Este pedido fue cancelado.', tone:'cancelled' }
    };
    return map[state] || { label:'PEDIDO RECIBIDO', detail:'Estamos actualizando el estado.', tone:'received' };
  }

  function accountStatus(state) {
    const map = {
      OPEN: { label:'PEDIR LA CUENTA', detail:'Solicita la cuenta cuando hayas terminado.', tone:'open' },
      REQUESTED: { label:'CUENTA SOLICITADA', detail:'El mesero ya fue avisado.', tone:'requested' },
      PREPARING: { label:'PREPARANDO TU CUENTA', detail:'El mesero está preparando la cuenta.', tone:'preparing' },
      IN_CASH: { label:'CUENTA EN CAJA', detail:'La cuenta fue enviada a Caja.', tone:'cash' },
      CLOSED: { label:'CUENTA FINALIZADA', detail:'La visita ya terminó.', tone:'closed' }
    };
    return map[state] || map.OPEN;
  }

  function commandStatus(state) {
    const map = {
      PENDIENTE: 'Recibido',
      EN_PREPARACION: 'Preparando',
      LISTA: 'Listo',
      ENTREGADA: 'Entregado',
      CANCELADA: 'Cancelado'
    };
    return map[state] || String(state || 'Pendiente');
  }

  function stationName(station) {
    return ({ COCINA:'Cocina', BARRA:'Barra', POSTRES:'Postres' })[station] || String(station || 'Estación');
  }

  function summaryStatus() {
    if (!S.orders.length) return null;
    const active = S.orders.filter((order) => !['ENTREGADO', 'CANCELADO'].includes(order.state));
    if (active.some((order) => order.state === 'LISTO')) return orderStatus('LISTO');
    if (active.some((order) => order.state === 'EN_PREPARACION')) return orderStatus('EN_PREPARACION');
    if (active.some((order) => order.state === 'ENVIADO')) return orderStatus('ENVIADO');
    const latest = S.orders[S.orders.length - 1];
    return orderStatus(latest?.state);
  }

  function ensureStyles() {
    if (document.getElementById('restaurantQrTrackingStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantQrTrackingStyles';
    style.textContent = `
      .qrv-track-button{position:fixed;z-index:47;right:max(12px,env(safe-area-inset-right));bottom:88px;min-height:48px;padding:0 16px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:#181614;color:#fff;font-size:13px;font-weight:900;box-shadow:0 12px 28px rgba(24,22,20,.28)}
      .qrv-track-button[data-tone="ready"]{background:#2f6e58}.qrv-track-button[data-tone="delivered"]{background:#405b50}.qrv-track-button[data-tone="cancelled"]{background:#8f2d2d}
      .qrv-track-button[hidden]{display:none}
      .qrv-track-panel-card{display:grid;gap:13px;padding:15px;border:1px solid #e4d7c5;border-radius:17px;background:#fff}
      .qrv-track-panel-card+.qrv-track-panel-card{margin-top:12px}.qrv-track-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.qrv-track-panel-head b{font-size:17px}.qrv-track-panel-head small{display:block;margin-top:3px;color:#776b60}
      .qrv-track-state{display:inline-flex;align-items:center;min-height:30px;padding:0 10px;border-radius:999px;background:#f3eee6;color:#524a43;font-size:11px;font-weight:900;white-space:nowrap}.qrv-track-state.ready{background:#e4f3eb;color:#255a48}.qrv-track-state.preparing{background:#fff0e5;color:#9b420d}.qrv-track-state.delivered{background:#e9f0ed;color:#375348}.qrv-track-state.cancelled{background:#fff0f0;color:#8f2d2d}
      .qrv-track-stations{display:grid;gap:7px}.qrv-track-station{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 11px;border-radius:11px;background:#f6f1e8}.qrv-track-station b{font-size:13px}.qrv-track-station span{font-size:12px;font-weight:900;color:#5b5148}
      .qrv-track-items{display:grid;gap:5px;padding-top:4px;border-top:1px solid #eee2d2}.qrv-track-item{display:flex;justify-content:space-between;gap:10px;color:#655b52;font-size:12px}.qrv-track-item b{color:#2c2723}
      .qrv-track-home{padding:30px 18px;text-align:center;border:1px solid #dfd1be;border-radius:20px;background:#fffdf8}.qrv-track-home-mark{display:grid;place-items:center;width:72px;height:72px;margin:0 auto 14px;border-radius:50%;background:#fff0e5;color:#d95b15;font-size:31px;font-weight:900}.qrv-track-home.ready .qrv-track-home-mark{background:#e5f2eb;color:#2f6e58}.qrv-track-home.delivered .qrv-track-home-mark{background:#e9f0ed;color:#375348}
      .qrv-track-home h2{margin:0;font-size:29px}.qrv-track-home p{max-width:500px;margin:9px auto;color:#6f655b;line-height:1.45}.qrv-track-home strong{display:block;margin-top:13px;font-size:20px}.qrv-track-home-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;max-width:520px;margin:20px auto 0}.qrv-track-home-actions button{min-height:54px;border-radius:14px;font-weight:900}.qrv-track-home-open{border:0;background:#181614;color:#fff}.qrv-track-home-more{border:1px solid #dccdb9;background:#fff;color:#201c18}
      .qrv-track-empty{padding:24px;text-align:center;color:#6f655b}
      .qrv-account-wrap{margin:10px 14px 0}.qrv-account-card{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:58px;padding:10px 12px;border:1px solid #dfd1be;border-radius:14px;background:#fffdf8}.qrv-account-copy{min-width:0}.qrv-account-copy b{display:block;font-size:13px}.qrv-account-copy span{display:block;margin-top:3px;color:#6f655b;font-size:11px}.qrv-account-button{min-width:150px;min-height:42px;padding:0 13px;border:0;border-radius:12px;background:#181614;color:#fff;font-weight:900}.qrv-account-card.requested{border-color:#f3c39f;background:#fff5ec}.qrv-account-card.preparing{border-color:#b7decf;background:#f0fdf7}.qrv-account-card.cash{border-color:#b9cfc7;background:#f1f7f4}.qrv-account-card.closed{opacity:.72}
      body.qrv-account-locked #categoryWrap,body.qrv-account-locked #cartBar{display:none!important}body.qrv-account-locked #app{pointer-events:none;opacity:.58}
      @media(min-width:1100px){.qrv-track-button{right:calc((100vw - 1080px)/2 + 12px)}}
      @media(max-width:560px){.qrv-track-button{left:12px;right:auto;bottom:78px;max-width:calc(100% - 24px);min-height:44px;padding:0 13px;font-size:12px}.qrv-track-home-actions{grid-template-columns:1fr}.qrv-account-card{align-items:stretch;flex-direction:column}.qrv-account-button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensureAccountUi() {
    let wrap = document.getElementById('restaurantAccountRequestWrap');
    if (wrap) return wrap;
    const anchor = document.getElementById('accountStrip');
    if (!anchor) return null;
    wrap = document.createElement('div');
    wrap.id = 'restaurantAccountRequestWrap';
    wrap.className = 'qrv-account-wrap';
    anchor.insertAdjacentElement('afterend', wrap);
    return wrap;
  }

  function ensureUi() {
    ensureStyles();
    ensureAccountUi();
    if (!document.getElementById('restaurantOrderTrackingButton')) {
      const button = document.createElement('button');
      button.id = 'restaurantOrderTrackingButton';
      button.className = 'qrv-track-button';
      button.type = 'button';
      button.hidden = true;
      button.addEventListener('click', openTrackingPanel);
      document.body.appendChild(button);
    }
    if (!document.getElementById('restaurantOrderTrackingPanel')) {
      const modal = document.createElement('div');
      modal.id = 'restaurantOrderTrackingPanel';
      modal.className = 'qrv3-modal';
      modal.hidden = true;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'restaurantOrderTrackingTitle');
      modal.innerHTML = `<section class="qrv3-sheet">
        <header class="qrv3-sheet-head"><h2 id="restaurantOrderTrackingTitle">Tu pedido</h2><button type="button" data-close-tracking aria-label="Cerrar seguimiento">×</button></header>
        <div id="restaurantOrderTrackingBody" class="qrv3-sheet-body"></div>
      </section>`;
      modal.querySelector('[data-close-tracking]').addEventListener('click', closeTrackingPanel);
      modal.addEventListener('click', (event) => { if (event.target === modal) closeTrackingPanel(); });
      document.body.appendChild(modal);
    }
  }

  function renderAccountAction() {
    ensureUi();
    const wrap = ensureAccountUi();
    if (!wrap) return;
    if (!S.sessionId) {
      wrap.innerHTML = '';
      document.body.classList.remove('qrv-account-locked');
      return;
    }
    const status = accountStatus(S.account?.state || 'OPEN');
    const locked = status.tone !== 'open';
    document.body.classList.toggle('qrv-account-locked', locked && status.tone !== 'closed');
    if (status.tone === 'open') {
      wrap.innerHTML = `<section class="qrv-account-card"><div class="qrv-account-copy"><b>¿Terminaste?</b><span>Pide la cuenta sin esperar a encontrar al mesero.</span></div><button id="restaurantRequestAccountButton" class="qrv-account-button" type="button" ${S.accountSubmitting ? 'disabled' : ''}>${S.accountSubmitting ? 'SOLICITANDO…' : 'PEDIR LA CUENTA'}</button></section>`;
      wrap.querySelector('#restaurantRequestAccountButton')?.addEventListener('click', requestAccount);
      return;
    }
    wrap.innerHTML = `<section class="qrv-account-card ${esc(status.tone)}"><div class="qrv-account-copy"><b>${esc(status.label)}</b><span>${esc(status.detail)}</span></div></section>`;
  }

  async function requestAccount() {
    if (S.accountSubmitting || (S.account?.state && S.account.state !== 'OPEN')) return;
    const tableName = S.table?.code || S.table?.name || '';
    if (!confirm(`¿Solicitar la cuenta${tableName ? ` de ${tableName}` : ''}?`)) return;
    S.accountSubmitting = true;
    renderAccountAction();
    try {
      const response = await delegatedFetch(`${qrApiPrefix}/pedir-cuenta`, {
        method:'POST', cache:'no-store', headers:{ 'Content-Type':'application/json', Accept:'application/json' }, body:'{}'
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || body?.message || 'No fue posible solicitar la cuenta');
      S.account = body?.data || { state:'REQUESTED', requested:true };
      renderAccountAction();
      refreshTracking().catch(() => {});
    } catch (error) {
      alert(error.message || 'No fue posible solicitar la cuenta');
    } finally {
      S.accountSubmitting = false;
      renderAccountAction();
    }
  }

  function renderButton() {
    ensureUi();
    const button = document.getElementById('restaurantOrderTrackingButton');
    const status = summaryStatus();
    if (!button || !status || !S.orders.length) {
      if (button) button.hidden = true;
      return;
    }
    button.hidden = false;
    button.dataset.tone = status.tone;
    button.textContent = `MI PEDIDO · ${status.label}`;
  }

  function renderTrackingPanel() {
    ensureUi();
    const body = document.getElementById('restaurantOrderTrackingBody');
    if (!body) return;
    if (!S.orders.length) {
      body.innerHTML = '<div class="qrv-track-empty"><b>Aún no hay pedidos enviados desde este teléfono.</b></div>';
      return;
    }
    body.innerHTML = S.orders.map((order, index) => {
      const state = orderStatus(order.state);
      const stations = (order.stations || []).map((station) => `<div class="qrv-track-station"><b>${esc(stationName(station.station))}</b><span>${esc(commandStatus(station.state))}</span></div>`).join('');
      const items = (order.items || []).map((item) => `<div class="qrv-track-item"><b>${esc(item.description)}</b><span>${Number(item.quantity || 0)} und.</span></div>`).join('');
      return `<article class="qrv-track-panel-card">
        <div class="qrv-track-panel-head"><div><b>Pedido ${index + 1}</b><small>${money(order.total)}</small></div><span class="qrv-track-state ${state.tone}">${esc(state.label)}</span></div>
        ${stations ? `<div class="qrv-track-stations">${stations}</div>` : ''}
        ${items ? `<div class="qrv-track-items">${items}</div>` : ''}
      </article>`;
    }).join('');
  }

  function openTrackingPanel() {
    ensureUi();
    renderTrackingPanel();
    const panel = document.getElementById('restaurantOrderTrackingPanel');
    if (!panel) return;
    panel.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeTrackingPanel() {
    const panel = document.getElementById('restaurantOrderTrackingPanel');
    if (!panel) return;
    panel.hidden = true;
    if (document.getElementById('helpPanel')?.hidden !== false && document.getElementById('orderPanel')?.hidden !== false) document.body.style.overflow = '';
  }

  function renderTrackingHome() {
    if (!S.orders.length) return;
    const latest = S.orders[S.orders.length - 1];
    const state = orderStatus(latest.state);
    document.getElementById('categoryWrap')?.setAttribute('hidden', '');
    document.getElementById('cartBar')?.setAttribute('hidden', '');
    const account = document.getElementById('accountStrip');
    if (account) account.innerHTML = `<b>Seguimiento del pedido</b><span>${esc(state.label)}</span>`;
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = `<section class="qrv-track-home ${state.tone}">
      <div class="qrv-track-home-mark">${state.tone === 'delivered' ? '✓' : '●'}</div>
      <h2>${esc(state.label)}</h2>
      <p>${esc(state.detail)}</p>
      <strong>Pedido ${S.orders.length} · ${money(latest.total)}</strong>
      <div class="qrv-track-home-actions"><button type="button" class="qrv-track-home-open">VER SEGUIMIENTO</button><button type="button" class="qrv-track-home-more">AGREGAR OTRO PEDIDO</button></div>
    </section>`;
    app.querySelector('.qrv-track-home-open')?.addEventListener('click', openTrackingPanel);
    app.querySelector('.qrv-track-home-more')?.addEventListener('click', () => location.reload());
  }

  function applySnapshot(snapshot, options = {}) {
    S.sessionId = snapshot?.sessionId || null;
    S.seatNumber = snapshot?.seatNumber || null;
    S.table = snapshot?.table || S.table;
    S.account = snapshot?.account || { state:'OPEN', requested:false };
    S.orders = Array.isArray(snapshot?.orders) ? snapshot.orders : [];
    renderButton();
    renderAccountAction();
    if (document.getElementById('restaurantOrderTrackingPanel')?.hidden === false) renderTrackingPanel();
    if (options.autoShow || document.querySelector('#app .qrv-track-home')) renderTrackingHome();
  }

  async function refreshTracking(options = {}) {
    if (S.loading || S.stopped) return;
    S.loading = true;
    try {
      const response = await delegatedFetch(`${qrApiPrefix}/mis-pedidos`, { cache:'no-store', headers:{ Accept:'application/json' } });
      if (!response.ok) {
        if ([401, 409].includes(response.status)) applySnapshot({ orders:[], account:{ state:'CLOSED' } });
        return;
      }
      const body = await response.json().catch(() => ({}));
      applySnapshot(body.data || {}, options);
      startStream();
    } finally {
      S.loading = false;
    }
  }

  function handleSseBlock(block) {
    const lines = block.split(/\r?\n/);
    let eventName = 'message';
    const data = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (eventName === 'snapshot' && data.length) {
      try { applySnapshot(JSON.parse(data.join('\n'))); } catch {}
    }
    if (eventName === 'visit-ended') {
      applySnapshot({ orders:[], account:{ state:'CLOSED' } });
      stopStream();
    }
  }

  async function streamLoop(controller) {
    const response = await delegatedFetch(`${qrApiPrefix}/mis-pedidos/stream`, {
      method:'GET', cache:'no-store', headers:{ Accept:'text/event-stream' }, signal:controller.signal
    });
    if (!response.ok || !response.body) {
      if ([401, 409].includes(response.status)) return;
      throw new Error('Seguimiento no disponible');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream:true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block && !block.startsWith(':')) handleSseBlock(block);
      }
    }
  }

  function scheduleReconnect() {
    if (S.stopped || S.reconnectTimer) return;
    S.reconnectTimer = setTimeout(() => {
      S.reconnectTimer = null;
      startStream();
    }, 3000);
  }

  function startStream() {
    if (S.stopped || S.streamAbort) return;
    const controller = new AbortController();
    S.streamAbort = controller;
    streamLoop(controller)
      .catch(() => {})
      .finally(() => {
        if (S.streamAbort === controller) S.streamAbort = null;
        if (!controller.signal.aborted) scheduleReconnect();
      });
  }

  function stopStream() {
    S.streamAbort?.abort();
    S.streamAbort = null;
    if (S.reconnectTimer) clearTimeout(S.reconnectTimer);
    S.reconnectTimer = null;
  }

  window.fetch = async (input, init = {}) => {
    const response = await delegatedFetch(input, init);
    const url = targetUrl(input);
    if (response.ok && requestMethod(input, init) === 'POST' && url.includes(`${qrApiPrefix}/pedidos`)) {
      setTimeout(() => refreshTracking({ autoShow:true }).catch(() => {}), 0);
    }
    if (response.ok && requestMethod(input, init) === 'POST' && url.includes(`${qrApiPrefix}/pedir-cuenta`)) {
      setTimeout(() => refreshTracking().catch(() => {}), 0);
    }
    return response;
  };

  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeTrackingPanel(); });
  window.addEventListener('pagehide', () => { S.stopped = true; stopStream(); }, { once:true });

  window.VantixGCQrAccountRequestV1 = Object.freeze({
    version:'1.0.0',
    requestAccount:true,
    accountTracking:true,
    idempotent:true,
    sameVisitAuthorization:true
  });

  const boot = () => {
    ensureUi();
    refreshTracking().catch(() => {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();