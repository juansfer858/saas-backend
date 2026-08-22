(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const SHIFT_KEY = 'restaurant_cash_shift';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) return;

  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (value) => new Intl.NumberFormat('es-CO', { style:'currency', currency:session.tenant?.moneda || 'COP', maximumFractionDigits:0 }).format(Number(value || 0));

  async function api(path) {
    const response = await fetch(path, {
      cache:'no-store',
      headers:{ Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (response.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      location.replace('/app');
      throw new Error('Sesión vencida');
    }
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body.data;
  }

  const safe = (promise) => promise.then((value) => ({ ok:true, value })).catch((error) => ({ ok:false, error }));

  function ensureShellExtras() {
    const railWrap = $('.rail-wrap');
    const rail = $('#rail');
    if (!railWrap || !rail) return false;

    if (!rail.querySelector('[data-cc-home]')) {
      const home = document.createElement('button');
      home.type = 'button';
      home.className = 'cc-home-button';
      home.dataset.ccHome = 'true';
      home.textContent = '⌂ Centro de control';
      home.addEventListener('click', () => showDashboard(true));
      rail.prepend(home);
    }

    if (!railWrap.querySelector('.cc-classic-link')) {
      const classic = document.createElement('a');
      classic.className = 'cc-classic-link';
      classic.href = '/app/restaurante';
      classic.textContent = '↩ Panel clásico de respaldo';
      classic.title = 'Ruta de recuperación sin la nueva capa visual';
      railWrap.append(classic);
    }

    const main = $('.ri-main');
    if (main && !$('#ccDashboard')) {
      const dashboard = document.createElement('section');
      dashboard.id = 'ccDashboard';
      dashboard.className = 'cc-dashboard';
      main.prepend(dashboard);
    }
    if (main && !$('#ccCustomView')) {
      const custom = document.createElement('section');
      custom.id = 'ccCustomView';
      custom.className = 'cc-menu-view';
      custom.hidden = true;
      main.insertBefore(custom, $('#message'));
    }

    return true;
  }

  function setActiveHome(active) {
    const home = $('[data-cc-home]');
    home?.classList.toggle('active', active);
    if (active) $$('.rail-ticket.active').forEach((button) => button.classList.remove('active'));
  }

  function showOnly(kind) {
    const dashboard = $('#ccDashboard');
    const custom = $('#ccCustomView');
    const message = $('#message');
    const view = $('#view');
    if (dashboard) dashboard.hidden = kind !== 'dashboard';
    if (custom) custom.hidden = kind !== 'custom';
    if (message) message.hidden = kind === 'dashboard' || kind === 'custom';
    if (view) view.hidden = kind !== 'operational';
  }

  function openOperationalTab(tab, pushState = true) {
    ensureShellExtras();
    const target = $(`[data-tab="${tab}"]`);
    if (!target) {
      const dashboard = $('#ccDashboard');
      if (dashboard) dashboard.insertAdjacentHTML('afterbegin', '<div class="ri-error">Tu usuario no tiene permiso para abrir esta operación.</div>');
      showDashboard(pushState);
      return;
    }
    setActiveHome(false);
    showOnly('operational');
    target.click();
    if (pushState) history.pushState({ view:tab }, '', `/app/centro-de-control?view=${encodeURIComponent(tab)}`);
  }

  async function showMenu(pushState = true) {
    ensureShellExtras();
    setActiveHome(false);
    showOnly('custom');
    const custom = $('#ccCustomView');
    custom.innerHTML = '<div class="ri-muted">Cargando carta real…</div>';
    try {
      const menu = await api('/api/v1/restaurante/menu');
      const rows = Array.isArray(menu) ? menu : [];
      custom.innerHTML = `<div class="cc-head"><div><h1>Carta y productos</h1><p>Lectura real del menú publicado para este tenant.</p></div><div class="cc-view-actions"><a class="cc-core-link" href="/app/inventario">Gestionar productos en Inventario</a></div></div><div class="cc-menu-grid">${rows.map((item) => `<article class="cc-menu-card ${item.warning ? 'warn' : ''}"><small>${esc(item.category || item.station || 'PRODUCTO')}</small><b>${esc(item.product?.nombre || item.nombre || 'Producto')}</b><strong>${money(item.product?.precio1 ?? item.precio ?? 0)}</strong>${item.warning ? `<p class="ri-muted">${esc(item.warning)}</p>` : ''}</article>`).join('') || '<div class="ri-card">No hay productos visibles en la carta.</div>'}</div>`;
    } catch (error) {
      custom.innerHTML = `<div class="ri-error">${esc(error.message)}</div>`;
    }
    if (pushState) history.pushState({ view:'carta' }, '', '/app/centro-de-control?view=carta');
  }

  async function renderDashboard() {
    const root = $('#ccDashboard');
    if (!root) return;
    root.innerHTML = '<div class="ri-muted">Cargando operación real…</div>';

    const [ctx, tables, menu, commands, orders] = await Promise.all([
      safe(api('/api/v1/restaurante/ui-context')),
      safe(api('/api/v1/restaurante/mesas')),
      safe(api('/api/v1/restaurante/menu')),
      safe(api('/api/v1/restaurante/comandas?limit=100')),
      safe(api('/api/v1/restaurante/pedidos?limit=100'))
    ]);

    const restaurantName = ctx.ok ? (ctx.value?.theme?.restaurantName || session.tenant?.nombreEmpresa || 'Restaurante') : (session.tenant?.nombreEmpresa || 'Restaurante');
    const tableRows = tables.ok && Array.isArray(tables.value) ? tables.value : [];
    const menuRows = menu.ok && Array.isArray(menu.value) ? menu.value : [];
    const commandRows = commands.ok && Array.isArray(commands.value) ? commands.value : [];
    const orderRows = orders.ok && Array.isArray(orders.value) ? orders.value : [];
    const openTables = tableRows.filter((row) => row.activeSession).length;
    const billRequested = tableRows.filter((row) => row.state === 'CUENTA_PEDIDA').length;
    const liveOrders = orderRows.filter((row) => !['CANCELADO','ENTREGADO','CERRADO'].includes(String(row.state || row.estado || '').toUpperCase())).length;
    const liveCommands = commandRows.filter((row) => !['ENTREGADA','CANCELADA'].includes(String(row.state || row.estado || '').toUpperCase())).length;
    const readyCommands = commandRows.filter((row) => String(row.state || row.estado || '').toUpperCase() === 'LISTA').length;
    const warnings = menuRows.filter((row) => row.warning).length;

    let cashValue = '0';
    let cashMeta = 'sin turno local en este navegador';
    const shiftId = localStorage.getItem(SHIFT_KEY);
    if (shiftId) {
      const cash = await safe(api(`/api/v1/restaurante/caja/turnos/${shiftId}/resumen`));
      if (cash.ok) { cashValue = '1 abierta'; cashMeta = 'turno real activo'; }
      else { cashValue = '—'; cashMeta = 'turno no verificable'; }
    }

    root.innerHTML = `<div class="cc-head"><div><h1>Centro de control</h1><p>Operación real dentro de la nueva capa. El panel clásico queda sólo como respaldo.</p></div><span class="cc-live-pill">Conectado al tenant real</span></div>
      <div class="cc-hero-grid">
        <section class="cc-hero"><div class="cc-kicker">VANTIXGC EXECUTIVE</div><h2>Tu restaurante, bajo control</h2><p>Mesas, pedidos, cocina y caja trabajan sobre el mismo motor operativo que ya estaba validado, sin salir de este Centro de Control.</p><div class="cc-actions">
          <button class="cc-action cash" data-cc-tab="caja">▣<small>Caja · Cobrar / Cerrar</small></button>
          <button class="cc-action" data-cc-tab="mesero">🛒 Nuevo pedido</button>
          <button class="cc-action" data-cc-tab="salon">▱ Abrir / ver mesas</button>
          <button class="cc-action" data-cc-tab="kds">♨ Ver KDS</button>
          <button class="cc-action" data-cc-menu="true">▤ Carta y productos</button>
          <button class="cc-action" data-cc-tab="estado">⚙ Estado / tema</button>
          <button class="cc-action" disabled title="Domicilios se integrará cuando exista una lectura/operación dedicada en este Core">▻ Domicilios · pendiente</button>
        </div></section>
        <aside class="cc-client"><div class="cc-client-top"><b>Vista cliente publicada</b><span class="cc-badge">● Real</span></div><div class="cc-phone"><div class="cc-phone-name">${esc(restaurantName.toUpperCase())}</div><div class="cc-promo"><small>CARTA PUBLICADA</small><b>${menuRows.length} productos visibles</b><strong>${warnings ? `${warnings} por revisar` : 'Sin alertas visibles'}</strong></div></div><button class="cc-client-link" data-cc-menu="true">Ver carta cargada →</button></aside>
      </div>
      <section class="cc-section"><div class="cc-section-head"><b>Requiere tu atención</b><span>Primero lo que puede afectar al cliente o a la operación.</span></div><div class="cc-attention"><div class="cc-count">${menu.ok ? warnings : '—'}</div><div class="cc-attention-main"><b>${warnings ? `${warnings} productos necesitan revisar receta o costo` : 'Recetas y costos sin alertas visibles'}</b><span>${menu.ok ? 'Calculado con la carta real del tenant.' : 'No fue posible leer la carta con este usuario.'}</span></div><button class="cc-mini-button" data-cc-menu="true">Atender →</button></div></section>
      <section class="cc-section"><div class="cc-section-head"><b>Operación en vivo</b><span>Indicadores del mismo tenant que usan las pantallas operativas.</span></div><div class="cc-live-grid">
        <article class="cc-live"><small>Mesas</small><strong>${tables.ok ? `${openTables} / ${tableRows.length}` : '—'}</strong><span>${tables.ok ? `${billRequested} con cuenta pedida` : 'Sin permiso de lectura'}</span></article>
        <article class="cc-live"><small>Mesero</small><strong>${orders.ok ? liveOrders : '—'}</strong><span>${orders.ok ? 'pedidos activos visibles' : 'Sin permiso de lectura'}</span></article>
        <article class="cc-live"><small>Cocina / KDS</small><strong>${commands.ok ? liveCommands : '—'}</strong><span>${commands.ok ? `${readyCommands} listas` : 'Sin permiso de lectura'}</span></article>
        <article class="cc-live"><small>Carta</small><strong>${menu.ok ? menuRows.length : '—'}</strong><span>${menu.ok ? `${warnings} alertas` : 'Sin permiso de lectura'}</span></article>
        <article class="cc-live"><small>Caja</small><strong>${esc(cashValue)}</strong><span>${esc(cashMeta)}</span></article>
      </div></section>`;

    $$('[data-cc-tab]', root).forEach((button) => button.addEventListener('click', () => openOperationalTab(button.dataset.ccTab)));
    $$('[data-cc-menu]', root).forEach((button) => button.addEventListener('click', () => showMenu()));
  }

  function showDashboard(pushState = false) {
    ensureShellExtras();
    setActiveHome(true);
    showOnly('dashboard');
    renderDashboard().catch((error) => {
      const root = $('#ccDashboard');
      if (root) root.innerHTML = `<div class="ri-error">${esc(error.message)}</div>`;
    });
    if (pushState) history.pushState({ view:'dashboard' }, '', '/app/centro-de-control');
  }

  function bindOperationalRail() {
    $$('.rail-ticket').forEach((button) => {
      if (button.dataset.ccBound === '1') return;
      button.dataset.ccBound = '1';
      button.addEventListener('click', () => {
        setActiveHome(false);
        showOnly('operational');
        const tab = button.dataset.tab;
        if (tab) history.replaceState({ view:tab }, '', `/app/centro-de-control?view=${encodeURIComponent(tab)}`);
      });
    });
  }

  function syncShell() {
    if (!ensureShellExtras()) return;
    bindOperationalRail();
  }

  function routeInitialView() {
    const view = new URLSearchParams(location.search).get('view');
    if (view === 'carta') { showMenu(false); return; }
    if (['salon','mesero','kds','caja','estado'].includes(view)) {
      const tryOpen = () => {
        const button = $(`[data-tab="${view}"]`);
        if (button) openOperationalTab(view, false);
        else setTimeout(tryOpen, 80);
      };
      tryOpen();
      return;
    }
    showDashboard(false);
  }

  window.addEventListener('popstate', () => routeInitialView());

  const observer = new MutationObserver(() => syncShell());
  const start = () => {
    syncShell();
    const rail = $('#rail');
    if (rail) observer.observe(rail, { childList:true });
    routeInitialView();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
