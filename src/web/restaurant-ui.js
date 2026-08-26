(() => {
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const SHIFT_KEY = 'restaurant_cash_shift';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session) { location.replace('/app'); return; }

  const S = {
    context: null,
    tab: null,
    tables: [],
    menu: [],
    commands: [],
    orders: [],
    selectedTableId: null,
    draft: null,
    cashShiftId: localStorage.getItem(SHIFT_KEY) || null,
    poll: null,
    dragging: false
  };
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => [...document.querySelectorAll(q)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (v) => new Intl.NumberFormat('es-CO', { style:'currency', currency: session.tenant?.moneda || 'COP', maximumFractionDigits:0 }).format(Number(v || 0));
  const number = (v) => Number(v || 0);

  async function api(path, opts = {}) {
    const response = await fetch(path, {
      ...opts,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        'x-tenant-subdomain': session.subdomain,
        ...(opts.headers || {})
      }
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

  function can(code) {
    const p = S.context?.permissions || [];
    return p.includes('*') || p.includes(code);
  }

  function message(text, error = false) {
    const node = $('#message');
    if (!node) return;
    node.innerHTML = text ? `<div class="${error ? 'ri-error' : 'ri-notice'}">${esc(text)}</div>` : '';
  }

  const tabDefs = [
    { id:'salon', kicker:'01', label:'Mesas', allowed:() => can('MESAS.VER') },
    { id:'mesero', kicker:'02', label:'Mesero', allowed:() => can('MESAS.VER') && can('PEDIDOS.CREAR') },
    { id:'kds', kicker:'03', label:'Cocina / Barra', allowed:() => can('COMANDAS.EDITAR') },
    { id:'caja', kicker:'04', label:'Caja', allowed:() => can('RESTAURANTE.CERRAR') && can('TESORERIA.CERRAR') },
    { id:'estado', kicker:'05', label:'Tema / Estado', allowed:() => can('RESTAURANTE.ADMINISTRAR') }
  ];

  function allowedTabs() { return tabDefs.filter((x) => x.allowed()); }
  function renderRail() {
    const allowed = allowedTabs();
    if (!S.tab || !allowed.some((x) => x.id === S.tab)) S.tab = allowed[0]?.id || null;
    $('#rail').innerHTML = allowed.map((x) => `<button class="rail-ticket ${S.tab === x.id ? 'active' : ''}" data-tab="${x.id}"><small>${x.kicker}</small>${esc(x.label)}</button>`).join('');
    $$('[data-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
  }

  function stopPoll() { if (S.poll) clearInterval(S.poll); S.poll = null; }
  async function setTab(tab) {
    stopPoll();
    S.tab = tab;
    renderRail();
    message('');
    await renderCurrent();
  }

  async function loadContext() {
    S.context = await api('/api/v1/restaurante/ui-context');
    window.RestaurantTheme?.apply(S.context.theme);
    $('[data-restaurant-name]').textContent = S.context.theme.restaurantName || session.tenant?.nombreEmpresa || 'Restaurante';
    $('#tenantLine').textContent = `${session.subdomain} · ${S.context.status.label}`;
    $('#userName').textContent = S.context.user.nombre || 'Usuario';
    $('#userRole').textContent = S.context.user.rol || '';
    const coreLink = $('#coreLink');
    if (coreLink) coreLink.hidden = !can('DASHBOARD.VER');
    const gate = $('#gateInner');
    gate.classList.toggle('ready', Boolean(S.context.status.productionReady));
    gate.innerHTML = `<b>${esc(S.context.status.productionLabel)}</b><span>${esc(S.context.status.limitations.join(' · ') || 'Gates registrados cerrados.')}</span>`;
    renderRail();
  }

  async function loadTables() {
    S.tables = await api('/api/v1/restaurante/mesas');
    if (!S.selectedTableId || !S.tables.some((x) => x.id === S.selectedTableId)) S.selectedTableId = S.tables[0]?.id || null;
    return S.tables;
  }
  async function loadMenu() { S.menu = await api('/api/v1/restaurante/menu'); return S.menu; }
  function selectedTable() { return S.tables.find((x) => x.id === S.selectedTableId) || null; }

  function tableTicket(table) {
    const active = table.activeSession;
    const sale = active?.sale;
    const stateText = table.state.replaceAll('_', ' ');
    const openAction = !active && can('MESAS.CREAR') ? `<button class="ri-btn small primary" data-open-table="${table.id}">Abrir</button>` : '';
    const selectAction = active && can('PEDIDOS.CREAR') ? `<button class="ri-btn small" data-select-table="${table.id}">Pedido</button>` : '';
    return `<article class="table-ticket ${table.state}" data-table="${table.id}" style="left:${Number(table.posX)}px;top:${Number(table.posY)}px;width:${Number(table.width)}px;height:${Number(table.height)}px">
      <div><div class="table-state">${esc(stateText)}</div><div class="table-name">${esc(table.name)}</div>${sale ? `<div class="table-total">${money(sale.total)}</div><div class="table-meta">${esc(sale.estado)} · ${esc(sale.numero || '')}</div>` : `<div class="table-meta">${table.seats} puestos</div>`}</div>
      <div class="table-actions">${openAction}${selectAction}<button class="ri-btn small brass" data-show-qr="${table.id}">QR</button>${can('RESTAURANTE.ADMINISTRAR') ? `<button class="ri-btn small danger" data-remove-table="${table.id}">×</button>` : ''}</div>
    </article>`;
  }

  async function renderSalon(fromPoll = false) {
    if (S.dragging && fromPoll) return;
    await loadTables();
    $('#view').innerHTML = `<div class="ri-grid">
      <section class="ri-card">
        <div class="ri-toolbar"><div><div class="ri-eyebrow">Plano vivo</div><h1 class="ri-title">Salón</h1></div><span class="push ri-muted">Estado derivado de la venta BORRADOR de cada mesa</span>${can('RESTAURANTE.ADMINISTRAR') ? '<button class="ri-btn primary" id="addTable">Agregar mesa</button>' : ''}</div>
        <div class="floor" id="floor">${S.tables.map(tableTicket).join('') || '<div class="empty-ticket">No hay mesas configuradas.</div>'}</div>
      </section>
      <aside class="ri-card"><div class="ri-eyebrow">Lectura rápida</div><h2>Estados</h2><div class="status-legend">${['LIBRE','OCUPADA','CUENTA_PEDIDA','RESERVADA'].map((state) => `<div class="status-row"><span class="status-dot ${state}"></span><span>${esc(state.replaceAll('_',' '))}</span><b>${S.tables.filter((x) => x.state === state).length}</b></div>`).join('')}</div><p class="ri-muted">Las mesas se actualizan automáticamente. La posición se guarda en el tenant.</p></aside>
    </div>`;
    bindSalon();
    if (!fromPoll) {
      stopPoll();
      S.poll = setInterval(() => { if (S.tab === 'salon') renderSalon(true).catch(() => {}); }, S.context.polling.floorMs || 3000);
    }
  }

  function bindSalon() {
    $('#addTable')?.addEventListener('click', addTable);
    $$('[data-open-table]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openTable(b.dataset.openTable); }));
    $$('[data-select-table]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); S.selectedTableId = b.dataset.selectTable; setTab('mesero'); }));
    $$('[data-show-qr]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); showQr(b.dataset.showQr); }));
    $$('[data-remove-table]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); removeTable(b.dataset.removeTable); }));
    if (can('RESTAURANTE.ADMINISTRAR') && matchMedia('(min-width:641px)').matches) bindTableDrag();
  }

  async function addTable() {
    const code = prompt('Código de mesa, por ejemplo M7');
    if (!code) return;
    const name = prompt('Nombre visible', `Mesa ${code.replace(/\D/g, '') || code}`) || code;
    try {
      await api('/api/v1/restaurante/mesas', { method:'POST', body:JSON.stringify({ code, name, seats:4, posX:30, posY:30 }) });
      await renderSalon();
    } catch (error) { message(error.message, true); }
  }
  async function openTable(id) {
    try {
      const result = await api(`/api/v1/restaurante/mesas/${id}/abrir`, { method:'POST', body:JSON.stringify({ guestCount:1 }) });
      S.selectedTableId = id;
      message(`Mesa abierta. Venta ${result.sale.numero} en BORRADOR.`);
      if (can('PEDIDOS.CREAR')) await setTab('mesero'); else await renderSalon();
    } catch (error) { message(error.message, true); }
  }
  async function removeTable(id) {
    if (!confirm('¿Retirar esta mesa del plano?')) return;
    try { await api(`/api/v1/restaurante/mesas/${id}`, { method:'DELETE' }); await renderSalon(); } catch (error) { message(error.message, true); }
  }
  function showQr(id) {
    const table = S.tables.find((x) => x.id === id);
    if (!table) return;
    const url = `${location.origin}/r/${encodeURIComponent(table.qrToken)}`;
    const box = document.createElement('div');
    box.className = 'ri-card';
    box.id = 'qrBox';
    box.innerHTML = `<div class="ri-eyebrow">Autopedido seguro</div><h2>${esc(table.name)}</h2><p class="ri-muted">Token permanente no adivinable de la mesa.</p><div class="ri-input">${esc(url)}</div><div class="ri-actions"><button class="ri-btn" id="copyQr">Copiar enlace</button><button class="ri-btn primary" id="openQr">Abrir como cliente</button><button class="ri-btn" id="closeQr">Cerrar</button></div>`;
    $('#view').prepend(box);
    $('#copyQr').onclick = () => navigator.clipboard?.writeText(url);
    $('#openQr').onclick = () => window.open(url, '_blank', 'noopener');
    $('#closeQr').onclick = () => box.remove();
  }
  function bindTableDrag() {
    $$('.table-ticket').forEach((el) => {
      let sx, sy, ox, oy;
      el.addEventListener('pointerdown', (event) => {
        if (event.target.closest('button')) return;
        S.dragging = true;
        sx = event.clientX; sy = event.clientY; ox = parseInt(el.style.left || '0'); oy = parseInt(el.style.top || '0');
        el.setPointerCapture(event.pointerId);
      });
      el.addEventListener('pointermove', (event) => {
        if (sx === undefined) return;
        el.style.left = `${Math.max(0, ox + event.clientX - sx)}px`;
        el.style.top = `${Math.max(0, oy + event.clientY - sy)}px`;
      });
      el.addEventListener('pointerup', async () => {
        if (sx === undefined) return;
        sx = undefined; S.dragging = false;
        try { await api(`/api/v1/restaurante/mesas/${el.dataset.table}`, { method:'PATCH', body:JSON.stringify({ posX:parseInt(el.style.left), posY:parseInt(el.style.top) }) }); } catch (error) { message(error.message, true); }
      });
    });
  }

  function draftQty(menuItemId) {
    const item = S.draft?.order?.items?.find((x) => x.menuItemId === menuItemId);
    return Number(item?.quantity || 0);
  }
  async function loadWaiterDraft(sessionId) {
    S.draft = await api(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador`);
    return S.draft;
  }
  async function loadSessionOrders(sessionId) {
    S.orders = await api(`/api/v1/restaurante/pedidos?sessionId=${encodeURIComponent(sessionId)}&limit=100`);
    if (!Array.isArray(S.orders)) S.orders = [];
    return S.orders;
  }
  function waiterOrderStatus(order) {
    const commands = Array.isArray(order?.commands) ? order.commands : [];
    const states = commands.map((x) => String(x.state || '').toUpperCase());
    if (!states.length) return { key:'RECIBIDO', label:'Recibido', detail:'Esperando comanda' };
    if (states.every((x) => x === 'CANCELADA')) return { key:'CANCELADO', label:'Cancelado', detail:'Sin producción activa' };
    const live = states.filter((x) => !['ENTREGADA','CANCELADA'].includes(x));
    if (!live.length) return { key:'ENTREGADO', label:'Entregado', detail:'Servicio completado' };
    if (live.every((x) => x === 'LISTA')) return { key:'LISTA', label:'Listo para entregar', detail:'Retirar en estación' };
    if (live.some((x) => x === 'LISTA')) return { key:'PARCIAL', label:'Parcialmente listo', detail:'Aún hay estaciones trabajando' };
    if (live.some((x) => x === 'EN_PREPARACION')) return { key:'PREPARACION', label:'En preparación', detail:'Cocina / barra trabajando' };
    return { key:'PENDIENTE', label:'En cocina', detail:'Pendiente de iniciar preparación' };
  }
  function waiterOrderAge(order) {
    const created = new Date(order?.creadoEn || 0).getTime();
    if (!Number.isFinite(created) || !created) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - created) / 60000));
    if (minutes < 1) return 'ahora';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `${hours} h ${minutes % 60} min`;
  }
  function waiterHistoryContent(orders) {
    const sent = (Array.isArray(orders) ? orders : []).filter((x) => !['BORRADOR','CANCELADO'].includes(String(x.state || '').toUpperCase()));
    const statuses = sent.map((order) => waiterOrderStatus(order));
    const inKitchen = statuses.filter((x) => ['PENDIENTE','PREPARACION','PARCIAL'].includes(x.key)).length;
    const ready = statuses.filter((x) => x.key === 'LISTA').length;
    const delivered = statuses.filter((x) => x.key === 'ENTREGADO').length;
    return `<div class="ri-toolbar"><div><div class="ri-eyebrow">Trazabilidad de la mesa</div><h2>Servicio de esta mesa</h2></div><div class="push ri-muted">${sent.length} ronda(s) enviada(s)</div>${can('PEDIDOS.VER') ? '<a class="ri-btn small" href="/app/centro-de-control?view=pedidos">Ver todos los pedidos</a>' : ''}</div>
      <div class="metric-strip"><div class="metric-ticket"><small>En cocina</small><b>${inKitchen}</b></div><div class="metric-ticket"><small>Listos</small><b>${ready}</b></div><div class="metric-ticket"><small>Entregados</small><b>${delivered}</b></div><div class="metric-ticket"><small>Total rondas</small><b>${sent.length}</b></div></div>
      ${sent.length ? sent.map((order, index) => {
        const status = waiterOrderStatus(order);
        const source = String(order.source || '').toUpperCase() === 'QR' ? '📱 Cliente · QR' : 'Mesero';
        const items = Array.isArray(order.items) ? order.items : [];
        const commands = Array.isArray(order.commands) ? order.commands : [];
        return `<article class="command-ticket"><div class="command-top"><div><div class="command-table">Ronda ${sent.length - index} · ${esc(source)}</div><span class="ri-muted">${new Date(order.creadoEn).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})} · hace ${esc(waiterOrderAge(order))}</span></div><div><span class="state-stamp ${esc(status.key)}">${esc(status.label)}</span><div class="ri-muted">${esc(status.detail)}</div></div></div>${items.map((item) => `<div class="command-item"><b>${esc(item.quantity)}×</b> ${esc(item.description)} <small class="ri-muted">· ${esc(item.station)}</small></div>`).join('')}<div class="ri-actions">${commands.map((command) => `<span class="state-stamp ${esc(command.state)}">${esc(command.station)} · ${esc(String(command.state || '').replaceAll('_',' '))}</span>`).join('')}</div></article>`;
      }).join('') : '<div class="empty-ticket">Todavía no hay rondas enviadas. El primer pedido aparecerá aquí en cuanto se envíe a cocina o barra.</div>'}`;
  }
  function waiterHistoryHtml(orders) {
    return `<section class="ri-card" id="waiterHistory" aria-live="polite">${waiterHistoryContent(orders)}</section>`;
  }
  async function refreshWaiterHistory(sessionId, tableId) {
    if (S.tab !== 'mesero') return;
    const before = selectedTable();
    const previousState = before?.state;
    await Promise.all([loadSessionOrders(sessionId), loadTables()]);
    const current = S.tables.find((x) => x.id === tableId);
    if (!current?.activeSession || current.activeSession.id !== sessionId || current.state !== previousState) {
      if (S.tab === 'mesero' && S.selectedTableId === tableId) await renderWaiter();
      return;
    }
    const root = $('#waiterHistory');
    if (root && S.selectedTableId === tableId) root.innerHTML = waiterHistoryContent(S.orders);
  }

  async function renderWaiter() {
    await Promise.all([loadTables(), loadMenu()]);
    const table = selectedTable();
    const active = table?.activeSession;
    if (active) await Promise.all([loadWaiterDraft(active.id), loadSessionOrders(active.id)]);
    else { S.draft = null; S.orders = []; }
    const sale = S.draft?.sale || active?.sale || null;
    const draftItems = S.draft?.order?.items || [];
    const sentOrders = S.orders.filter((x) => !['BORRADOR','CANCELADO'].includes(String(x.state || '').toUpperCase()));
    const accountRequested = Boolean(active && (table.state === 'CUENTA_PEDIDA' || active.state === 'CUENTA_PEDIDA'));
    const hasUnsent = draftItems.length > 0;
    const categories = ['ENTRADAS','FUERTES','BEBIDAS','POSTRES'];
    const billControl = active && can('MESAS.EDITAR')
      ? accountRequested
        ? '<span class="state-stamp CUENTA_PEDIDA">Cuenta pedida</span>'
        : hasUnsent
          ? '<button class="ri-btn brass" id="requestBill" disabled title="Envía o retira los productos de esta ronda antes de pedir la cuenta">Pedir cuenta · ronda sin enviar</button>'
          : '<button class="ri-btn brass" id="requestBill">Pedir cuenta</button>'
      : '';
    $('#view').innerHTML = `<div class="ri-grid">
      <section class="ri-card">
        <div class="ri-toolbar"><div><div class="ri-eyebrow">Toma directa</div><h1 class="ri-title">Panel del mesero</h1></div><select class="ri-select push" id="tableSelect">${S.tables.map((x) => `<option value="${x.id}" ${x.id === S.selectedTableId ? 'selected' : ''}>${esc(x.name)} · ${esc(x.state)}</option>`).join('')}</select>${table && !active && can('MESAS.CREAR') ? '<button class="ri-btn primary" id="openSelected">Abrir mesa</button>' : ''}${billControl}</div>
        ${active ? `<div class="ri-notice">${esc(table.name)} · venta ${esc(sale?.numero || '')} · cuenta real ${money(sale?.total)} · ${sentOrders.length} ronda(s) enviada(s)</div>` : '<div class="ri-error">La mesa está libre. Ábrela para iniciar la venta BORRADOR.</div>'}
        ${accountRequested ? '<div class="ri-notice">La cuenta ya fue pedida. Si el cliente agrega productos y envías una nueva ronda, la mesa volverá a servicio activo y después deberá pedirse la cuenta nuevamente.</div>' : ''}
        ${hasUnsent ? '<div class="ri-notice">Hay productos sin enviar. Termina esta ronda antes de pedir la cuenta para no dejar una comanda pendiente fuera del cierre.</div>' : ''}
        ${categories.map((cat) => `<section class="menu-section"><h3>${cat}</h3><div class="menu-grid">${S.menu.filter((x) => x.category === cat).map((item) => {
          const q = draftQty(item.id);
          return `<article class="menu-ticket ${item.warning ? 'warn' : ''}"><div class="menu-station">${esc(item.station)}</div><div class="menu-name">${esc(item.product?.nombre || 'Producto')}</div><div class="menu-price">${money(item.product?.precio1)}</div>${item.warning ? `<div class="ri-muted">${esc(item.warning)}</div>` : active ? `<div class="qty-control"><button class="ri-btn small" data-draft-minus="${item.id}">−</button><span class="qty-number">${q}</span><button class="ri-btn small primary" data-draft-plus="${item.id}">+</button></div>` : '<span class="ri-muted">Mesa cerrada</span>'}</article>`;
        }).join('') || '<div class="empty-ticket">Sin productos en esta categoría.</div>'}</div></section>`).join('')}
      </section>
      <aside class="order-sheet"><div class="ri-eyebrow">${sentOrders.length ? 'Nueva ronda' : 'Primer pedido'}</div><h2>${sentOrders.length ? `Ronda ${sentOrders.length + 1}` : 'Pedido en curso'}</h2>${draftItems.length ? draftItems.map((item) => `<div class="order-line"><span class="qty">${esc(item.quantity)}×</span><span>${esc(item.description)}<small class="ri-muted">${esc(item.station)}</small></span><span class="amount">${money(item.lineTotal)}</span></div>`).join('') : `<div class="empty-ticket">${sentOrders.length ? 'La mesa ya tiene pedidos enviados. Agrega productos aquí para iniciar una nueva ronda sin perder el historial anterior.' : 'Agrega productos. Cada cambio se guarda en el documento real de la mesa.'}</div>`}<div class="order-total"><span>Por enviar</span><span>${money(S.draft?.order?.total)}</span></div><div class="ri-muted">Cuenta completa de la mesa: ${money(sale?.total)} · ${sale?.detalles?.length || 0} línea(s)</div><div class="ri-actions">${draftItems.length ? '<button class="ri-btn primary" id="sendDraft">Enviar esta ronda a cocina / barra</button>' : ''}</div></aside>
    </div>${active ? waiterHistoryHtml(S.orders) : ''}`;
    $('#tableSelect')?.addEventListener('change', (e) => { S.selectedTableId = e.target.value; renderWaiter().catch((error) => message(error.message, true)); });
    $('#openSelected')?.addEventListener('click', () => openTable(S.selectedTableId));
    $('#requestBill')?.addEventListener('click', requestBill);
    $$('[data-draft-plus]').forEach((b) => b.addEventListener('click', () => changeDraftQty(active.id, b.dataset.draftPlus, draftQty(b.dataset.draftPlus) + 1)));
    $$('[data-draft-minus]').forEach((b) => b.addEventListener('click', () => changeDraftQty(active.id, b.dataset.draftMinus, Math.max(0, draftQty(b.dataset.draftMinus) - 1))));
    $('#sendDraft')?.addEventListener('click', () => sendDraft(active.id));
    stopPoll();
    if (active) {
      const sessionId = active.id;
      const tableId = table.id;
      S.poll = setInterval(() => { if (S.tab === 'mesero') refreshWaiterHistory(sessionId, tableId).catch(() => {}); }, Math.max(Number(S.context.polling.floorMs || 3000), 2500));
    }
  }

  async function changeDraftQty(sessionId, menuItemId, quantity) {
    try {
      S.draft = await api(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador/items/${menuItemId}`, { method:'PUT', body:JSON.stringify({ quantity }) });
      await renderWaiter();
    } catch (error) { message(error.message, true); }
  }
  async function sendDraft(sessionId) {
    const wasAccountRequested = selectedTable()?.state === 'CUENTA_PEDIDA';
    try {
      const order = await api(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador/enviar`, { method:'POST', body:'{}' });
      S.draft = null;
      message(wasAccountRequested
        ? `Nueva ronda enviada. ${order.commands.length} comanda(s) reales en cola. La mesa volvió a servicio activo; la cuenta deberá pedirse nuevamente al terminar.`
        : `Pedido enviado. ${order.commands.length} comanda(s) reales en cola.`);
      await renderWaiter();
    } catch (error) { message(error.message, true); }
  }
  async function requestBill() {
    const table = selectedTable();
    if (!table) return;
    if (S.draft?.order?.items?.length) { message('No puedes pedir la cuenta con productos sin enviar. Envía esta ronda o retira sus productos primero.', true); return; }
    if (table.state === 'CUENTA_PEDIDA') { message('La cuenta de esta mesa ya fue solicitada.'); return; }
    try { await api(`/api/v1/restaurante/mesas/${table.id}/pedir-cuenta`, { method:'POST', body:'{}' }); message('Cuenta solicitada. Caja ya puede cobrar esta mesa.'); await renderWaiter(); } catch (error) { message(error.message, true); }
  }

  function commandItems(command) { return (command.order?.items || []).filter((x) => x.station === command.station); }
  function commandCard(command) {
    const items = commandItems(command);
    const qr = command.order?.source === 'QR';
    return `<article class="command-ticket"><div class="command-top"><div><div class="command-table">${esc(command.order?.session?.table?.name || 'Mesa')}</div><span class="${qr ? 'origin-qr' : 'origin-waiter'}">${qr ? '📱 vía autopedido QR' : 'Tomado por mesero'}</span></div><div><div class="command-time">${new Date(command.creadoEn).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</div><span class="state-stamp ${command.state}">${esc(command.state.replaceAll('_',' '))}</span></div></div>${items.map((item) => `<div class="command-item"><b>${esc(item.quantity)}×</b> ${esc(item.description)}${item.notes ? ` · <small>${esc(item.notes)}</small>` : ''}</div>`).join('')}<div class="ri-actions">${command.state === 'PENDIENTE' ? `<button class="ri-btn small secondary" data-command="${command.id}" data-command-state="EN_PREPARACION">Preparar</button>` : ''}${command.state === 'EN_PREPARACION' ? `<button class="ri-btn small primary" data-command="${command.id}" data-command-state="LISTA">Marcar listo</button>` : ''}${command.state === 'LISTA' ? `<button class="ri-btn small" data-command="${command.id}" data-command-state="ENTREGADA">Entregar</button>` : ''}<button class="ri-btn small" data-print-command="${command.id}">PDF</button></div></article>`;
  }

  async function renderKds(fromPoll = false) {
    S.commands = await api('/api/v1/restaurante/comandas?limit=200');
    const visible = S.commands.filter((x) => !['ENTREGADA','CANCELADA'].includes(x.state));
    let stations = can('RESTAURANTE.ADMINISTRAR') ? ['COCINA','BARRA','POSTRES'] : [...new Set(visible.map((x) => x.station))];
    if (!stations.length) stations = ['MI ESTACIÓN'];
    $('#view').innerHTML = `<div class="kds-head"><div><div class="ri-eyebrow">Producción viva</div><h1 class="ri-title">Cocina / Barra</h1></div><div class="ri-muted">Actualización automática cada ${Math.round((S.context.polling.kdsMs || 2000)/1000)} s · sin recargar</div></div><div class="kds-lanes">${stations.map((station) => {
      const rows = station === 'MI ESTACIÓN' ? [] : visible.filter((x) => x.station === station);
      return `<section class="kds-lane" data-station="${station}"><div class="kds-lane-count">${rows.length} comanda(s)</div><h2 class="kds-lane-title">${esc(station.replace('_',' '))}</h2>${rows.map(commandCard).join('') || '<div class="empty-ticket">Sin comandas pendientes.</div>'}</section>`;
    }).join('')}</div>`;
    bindKds();
    if (!fromPoll) {
      stopPoll();
      S.poll = setInterval(() => { if (S.tab === 'kds') renderKds(true).catch(() => {}); }, S.context.polling.kdsMs || 2000);
    }
  }
  function bindKds() {
    $$('[data-command]').forEach((b) => b.addEventListener('click', () => setCommand(b.dataset.command, b.dataset.commandState)));
    $$('[data-print-command]').forEach((b) => b.addEventListener('click', () => printCommand(S.commands.find((x) => x.id === b.dataset.printCommand))));
  }
  async function setCommand(id, state) {
    try {
      const result = await api(`/api/v1/restaurante/comandas/${id}`, { method:'PATCH', body:JSON.stringify({ state }) });
      if (result.notification?.queued) message('Pedido listo; notificación WhatsApp encolada.');
      await renderKds(true);
    } catch (error) { message(error.message, true); }
  }
  function printCommand(command) {
    if (!command) return;
    const items = commandItems(command);
    const theme = JSON.stringify(S.context.theme).replace(/</g, '\\u003c');
    const popup = window.open('', '_blank', 'width=480,height=720');
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Comanda</title><link rel="stylesheet" href="/app/restaurant-theme.css"><script src="/app/restaurant-theme.js"><\/script></head><body><main class="qr-shell"><article class="command-ticket"><div class="command-top"><div class="command-table">${esc(command.order.session.table.name)} · ${esc(command.station)}</div><span class="state-stamp ${esc(command.state)}">${esc(command.state)}</span></div><div class="origin-${command.order.source === 'QR' ? 'qr' : 'waiter'}">${command.order.source === 'QR' ? '📱 vía autopedido QR' : 'Tomado por mesero'}</div>${items.map((x) => `<div class="command-item"><b>${esc(x.quantity)}×</b> ${esc(x.description)}</div>`).join('')}<div class="ri-error">COMANDA SIMULADA — NO IMPRESA EN HARDWARE</div><button class="ri-btn primary no-print" onclick="print()">Imprimir / Guardar PDF</button></article></main><script>RestaurantTheme.apply(${theme});<\/script></body></html>`);
    popup.document.close();
  }

  function cashAge(value) {
    if (!value) return 'En servicio';
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return 'En servicio';
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return 'Solicitada ahora';
    if (minutes < 60) return `Solicitada hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `Solicitada hace ${hours} h ${minutes % 60} min`;
  }

  function cashTableRow(table, selected) {
    const active = table.activeSession;
    const sale = active?.sale;
    const requested = table.state === 'CUENTA_PEDIDA';
    return `<button type="button" class="cash-due-row ${selected ? 'selected' : ''}" data-cash-table="${table.id}">
      <span class="cash-table-icon">▱</span>
      <span class="cash-due-main"><b>${esc(table.name)}</b><small>${requested ? esc(cashAge(active?.accountRequestedAt)) : 'Cuenta abierta · aún en servicio'}</small></span>
      <span class="cash-due-total"><small>Total a pagar</small><b>${money(sale?.total)}</b></span>
      <span class="cash-due-state ${requested ? 'ready' : ''}">${requested ? 'Por cobrar' : 'Abierta'}</span>
      <span class="cash-due-action">Cobrar →</span>
    </button>`;
  }

  async function renderCash() {
    await loadTables();
    const cajas = await api('/api/v1/tesoreria/cajas-bancos');
    let summary = null;
    if (S.cashShiftId) {
      try { summary = await api(`/api/v1/restaurante/caja/turnos/${S.cashShiftId}/resumen`); }
      catch { S.cashShiftId = null; localStorage.removeItem(SHIFT_KEY); }
    }

    const cashAccounts = cajas.filter((x) => x.tipo === 'CAJA' && x.activo);
    const openTables = S.tables.filter((x) => x.activeSession);
    const dueTables = [...openTables].sort((a, b) => {
      const aReady = a.state === 'CUENTA_PEDIDA' ? 0 : 1;
      const bReady = b.state === 'CUENTA_PEDIDA' ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      return new Date(a.activeSession?.accountRequestedAt || a.activeSession?.openedAt || 0) - new Date(b.activeSession?.accountRequestedAt || b.activeSession?.openedAt || 0);
    });

    const previousSelected = dueTables.find((x) => x.id === S.selectedTableId);
    const selected = previousSelected || dueTables[0] || null;
    if (selected) S.selectedTableId = selected.id;

    const closedTotal = number(summary?.restaurantClosedTablesTotal);
    const cashRecorded = number(summary?.restaurantCashRecorded);
    const otherRecorded = Math.max(0, closedTotal - cashRecorded);
    const requestedCount = openTables.filter((x) => x.state === 'CUENTA_PEDIDA').length;
    const shiftAccount = cajas.find((x) => x.id === summary?.shift?.cajaBancoId) || cashAccounts[0] || null;
    const selectedTotal = number(selected?.activeSession?.sale?.total);
    const openedAt = summary?.shift?.abiertoEn ? new Date(summary.shift.abiertoEn) : null;
    const shiftAge = openedAt && Number.isFinite(openedAt.getTime()) ? cashAge(openedAt).replace('Solicitada ', '') : '';
    const recent = Array.isArray(summary?.tables) ? [...summary.tables].reverse().slice(0, 8) : [];

    if (!S.cashShiftId || !summary) {
      $('#view').innerHTML = `<section class="cash-shell cash-closed-shell">
        <div class="cash-page-head"><div><div class="ri-eyebrow">Caja / Turno</div><h1 class="ri-title">Abrir caja</h1><p class="ri-muted">Una sola acción para empezar. Elige la caja y registra el fondo inicial.</p></div><span class="cash-state-pill closed">● CAJA CERRADA</span></div>
        <div class="cash-open-card">
          <div class="cash-open-icon">▣</div>
          <div><div class="ri-eyebrow">Inicio de turno</div><h2>Caja lista para comenzar</h2><p>Abre el turno antes de cobrar mesas. Puedes iniciar con fondo $0 si no manejas efectivo inicial.</p></div>
          <div class="cash-open-form">
            <label class="ri-label">Caja<select id="cashAccount" class="ri-select">${cashAccounts.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select></label>
            <label class="ri-label">Fondo inicial<input id="opening" class="ri-input" type="number" min="0" value="0" inputmode="numeric" placeholder="0"></label>
            <button id="openShift" class="ri-btn primary cash-primary-action" ${cashAccounts.length ? '' : 'disabled'}>Abrir caja</button>
          </div>
          ${cashAccounts.length ? '' : '<div class="ri-error">No hay una caja activa configurada en Tesorería.</div>'}
        </div>
      </section>`;
      bindCash(cajas, null, selected);
      return;
    }

    $('#view').innerHTML = `<section class="cash-shell" data-cash-method="EFECTIVO">
      <div class="cash-page-head"><div><div class="ri-eyebrow">Caja / Turno</div><h1 class="ri-title">Caja</h1><p class="ri-muted">Cobro de mesas, seguimiento del turno y cierre en una sola pantalla.</p></div><span class="cash-state-pill">● CAJA ABIERTA</span></div>

      <div class="cash-shift-strip">
        <div class="cash-shift-item"><span class="cash-shift-icon">▣</span><span><small>Caja</small><b>${esc(shiftAccount?.nombre || 'Caja')}</b><em>Caja principal del turno</em></span></div>
        <div class="cash-shift-item"><span class="cash-shift-icon green">◷</span><span><small>Turno</small><b class="green-text">Abierto</b><em>${esc(shiftAge || 'Turno actual')}</em></span></div>
        <div class="cash-shift-item"><span class="cash-shift-icon">○</span><span><small>Cajero actual</small><b>${esc(S.context.user.nombre || 'Usuario')}</b><em>${esc(S.context.user.rol || '')}</em></span></div>
        <div class="cash-shift-item"><span class="cash-shift-icon">□</span><span><small>Hora de apertura</small><b>${openedAt ? openedAt.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}) : '—'}</b><em>${openedAt ? openedAt.toLocaleDateString('es-CO') : ''}</em></span></div>
      </div>

      <div class="cash-kpis">
        <article class="cash-kpi"><span>↗</span><div><small>Ventas del turno</small><b>${money(closedTotal)}</b><em>${recent.length} cierre(s) registrado(s)</em></div></article>
        <article class="cash-kpi green"><span>▣</span><div><small>Efectivo registrado</small><b>${money(cashRecorded)}</b><em>Dato real del turno</em></div></article>
        <article class="cash-kpi blue"><span>▤</span><div><small>Otros medios</small><b>${money(otherRecorded)}</b><em>Ventas cerradas menos efectivo</em></div></article>
        <article class="cash-kpi orange"><span>▱</span><div><small>Mesas por cobrar</small><b>${requestedCount}</b><em>${openTables.length} mesa(s) abiertas</em></div></article>
      </div>

      <div class="cash-workspace">
        <section class="cash-panel cash-due-panel">
          <div class="cash-panel-head"><div><h2>Mesas por cobrar</h2><p>Las cuentas pedidas aparecen primero.</p></div><span class="cash-count-badge">${requestedCount}</span></div>
          <div class="cash-due-list">${dueTables.length ? dueTables.map((table) => cashTableRow(table, table.id === selected?.id)).join('') : '<div class="empty-ticket">No hay mesas abiertas en este momento.</div>'}</div>
        </section>

        <section class="cash-panel cash-fast-panel">
          <div class="cash-panel-head"><div><h2>Cobro rápido</h2><p>${selected ? 'Mesa seleccionada' : 'Selecciona una mesa para cobrar'}</p></div>${selected ? '<span class="cash-selected-pill">✓ Seleccionada</span>' : ''}</div>
          ${selected ? `<div class="cash-selected-summary"><div><span class="cash-table-icon large">▱</span><span><b>${esc(selected.name)}</b><small>${esc(selected.state.replaceAll('_',' '))} · ${selected.activeSession?.guestCount || 1} persona(s)</small></span></div><div><small>Total a pagar</small><b>${money(selectedTotal)}</b></div></div>
          <div class="cash-payment-title">Método de pago</div>
          <div class="cash-methods">
            <button type="button" class="cash-method active" data-cash-method="EFECTIVO"><b>▣</b><span>Efectivo</span></button>
            <button type="button" class="cash-method" data-cash-method="BANCO"><b>▤</b><span>Tarjeta / QR</span></button>
            <button type="button" class="cash-method" data-cash-method="CREDITO"><b>◫</b><span>Crédito</span></button>
            <button type="button" class="cash-method" disabled title="Pago mixto todavía no está soportado por el motor transaccional"><b>◩</b><span>Mixto</span><small>Próximamente</small></button>
          </div>
          <label class="ri-label cash-account-field" id="accountLabel">Caja / banco<select id="paymentAccount" class="ri-select"></select></label>
          <div class="cash-received-row" id="cashReceivedRow"><label class="ri-label">Recibido del cliente<input id="cashReceived" class="ri-input" type="number" min="0" step="1" inputmode="numeric" value="${Math.ceil(selectedTotal)}"></label><div class="cash-change"><small>Cambio</small><b id="cashChange">${money(0)}</b></div></div>
          <details class="cash-more-options"><summary>Propina y división de cuenta</summary><div><label class="ri-label">Propina<input id="tip" class="ri-input" type="number" min="0" value="0"></label><label class="ri-label">Dividir en partes iguales<input id="parts" class="ri-input" type="number" min="1" max="50" value="1"></label></div></details>
          <button id="closeTable" class="ri-btn primary cash-confirm">Confirmar cobro · ${money(selectedTotal)}</button>` : '<div class="cash-empty-selection"><span>▱</span><b>Sin mesa seleccionada</b><p>Cuando una mesa pida la cuenta aparecerá aquí para cobrarla.</p></div>'}
        </section>
      </div>

      <div class="cash-lower-grid">
        <section class="cash-panel">
          <div class="cash-panel-head"><div><h2>Últimos cobros</h2><p>Trazabilidad real del turno actual.</p></div></div>
          <div class="cash-recent-list">${recent.length ? recent.map((row) => `<div class="cash-recent-row"><span><b>${esc(row.table)}</b><small>${esc(row.saleNumber || 'Venta')}</small></span><span>${money(row.total)}</span><span class="cash-recent-state">Registrado</span></div>`).join('') : '<div class="empty-ticket">Todavía no hay mesas cerradas en este turno.</div>'}</div>
        </section>

        <section class="cash-panel cash-close-panel">
          <div class="cash-panel-head"><div><h2>Resumen del turno</h2><p>Cuenta el efectivo antes de cerrar.</p></div></div>
          <div class="cash-close-lines"><div><span>Ventas cerradas</span><b>${money(closedTotal)}</b></div><div><span>Fondo inicial</span><b>${money(summary.shift.saldoInicial)}</b></div><div><span>Efectivo esperado</span><b>${money(summary.systemCashExpected)}</b></div></div>
          <label class="ri-label cash-physical-label">Efectivo contado<input id="physicalCount" class="ri-input" type="number" min="0" step="1" inputmode="numeric" placeholder="Escribe cuánto hay en caja"></label>
          <div id="difference" class="cash-difference"><small>Diferencia</small><b>—</b><span>Ingresa el conteo físico.</span></div>
          <div class="cash-close-checks"><span class="${requestedCount ? 'warn' : 'ok'}">${requestedCount ? '!' : '✓'} ${requestedCount ? `${requestedCount} mesa(s) aún por cobrar` : 'Todas las cuentas pedidas están cobradas'}</span><span class="ok">✓ Ventas del turno disponibles</span><span id="cashCountCheck">○ Arqueo pendiente</span></div>
          <button id="closeShift" class="ri-btn brass cash-close-button" disabled>Cerrar turno</button>
        </section>
      </div>
    </section>`;

    bindCash(cajas, summary, selected);
  }

  function bindCash(cajas, summary, selected) {
    $('#openShift')?.addEventListener('click', async () => {
      try {
        const shift = await api('/api/v1/restaurante/caja/abrir', { method:'POST', body:JSON.stringify({ cajaBancoId:$('#cashAccount').value, saldoInicial:number($('#opening').value) }) });
        S.cashShiftId = shift.id;
        localStorage.setItem(SHIFT_KEY, shift.id);
        message('Caja abierta. Ya puedes recibir cobros.');
        await renderCash();
      } catch (error) { message(error.message, true); }
    });

    $$('[data-cash-table]').forEach((button) => button.addEventListener('click', async () => {
      S.selectedTableId = button.dataset.cashTable;
      await renderCash();
    }));

    const methodButtons = $$('[data-cash-method]');
    const account = $('#paymentAccount');
    const label = $('#accountLabel');
    const receivedRow = $('#cashReceivedRow');
    const received = $('#cashReceived');
    const change = $('#cashChange');
    const confirm = $('#closeTable');
    const tip = $('#tip');
    const selectedTotal = number(selected?.activeSession?.sale?.total);

    function currentMethod() {
      return methodButtons.find((button) => button.classList.contains('active'))?.dataset.cashMethod || 'EFECTIVO';
    }

    function refreshAccounts() {
      if (!account || !label) return;
      const type = currentMethod();
      label.classList.toggle('hidden', type === 'CREDITO');
      if (receivedRow) receivedRow.hidden = type !== 'EFECTIVO';
      const rows = cajas.filter((x) => x.activo && (type === 'EFECTIVO' ? x.tipo === 'CAJA' : type === 'BANCO' ? x.tipo === 'BANCO' : false));
      account.innerHTML = rows.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('');
      if (confirm) confirm.textContent = `Confirmar cobro · ${money(selectedTotal + number(tip?.value))}`;
      updateChange();
    }

    function updateChange() {
      if (!received || !change || !confirm) return;
      const total = selectedTotal + number(tip?.value);
      const amount = number(received.value);
      const diff = amount - total;
      change.textContent = money(Math.max(0, diff));
      change.parentElement.classList.toggle('bad', currentMethod() === 'EFECTIVO' && amount < total);
      if (currentMethod() === 'EFECTIVO') confirm.disabled = amount < total;
      else confirm.disabled = false;
      confirm.textContent = `Confirmar cobro · ${money(total)}`;
    }

    methodButtons.forEach((button) => button.addEventListener('click', () => {
      if (button.disabled) return;
      methodButtons.forEach((row) => row.classList.toggle('active', row === button));
      refreshAccounts();
    }));
    received?.addEventListener('input', updateChange);
    tip?.addEventListener('input', updateChange);
    refreshAccounts();

    confirm?.addEventListener('click', async () => {
      if (!selected) return;
      const formaPago = currentMethod();
      const parts = Math.max(1, Number($('#parts')?.value || 1));
      try {
        const result = await api(`/api/v1/restaurante/mesas/${selected.id}/cerrar`, {
          method:'POST',
          body:JSON.stringify({
            formaPago,
            cajaBancoId:formaPago === 'CREDITO' ? null : account?.value,
            tipAmount:number(tip?.value),
            split:parts > 1 ? { mode:'EQUAL', parts } : { mode:'NONE' }
          })
        });
        message(`Cobro registrado. ${result.sale.numero} · ${result.fiscalDocument.mode}.`);
        S.selectedTableId = null;
        await renderCash();
      } catch (error) { message(error.message, true); }
    });

    const physical = $('#physicalCount');
    const difference = $('#difference');
    const closeButton = $('#closeShift');
    const countCheck = $('#cashCountCheck');
    physical?.addEventListener('input', () => {
      const raw = physical.value;
      if (raw === '') {
        difference.innerHTML = '<small>Diferencia</small><b>—</b><span>Ingresa el conteo físico.</span>';
        difference.classList.remove('ok','bad');
        closeButton.disabled = true;
        if (countCheck) { countCheck.className = ''; countCheck.textContent = '○ Arqueo pendiente'; }
        return;
      }
      const diff = number(raw) - number(summary?.systemCashExpected);
      difference.classList.toggle('ok', Math.abs(diff) < .005);
      difference.classList.toggle('bad', Math.abs(diff) >= .005);
      difference.innerHTML = `<small>Diferencia</small><b>${money(diff)}</b><span>${Math.abs(diff) < .005 ? 'Caja cuadrada' : 'Revisa el efectivo antes de cerrar'}</span>`;
      closeButton.disabled = false;
      if (countCheck) { countCheck.className = Math.abs(diff) < .005 ? 'ok' : 'warn'; countCheck.textContent = `${Math.abs(diff) < .005 ? '✓' : '!'} Arqueo realizado`; }
    });

    closeButton?.addEventListener('click', async () => {
      if (!physical || physical.value === '') return;
      try {
        const result = await api(`/api/v1/restaurante/caja/turnos/${S.cashShiftId}/cerrar`, { method:'POST', body:JSON.stringify({ saldoFinal:number(physical.value) }) });
        message(`Turno cerrado. Descuadre final ${money(result.closed.descuadre)}.`);
        S.cashShiftId = null;
        localStorage.removeItem(SHIFT_KEY);
        await renderCash();
      } catch (error) { message(error.message, true); }
    });
  }

  async function renderStatus() {
    await loadContext();
    const status = S.context.status;
    const theme = S.context.theme;
    const tokens = theme.tokens;
    const typography = theme.typography;
    $('#view').innerHTML = `<div class="ri-grid"><section class="ri-card"><div class="ri-eyebrow">Estado oficial</div><h1 class="ri-title">${esc(status.label)}</h1><p><b>${esc(status.productionLabel)}</b></p><div class="metric-strip"><div class="metric-ticket"><small>Impresora física</small><b>${status.gates.physicalPrinterFieldPass ? 'OK' : 'PEND.'}</b></div><div class="metric-ticket"><small>Meta</small><b>${status.gates.metaBusinessManagementReviewPass ? 'OK' : 'PEND.'}</b></div><div class="metric-ticket"><small>DIAN real</small><b>${status.gates.dianRealEnabled ? 'OK' : 'PEND.'}</b></div><div class="metric-ticket"><small>Fiscal simulado</small><b>${status.gates.simulatedFiscalOperationExplicitlyAccepted ? 'SÍ' : 'NO'}</b></div></div><label class="ri-checkbox"><input type="checkbox" id="waReady" ${status.whatsappOrderReadyEnabled ? 'checked' : ''}> Activar evento opcional “Pedido listo” por WhatsApp; sigue sujeto a plantilla y consentimiento.</label><button class="ri-btn" id="saveOperational">Guardar operación</button></section><aside class="theme-preview"><div class="ri-eyebrow">Tema independiente</div><h2>La Riel</h2><p>Los componentes consumen variables del tema; no contienen colores ni tipografías de negocio en su lógica.</p><span class="origin-qr">📱 vía autopedido QR</span><article class="command-ticket"><div class="command-table">Vista previa</div><div class="command-item"><b>2×</b> Producto de muestra</div></article></aside></div>
    <section class="ri-card"><div class="ri-eyebrow">Perfil visual del tenant</div><h2>Editar tema en un solo lugar</h2><div class="theme-panel"><label class="ri-label">Nombre del restaurante<input id="themeName" class="ri-input" value="${esc(theme.restaurantName || '')}"></label>${Object.keys(tokens).map((key) => `<label class="ri-label theme-swatch"><input type="color" data-theme-token="${key}" value="${esc(tokens[key])}"><span>${esc(key)}<small>${esc(tokens[key])}</small></span></label>`).join('')}<label class="ri-label">Tipografía títulos<input id="fontDisplay" class="ri-input" value="${esc(typography.display)}"></label><label class="ri-label">Tipografía interfaz<input id="fontBody" class="ri-input" value="${esc(typography.body)}"></label><label class="ri-label">Tipografía recibos<input id="fontMono" class="ri-input" value="${esc(typography.mono)}"></label></div><div class="ri-actions"><button id="saveTheme" class="ri-btn primary">Guardar tema del tenant</button></div></section>`;
    $('#saveOperational').onclick = async () => { try { await api('/api/v1/restaurante/config', { method:'PATCH', body:JSON.stringify({ whatsappOrderReadyEnabled:$('#waReady').checked }) }); message('Configuración operativa guardada.'); await renderStatus(); } catch (error) { message(error.message, true); } };
    $('#saveTheme').onclick = async () => {
      const payload = { restaurantName:$('#themeName').value.trim(), tokens:{}, typography:{ display:$('#fontDisplay').value.trim(), body:$('#fontBody').value.trim(), mono:$('#fontMono').value.trim() } };
      $$('[data-theme-token]').forEach((input) => { payload.tokens[input.dataset.themeToken] = input.value; });
      try { const saved = await api('/api/v1/restaurante/theme', { method:'PATCH', body:JSON.stringify(payload) }); S.context.theme = saved; window.RestaurantTheme.apply(saved); message('Tema guardado. Las cinco pantallas consumirán estos mismos tokens.'); await renderStatus(); } catch (error) { message(error.message, true); }
    };
  }

  async function renderCurrent() {
    if (!S.tab) { $('#view').innerHTML = '<div class="empty-ticket">Este usuario no tiene una superficie operativa de Restaurante asignada.</div>'; return; }
    try {
      if (S.tab === 'salon') await renderSalon();
      else if (S.tab === 'mesero') await renderWaiter();
      else if (S.tab === 'kds') await renderKds();
      else if (S.tab === 'caja') await renderCash();
      else if (S.tab === 'estado') await renderStatus();
    } catch (error) { message(error.message, true); $('#view').innerHTML = '<div class="empty-ticket">No fue posible cargar esta vista.</div>'; }
  }

  window.addEventListener('beforeunload', stopPoll);
  loadContext().then(renderCurrent).catch((error) => message(error.message, true));
})();
