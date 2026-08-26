(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const SHIFT_KEY = 'restaurant_cash_shift';
  const CONTROL_PATH = '/app/centro-de-control';
  const VIEW_LABELS = Object.freeze({
    dashboard:'Centro de control',
    salon:'Mesas',
    mesero:'Mesero',
    pedidos:'Pedidos en curso',
    kds:'Cocina / Barra',
    caja:'Caja',
    carta:'Carta y productos',
    estado:'Tema / Estado'
  });
  let session = null;
  let shellOpeningTab = false;
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

  function currentView() {
    return new URLSearchParams(location.search).get('view') || 'dashboard';
  }

  function viewUrl(view) {
    return view === 'dashboard' ? CONTROL_PATH : `${CONTROL_PATH}?view=${encodeURIComponent(view)}`;
  }

  function currentTrail() {
    const trail = history.state?.ccTrail;
    return Array.isArray(trail) ? trail.filter((view) => VIEW_LABELS[view]) : [];
  }

  function ensureRouteState(view = currentView()) {
    if (history.state?.ccView === view && Array.isArray(history.state?.ccTrail)) return;
    history.replaceState({ ...(history.state || {}), ccView:view, ccTrail:view === 'dashboard' ? [] : ['dashboard'] }, '', viewUrl(view));
  }

  function enterView(view, pushState = true) {
    const origin = currentView();
    if (pushState && origin !== view) {
      history.pushState({ ccView:view, ccTrail:[...currentTrail(), origin] }, '', viewUrl(view));
    } else if (!pushState) {
      ensureRouteState(view);
    }
    renderBackControl(view);
  }

  function navigateBack() {
    const trail = currentTrail();
    const origin = trail[trail.length - 1] || 'dashboard';
    const nextTrail = trail.slice(0, -1);
    history.replaceState({ ...(history.state || {}), ccView:origin, ccTrail:nextTrail }, '', viewUrl(origin));
    routeCurrentView();
  }

  function renderBackControl(view = currentView()) {
    const bar = $('#ccBackBar');
    if (!bar) return;
    if (view === 'dashboard') {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    const trail = currentTrail();
    const origin = trail[trail.length - 1] || 'dashboard';
    bar.hidden = false;
    bar.innerHTML = `<button type="button" class="cc-mini-button" data-cc-back="true">← Atrás <span>${esc(VIEW_LABELS[origin] || 'Centro de control')}</span></button>`;
    $('[data-cc-back]', bar)?.addEventListener('click', navigateBack);
  }

  function ensureShellExtras() {
    const railWrap = $('.rail-wrap');
    const rail = $('#rail');
    if (!railWrap || !rail) return false;

    if (!railWrap.querySelector('[data-cc-home]')) {
      const home = document.createElement('button');
      home.type = 'button';
      home.className = 'cc-home-button';
      home.dataset.ccHome = 'true';
      home.textContent = '⌂ Centro de control';
      home.addEventListener('click', () => showDashboard(true));
      railWrap.insertBefore(home, rail);
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
    if (main && !$('#ccBackBar')) {
      const backBar = document.createElement('div');
      backBar.id = 'ccBackBar';
      backBar.className = 'cc-view-actions';
      backBar.hidden = true;
      main.insertBefore(backBar, $('#ccDashboard') || $('#ccCustomView') || $('#message') || $('#view'));
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
    enterView(tab, pushState);
    setActiveHome(false);
    showOnly('operational');
    shellOpeningTab = true;
    try { target.click(); } finally { shellOpeningTab = false; }
  }

  async function showMenu(pushState = true) {
    ensureShellExtras();
    enterView('carta', pushState);
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
  }

  function commandState(command) {
    return String(command?.state || command?.estado || '').toUpperCase();
  }

  function orderStage(order) {
    const commands = (order.commands || []).filter((command) => commandState(command) !== 'CANCELADA');
    if (!commands.length) return { key:'RECIBIDO', label:'Pedido recibido', step:0 };
    const states = commands.map(commandState);
    if (states.every((state) => state === 'ENTREGADA')) return { key:'ENTREGADO', label:'Entregado', step:3 };
    if (states.some((state) => state === 'LISTA') && states.every((state) => ['LISTA','ENTREGADA'].includes(state))) return { key:'LISTO', label:'Listo para entregar', step:2 };
    if (states.some((state) => ['EN_PREPARACION','LISTA'].includes(state))) return { key:'PREPARACION', label:'En preparación', step:1 };
    return { key:'RECIBIDO', label:'Enviado a producción', step:0 };
  }

  function orderAge(value) {
    const created = new Date(value);
    if (Number.isNaN(created.getTime())) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - created.getTime()) / 60000));
    if (minutes < 1) return 'ahora';
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  function progressMarkup(stage) {
    const labels = ['Recibido','Preparación','Listo','Entregado'];
    return `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:12px 0">${labels.map((label, index) => `<div style="height:5px;border-radius:999px;background:${index <= stage.step ? (stage.step >= 2 ? '#16a34a' : '#f97316') : '#e2e8f0'}" title="${label}"></div>`).join('')}</div>`;
  }

  function orderCard(order) {
    const stage = orderStage(order);
    const table = order.session?.table;
    const items = Array.isArray(order.items) ? order.items : [];
    const commands = Array.isArray(order.commands) ? order.commands : [];
    const stationSummary = ['COCINA','BARRA','POSTRES'].map((station) => {
      const row = commands.find((command) => command.station === station);
      return row ? `${station}: ${commandState(row).replaceAll('_',' ')}` : null;
    }).filter(Boolean).join(' · ');
    const source = String(order.source || '').toUpperCase() === 'QR' ? '📱 QR cliente' : 'Mesero';
    const billRequested = String(table?.state || '').toUpperCase() === 'CUENTA_PEDIDA';
    return `<article class="ri-card" data-cc-order-card="${esc(order.id)}" style="padding:16px!important;box-shadow:0 5px 14px rgba(15,23,42,.05)!important">
      <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start"><div><div class="ri-eyebrow">${esc(source)} · ${esc(orderAge(order.creadoEn))}</div><h2 style="margin:4px 0 2px;font-size:18px">${esc(table?.name || 'Mesa')}</h2><div class="ri-muted" style="font-size:11px">Pedido ${esc(String(order.id || '').slice(0,8))}</div></div><div style="text-align:right"><span class="state-stamp ${stage.key}" style="display:inline-flex">${esc(stage.label)}</span><strong style="display:block;margin-top:6px;font-size:17px">${money(order.total)}</strong></div></div>
      ${progressMarkup(stage)}
      <div style="display:grid;gap:5px">${items.slice(0,7).map((item) => `<div class="status-row" style="display:grid;grid-template-columns:44px 1fr auto;gap:8px;padding:7px 0"><b>${esc(item.quantity)}×</b><span>${esc(item.description || 'Producto')}</span><small class="ri-muted">${esc(item.station || '')}</small></div>`).join('') || '<div class="ri-muted">Sin líneas visibles.</div>'}${items.length > 7 ? `<div class="ri-muted">+ ${items.length - 7} línea(s) más</div>` : ''}</div>
      <div class="ri-muted" style="font-size:10px;margin-top:10px">${esc(stationSummary || 'Aún sin comandas asociadas')}</div>
      <div class="ri-actions" style="margin-top:12px"><button class="ri-btn small" data-cc-order-mesero="true">Abrir Mesero</button>${stage.key !== 'ENTREGADO' ? '<button class="ri-btn small secondary" data-cc-order-kds="true">Ver Cocina / Barra</button>' : ''}${billRequested ? '<button class="ri-btn small primary" data-cc-order-cash="true">Cobrar mesa</button>' : ''}</div>
    </article>`;
  }

  async function showOrders(pushState = true) {
    ensureShellExtras();
    enterView('pedidos', pushState);
    setActiveHome(false);
    showOnly('custom');
    const custom = $('#ccCustomView');
    custom.innerHTML = '<div class="ri-muted">Cargando pedidos reales…</div>';
    try {
      const orders = await api('/api/v1/restaurante/pedidos?limit=200');
      const rows = Array.isArray(orders) ? orders : [];
      const active = rows.filter((order) => !['CANCELADO','CERRADO'].includes(String(order.state || order.estado || '').toUpperCase()) && orderStage(order).key !== 'ENTREGADO');
      const delivered = rows.filter((order) => orderStage(order).key === 'ENTREGADO').slice(0, 8);
      const received = active.filter((order) => orderStage(order).key === 'RECIBIDO').length;
      const preparing = active.filter((order) => orderStage(order).key === 'PREPARACION').length;
      const ready = active.filter((order) => orderStage(order).key === 'LISTO').length;
      custom.innerHTML = `<div class="cc-head"><div><h1>Pedidos en curso</h1><p>El puente entre Mesero, Cocina / Barra y Caja. Todo proviene de pedidos y comandas reales.</p></div><span class="cc-live-pill">${active.length} activos</span></div>
        <div class="cc-live-grid" style="padding:0;margin-bottom:14px;grid-template-columns:repeat(4,minmax(0,1fr))"><button class="cc-live" type="button" data-cc-order-filter="ALL" style="cursor:pointer;text-align:left"><small>Activos</small><strong>${active.length}</strong><span>todos los pedidos en servicio</span></button><button class="cc-live" type="button" data-cc-order-filter="RECIBIDO" style="cursor:pointer;text-align:left"><small>Recibidos</small><strong>${received}</strong><span>esperando o enviados a producción</span></button><button class="cc-live" type="button" data-cc-order-filter="PREPARACION" style="cursor:pointer;text-align:left"><small>En preparación</small><strong>${preparing}</strong><span>cocina / barra trabajando</span></button><button class="cc-live" type="button" data-cc-order-filter="LISTO" style="cursor:pointer;text-align:left"><small>Listos</small><strong>${ready}</strong><span>requieren entrega al cliente</span></button></div>
        <div data-cc-orders-grid style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">${active.map(orderCard).join('') || '<div class="ri-card">No hay pedidos activos en este momento.</div>'}</div>
        ${delivered.length ? `<section class="cc-section"><div class="cc-section-head"><b>Entregados recientes</b><span>Últimos pedidos completados visibles.</span></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;padding:14px">${delivered.map(orderCard).join('')}</div></section>` : ''}`;
      $$('[data-cc-order-filter]', custom).forEach((button) => button.addEventListener('click', () => {
        const filter = button.dataset.ccOrderFilter;
        const grid = $('[data-cc-orders-grid]', custom);
        const filtered = filter === 'ALL' ? active : active.filter((order) => orderStage(order).key === filter);
        grid.innerHTML = filtered.map(orderCard).join('') || '<div class="ri-card">No hay pedidos en este estado.</div>';
        bindOrderActions(grid);
      }));
      bindOrderActions(custom);
    } catch (error) {
      custom.innerHTML = `<div class="ri-error">${esc(error.message)}</div>`;
    }
  }

  function bindOrderActions(root) {
    $$('[data-cc-order-mesero]', root).forEach((button) => button.addEventListener('click', () => openOperationalTab('mesero')));
    $$('[data-cc-order-kds]', root).forEach((button) => button.addEventListener('click', () => openOperationalTab('kds')));
    $$('[data-cc-order-cash]', root).forEach((button) => button.addEventListener('click', () => openOperationalTab('caja')));
  }

  function attentionRow(count, title, detail, action, label) {
    return `<div class="cc-attention"><div class="cc-count">${esc(count)}</div><div class="cc-attention-main"><b>${esc(title)}</b><span>${esc(detail)}</span></div><button class="cc-mini-button" type="button" ${action === 'pedidos' ? 'data-cc-orders="true"' : action === 'carta' ? 'data-cc-menu="true"' : `data-cc-tab="${esc(action)}"`}>${esc(label)} →</button></div>`;
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
    const activeOrders = orderRows.filter((row) => !['CANCELADO','CERRADO'].includes(String(row.state || row.estado || '').toUpperCase()) && orderStage(row).key !== 'ENTREGADO');
    const liveOrders = activeOrders.length;
    const pendingCommands = commandRows.filter((row) => commandState(row) === 'PENDIENTE').length;
    const preparingCommands = commandRows.filter((row) => commandState(row) === 'EN_PREPARACION').length;
    const readyCommands = commandRows.filter((row) => commandState(row) === 'LISTA').length;
    const warnings = menuRows.filter((row) => row.warning).length;

    let cashValue = '0';
    let cashMeta = 'sin turno local en este navegador';
    const shiftId = localStorage.getItem(SHIFT_KEY);
    if (shiftId) {
      const cash = await safe(api(`/api/v1/restaurante/caja/turnos/${shiftId}/resumen`));
      if (cash.ok) { cashValue = '1 abierta'; cashMeta = 'turno real activo'; }
      else { cashValue = '—'; cashMeta = 'turno no verificable'; }
    }

    const attention = [];
    if (readyCommands) attention.push(attentionRow(readyCommands, `${readyCommands} comanda(s) listas para entregar`, 'El cliente ya está esperando el último tramo del servicio.', 'kds', 'Entregar'));
    if (billRequested) attention.push(attentionRow(billRequested, `${billRequested} mesa(s) pidieron la cuenta`, 'Están listas para pasar a cobro y cierre.', 'caja', 'Cobrar'));
    if (warnings) attention.push(attentionRow(warnings, `${warnings} producto(s) necesitan revisar receta o costo`, 'La alerta viene de la carta real del tenant.', 'carta', 'Revisar'));
    if (!attention.length) attention.push('<div class="cc-attention" style="border-color:#bbf7d0;border-left-color:#16a34a"><div class="cc-count" style="background:#dcfce7;color:#166534">✓</div><div class="cc-attention-main"><b>Sin pendientes críticos visibles</b><span>El servicio no tiene cuentas pedidas, comandas listas ni alertas de carta.</span></div></div>');

    root.innerHTML = `<div class="cc-head"><div><h1>Centro de control</h1><p>El servicio completo en una sola lectura: mesa, pedido, producción, entrega y cobro.</p></div><span class="cc-live-pill">Conectado al tenant real</span></div>
      <div class="cc-hero-grid">
        <section class="cc-hero"><div class="cc-kicker">VANTIXGC OPERACIÓN</div><h2>Del cliente al cobro, sin perder el pedido</h2><p>Ahora puedes seguir cada pedido después de enviarlo: quién lo tomó, qué está preparando cocina, qué ya está listo y qué mesa pasó a caja.</p><div class="cc-actions">
          <button class="cc-action cash" data-cc-tab="caja"><span class="cc-cash-icon">▣</span><strong>Caja</strong><small>Cobrar / Cerrar</small></button>
          <button class="cc-action" data-cc-tab="mesero">🛒 Nuevo pedido</button>
          <button class="cc-action" data-cc-orders="true">◫ Pedidos en curso</button>
          <button class="cc-action" data-cc-tab="salon">▱ Abrir / ver mesas</button>
          <button class="cc-action" data-cc-tab="kds">♨ Ver KDS</button>
          <button class="cc-action" data-cc-menu="true">▤ Carta y productos</button>
          <button class="cc-action" data-cc-tab="estado">⚙ Estado / tema</button>
        </div></section>
        <aside class="cc-client"><div class="cc-client-top"><b>Vista cliente publicada</b><span class="cc-badge">● Real</span></div><div class="cc-phone"><div class="cc-phone-name">${esc(restaurantName.toUpperCase())}</div><div class="cc-promo"><small>CARTA PUBLICADA</small><b>${menuRows.length} productos visibles</b><strong>${warnings ? `${warnings} por revisar` : 'Sin alertas visibles'}</strong></div></div><button class="cc-client-link" data-cc-menu="true">Ver carta cargada →</button></aside>
      </div>
      <section class="cc-section"><div class="cc-section-head"><b>Flujo del servicio</b><span>Cada etapa abre la pantalla donde se atiende. Los números vienen de datos reales.</span></div><div class="cc-live-grid" style="grid-template-columns:repeat(6,minmax(0,1fr))">
        <button type="button" class="cc-live" data-cc-tab="salon" style="cursor:pointer;text-align:left"><small>1 · Mesas abiertas</small><strong>${tables.ok ? openTables : '—'}</strong><span>Abrir o revisar salón</span></button>
        <button type="button" class="cc-live" data-cc-orders="true" style="cursor:pointer;text-align:left"><small>2 · Pedidos activos</small><strong>${orders.ok ? liveOrders : '—'}</strong><span>Seguir pedido completo</span></button>
        <button type="button" class="cc-live" data-cc-tab="kds" style="cursor:pointer;text-align:left"><small>3 · Por preparar</small><strong>${commands.ok ? pendingCommands : '—'}</strong><span>Esperando producción</span></button>
        <button type="button" class="cc-live" data-cc-tab="kds" style="cursor:pointer;text-align:left"><small>4 · En preparación</small><strong>${commands.ok ? preparingCommands : '—'}</strong><span>Cocina / barra trabajando</span></button>
        <button type="button" class="cc-live" data-cc-tab="kds" style="cursor:pointer;text-align:left"><small>5 · Listos</small><strong>${commands.ok ? readyCommands : '—'}</strong><span>Listos para entregar</span></button>
        <button type="button" class="cc-live" data-cc-tab="caja" style="cursor:pointer;text-align:left"><small>6 · Cuenta pedida</small><strong>${tables.ok ? billRequested : '—'}</strong><span>Cobrar y cerrar</span></button>
      </div></section>
      <section class="cc-section"><div class="cc-section-head"><b>Requiere tu atención</b><span>Primero lo que puede frenar el servicio.</span></div>${attention.join('')}</section>
      <section class="cc-section"><div class="cc-section-head"><b>Operación en vivo</b><span>Accesos directos a las áreas del mismo tenant.</span></div><div class="cc-live-grid">
        <button type="button" class="cc-live" data-cc-tab="salon" style="cursor:pointer;text-align:left"><small>Mesas</small><strong>${tables.ok ? `${openTables} / ${tableRows.length}` : '—'}</strong><span>${tables.ok ? `${billRequested} con cuenta pedida` : 'Sin permiso de lectura'}</span></button>
        <button type="button" class="cc-live" data-cc-orders="true" style="cursor:pointer;text-align:left"><small>Pedidos</small><strong>${orders.ok ? liveOrders : '—'}</strong><span>${orders.ok ? 'pedidos activos visibles' : 'Sin permiso de lectura'}</span></button>
        <button type="button" class="cc-live" data-cc-tab="kds" style="cursor:pointer;text-align:left"><small>Cocina / KDS</small><strong>${commands.ok ? pendingCommands + preparingCommands + readyCommands : '—'}</strong><span>${commands.ok ? `${readyCommands} listas` : 'Sin permiso de lectura'}</span></button>
        <button type="button" class="cc-live" data-cc-menu="true" style="cursor:pointer;text-align:left"><small>Carta</small><strong>${menu.ok ? menuRows.length : '—'}</strong><span>${menu.ok ? `${warnings} alertas` : 'Sin permiso de lectura'}</span></button>
        <button type="button" class="cc-live" data-cc-tab="caja" style="cursor:pointer;text-align:left"><small>Caja</small><strong>${esc(cashValue)}</strong><span>${esc(cashMeta)}</span></button>
      </div></section>`;

    $$('[data-cc-tab]', root).forEach((button) => button.addEventListener('click', () => openOperationalTab(button.dataset.ccTab)));
    $$('[data-cc-menu]', root).forEach((button) => button.addEventListener('click', () => showMenu()));
    $$('[data-cc-orders]', root).forEach((button) => button.addEventListener('click', () => showOrders()));
  }

  function showDashboard(pushState = false) {
    ensureShellExtras();
    if (pushState && currentView() !== 'dashboard') history.pushState({ ccView:'dashboard', ccTrail:[] }, '', CONTROL_PATH);
    else ensureRouteState('dashboard');
    renderBackControl('dashboard');
    setActiveHome(true);
    showOnly('dashboard');
    renderDashboard().catch((error) => {
      const root = $('#ccDashboard');
      if (root) root.innerHTML = `<div class="ri-error">${esc(error.message)}</div>`;
    });
  }

  function syncShell() {
    if (!ensureShellExtras()) return false;
    renderBackControl(currentView());
    return true;
  }

  function routeCurrentView() {
    const view = currentView();
    ensureRouteState(view);
    if (view === 'carta') { showMenu(false); return; }
    if (view === 'pedidos') { showOrders(false); return; }
    if (['salon','mesero','kds','caja','estado'].includes(view)) {
      const tryOpen = (attempt = 0) => {
        const button = $(`[data-tab="${view}"]`);
        if (button) { openOperationalTab(view, false); return; }
        if (attempt < 40) requestAnimationFrame(() => tryOpen(attempt + 1));
        else showDashboard(false);
      };
      tryOpen();
      return;
    }
    showDashboard(false);
  }

  window.addEventListener('popstate', routeCurrentView);
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('.rail-ticket');
    if (!button || shellOpeningTab) return;
    const origin = currentView();
    const target = button.dataset.tab;
    if (!target) return;
    setActiveHome(false);
    showOnly('operational');
    if (target === origin) {
      renderBackControl(target);
      return;
    }
    history.pushState({ ccView:target, ccTrail:[...currentTrail(), origin] }, '', viewUrl(target));
    renderBackControl(target);
  });

  const start = () => {
    const ready = (attempt = 0) => {
      if (syncShell()) { routeCurrentView(); return; }
      if (attempt < 60) requestAnimationFrame(() => ready(attempt + 1));
    };
    ready();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();

  window.VantixGCRestaurantControlCenter = Object.freeze({
    showDashboard: () => showDashboard(true),
    showOrders: () => showOrders(true),
    showMenu: () => showMenu(true),
    openOperationalTab,
    navigateBack
  });
})();
