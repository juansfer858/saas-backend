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

  async function renderCash() {
    await loadTables();
    const cajas = await api('/api/v1/tesoreria/cajas-bancos');
    let summary = null;
    if (S.cashShiftId) {
      try { summary = await api(`/api/v1/restaurante/caja/turnos/${S.cashShiftId}/resumen`); }
      catch { S.cashShiftId = null; localStorage.removeItem(SHIFT_KEY); }
    }
    const openTables = S.tables.filter((x) => x.activeSession);
    const p = summary?.paymentBreakdown || {};
    $('#view').innerHTML = `<div class="ri-grid">
      <section class="ri-card"><div class="ri-eyebrow">Tesorería del Core</div><h1 class="ri-title">Cierre de caja / turno</h1>${!S.cashShiftId ? `<div class="ri-actions"><select id="cashAccount" class="ri-select">${cajas.filter((x) => x.tipo === 'CAJA' && x.activo).map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select><input id="opening" class="ri-input" type="number" min="0" value="0" placeholder="Fondo inicial"><button id="openShift" class="ri-btn primary">Abrir caja</button></div>` : `<div class="metric-strip"><div class="metric-ticket"><small>Efectivo</small><b>${money(p.cashSales)}</b></div><div class="metric-ticket"><small>Tarjeta / QR</small><b>${money(p.electronicSales)}</b></div><div class="metric-ticket"><small>Crédito</small><b>${money(p.creditSales)}</b></div><div class="metric-ticket"><small>Propinas</small><b>${money(p.tips)}</b></div></div><div class="receipt"><div class="receipt-head"><div class="ri-eyebrow">Cierre X / Z</div><h2 data-restaurant-name>${esc(S.context.theme.restaurantName)}</h2><small>${new Date(summary.shift.abiertoEn).toLocaleString('es-CO')}</small></div><div class="receipt-row"><span>Fondo inicial</span><b>${money(summary.shift.saldoInicial)}</b></div><div class="receipt-row"><span>Ventas efectivo</span><b>${money(p.cashSales)}</b></div><div class="receipt-row"><span>Tarjeta / QR / transferencia</span><b>${money(p.electronicSales)}</b></div><div class="receipt-row"><span>Crédito</span><b>${money(p.creditSales)}</b></div><div class="receipt-row tip"><span>Propinas</span><b>${money(p.tips)}</b></div><div class="receipt-row total"><span>Total operación</span><b>${money(p.restaurantTotal)}</b></div><div class="receipt-row total"><span>Caja esperada</span><b>${money(summary.systemCashExpected)}</b></div><div class="count-box"><label class="ri-label">Conteo físico caja<input id="physicalCount" class="ri-input" type="number" min="0" step="1" placeholder="Ingrese el efectivo contado"></label><div id="difference" class="difference">Ingrese el conteo para calcular diferencia.</div><div class="ri-actions"><button id="closeShift" class="ri-btn brass" disabled>Cerrar turno</button></div></div></div>`}</section>
      <aside class="ri-card"><div class="ri-eyebrow">Cobro</div><h2>Cerrar mesa</h2>${openTables.length ? `<label class="ri-label">Mesa<select id="closeTableId" class="ri-select">${openTables.map((x) => `<option value="${x.id}">${esc(x.name)} · ${esc(x.state)}</option>`).join('')}</select></label><label class="ri-label">Forma de pago<select id="paymentMethod" class="ri-select"><option value="EFECTIVO">Efectivo</option><option value="BANCO">Tarjeta / QR / transferencia</option><option value="CREDITO">Crédito</option></select></label><label class="ri-label" id="accountLabel">Caja / banco<select id="paymentAccount" class="ri-select"></select></label><label class="ri-label">Propina<input id="tip" class="ri-input" type="number" min="0" value="0"></label><label class="ri-label">Dividir en partes iguales<input id="parts" class="ri-input" type="number" min="1" max="50" value="1"></label><button id="closeTable" class="ri-btn primary">Cobrar y cerrar</button>` : '<div class="empty-ticket">No hay mesas abiertas.</div>'}</aside>
    </div>${summary?.tables?.length ? `<section class="ri-card"><div class="ri-eyebrow">Trazabilidad</div><h2>Mesas cerradas en el turno</h2>${summary.tables.map((x) => `<div class="status-row"><span></span><span>${esc(x.table)} · ${esc(x.saleNumber)} · ${esc(x.formaPago)}</span><b>${money(x.total)}</b></div>`).join('')}</section>` : ''}`;
    bindCash(cajas, summary);
  }
  function bindCash(cajas, summary) {
    $('#openShift')?.addEventListener('click', async () => {
      try {
        const shift = await api('/api/v1/restaurante/caja/abrir', { method:'POST', body:JSON.stringify({ cajaBancoId:$('#cashAccount').value, saldoInicial:number($('#opening').value) }) });
        S.cashShiftId = shift.id; localStorage.setItem(SHIFT_KEY, shift.id); message('Turno de caja abierto.'); await renderCash();
      } catch (error) { message(error.message, true); }
    });
    const method = $('#paymentMethod');
    const account = $('#paymentAccount');
    const label = $('#accountLabel');
    function refreshAccounts() {
      if (!method || !account || !label) return;
      const type = method.value;
      label.classList.toggle('hidden', type === 'CREDITO');
      const rows = cajas.filter((x) => x.activo && (type === 'EFECTIVO' ? x.tipo === 'CAJA' : type === 'BANCO' ? x.tipo === 'BANCO' : false));
      account.innerHTML = rows.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('');
    }
    method?.addEventListener('change', refreshAccounts); refreshAccounts();
    $('#closeTable')?.addEventListener('click', async () => {
      const formaPago = method.value;
      const parts = Math.max(1, Number($('#parts').value || 1));
      try {
        const result = await api(`/api/v1/restaurante/mesas/${$('#closeTableId').value}/cerrar`, { method:'POST', body:JSON.stringify({ formaPago, cajaBancoId:formaPago === 'CREDITO' ? null : account.value, tipAmount:number($('#tip').value), split:parts > 1 ? { mode:'EQUAL', parts } : { mode:'NONE' } }) });
        message(`Mesa cerrada. ${result.sale.numero} · ${result.fiscalDocument.mode}.`); await renderCash();
      } catch (error) { message(error.message, true); }
    });
    const physical = $('#physicalCount');
    const difference = $('#difference');
    const closeButton = $('#closeShift');
    physical?.addEventListener('input', () => {
      const raw = physical.value;
      if (raw === '') { difference.className = 'difference'; difference.textContent = 'Ingrese el conteo para calcular diferencia.'; closeButton.disabled = true; return; }
      const diff = number(raw) - number(summary.systemCashExpected);
      difference.className = `difference ${Math.abs(diff) < .005 ? 'ok' : 'bad'}`;
      difference.textContent = `Diferencia real: ${money(diff)}${Math.abs(diff) < .005 ? ' · Caja cuadrada' : ' · Revisar antes de cerrar'}`;
      closeButton.disabled = false;
    });
    closeButton?.addEventListener('click', async () => {
      if (physical.value === '') return;
      try {
        const result = await api(`/api/v1/restaurante/caja/turnos/${S.cashShiftId}/cerrar`, { method:'POST', body:JSON.stringify({ saldoFinal:number(physical.value) }) });
        message(`Turno cerrado. Descuadre final ${money(result.closed.descuadre)}.`); S.cashShiftId = null; localStorage.removeItem(SHIFT_KEY); await renderCash();
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
