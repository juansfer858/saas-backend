(() => {
  'use strict';
  const MARKER = 'VANTIX_WAITER_DEDICATED_RUNTIME_V7';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const CATEGORIES = ['ENTRADAS','FUERTES','BEBIDAS','POSTRES'];
  const POLL_MS = 6000;
  const IDLE_BEFORE_POLL_MS = 2500;
  const MENU_PAGE = 40;

  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}

  const app = document.querySelector('#wvApp');
  const msg = document.querySelector('#wvMessage');
  const online = document.querySelector('#wvOnline');
  const sync = document.querySelector('#wvSync');
  const backdrop = document.querySelector('#wvBackdrop');

  const S = {
    context:null,
    zones:[],
    tables:[],
    menu:[],
    selectedZoneId:null,
    selectedTableId:null,
    category:'ENTRADAS',
    search:'',
    seat:1,
    menuLimit:MENU_PAGE,
    draft:null,
    orders:[],
    detailsEpoch:0,
    detailsSessionId:null,
    lastInteraction:Date.now(),
    mutationCount:0,
    qtyDesired:new Map(),
    qtyJobs:new Map(),
    detailRefreshTimer:null,
    pollTimer:null,
    destroyed:false
  };

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (v) => new Intl.NumberFormat('es-CO', { style:'currency', currency:session?.tenant?.moneda || 'COP', maximumFractionDigits:0 }).format(Number(v || 0));
  const touch = () => { S.lastInteraction = Date.now(); };

  function message(text, error = false) {
    if (!msg) return;
    msg.innerHTML = text ? `<div class="wv-msg ${error ? 'err' : ''}">${esc(text)}</div>` : '';
  }

  function setOnlineState() {
    if (!online) return;
    const on = navigator.onLine !== false;
    online.classList.toggle('off', !on);
    online.title = on ? 'En línea' : 'Sin conexión';
  }
  window.addEventListener('online', () => { setOnlineState(); message('Conexión recuperada.'); schedulePoll(250); });
  window.addEventListener('offline', () => { setOnlineState(); message('Sin conexión. Puedes seguir navegando lo ya cargado; las acciones esperan conexión.', true); });
  setOnlineState();

  function showFatal(title, detail) {
    if (!app) return;
    app.innerHTML = `<section class="wv-card wv-empty"><b>${esc(title)}</b><span>${esc(detail)}</span><div style="margin-top:12px"><button type="button" class="wv-btn primary" data-action="reload">Reintentar</button></div></section>`;
  }

  function headers(extra = {}) {
    return {
      'Content-Type':'application/json',
      Authorization:`Bearer ${session.token}`,
      'x-tenant-subdomain':session.subdomain,
      ...extra
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache:'no-store',
      headers:headers(options.headers || {})
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (response.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      throw Object.assign(new Error('Este dispositivo perdió la vinculación. Genera un QR nuevo desde Empleados.'), { fatal:true });
    }
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function selectedZone() { return S.zones.find((x) => x.id === S.selectedZoneId) || null; }
  function selectedTable() { return S.tables.find((x) => x.id === S.selectedTableId) || null; }
  function zoneTables() { return S.tables.filter((x) => x.zoneId === S.selectedZoneId); }

  function preferredInitialSelection() {
    const assignment = S.context?.workAssignment || {};
    const preferredTables = Array.isArray(assignment.tableIds) ? assignment.tableIds : [];
    const preferredZones = Array.isArray(assignment.zoneIds) ? assignment.zoneIds : [];
    const preferredTable = preferredTables.map((id) => S.tables.find((x) => x.id === id)).find(Boolean);
    if (preferredTable) {
      S.selectedZoneId = preferredTable.zoneId;
      S.selectedTableId = preferredTable.id;
      return;
    }
    const preferredZone = preferredZones.map((id) => S.zones.find((x) => x.id === id)).find(Boolean);
    S.selectedZoneId = preferredZone?.id || S.zones[0]?.id || null;
    S.selectedTableId = S.tables.find((x) => x.zoneId === S.selectedZoneId)?.id || null;
  }

  function tableMeta(table) {
    const state = String(table?.state || 'LIBRE');
    const people = Number(table?.activeSession?.guestCount || 0);
    if (state === 'LIBRE') return 'Libre';
    if (state === 'CUENTA_PEDIDA') return 'Cuenta pedida';
    return `${state.replaceAll('_',' ')}${people ? ` · ${people} pers.` : ''}`;
  }

  function renderShell() {
    if (!app) return;
    app.innerHTML = `<section class="wv-card wv-top">
      <div class="wv-zone-row">
        <select id="wvZone" class="wv-zone" aria-label="Zona"></select>
        <div id="wvTables" class="wv-tables" aria-label="Mesas"></div>
      </div>
    </section>
    <div id="wvBody" class="wv-body"></div>`;
    renderZoneSelect();
    renderTables();
  }

  function renderZoneSelect() {
    const select = document.querySelector('#wvZone');
    if (!select) return;
    select.innerHTML = S.zones.map((zone) => `<option value="${zone.id}" ${zone.id === S.selectedZoneId ? 'selected' : ''}>${esc(zone.name)}</option>`).join('');
  }

  function renderTables() {
    const root = document.querySelector('#wvTables');
    if (!root) return;
    const rows = zoneTables();
    root.innerHTML = rows.length ? rows.map((table) => `<button type="button" class="wv-table ${esc(String(table.state || 'LIBRE'))} ${table.id === S.selectedTableId ? 'active' : ''}" data-table="${table.id}"><b>${esc(table.name)}</b><span>${esc(tableMeta(table))}</span></button>`).join('') : '<div class="wv-empty" style="padding:8px">Sin mesas en esta zona.</div>';
    const current = root.querySelector('.wv-table.active');
    current?.scrollIntoView?.({ block:'nearest', inline:'nearest' });
  }

  function bodyLoading(text = 'Cargando mesa…') {
    const body = document.querySelector('#wvBody');
    if (body) body.innerHTML = `<section class="wv-card wv-loading"><div class="wv-spin"></div><b>${esc(text)}</b><span>La navegación sigue disponible.</span></section>`;
  }

  function openMode() {
    return document.querySelector('[data-open-mode].primary')?.dataset.openMode || 'CONJUNTA';
  }

  function renderFreeTable(table) {
    const zone = selectedZone();
    const body = document.querySelector('#wvBody');
    if (!body) return;
    closeOrder();
    body.innerHTML = `<section class="wv-card wv-open">
      <small>${esc(zone?.name || 'Zona')} · ${esc(table.name)}</small>
      <h2>Abrir mesa</h2>
      <div class="wv-open-grid">
        <label class="wv-label">Personas<input id="wvOpenGuests" class="wv-input" type="number" min="1" max="50" value="1"></label>
        <div><div class="wv-label" style="margin-bottom:4px">Modo de cuenta</div><div class="wv-mode"><button type="button" class="wv-btn primary" data-open-mode="CONJUNTA">Conjunta</button><button type="button" class="wv-btn" data-open-mode="INDIVIDUAL">Individual</button></div></div>
        <button type="button" class="wv-btn primary wv-open-action" data-action="open-table">Abrir ${esc(table.name)}</button>
      </div>
    </section>`;
  }

  function serviceData(table) {
    const active = table?.activeSession;
    return S.draft?.service || (active ? {
      billingMode:active.billingMode || 'CONJUNTA',
      guestCount:Number(active.guestCount || 1),
      allItems:[],
      seats:[],
      total:active.sale?.total || 0,
      accountPreparedAt:active.accountPreparedAt || null,
      cashierRequestedAt:active.cashierRequestedAt || null
    } : null);
  }

  function billingMode() { return serviceData(selectedTable())?.billingMode || selectedTable()?.activeSession?.billingMode || 'CONJUNTA'; }
  function guestCount() { return Math.max(1, Number(serviceData(selectedTable())?.guestCount || selectedTable()?.activeSession?.guestCount || 1)); }

  function renderActiveSkeleton(table) {
    const body = document.querySelector('#wvBody');
    if (!body) return;
    body.innerHTML = `<div class="wv-service">
      <section id="wvServiceBar" class="wv-card wv-servicebar"></section>
      <div class="wv-work">
        <section class="wv-card wv-catalog">
          <div id="wvTabs" class="wv-tabs"></div>
          <div class="wv-search-row"><input id="wvSearch" class="wv-input" placeholder="Buscar producto…" value="${esc(S.search)}"><span id="wvSearchMeta" class="wv-search-meta"></span></div>
          <div id="wvMenuGrid" class="wv-grid"></div>
        </section>
        <aside id="wvOrder" class="wv-card wv-order"></aside>
      </div>
      <details id="wvHistory" class="wv-card wv-history"><summary>Ver rondas enviadas</summary><div id="wvHistoryBody"></div></details>
      <button id="wvOrderToggle" type="button" class="wv-order-toggle">VER PEDIDO</button>
    </div>`;
    renderServiceBar();
    renderTabs();
    renderMenuGrid();
    renderOrder();
    renderHistory();
  }

  function renderServiceBar() {
    const root = document.querySelector('#wvServiceBar');
    const table = selectedTable();
    if (!root || !table?.activeSession) return;
    const service = serviceData(table);
    const mode = service?.billingMode || 'CONJUNTA';
    const guests = Math.max(1, Number(service?.guestCount || table.activeSession.guestCount || 1));
    if (S.seat > guests) S.seat = 1;
    const people = mode === 'INDIVIDUAL'
      ? Array.from({length:guests}, (_,i) => i + 1).map((seat) => `<button type="button" class="wv-btn wv-seat ${seat === S.seat ? 'active' : ''}" data-seat="${seat}">Persona ${seat}</button>`).join('')
      : `<span style="font-size:12px;font-weight:800">${guests} persona(s) · cuenta conjunta</span>`;
    root.innerHTML = `<div class="wv-servicebar-row"><button type="button" class="wv-btn ${mode === 'CONJUNTA' ? 'primary' : ''}" data-billing="CONJUNTA">Conjunta</button><button type="button" class="wv-btn ${mode === 'INDIVIDUAL' ? 'primary' : ''}" data-billing="INDIVIDUAL">Individual</button><button type="button" class="wv-btn" data-action="add-person">+ Persona</button></div><div class="wv-servicebar-row" style="margin-top:7px">${people}</div>`;
  }

  function renderTabs() {
    const root = document.querySelector('#wvTabs');
    if (!root) return;
    root.innerHTML = CATEGORIES.map((cat) => `<button type="button" class="wv-btn wv-tab ${cat === S.category ? 'active' : ''}" data-category="${cat}">${cat}</button>`).join('');
  }

  function draftQty(menuItemId, seat = null) {
    const mode = billingMode();
    const target = mode === 'INDIVIDUAL' ? Number(seat || S.seat || 1) : null;
    const key = `${menuItemId}|${target || 0}`;
    if (S.qtyDesired.has(key)) return Number(S.qtyDesired.get(key) || 0);
    const row = S.draft?.order?.items?.find((item) => item.menuItemId === menuItemId && (mode !== 'INDIVIDUAL' ? item.seatNumber == null : Number(item.seatNumber || 0) === target));
    return Number(row?.quantity || 0);
  }

  function visibleMenuRows() {
    const needle = String(S.search || '').trim().toLocaleLowerCase('es');
    return S.menu.filter((item) => item.category === S.category && (!needle || String(item.product?.nombre || '').toLocaleLowerCase('es').includes(needle)));
  }

  function renderMenuGrid() {
    const grid = document.querySelector('#wvMenuGrid');
    const meta = document.querySelector('#wvSearchMeta');
    if (!grid) return;
    const rows = visibleMenuRows();
    const shown = rows.slice(0, S.menuLimit);
    if (meta) meta.textContent = `${rows.length} producto${rows.length === 1 ? '' : 's'}`;
    grid.innerHTML = shown.length ? shown.map((item) => {
      const q = draftQty(item.id, billingMode() === 'INDIVIDUAL' ? S.seat : null);
      const warning = item.warning ? `<small style="color:#b45309">${esc(item.warning)}</small>` : '';
      return `<article class="wv-product" data-menu-item="${item.id}" data-name="${esc(String(item.product?.nombre || '').toLocaleLowerCase('es'))}"><small>${esc(item.station || '')}</small><b>${esc(item.product?.nombre || 'Producto')}</b><strong>${money(item.product?.precio1)}</strong>${warning}${item.warning ? '' : `<div class="wv-qty"><button type="button" data-qty-delta="-1" aria-label="Quitar">−</button><span data-qty>${q}</span><button type="button" class="plus" data-qty-delta="1" aria-label="Agregar">+</button></div>`}</article>`;
    }).join('') : '<div class="wv-empty" style="grid-column:1/-1">No hay productos para este filtro.</div>';
    if (rows.length > shown.length) grid.insertAdjacentHTML('beforeend', `<button type="button" class="wv-btn wv-more" data-action="more-menu">Mostrar ${Math.min(MENU_PAGE, rows.length - shown.length)} más</button>`);
  }

  function orderItems(service) { return Array.isArray(service?.allItems) ? service.allItems : []; }
  function renderOrder() {
    const root = document.querySelector('#wvOrder');
    const toggle = document.querySelector('#wvOrderToggle');
    const table = selectedTable();
    if (!root || !table?.activeSession) return;
    const service = serviceData(table);
    const all = orderItems(service);
    const draftItems = Array.isArray(S.draft?.order?.items) ? S.draft.order.items : [];
    const prepared = Boolean(service?.accountPreparedAt);
    const sentToCash = Boolean(service?.cashierRequestedAt || table.state === 'CUENTA_PEDIDA');
    const rows = all.length ? all.map((item) => `<div class="wv-item"><div><b>${esc(item.quantity)}× ${esc(item.description)}</b><small>${esc(item.station || '')}${item.orderState === 'BORRADOR' ? ' · Por enviar' : ' · Enviado'}${item.notes ? ` · ${esc(item.notes)}` : ''}</small></div><strong>${money(item.lineTotal)}</strong>${item.orderState === 'BORRADOR' ? `<div style="grid-column:1/-1;display:flex;gap:6px"><button type="button" class="wv-btn" style="min-height:38px" data-note="${item.id}">Nota</button>${billingMode() === 'INDIVIDUAL' ? `<select class="wv-select" style="min-height:38px" data-move="${item.id}">${Array.from({length:guestCount()},(_,i)=>i+1).map((seat)=>`<option value="${seat}" ${Number(item.seatNumber)===seat?'selected':''}>Persona ${seat}</option>`).join('')}</select>` : ''}</div>` : ''}</div>`).join('') : '<div class="wv-empty" style="padding:12px">Sin productos todavía.</div>';
    let mainAction = '';
    if (draftItems.length) mainAction = `<button type="button" class="wv-btn primary" data-action="send-draft">Enviar a cocina / barra · ${money(S.draft?.order?.total || 0)}</button>`;
    else if (sentToCash) mainAction = '<div class="wv-msg">✓ Cuenta enviada a Caja</div>';
    else if (prepared) mainAction = `<button type="button" class="wv-btn primary" data-action="send-cash">Enviar a Caja · ${money(service?.total || 0)}</button>`;
    else if (all.length) mainAction = '<button type="button" class="wv-btn brass" data-action="prepare-account">Preparar cuenta</button>';
    root.innerHTML = `<div class="wv-order-head"><div><small>Pedido en curso</small><h2>${esc(table.name)}</h2></div><button type="button" class="wv-btn wv-close" data-action="close-order">×</button></div><div class="wv-order-list">${rows}</div><div class="wv-total"><span>Total mesa</span><b>${money(service?.total || table.activeSession?.sale?.total || 0)}</b></div><div class="wv-actions">${mainAction}${all.length ? '<button type="button" class="wv-btn" data-action="print-precheck">Imprimir pre-cuenta</button>' : ''}</div>`;
    if (toggle) toggle.textContent = `VER PEDIDO · ${money(service?.total || table.activeSession?.sale?.total || 0)}`;
  }

  function statusForOrder(order) {
    const commands = Array.isArray(order?.commands) ? order.commands : [];
    const states = commands.map((x) => String(x.state || '').toUpperCase());
    if (!states.length) return 'Recibido';
    if (states.some((x) => x === 'LISTA')) return 'Listo / parcial';
    if (states.some((x) => x === 'EN_PREPARACION')) return 'En preparación';
    if (states.every((x) => ['ENTREGADA','CANCELADA'].includes(x))) return 'Entregado';
    return 'En cocina';
  }

  function renderHistory() {
    const root = document.querySelector('#wvHistoryBody');
    if (!root) return;
    const rows = (Array.isArray(S.orders) ? S.orders : []).filter((x) => !['BORRADOR','CANCELADO'].includes(String(x.state || '').toUpperCase()));
    root.innerHTML = rows.length ? rows.map((order, index) => `<div class="wv-round"><b>Ronda ${rows.length - index} · ${esc(statusForOrder(order))}</b>${(order.items || []).map((item) => `${esc(item.quantity)}× ${esc(item.description)}`).join(' · ')}</div>`).join('') : '<div class="wv-empty" style="padding:10px">Aún no hay rondas enviadas.</div>';
  }

  function updateQuantitiesInDom() {
    document.querySelectorAll('[data-menu-item]').forEach((card) => {
      const q = card.querySelector('[data-qty]');
      if (q) q.textContent = String(draftQty(card.dataset.menuItem, billingMode() === 'INDIVIDUAL' ? S.seat : null));
    });
  }

  async function selectCurrentTable({ showLoader = true } = {}) {
    touch();
    S.detailsEpoch += 1;
    S.draft = null;
    S.orders = [];
    S.qtyDesired.clear();
    const table = selectedTable();
    renderTables();
    if (!table) {
      const body = document.querySelector('#wvBody');
      if (body) body.innerHTML = '<section class="wv-card wv-empty"><b>Selecciona una mesa</b></section>';
      return;
    }
    if (!table.activeSession) {
      renderFreeTable(table);
      return;
    }
    renderActiveSkeleton(table);
    if (showLoader) message('Cargando consumo de la mesa…');
    await refreshSelectedDetails({ quiet:!showLoader });
  }

  async function refreshSelectedDetails({ quiet = true } = {}) {
    const table = selectedTable();
    const sessionId = table?.activeSession?.id;
    if (!sessionId) return;
    const epoch = ++S.detailsEpoch;
    try {
      const [draft, orders] = await Promise.all([
        api(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador`),
        api(`/api/v1/restaurante/pedidos?sessionId=${encodeURIComponent(sessionId)}&limit=100`)
      ]);
      const current = selectedTable();
      if (epoch !== S.detailsEpoch || current?.activeSession?.id !== sessionId) return;
      S.detailsSessionId = sessionId;
      S.draft = draft;
      S.orders = Array.isArray(orders) ? orders : [];
      const guests = guestCount();
      if (S.seat > guests) S.seat = 1;
      renderServiceBar();
      updateQuantitiesInDom();
      renderOrder();
      renderHistory();
      renderTables();
      if (!quiet) message('');
    } catch (error) {
      if (epoch !== S.detailsEpoch) return;
      if (error.fatal) showFatal('Dispositivo no vinculado', error.message);
      else message(error.message, true);
    }
  }

  async function refreshTables({ allowSelectionRefresh = true } = {}) {
    try {
      const previous = selectedTable();
      const previousSession = previous?.activeSession?.id || null;
      const rows = await api('/api/v1/restaurante/mesas');
      if (!Array.isArray(rows)) return;
      S.tables = rows;
      if (!S.tables.some((x) => x.id === S.selectedTableId)) S.selectedTableId = S.tables.find((x) => x.zoneId === S.selectedZoneId)?.id || null;
      renderTables();
      const current = selectedTable();
      const currentSession = current?.activeSession?.id || null;
      if (allowSelectionRefresh && previousSession !== currentSession) await selectCurrentTable({ showLoader:false });
    } catch (error) {
      if (!error.fatal) return;
      showFatal('Dispositivo no vinculado', error.message);
    }
  }

  function beginMutation() {
    S.mutationCount += 1;
    if (sync) sync.classList.add('show');
  }
  function endMutation() {
    S.mutationCount = Math.max(0, S.mutationCount - 1);
    if (!S.mutationCount && sync) sync.classList.remove('show');
  }

  async function mutate(path, options = {}) {
    touch();
    beginMutation();
    try { return await api(path, options); }
    finally { endMutation(); }
  }

  function qtyKey(menuItemId, seat) { return `${menuItemId}|${seat || 0}`; }

  function adjustQty(card, delta) {
    const table = selectedTable();
    const sessionId = table?.activeSession?.id;
    if (!sessionId) return;
    touch();
    const menuItemId = card.dataset.menuItem;
    const seat = billingMode() === 'INDIVIDUAL' ? S.seat : null;
    const key = qtyKey(menuItemId, seat);
    const current = S.qtyDesired.has(key) ? Number(S.qtyDesired.get(key)) : draftQty(menuItemId, seat);
    const desired = Math.max(0, current + delta);
    S.qtyDesired.set(key, desired);
    const node = card.querySelector('[data-qty]');
    if (node) node.textContent = String(desired);
    queueQtySync({ key, sessionId, menuItemId, seat });
  }

  function queueQtySync(job) {
    if (S.qtyJobs.has(job.key)) return S.qtyJobs.get(job.key);
    const promise = (async () => {
      beginMutation();
      try {
        let lastSent = null;
        while (true) {
          const desired = Number(S.qtyDesired.get(job.key) ?? 0);
          if (lastSent === desired) break;
          lastSent = desired;
          await api(`/api/v1/restaurante/sesiones/${job.sessionId}/pedido-borrador/items/${job.menuItemId}`, {
            method:'PUT',
            body:JSON.stringify({ quantity:desired, seatNumber:job.seat })
          });
          if (Number(S.qtyDesired.get(job.key) ?? 0) === desired) break;
        }
      } catch (error) {
        message(error.message, true);
      } finally {
        S.qtyJobs.delete(job.key);
        endMutation();
        scheduleDetailRefresh();
      }
    })();
    S.qtyJobs.set(job.key, promise);
    return promise;
  }

  async function flushQtyJobs() {
    const jobs = [...S.qtyJobs.values()];
    if (jobs.length) await Promise.allSettled(jobs);
  }

  function scheduleDetailRefresh() {
    if (S.detailRefreshTimer) clearTimeout(S.detailRefreshTimer);
    S.detailRefreshTimer = setTimeout(() => {
      S.detailRefreshTimer = null;
      if (!S.qtyJobs.size) refreshSelectedDetails({ quiet:true }).catch(() => {});
    }, 180);
  }

  async function openTable() {
    const table = selectedTable();
    if (!table || table.activeSession) return;
    const people = Math.max(1, Math.min(50, Number(document.querySelector('#wvOpenGuests')?.value || 1)));
    const mode = openMode();
    try {
      await mutate(`/api/v1/restaurante/mesas/${table.id}/abrir`, { method:'POST', body:JSON.stringify({ guestCount:people, billingMode:mode }) });
      message(`${table.name} abierta.`);
      await refreshTables({ allowSelectionRefresh:false });
      await selectCurrentTable({ showLoader:false });
    } catch (error) { message(error.message, true); }
  }

  async function updateService(payload, successText) {
    const sessionId = selectedTable()?.activeSession?.id;
    if (!sessionId) return;
    try {
      await flushQtyJobs();
      await mutate(`/api/v1/restaurante/sesiones/${sessionId}/servicio`, { method:'PATCH', body:JSON.stringify(payload) });
      message(successText);
      await refreshSelectedDetails({ quiet:true });
    } catch (error) { message(error.message, true); }
  }

  async function updateItem(itemId, payload, successText) {
    const sessionId = selectedTable()?.activeSession?.id;
    if (!sessionId) return;
    try {
      await flushQtyJobs();
      await mutate(`/api/v1/restaurante/sesiones/${sessionId}/items/${itemId}`, { method:'PATCH', body:JSON.stringify(payload) });
      message(successText);
      await refreshSelectedDetails({ quiet:true });
    } catch (error) { message(error.message, true); }
  }

  async function sendDraft() {
    const sessionId = selectedTable()?.activeSession?.id;
    if (!sessionId) return;
    try {
      await flushQtyJobs();
      const order = await mutate(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador/enviar`, { method:'POST', body:'{}' });
      message(`Pedido enviado · ${Number(order?.commands?.length || 0)} comanda(s).`);
      S.qtyDesired.clear();
      await Promise.all([refreshTables({ allowSelectionRefresh:false }), refreshSelectedDetails({ quiet:true })]);
    } catch (error) { message(error.message, true); }
  }

  async function tableAction(action) {
    const table = selectedTable();
    if (!table) return;
    const path = action === 'prepare-account' ? 'preparar-cuenta' : 'enviar-caja';
    try {
      await flushQtyJobs();
      await mutate(`/api/v1/restaurante/mesas/${table.id}/${path}`, { method:'POST', body:'{}' });
      message(action === 'prepare-account' ? 'Cuenta preparada.' : 'Cuenta enviada a Caja.');
      await Promise.all([refreshTables({ allowSelectionRefresh:false }), refreshSelectedDetails({ quiet:true })]);
    } catch (error) { message(error.message, true); }
  }

  function printPrecheck() {
    const table = selectedTable();
    const zone = selectedZone();
    const service = serviceData(table);
    if (!table || !service) return;
    const popup = window.open('', '_blank', 'width=520,height=760');
    if (!popup) { message('Permite ventanas emergentes para imprimir la pre-cuenta.', true); return; }
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pre-cuenta · ${esc(table.name)}</title><style>body{font-family:Arial,sans-serif;padding:20px;color:#111}h1{margin:0}.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #ddd}.total{font-size:20px;font-weight:700}</style></head><body><small>VantixGC Restaurante · PRE-CUENTA NO FISCAL</small><h1>${esc(table.name)}</h1><p>${esc(zone?.name || '')}</p>${orderItems(service).map((item)=>`<div class="row"><span>${esc(item.quantity)}× ${esc(item.description)}</span><span>${money(item.lineTotal)}</span></div>`).join('')}<div class="row total"><span>Total</span><span>${money(service.total)}</span></div><button onclick="print()">Imprimir</button></body></html>`);
    popup.document.close();
  }

  function openOrder() { document.documentElement.classList.add('wv-order-open'); }
  function closeOrder() { document.documentElement.classList.remove('wv-order-open'); }
  backdrop?.addEventListener('click', closeOrder);

  function schedulePoll(delay = POLL_MS) {
    if (S.pollTimer) clearTimeout(S.pollTimer);
    S.pollTimer = setTimeout(pollTick, delay);
  }

  async function pollTick() {
    if (S.destroyed) return;
    try {
      const idle = Date.now() - S.lastInteraction;
      if (!document.hidden && navigator.onLine !== false && idle >= IDLE_BEFORE_POLL_MS && !S.mutationCount && !S.qtyJobs.size) {
        const tableBefore = selectedTable();
        const sessionBefore = tableBefore?.activeSession?.id;
        await refreshTables({ allowSelectionRefresh:true });
        const current = selectedTable();
        if (sessionBefore && current?.activeSession?.id === sessionBefore) await refreshSelectedDetails({ quiet:true });
      }
    } finally { schedulePoll(POLL_MS); }
  }

  let searchTimer = null;
  app?.addEventListener('input', (event) => {
    if (event.target.id !== 'wvSearch') return;
    touch();
    S.search = event.target.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.menuLimit = MENU_PAGE; renderMenuGrid(); }, 90);
  });

  app?.addEventListener('change', (event) => {
    touch();
    if (event.target.id === 'wvZone') {
      S.selectedZoneId = event.target.value;
      S.selectedTableId = S.tables.find((x) => x.zoneId === S.selectedZoneId)?.id || null;
      S.seat = 1;
      S.menuLimit = MENU_PAGE;
      renderTables();
      selectCurrentTable({ showLoader:false }).catch((error) => message(error.message, true));
      return;
    }
    if (event.target.matches('[data-move]')) {
      updateItem(event.target.dataset.move, { seatNumber:Number(event.target.value) }, 'Producto movido de persona.');
    }
  });

  app?.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    touch();
    if (target.dataset.table) {
      if (target.dataset.table === S.selectedTableId) return;
      S.selectedTableId = target.dataset.table;
      S.seat = 1;
      S.menuLimit = MENU_PAGE;
      renderTables();
      selectCurrentTable({ showLoader:false }).catch((error) => message(error.message, true));
      return;
    }
    if (target.dataset.category) {
      S.category = target.dataset.category;
      S.menuLimit = MENU_PAGE;
      renderTabs();
      renderMenuGrid();
      return;
    }
    if (target.dataset.seat) {
      S.seat = Number(target.dataset.seat);
      renderServiceBar();
      updateQuantitiesInDom();
      return;
    }
    if (target.dataset.billing) {
      if (target.dataset.billing === billingMode()) return;
      updateService({ billingMode:target.dataset.billing }, 'Modo de cuenta actualizado.');
      return;
    }
    if (target.dataset.openMode) {
      document.querySelectorAll('[data-open-mode]').forEach((button) => button.classList.toggle('primary', button === target));
      return;
    }
    if (target.dataset.qtyDelta) {
      const card = target.closest('[data-menu-item]');
      if (card) adjustQty(card, Number(target.dataset.qtyDelta));
      return;
    }
    if (target.dataset.note) {
      const item = orderItems(serviceData(selectedTable())).find((x) => x.id === target.dataset.note);
      const notes = prompt('Nota para cocina / barra', item?.notes || '');
      if (notes !== null) updateItem(target.dataset.note, { notes }, 'Nota guardada.');
      return;
    }
    const action = target.dataset.action;
    if (!action) return;
    if (action === 'reload') return location.reload();
    if (action === 'open-table') return openTable();
    if (action === 'add-person') return updateService({ guestCount:guestCount() + 1 }, `Persona ${guestCount() + 1} agregada.`);
    if (action === 'more-menu') { S.menuLimit += MENU_PAGE; return renderMenuGrid(); }
    if (action === 'send-draft') return sendDraft();
    if (action === 'prepare-account' || action === 'send-cash') return tableAction(action);
    if (action === 'print-precheck') return printPrecheck();
    if (action === 'close-order') return closeOrder();
  });

  document.addEventListener('click', (event) => {
    if (event.target?.id === 'wvOrderToggle') { touch(); openOrder(); }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { touch(); schedulePoll(400); }
  });

  async function bootstrap() {
    if (!session?.token || !session?.subdomain) {
      showFatal('Este dispositivo no está vinculado', 'Genera un QR nuevo desde Empleados y escanéalo desde este mismo navegador.');
      return;
    }
    try {
      const [context, zones, tables, menu] = await Promise.all([
        api('/api/v1/restaurante/ui-context'),
        api('/api/v1/restaurante/zonas'),
        api('/api/v1/restaurante/mesas'),
        api('/api/v1/restaurante/menu')
      ]);
      S.context = context;
      S.zones = Array.isArray(zones) ? zones : [];
      S.tables = Array.isArray(tables) ? tables : [];
      S.menu = Array.isArray(menu) ? menu : [];
      window.RestaurantTheme?.apply?.(context?.theme || {});
      const restaurant = document.querySelector('#wvRestaurant');
      const user = document.querySelector('#wvUser');
      if (restaurant) restaurant.textContent = context?.theme?.restaurantName || session.tenant?.nombreEmpresa || 'Restaurante';
      if (user) user.textContent = context?.user?.nombre || 'Mesero';
      preferredInitialSelection();
      renderShell();
      await selectCurrentTable({ showLoader:false });
      schedulePoll(POLL_MS);
      document.documentElement.dataset.waiterRuntime = 'v7-dedicated';
    } catch (error) {
      showFatal(error.fatal ? 'Dispositivo no vinculado' : 'No se pudo cargar Mesero', error.message || 'Reintenta en unos segundos.');
    }
  }

  window.addEventListener('beforeunload', () => { S.destroyed = true; if (S.pollTimer) clearTimeout(S.pollTimer); if (S.detailRefreshTimer) clearTimeout(S.detailRefreshTimer); });
  window.VantixGCWaiterV7 = Object.freeze({ marker:MARKER, version:'7.0.0', runtime:'DEDICATED_PARTIAL_DOM_OPTIMISTIC' });
  bootstrap();
})();
