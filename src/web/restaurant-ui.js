(() => {
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const SHIFT_KEY = 'restaurant_cash_shift';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session) { location.replace('/app'); return; }

  const S = {
    context: null,
    tab: null,
    zones: [],
    tables: [],
    menu: [],
    commands: [],
    orders: [],
    selectedZoneId: null,
    selectedTableId: null,
    waiterSeat: 1,
    waiterCategory: 'ENTRADAS',
    waiterSearch: '',
    salonView: localStorage.getItem('restaurant_salon_view_v2') === 'LISTA' ? 'LISTA' : 'PLANO',
    salonEdit: false,
    kdsFilter: 'ALL',
    kdsZone: 'ALL',
    kdsWaiter: 'ALL',
    kdsSearch: '',
    kdsSoundEnabled: localStorage.getItem('restaurant_kds_sound_v1') !== 'off',
    kdsKnownIds: new Set(),
    draft: null,
    cashShiftId: localStorage.getItem(SHIFT_KEY) || null,
    cashMetric: null,
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
    { id:'estado', kicker:'05', label:'Estado', allowed:() => can('RESTAURANTE.ADMINISTRAR') }
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
    if (tab !== 'caja') S.cashMetric = null;
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

  async function loadZones() {
    S.zones = await api('/api/v1/restaurante/zonas');
    if (!Array.isArray(S.zones)) S.zones = [];
    if (!S.selectedZoneId || !S.zones.some((zone) => zone.id === S.selectedZoneId)) S.selectedZoneId = S.zones[0]?.id || null;
    return S.zones;
  }
  async function loadTables() {
    S.tables = await api('/api/v1/restaurante/mesas');
    if (!S.selectedTableId || !S.tables.some((x) => x.id === S.selectedTableId)) S.selectedTableId = S.tables[0]?.id || null;
    return S.tables;
  }
  async function loadMenu() { S.menu = await api('/api/v1/restaurante/menu'); return S.menu; }
  function selectedZone() { return S.zones.find((zone) => zone.id === S.selectedZoneId) || null; }
  function selectedTable() { return S.tables.find((x) => x.id === S.selectedTableId) || null; }
  function tablesInSelectedZone() { return S.tables.filter((table) => table.zoneId === S.selectedZoneId); }

  function salonStateLabel(state) { return String(state || 'LIBRE').replaceAll('_', ' '); }
  function salonTableAge(table) {
    const opened = table.activeSession?.openedAt ? new Date(table.activeSession.openedAt).getTime() : 0;
    if (!opened) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - opened) / 60000));
    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }
  function salonStats(rows) {
    const count = (state) => rows.filter((row) => row.state === state).length;
    return { total:rows.length, free:count('LIBRE'), occupied:count('OCUPADA'), bill:count('CUENTA_PEDIDA'), reserved:count('RESERVADA') };
  }
  function tableTicket(table) {
    const active = table.activeSession;
    const sale = active?.sale;
    const age = salonTableAge(table);
    const edit = Boolean(S.salonEdit && can('RESTAURANTE.ADMINISTRAR'));
    const openAction = !edit && !active && can('MESAS.CREAR') ? `<button class="ri-btn small primary" data-open-table="${table.id}">Abrir mesa</button>` : '';
    const selectAction = !edit && active && can('PEDIDOS.CREAR') ? `<button class="ri-btn small primary" data-select-table="${table.id}">${table.state === 'CUENTA_PEDIDA' ? 'Ver cuenta' : 'Tomar pedido'}</button>` : '';
    const removeAction = edit ? `<button class="ri-btn small danger" data-remove-table="${table.id}">Retirar</button>` : '';
    return `<article class="salon-table ${table.state} ${edit ? 'edit-mode' : ''}" data-table="${table.id}" style="left:${Number(table.posX)}px;top:${Number(table.posY)}px;width:${Math.max(Number(table.width),150)}px;height:${Math.max(Number(table.height),120)}px">
      <div class="salon-table-top"><span class="salon-table-state">${esc(salonStateLabel(table.state))}</span>${edit ? '<span class="salon-drag-hint">Mover</span>' : ''}</div>
      <div class="salon-table-name">${esc(table.name)}</div>
      <div class="salon-table-main">${sale ? `<strong>${money(sale.total)}</strong><span>${age || esc(sale.estado)}</span>` : `<strong>${table.seats}</strong><span>puestos</span>`}</div>
      <div class="salon-table-actions">${openAction}${selectAction}${removeAction}</div>
    </article>`;
  }
  function salonListRow(table) {
    const active = table.activeSession;
    const sale = active?.sale;
    const edit = Boolean(S.salonEdit && can('RESTAURANTE.ADMINISTRAR'));
    return `<article class="salon-list-row ${table.state}"><div class="salon-list-main"><span class="salon-table-state">${esc(salonStateLabel(table.state))}</span><b>${esc(table.name)}</b><small>${table.seats} puestos${salonTableAge(table) ? ` · ${salonTableAge(table)}` : ''}</small></div><strong>${sale ? money(sale.total) : '—'}</strong><div class="salon-list-actions">${!edit && !active && can('MESAS.CREAR') ? `<button class="ri-btn small primary" data-open-table="${table.id}">Abrir</button>` : ''}${!edit && active && can('PEDIDOS.CREAR') ? `<button class="ri-btn small primary" data-select-table="${table.id}">Pedido</button>` : ''}${edit ? `<button class="ri-btn small danger" data-remove-table="${table.id}">Retirar</button>` : ''}</div></article>`;
  }
  function ensureSalonDialog(id, className = 'salon-dialog') {
    let dialog = document.getElementById(id);
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = id;
      dialog.className = `ri-card ${className}`;
      document.body.appendChild(dialog);
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close?.(); });
    }
    return dialog;
  }
  function openDialog(dialog) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open',''); }
  function restaurantDisplayName() { return S.context?.theme?.restaurantName || S.context?.restaurantName || session.tenant?.nombreEmpresa || 'Restaurante'; }

  async function renderSalon(fromPoll = false) {
    if (S.dragging && fromPoll) return;
    await loadZones();
    await loadTables();
    const zone = selectedZone();
    const zoneTables = tablesInSelectedZone();
    const admin = can('RESTAURANTE.ADMINISTRAR');
    const stats = salonStats(zoneTables);
    if (!S.selectedTableId || !zoneTables.some((row) => row.id === S.selectedTableId)) S.selectedTableId = zoneTables[0]?.id || null;
    const zonesMarkup = S.zones.map((row) => `<button type="button" class="salon-zone-tab ${row.id === S.selectedZoneId ? 'active' : ''}" data-zone-id="${row.id}"><b>${esc(row.name)}</b><span>${row.tableCount || 0}</span></button>`).join('');
    const body = zone ? (S.salonView === 'LISTA'
      ? `<div class="salon-list">${zoneTables.map(salonListRow).join('') || '<div class="salon-empty"><b>Esta zona no tiene mesas</b><span>Agrega la primera mesa para empezar a operar.</span></div>'}</div>`
      : `<div class="salon-floor ${S.salonEdit ? 'editing' : ''}" id="floor">${zoneTables.map(tableTicket).join('') || '<div class="salon-empty"><b>Esta zona no tiene mesas</b><span>Agrega la primera mesa para empezar a operar.</span></div>'}</div>`)
      : '<div class="salon-empty"><b>No hay zonas disponibles</b><span>Crea una zona para organizar el salón.</span></div>';
    $('#view').innerHTML = `<section class="salon-shell">
      <header class="salon-head"><div><div class="ri-eyebrow">OPERACIÓN DEL SALÓN</div><h1 class="ri-title">Mesas</h1><p class="ri-muted">Opera el servicio; la edición del plano permanece separada para evitar movimientos accidentales.</p></div><div class="salon-head-actions"><div class="salon-view-toggle"><button type="button" class="${S.salonView === 'PLANO' ? 'active' : ''}" data-salon-view="PLANO">Plano</button><button type="button" class="${S.salonView === 'LISTA' ? 'active' : ''}" data-salon-view="LISTA">Lista</button></div>${admin ? '<button type="button" class="ri-btn" id="manageZones">Gestionar zonas</button>' : ''}<button type="button" class="ri-btn" id="manageQr">Gestionar QR</button>${admin && zone ? '<button type="button" class="ri-btn primary" id="addTable">+ Mesa</button><button type="button" class="ri-btn secondary" id="toggleSalonEdit">'+(S.salonEdit ? 'Terminar edición' : 'Editar plano')+'</button>' : ''}</div></header>
      <nav class="salon-zone-tabs">${zonesMarkup || '<span class="ri-muted">Sin zonas</span>'}</nav>
      ${zone ? `<section class="salon-zone-summary"><div><small>Zona activa</small><b>${esc(zone.name)}</b></div><div><small>Mesas</small><b>${stats.total}</b></div><div class="free"><small>Libres</small><b>${stats.free}</b></div><div class="occupied"><small>Ocupadas</small><b>${stats.occupied}</b></div><div class="bill"><small>Cuenta pedida</small><b>${stats.bill}</b></div>${stats.reserved ? `<div><small>Reservadas</small><b>${stats.reserved}</b></div>` : ''}</section>` : ''}
      ${S.salonEdit ? '<div class="salon-edit-notice">Modo edición activo: ahora puedes mover o retirar mesas. Las acciones de servicio están temporalmente bloqueadas.</div>' : ''}
      ${body}
    </section>`;
    bindSalon();
    if (!fromPoll) {
      stopPoll();
      S.poll = setInterval(() => { if (S.tab === 'salon' && !S.salonEdit) renderSalon(true).catch(() => {}); }, S.context.polling.floorMs || 3000);
    }
  }

  function bindSalon() {
    $('#addTable')?.addEventListener('click', addTable);
    $('#manageZones')?.addEventListener('click', openZoneManager);
    $('#manageQr')?.addEventListener('click', openQrManager);
    $('#toggleSalonEdit')?.addEventListener('click', () => { S.salonEdit = !S.salonEdit; renderSalon().catch((error) => message(error.message, true)); });
    $$('[data-salon-view]').forEach((button) => button.addEventListener('click', () => { S.salonView = button.dataset.salonView; localStorage.setItem('restaurant_salon_view_v2', S.salonView); renderSalon().catch((error) => message(error.message, true)); }));
    $$('[data-zone-id]').forEach((button) => button.addEventListener('click', () => {
      S.selectedZoneId = button.dataset.zoneId;
      S.salonEdit = false;
      const first = S.tables.find((table) => table.zoneId === S.selectedZoneId);
      S.selectedTableId = first?.id || null;
      renderSalon().catch((error) => message(error.message, true));
    }));
    $$('[data-open-table]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openTable(b.dataset.openTable); }));
    $$('[data-select-table]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); S.selectedTableId = b.dataset.selectTable; setTab('mesero'); }));
    $$('[data-remove-table]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); removeTable(b.dataset.removeTable); }));
    if (S.salonEdit && can('RESTAURANTE.ADMINISTRAR') && S.salonView === 'PLANO' && matchMedia('(min-width:641px)').matches) bindTableDrag();
  }

  async function openZoneManager() {
    const dialog = ensureSalonDialog('salonZoneDialog');
    const rows = S.zones.map((zone) => `<div class="salon-manager-row"><div><b>${esc(zone.name)}</b><small>${zone.tableCount || 0} mesa(s)</small></div><div class="ri-actions"><button type="button" class="ri-btn small" data-zone-rename="${zone.id}">Renombrar</button>${zone.tableCount === 0 && S.zones.length > 1 ? `<button type="button" class="ri-btn small danger" data-zone-remove="${zone.id}">Eliminar</button>` : ''}</div></div>`).join('');
    dialog.innerHTML = `<div class="salon-dialog-head"><div><div class="ri-eyebrow">Organización</div><h2>Gestionar zonas</h2><p class="ri-muted">Las zonas organizan el plano; no forman parte del trabajo diario del mesero.</p></div><button type="button" class="ri-btn" data-dialog-close>Cerrar</button></div><div class="salon-manager-list">${rows}</div><button type="button" class="ri-btn primary" id="dialogAddZone">+ Crear zona</button>`;
    dialog.querySelector('[data-dialog-close]')?.addEventListener('click', () => dialog.close?.());
    dialog.querySelector('#dialogAddZone')?.addEventListener('click', async () => { await addZone(); dialog.close?.(); });
    dialog.querySelectorAll('[data-zone-rename]').forEach((button) => button.addEventListener('click', async () => { S.selectedZoneId = button.dataset.zoneRename; await renameZone(); dialog.close?.(); }));
    dialog.querySelectorAll('[data-zone-remove]').forEach((button) => button.addEventListener('click', async () => { S.selectedZoneId = button.dataset.zoneRemove; await removeZone(); dialog.close?.(); }));
    openDialog(dialog);
  }

  async function addZone() {
    const name = prompt('Nombre de la nueva zona, por ejemplo Terraza');
    if (!name?.trim()) return;
    try {
      const zone = await api('/api/v1/restaurante/zonas', { method:'POST', body:JSON.stringify({ name:name.trim() }) });
      S.selectedZoneId = zone.id;
      S.salonEdit = false;
      message(`Zona “${zone.name}” creada.`);
      await renderSalon();
    } catch (error) { message(error.message, true); }
  }

  async function renameZone() {
    const zone = selectedZone();
    if (!zone) return;
    const name = prompt('Nuevo nombre de la zona', zone.name);
    if (!name?.trim() || name.trim() === zone.name) return;
    try {
      const saved = await api(`/api/v1/restaurante/zonas/${zone.id}`, { method:'PATCH', body:JSON.stringify({ name:name.trim() }) });
      message(`Zona renombrada a “${saved.name}”.`);
      await renderSalon();
    } catch (error) { message(error.message, true); }
  }

  async function removeZone() {
    const zone = selectedZone();
    if (!zone || !confirm(`¿Eliminar la zona “${zone.name}”? Solo se permite si no tiene mesas.`)) return;
    try {
      await api(`/api/v1/restaurante/zonas/${zone.id}`, { method:'DELETE' });
      S.selectedZoneId = null;
      message('Zona retirada.');
      await renderSalon();
    } catch (error) { message(error.message, true); }
  }

  async function addTable() {
    const zone = selectedZone();
    if (!zone) { message('Selecciona o crea una zona antes de agregar una mesa.', true); return; }
    const code = prompt('Código de mesa, por ejemplo M7');
    if (!code) return;
    const name = prompt('Nombre visible', `Mesa ${code.replace(/\D/g, '') || code}`) || code;
    try {
      await api('/api/v1/restaurante/mesas', { method:'POST', body:JSON.stringify({ code, name, zoneId:zone.id, seats:4, posX:30, posY:30, width:170, height:135 }) });
      message(`Mesa creada dentro de ${zone.name}.`);
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
    if (!S.salonEdit || !confirm('¿Retirar esta mesa del plano?')) return;
    try { await api(`/api/v1/restaurante/mesas/${id}`, { method:'DELETE' }); await renderSalon(); } catch (error) { message(error.message, true); }
  }

  function qrPrintHtml(rows, title) {
    const cards = rows.map((row) => `<article class="qr-print-card"><div class="qr-print-brand">${esc(restaurantDisplayName())}</div><h2>${esc(row.tableName)}</h2><p>${esc(row.zoneName)}</p><div class="qr-print-code">${row.svg}</div><h3>Escanea para ver la carta y pedir</h3><p>Puedes usar tus datos móviles o el Wi-Fi del restaurante.</p><small>${esc(row.url)}</small></article>`).join('');
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title><link rel="stylesheet" href="/app/restaurant-control-center.css?v=workspace-v8-salon"></head><body class="qr-print-body"><main class="qr-print-grid">${cards}</main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150));<\/script></body></html>`;
  }
  function printQrRows(rows, title) {
    if (!rows?.length) return message('No hay mesas para imprimir.', true);
    const popup = window.open('', '_blank', 'width=900,height=760');
    if (!popup) return message('El navegador bloqueó la ventana de impresión.', true);
    popup.document.write(qrPrintHtml(rows, title));
    popup.document.close();
  }
  async function showQr(id) {
    try {
      const material = await api(`/api/v1/restaurante/mesas/${id}/qr`);
      const dialog = ensureSalonDialog('salonQrDetailDialog', 'salon-dialog qr-detail-dialog');
      dialog.innerHTML = `<div class="salon-dialog-head"><div><div class="ri-eyebrow">Autopedido QR</div><h2>${esc(material.tableName)}</h2><p class="ri-muted">${esc(material.zoneName)} · URL pública canónica</p></div><button type="button" class="ri-btn" data-dialog-close>Cerrar</button></div><div class="qr-detail-code">${material.svg}</div><div class="qr-public-url">${esc(material.url)}</div><p class="ri-muted">Este QR no contiene IP, contraseña Wi-Fi ni identificadores internos. Funciona con datos móviles o Wi-Fi siempre que haya acceso a la URL pública.</p><div class="ri-actions"><button type="button" class="ri-btn" data-copy-qr>Copiar enlace</button><button type="button" class="ri-btn" data-open-qr>Abrir como cliente</button><button type="button" class="ri-btn primary" data-print-qr>Imprimir QR</button>${can('RESTAURANTE.ADMINISTRAR') ? '<button type="button" class="ri-btn danger" data-regenerate-qr>Regenerar QR</button>' : ''}</div>`;
      dialog.querySelector('[data-dialog-close]')?.addEventListener('click', () => dialog.close?.());
      dialog.querySelector('[data-copy-qr]')?.addEventListener('click', () => navigator.clipboard?.writeText(material.url));
      dialog.querySelector('[data-open-qr]')?.addEventListener('click', () => window.open(material.url, '_blank', 'noopener'));
      dialog.querySelector('[data-print-qr]')?.addEventListener('click', () => printQrRows([material], `QR ${material.tableName}`));
      dialog.querySelector('[data-regenerate-qr]')?.addEventListener('click', async () => { dialog.close?.(); await regenerateQr(id); });
      openDialog(dialog);
    } catch (error) { message(error.message, true); }
  }
  async function regenerateQr(id) {
    if (!can('RESTAURANTE.ADMINISTRAR') || !confirm('¿Regenerar este QR? El QR anterior dejará de funcionar inmediatamente.')) return;
    try {
      const material = await api(`/api/v1/restaurante/mesas/${id}/qr/regenerar`, { method:'POST', body:'{}' });
      message(`QR de ${material.tableName} regenerado. El enlace anterior quedó invalidado.`);
      await loadTables();
      await showQr(id);
    } catch (error) { message(error.message, true); }
  }
  async function openQrManager() {
    const zone = selectedZone();
    const rows = tablesInSelectedZone();
    const admin = can('RESTAURANTE.ADMINISTRAR');
    const dialog = ensureSalonDialog('salonQrManagerDialog', 'salon-dialog qr-manager-dialog');
    dialog.innerHTML = `<div class="salon-dialog-head"><div><div class="ri-eyebrow">Autopedido</div><h2>Gestionar QR</h2><p class="ri-muted">Los QR impresos usan siempre la URL pública canónica, nunca la IP del computador o del Edge.</p></div><button type="button" class="ri-btn" data-dialog-close>Cerrar</button></div><div class="qr-manager-note"><b>Conectividad</b><span>El mismo QR sirve con datos móviles o Wi-Fi. La continuidad por Wi-Fi sin Internet requiere Edge y resolución DNS local del establecimiento.</span></div><div class="salon-manager-list">${rows.map((table) => `<div class="salon-manager-row"><div><b>${esc(table.name)}</b><small>${esc(zone?.name || 'Sin zona')} · ${esc(salonStateLabel(table.state))}</small></div><div class="ri-actions"><button type="button" class="ri-btn small" data-qr-view="${table.id}">Ver / imprimir</button>${admin ? `<button type="button" class="ri-btn small danger" data-qr-regenerate="${table.id}">Regenerar</button>` : ''}</div></div>`).join('') || '<div class="salon-empty"><b>Sin mesas en esta zona</b></div>'}</div>${admin ? `<div class="ri-actions"><button type="button" class="ri-btn primary" id="printZoneQrs" ${!zone || !rows.length ? 'disabled' : ''}>Imprimir QR de esta zona</button><button type="button" class="ri-btn" id="printAllQrs">Imprimir todos los QR</button></div>` : ''}`;
    dialog.querySelector('[data-dialog-close]')?.addEventListener('click', () => dialog.close?.());
    dialog.querySelectorAll('[data-qr-view]').forEach((button) => button.addEventListener('click', async () => { dialog.close?.(); await showQr(button.dataset.qrView); }));
    dialog.querySelectorAll('[data-qr-regenerate]').forEach((button) => button.addEventListener('click', async () => { dialog.close?.(); await regenerateQr(button.dataset.qrRegenerate); }));
    dialog.querySelector('#printZoneQrs')?.addEventListener('click', async () => { try { const materials = await api(`/api/v1/restaurante/zonas/${zone.id}/qrs`); printQrRows(materials, `QR · ${zone.name}`); } catch (error) { message(error.message, true); } });
    dialog.querySelector('#printAllQrs')?.addEventListener('click', async () => { try { const materials = await api('/api/v1/restaurante/qrs'); printQrRows(materials, 'QR · Todas las mesas'); } catch (error) { message(error.message, true); } });
    openDialog(dialog);
  }

  function bindTableDrag() {
    $$('.salon-table.edit-mode').forEach((el) => {
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

  function draftQty(menuItemId, seatNumber = null) {
    const mode = S.draft?.service?.billingMode || S.draft?.session?.billingMode || 'CONJUNTA';
    const targetSeat = mode === 'INDIVIDUAL' ? Number(seatNumber || S.waiterSeat || 1) : null;
    const item = S.draft?.order?.items?.find((x) => x.menuItemId === menuItemId && (mode !== 'INDIVIDUAL' ? x.seatNumber == null : Number(x.seatNumber || 0) === targetSeat));
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

  function waiterElapsed(value) {
    const stamp = new Date(value || 0).getTime();
    if (!stamp) return '—';
    const minutes = Math.max(0, Math.floor((Date.now() - stamp) / 60000));
    if (minutes < 1) return 'ahora';
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  function waiterTableChip(table) {
    const selected = table.id === S.selectedTableId;
    const state = String(table.state || 'LIBRE');
    const people = Number(table.activeSession?.guestCount || 0);
    const meta = state === 'LIBRE' ? 'Libre' : state === 'CUENTA_PEDIDA' ? 'Cuenta pedida' : `${state.replaceAll('_',' ')}${people ? ` · ${people} pers.` : ''}`;
    return `<button type="button" class="waiter-table-chip ${selected ? 'selected' : ''} ${state}" data-waiter-table="${table.id}"><b>${esc(table.name)}</b><span>${esc(meta)}</span></button>`;
  }

  function waiterServiceGroups(service) {
    if (!service) return [];
    if (service.billingMode === 'INDIVIDUAL') return service.seats || [];
    return [{ seatNumber:null, label:'Cuenta conjunta', items:service.allItems || [], total:service.total || 0 }];
  }

  function waiterStage(service, draftItems, sentOrders) {
    if (draftItems.length) return { step:1, label:'Por enviar' };
    if (!sentOrders.length) return { step:0, label:'Borrador' };
    const states = sentOrders.map(waiterOrderStatus);
    if (states.some((row) => row.key === 'LISTA')) return { step:3, label:'Listo' };
    if (states.some((row) => ['PENDIENTE','PREPARACION','PARCIAL'].includes(row.key))) return { step:2, label:'En cocina' };
    return { step:2, label:'En cocina' };
  }

  function waiterProgressMarkup(stage) {
    const labels = ['Borrador','Por enviar','En cocina','Listo'];
    return `<div class="waiter-progress">${labels.map((label, index) => `<span class="${index <= stage.step ? 'done' : ''} ${index === stage.step ? 'active' : ''}"><i></i>${label}</span>`).join('')}</div>`;
  }

  function waiterItemRow(item, service, activeSessionId) {
    const sent = item.orderState !== 'BORRADOR';
    const seat = Number(item.seatNumber || 0);
    const seatOptions = service?.billingMode === 'INDIVIDUAL'
      ? (service.seats || []).map((row) => `<option value="${row.seatNumber}" ${row.seatNumber === seat ? 'selected' : ''}>Persona ${row.seatNumber}</option>`).join('')
      : '';
    return `<div class="waiter-item-row"><div class="waiter-item-copy"><b>${esc(item.quantity)}× ${esc(item.description)}</b><small>${esc(item.station)} · ${sent ? 'Enviado' : 'Por enviar'}${item.notes ? ` · ${esc(item.notes)}` : ''}</small></div><strong>${money(item.lineTotal)}</strong>${service?.billingMode === 'INDIVIDUAL' ? `<select class="ri-select waiter-move-select" data-waiter-move="${item.id}" data-session="${activeSessionId}">${seatOptions}</select>` : ''}${!sent ? `<button type="button" class="ri-btn small" data-waiter-note="${item.id}" data-session="${activeSessionId}" data-current-note="${esc(item.notes || '')}">Nota</button>` : ''}</div>`;
  }

  function waiterGroupMarkup(group, service, activeSessionId) {
    const selected = service.billingMode === 'INDIVIDUAL' && Number(group.seatNumber) === Number(S.waiterSeat || 1);
    return `<section class="waiter-person-order ${selected ? 'selected' : ''}"><div class="waiter-person-head"><div><b>${esc(group.label || 'Cuenta')}</b>${selected ? '<span>Seleccionada</span>' : ''}</div><strong>${money(group.total)}</strong></div>${(group.items || []).length ? group.items.map((item) => waiterItemRow(item, service, activeSessionId)).join('') : '<div class="empty-ticket">Sin productos todavía.</div>'}</section>`;
  }

  function waiterPrecheckHtml(table, zone, service) {
  const groups = waiterServiceGroups(service);
  const theme = JSON.stringify(S.context?.theme || {}).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pre-cuenta · ${esc(table.name)}</title><link rel="stylesheet" href="/app/restaurant-theme.css?v=la-riel-v1"><link rel="stylesheet" href="/app/restaurant-control-center.css?v=workspace-v6"><script src="/app/restaurant-theme.js?v=panel-font-v1"><\/script></head><body><main class="qr-shell"><article class="receipt"><div class="receipt-head"><small>VantixGC Restaurante · PRE-CUENTA NO FISCAL</small><h1>${esc(table.name)}</h1><div class="ri-muted">${esc(zone?.name || 'Zona')} · ${service.billingMode === 'INDIVIDUAL' ? 'Cuenta individual' : 'Cuenta conjunta'} · ${service.guestCount} persona(s)</div></div>${groups.map((group) => `<section class="receipt"><div class="receipt-head"><b>${esc(group.label)}</b></div>${(group.items || []).map((item) => `<div class="receipt-row"><span>${esc(item.quantity)}× ${esc(item.description)}</span><span>${money(item.lineTotal)}</span></div>`).join('')}<div class="receipt-row total"><span>Subtotal</span><b>${money(group.total)}</b></div></section>`).join('')}<div class="receipt-row total"><span>Total mesa</span><b>${money(service.total)}</b></div><button class="ri-btn primary no-print" onclick="print()">Imprimir</button></article></main><script>RestaurantTheme.apply(${theme});<\/script></body></html>`;
}

  async function renderWaiter() {
    await Promise.all([loadZones(), loadTables(), loadMenu()]);
    let table = selectedTable();
    if (table?.zoneId) S.selectedZoneId = table.zoneId;
    if (!S.selectedZoneId) S.selectedZoneId = S.zones[0]?.id || null;
    let zoneTables = tablesInSelectedZone();
    if (!table || table.zoneId !== S.selectedZoneId) {
      table = zoneTables[0] || null;
      S.selectedTableId = table?.id || null;
    }
    const zone = selectedZone();
    const active = table?.activeSession;
    if (active) await Promise.all([loadWaiterDraft(active.id), loadSessionOrders(active.id)]);
    else { S.draft = null; S.orders = []; }

    const service = S.draft?.service || (active ? {
      billingMode:active.billingMode || 'CONJUNTA', guestCount:Number(active.guestCount || 1), allItems:[], seats:[], total:active.sale?.total || 0,
      accountPreparedAt:active.accountPreparedAt || null, cashierRequestedAt:active.cashierRequestedAt || null
    } : null);
    const billingMode = service?.billingMode || 'CONJUNTA';
    const guestCount = Math.max(Number(service?.guestCount || active?.guestCount || 1), 1);
    if (!S.waiterSeat || S.waiterSeat > guestCount) S.waiterSeat = 1;
    const draftItems = S.draft?.order?.items || [];
    const sentOrders = S.orders.filter((row) => !['BORRADOR','CANCELADO'].includes(String(row.state || '').toUpperCase()));
    const allItems = service?.allItems || [];
    const hasConsumption = allItems.length > 0;
    const stage = waiterStage(service, draftItems, sentOrders);
    const search = String(S.waiterSearch || '').trim().toLocaleLowerCase('es');
    const category = S.waiterCategory || 'ENTRADAS';
    const visibleMenu = S.menu.filter((item) => item.category === category && (!search || String(item.product?.nombre || '').toLocaleLowerCase('es').includes(search)));
    const canEditService = active && can('MESAS.EDITAR');
    const prepared = Boolean(service?.accountPreparedAt);
    const sentToCash = Boolean(service?.cashierRequestedAt || table?.state === 'CUENTA_PEDIDA');

    const top = `<section class="ri-card waiter-top-card"><div class="waiter-title-row"><div><div class="ri-eyebrow">Toma de pedido</div><h1 class="ri-title">Panel del mesero</h1><p class="ri-muted">Zona → mesa → cuenta → personas → pedido → cocina → caja.</p></div><div class="waiter-user-badge"><small>Mesero</small><b>${esc(S.context.user.nombre || 'Usuario')}</b></div></div><div class="waiter-zone-row"><label class="ri-label">Zona<select id="waiterZone" class="ri-select">${S.zones.map((row) => `<option value="${row.id}" ${row.id === S.selectedZoneId ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></label><div class="waiter-table-strip">${zoneTables.map(waiterTableChip).join('') || '<div class="empty-ticket">Esta zona no tiene mesas visibles.</div>'}</div>${table ? `<div class="waiter-table-summary"><small>Mesa seleccionada</small><b>${esc(table.name)}</b><span>${active ? `${guestCount} persona(s) · ${waiterElapsed(active.openedAt)}` : 'Libre'}</span></div>` : ''}</div></section>`;

    if (!table) {
      $('#view').innerHTML = `${top}<section class="ri-card"><div class="empty-ticket">Selecciona una zona con mesas para comenzar.</div></section>`;
      bindWaiterTop();
      return;
    }

    if (!active) {
      $('#view').innerHTML = `${top}<section class="ri-card waiter-open-card"><div><div class="ri-eyebrow">${esc(zone?.name || 'Zona')} · ${esc(table.name)}</div><h2>Abrir mesa</h2><p class="ri-muted">Define desde el inicio cuántas personas hay y cómo quieren manejar la cuenta.</p></div><div class="waiter-open-grid"><label class="ri-label">Personas<input id="waiterOpenGuests" class="ri-input" type="number" min="1" max="50" value="1"></label><div><div class="ri-label">Modo de cuenta</div><div class="waiter-mode-buttons"><button type="button" class="ri-btn primary" data-open-mode="CONJUNTA">Cuenta conjunta</button><button type="button" class="ri-btn" data-open-mode="INDIVIDUAL">Cuenta individual</button></div></div><button type="button" class="ri-btn primary waiter-open-action" id="waiterOpenTable">Abrir ${esc(table.name)}</button></div></section>`;
      bindWaiterTop();
      $$('[data-open-mode]').forEach((button) => button.addEventListener('click', () => { $$('[data-open-mode]').forEach((row) => row.classList.toggle('primary', row === button)); }));
      $('#waiterOpenTable')?.addEventListener('click', async () => {
        const mode = $('[data-open-mode].primary')?.dataset.openMode || 'CONJUNTA';
        const people = Math.max(1, Math.min(50, Number($('#waiterOpenGuests')?.value || 1)));
        try {
          const result = await api(`/api/v1/restaurante/mesas/${table.id}/abrir`, { method:'POST', body:JSON.stringify({ guestCount:people, billingMode:mode }) });
          message(`${table.name} abierta · ${mode === 'INDIVIDUAL' ? 'cuenta individual' : 'cuenta conjunta'} · ${people} persona(s).`);
          S.waiterSeat = 1;
          await renderWaiter();
        } catch (error) { message(error.message, true); }
      });
      return;
    }

    const modeButtons = `<div class="waiter-mode-buttons"><button type="button" class="ri-btn ${billingMode === 'CONJUNTA' ? 'primary' : ''}" data-billing-mode="CONJUNTA" ${hasConsumption && billingMode !== 'CONJUNTA' ? 'disabled' : ''}>Cuenta conjunta</button><button type="button" class="ri-btn ${billingMode === 'INDIVIDUAL' ? 'primary' : ''}" data-billing-mode="INDIVIDUAL" ${hasConsumption && billingMode !== 'INDIVIDUAL' ? 'disabled' : ''}>Cuenta individual</button></div>`;
    const peopleTabs = billingMode === 'INDIVIDUAL' ? `<div class="waiter-person-tabs">${Array.from({length:guestCount},(_,i)=>i+1).map((seat) => `<button type="button" class="ri-btn ${seat === Number(S.waiterSeat) ? 'primary' : ''}" data-waiter-seat="${seat}">Persona ${seat}</button>`).join('')}${canEditService ? '<button type="button" class="ri-btn" id="addWaiterPerson">+ Agregar persona</button>' : ''}</div>` : `<div class="waiter-joint-info"><b>${guestCount} persona(s)</b>${canEditService ? '<button type="button" class="ri-btn small" id="addWaiterPerson">+ Persona</button>' : ''}<span>Todos los consumos van a una sola cuenta.</span></div>`;

    const catalog = `<section class="ri-card waiter-catalog"><div class="waiter-menu-tabs">${['ENTRADAS','FUERTES','BEBIDAS','POSTRES'].map((cat) => `<button type="button" class="${cat === category ? 'active' : ''}" data-waiter-category="${cat}">${cat}</button>`).join('')}</div><div class="waiter-search-row"><input id="waiterSearch" class="ri-input" placeholder="Buscar producto…" value="${esc(S.waiterSearch || '')}"><span class="ri-muted">${billingMode === 'INDIVIDUAL' ? `Agregando a Persona ${S.waiterSeat}` : 'Agregando a cuenta conjunta'}</span></div><div class="menu-grid waiter-product-grid">${visibleMenu.map((item) => { const q=draftQty(item.id, billingMode === 'INDIVIDUAL' ? S.waiterSeat : null); return `<article class="menu-ticket ${item.warning ? 'warn' : ''}" data-waiter-product="${esc(String(item.product?.nombre || '').toLocaleLowerCase('es'))}"><div class="menu-station">${esc(item.station)}</div><div class="menu-name">${esc(item.product?.nombre || 'Producto')}</div><div class="menu-price">${money(item.product?.precio1)}</div>${item.warning ? `<div class="ri-muted">${esc(item.warning)}</div>` : `<div class="qty-control"><button class="ri-btn small" data-draft-minus="${item.id}">−</button><span class="qty-number">${q}</span><button class="ri-btn small primary" data-draft-plus="${item.id}">+</button></div>`}</article>`; }).join('') || '<div class="empty-ticket">No hay productos para este filtro.</div>'}</div></section>`;

    const groups = waiterServiceGroups(service);
    const accountAction = sentToCash
      ? `<div class="waiter-sent-cash"><b>✓ Enviado a Caja</b><span>Caja ya puede cobrar esta mesa.</span></div>`
      : prepared
        ? `<button type="button" class="ri-btn primary waiter-main-action" id="sendToCash" ${draftItems.length ? 'disabled' : ''}>Enviar a caja · ${money(service.total)}</button>`
        : `<button type="button" class="ri-btn brass waiter-main-action" id="prepareAccount" ${draftItems.length || !hasConsumption ? 'disabled' : ''}>Preparar cuenta</button>`;
    const orderPanel = `<aside class="ri-card waiter-order-panel"><div class="waiter-order-head"><div><div class="ri-eyebrow">Pedido en curso</div><h2>${esc(table.name)}</h2></div><span class="state-stamp ${esc(stage.label.replaceAll(' ','_').toUpperCase())}">${esc(stage.label)}</span></div>${waiterProgressMarkup(stage)}<div class="waiter-order-scroll">${groups.map((group) => waiterGroupMarkup(group, service, active.id)).join('')}</div><div class="waiter-total"><span>Total mesa</span><b>${money(service.total)}</b></div><div class="waiter-action-stack">${draftItems.length ? `<button type="button" class="ri-btn primary waiter-main-action" id="sendDraft">Enviar a cocina / barra · ${money(S.draft?.order?.total)}</button>` : ''}${accountAction}${hasConsumption ? '<button type="button" class="ri-btn" id="printPrecheck">Imprimir pre-cuenta</button>' : ''}</div></aside>`;

    $('#view').innerHTML = `${top}<section class="ri-card waiter-service-bar"><div><div class="ri-label">Modo de cuenta</div>${modeButtons}</div><div><div class="ri-label">Personas en la mesa</div>${peopleTabs}</div><div class="waiter-service-meta"><small>Zona</small><b>${esc(zone?.name || '—')}</b><small>Tiempo</small><b>${waiterElapsed(active.openedAt)}</b></div></section><div class="waiter-workspace">${catalog}${orderPanel}</div>${waiterHistoryHtml(S.orders)}`;

    bindWaiterTop();
    $$('[data-billing-mode]').forEach((button) => button.addEventListener('click', async () => {
      if (button.disabled || button.dataset.billingMode === billingMode) return;
      await updateWaiterService(active.id, { billingMode:button.dataset.billingMode }, 'Modo de cuenta actualizado.');
    }));
    $$('[data-waiter-seat]').forEach((button) => button.addEventListener('click', () => { S.waiterSeat=Number(button.dataset.waiterSeat); renderWaiter().catch((error)=>message(error.message,true)); }));
    $('#addWaiterPerson')?.addEventListener('click', () => updateWaiterService(active.id, { guestCount:guestCount+1 }, `Persona ${guestCount+1} agregada.`));
    $$('[data-waiter-category]').forEach((button) => button.addEventListener('click', () => { S.waiterCategory=button.dataset.waiterCategory; renderWaiter().catch((error)=>message(error.message,true)); }));
    $('#waiterSearch')?.addEventListener('input', (event) => {
      S.waiterSearch=event.target.value;
      const needle=String(S.waiterSearch||'').trim().toLocaleLowerCase('es');
      $$('[data-waiter-product]').forEach((card)=>{card.hidden=Boolean(needle)&&!String(card.dataset.waiterProduct||'').includes(needle);});
    });
    $$('[data-draft-plus]').forEach((button) => button.addEventListener('click', () => changeDraftQty(active.id, button.dataset.draftPlus, draftQty(button.dataset.draftPlus, billingMode === 'INDIVIDUAL' ? S.waiterSeat : null)+1, billingMode === 'INDIVIDUAL' ? S.waiterSeat : null)));
    $$('[data-draft-minus]').forEach((button) => button.addEventListener('click', () => changeDraftQty(active.id, button.dataset.draftMinus, Math.max(0,draftQty(button.dataset.draftMinus, billingMode === 'INDIVIDUAL' ? S.waiterSeat : null)-1), billingMode === 'INDIVIDUAL' ? S.waiterSeat : null)));
    $$('[data-waiter-move]').forEach((select) => select.addEventListener('change', () => updateWaiterItem(select.dataset.session, select.dataset.waiterMove, { seatNumber:Number(select.value) }, 'Producto movido de persona.')));
    $$('[data-waiter-note]').forEach((button) => button.addEventListener('click', async () => { const notes=prompt('Nota para cocina / barra',button.dataset.currentNote||''); if(notes===null)return; await updateWaiterItem(button.dataset.session,button.dataset.waiterNote,{notes},'Nota guardada.'); }));
    $('#sendDraft')?.addEventListener('click', () => sendDraft(active.id));
    $('#prepareAccount')?.addEventListener('click', () => prepareWaiterAccount(table.id));
    $('#sendToCash')?.addEventListener('click', () => sendWaiterToCash(table.id));
    $('#printPrecheck')?.addEventListener('click', () => { const popup=window.open('','_blank','width=520,height=760'); if(!popup)return; popup.document.write(waiterPrecheckHtml(table,zone,service)); popup.document.close(); });

    stopPoll();
    const sessionId=active.id, tableId=table.id;
    S.poll=setInterval(()=>{if(S.tab==='mesero')refreshWaiterHistory(sessionId,tableId).catch(()=>{});},Math.max(Number(S.context.polling.floorMs||3000),2500));
  }

  function bindWaiterTop() {
    $('#waiterZone')?.addEventListener('change', (event) => {
      S.selectedZoneId=event.target.value;
      const first=S.tables.find((row)=>row.zoneId===S.selectedZoneId);
      S.selectedTableId=first?.id||null;
      S.waiterSeat=1;
      renderWaiter().catch((error)=>message(error.message,true));
    });
    $$('[data-waiter-table]').forEach((button)=>button.addEventListener('click',()=>{S.selectedTableId=button.dataset.waiterTable;S.waiterSeat=1;renderWaiter().catch((error)=>message(error.message,true));}));
  }

  async function updateWaiterService(sessionId, payload, successText) {
    try {
      await api(`/api/v1/restaurante/sesiones/${sessionId}/servicio`, { method:'PATCH', body:JSON.stringify(payload) });
      message(successText);
      await renderWaiter();
    } catch (error) { message(error.message,true); }
  }

  async function changeDraftQty(sessionId, menuItemId, quantity, seatNumber = null) {
    try {
      await api(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador/items/${menuItemId}`, { method:'PUT', body:JSON.stringify({ quantity, seatNumber }) });
      await renderWaiter();
    } catch (error) { message(error.message, true); }
  }

  async function updateWaiterItem(sessionId, itemId, payload, successText) {
    try {
      await api(`/api/v1/restaurante/sesiones/${sessionId}/items/${itemId}`, { method:'PATCH', body:JSON.stringify(payload) });
      message(successText);
      await renderWaiter();
    } catch (error) { message(error.message,true); }
  }

  async function sendDraft(sessionId) {
    const wasSentToCash=Boolean(S.draft?.service?.cashierRequestedAt);
    try {
      const order=await api(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador/enviar`, { method:'POST', body:'{}' });
      message(wasSentToCash ? `Nueva ronda enviada. ${order.commands.length} comanda(s). La mesa volvió a servicio activo.` : `Pedido enviado. ${order.commands.length} comanda(s) reales en cola.`);
      await renderWaiter();
    } catch (error) { message(error.message,true); }
  }

  async function prepareWaiterAccount(tableId) {
    try {
      await api(`/api/v1/restaurante/mesas/${tableId}/preparar-cuenta`, { method:'POST', body:'{}' });
      message('Cuenta preparada. Revísala y envíala a Caja cuando el cliente confirme.');
      await renderWaiter();
    } catch (error) { message(error.message,true); }
  }

  async function sendWaiterToCash(tableId) {
    try {
      await api(`/api/v1/restaurante/mesas/${tableId}/enviar-caja`, { method:'POST', body:'{}' });
      message('Cuenta enviada a Caja. La mesa quedó marcada como cuenta pedida.');
      await renderWaiter();
    } catch (error) { message(error.message,true); }
  }

  const KDS_OVERDUE_MINUTES = 12;

  function commandItems(command) { return (command.order?.items || []).filter((x) => x.station === command.station); }
  function kdsAgeMinutes(command) {
    const created = new Date(command?.creadoEn || 0).getTime();
    if (!Number.isFinite(created) || !created) return 0;
    return Math.max(0, Math.floor((Date.now() - created) / 60000));
  }
  function kdsAgeLabel(command) {
    const minutes = kdsAgeMinutes(command);
    if (minutes < 1) return 'ahora';
    if (minutes < 60) return `hace ${minutes} min`;
    return `hace ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }
  function kdsIsLate(command) {
    return ['PENDIENTE','EN_PREPARACION'].includes(String(command?.state || '')) && kdsAgeMinutes(command) >= KDS_OVERDUE_MINUTES;
  }
  function kdsStatus(command) {
    if (kdsIsLate(command)) return { key:'ATRASADA', label:'ATRASADA' };
    if (command.state === 'PENDIENTE') return { key:'PENDIENTE', label:'PENDIENTE' };
    if (command.state === 'EN_PREPARACION') return { key:'EN_PREPARACION', label:'EN PREPARACIÓN' };
    if (command.state === 'LISTA') return { key:'LISTA', label:'LISTA' };
    return { key:String(command.state || ''), label:String(command.state || '').replaceAll('_',' ') };
  }
  function kdsZoneLabel(command) { return command.order?.session?.table?.zone?.name || 'Sin zona'; }
  function kdsWaiterLabel(command) {
    if (String(command.order?.source || '').toUpperCase() === 'QR') return 'Cliente · QR';
    return command.waiter?.nombre || 'Mesero';
  }
  function kdsOrderLabel(command) { return `#${String(command.order?.id || command.id || '').slice(0, 6).toUpperCase()}`; }
  function kdsStationIcon(station) { return station === 'COCINA' ? '♨' : station === 'BARRA' ? '▥' : '♢'; }
  function kdsStations() {
    const role = String(S.context?.user?.rol || '').toUpperCase();
    if (['COCINA','BARRA','POSTRES'].includes(role)) return [role];
    return ['COCINA','BARRA','POSTRES'];
  }
  function kdsVisibleCommands() { return S.commands.filter((row) => !['ENTREGADA','CANCELADA'].includes(String(row.state || ''))); }
  function kdsUnique(rows, getter) { return [...new Set(rows.map(getter).filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b), 'es')); }
  function kdsMatches(command) {
    if (S.kdsFilter !== 'ALL' && command.state !== S.kdsFilter) return false;
    if (S.kdsZone !== 'ALL' && kdsZoneLabel(command) !== S.kdsZone) return false;
    if (S.kdsWaiter !== 'ALL' && kdsWaiterLabel(command) !== S.kdsWaiter) return false;
    const search = String(S.kdsSearch || '').trim().toLocaleLowerCase('es');
    if (!search) return true;
    const haystack = [
      command.order?.session?.table?.name,
      kdsZoneLabel(command), kdsWaiterLabel(command), command.order?.id, command.id,
      ...commandItems(command).map((item) => item.description),
      ...commandItems(command).map((item) => item.notes)
    ].filter(Boolean).join(' ').toLocaleLowerCase('es');
    return haystack.includes(search);
  }
  function kdsKpis(rows) {
    const active = rows.filter((row) => ['PENDIENTE','EN_PREPARACION','LISTA'].includes(row.state));
    const average = active.length ? Math.round(active.reduce((sum,row) => sum + kdsAgeMinutes(row), 0) / active.length) : 0;
    return {
      pending: rows.filter((row) => row.state === 'PENDIENTE').length,
      preparing: rows.filter((row) => row.state === 'EN_PREPARACION').length,
      ready: rows.filter((row) => row.state === 'LISTA').length,
      late: rows.filter(kdsIsLate).length,
      average
    };
  }
  function kdsFocusSnapshot() {
    const active = document.activeElement;
    if (!active?.id || !['kdsSearch','kdsZoneFilter','kdsWaiterFilter'].includes(active.id)) return null;
    return { id:active.id, start:active.selectionStart, end:active.selectionEnd };
  }
  function kdsRestoreFocus(snapshot) {
    if (!snapshot) return;
    const node = document.getElementById(snapshot.id);
    if (!node) return;
    node.focus();
    if (typeof node.setSelectionRange === 'function' && Number.isInteger(snapshot.start)) node.setSelectionRange(snapshot.start, snapshot.end ?? snapshot.start);
  }
  function playKdsTone() {
    if (!S.kdsSoundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      oscillator.connect(gain); gain.connect(ctx.destination);
      oscillator.start(); oscillator.stop(ctx.currentTime + 0.2);
      oscillator.onended = () => ctx.close?.();
    } catch {}
  }
  function kdsRememberCommands(rows, fromPoll) {
    const current = new Set(rows.filter((row) => !['ENTREGADA','CANCELADA'].includes(row.state)).map((row) => row.id));
    const hadKnown = S.kdsKnownIds.size > 0;
    const hasNew = fromPoll && hadKnown && [...current].some((id) => !S.kdsKnownIds.has(id));
    S.kdsKnownIds = current;
    if (hasNew) playKdsTone();
  }
  function kdsMetricCard(icon, label, value, extraClass = '') {
    return `<article class="kds-kpi ${extraClass}"><span class="kds-kpi-icon">${icon}</span><div><small>${label}</small><b>${value}</b></div></article>`;
  }
  function kdsCommandCard(command) {
    const items = commandItems(command);
    const status = kdsStatus(command);
    const late = kdsIsLate(command);
    const table = command.order?.session?.table?.name || 'Mesa';
    const zone = kdsZoneLabel(command);
    const waiter = kdsWaiterLabel(command);
    const cardClass = command.state === 'LISTA' ? 'kds-ready' : command.state === 'EN_PREPARACION' ? 'kds-preparing' : 'kds-pending';
    let actions = '';
    if (command.state === 'PENDIENTE') actions = `<button class="ri-btn primary" data-command="${command.id}" data-command-state="EN_PREPARACION">♨ Tomar</button><button class="ri-btn" data-kds-detail="${command.id}">☷ Ver detalle</button>`;
    if (command.state === 'EN_PREPARACION') actions = `<button class="ri-btn primary kds-wide-action" data-command="${command.id}" data-command-state="LISTA">✓ Marcar listo</button><button class="ri-btn" data-kds-detail="${command.id}">☷ Ver detalle</button>`;
    if (command.state === 'LISTA') actions = `<div class="kds-ready-notice">✓ Mesero avisado en vivo</div><button class="ri-btn" data-command="${command.id}" data-command-state="ENTREGADA">Marcar entregada</button><button class="ri-btn" data-kds-detail="${command.id}">☷ Ver detalle</button>`;
    return `<article class="kds-command-card ${cardClass} ${late ? 'kds-overdue' : ''}" data-kds-command="${command.id}">
      <div class="kds-card-top"><div><b>${esc(table)} · ${esc(zone)}</b><small>${esc(waiter)} · ${esc(kdsAgeLabel(command))}</small></div><div class="kds-card-status"><small>Pedido ${esc(kdsOrderLabel(command))}</small><span class="state-stamp ${status.key}">${status.label}</span></div></div>
      <div class="kds-items">${items.map((item) => `<div class="kds-item"><span><b>${esc(item.quantity)}×</b> ${esc(item.description)}</span>${item.notes ? `<em>${esc(item.notes)}</em>` : ''}</div>`).join('') || '<div class="empty-ticket">Sin productos visibles en esta estación.</div>'}</div>
      <div class="kds-card-actions">${actions}</div>
    </article>`;
  }
  function kdsLaneMarkup(station, rows) {
    const stationRows = rows.filter((row) => row.station === station);
    return `<section class="kds-v2-lane" data-station="${station}"><header><div><span class="kds-station-icon">${kdsStationIcon(station)}</span><h2>${esc(station.replaceAll('_',' '))}</h2></div><span class="kds-count">${stationRows.length} comanda(s)</span></header><div class="kds-lane-scroll">${stationRows.map(kdsCommandCard).join('') || `<div class="kds-empty"><b>Sin comandas pendientes</b><span>Los nuevos pedidos de ${esc(station.toLowerCase())} aparecerán aquí automáticamente.</span></div>`}</div></section>`;
  }
  function kdsDetailMarkup(command) {
    const status = kdsStatus(command);
    const table = command.order?.session?.table?.name || 'Mesa';
    return `<div class="kds-detail-head"><div><div class="ri-eyebrow">Detalle de comanda</div><h2>${esc(table)} · ${esc(kdsZoneLabel(command))}</h2><p class="ri-muted">${esc(kdsWaiterLabel(command))} · ${esc(kdsAgeLabel(command))} · Pedido ${esc(kdsOrderLabel(command))}</p></div><button type="button" class="ri-btn" data-kds-close>Cerrar</button></div><span class="state-stamp ${status.key}">${status.label}</span><div class="kds-detail-items">${commandItems(command).map((item) => `<div><b>${esc(item.quantity)}× ${esc(item.description)}</b>${item.notes ? `<span>Nota: ${esc(item.notes)}</span>` : ''}</div>`).join('')}</div><div class="ri-actions"><button type="button" class="ri-btn" data-kds-print="${command.id}">PDF / Imprimir</button></div>`;
  }
  function openKdsDetail(id) {
    const command = S.commands.find((row) => row.id === id);
    const dialog = $('#kdsDetailDialog');
    if (!command || !dialog) return;
    dialog.innerHTML = kdsDetailMarkup(command);
    dialog.querySelector('[data-kds-close]')?.addEventListener('click', () => dialog.close?.());
    dialog.querySelector('[data-kds-print]')?.addEventListener('click', () => printCommand(command));
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open','');
  }

  async function renderKds(fromPoll = false, localOnly = false) {
    const focus = kdsFocusSnapshot();
    if (!localOnly) {
      const rows = await api('/api/v1/restaurante/comandas?limit=200');
      kdsRememberCommands(rows, fromPoll);
      S.commands = rows;
    }
    const visible = kdsVisibleCommands();
    const filtered = visible.filter(kdsMatches);
    const kpis = kdsKpis(visible);
    const zones = kdsUnique(visible, kdsZoneLabel);
    const waiters = kdsUnique(visible, kdsWaiterLabel);
    if (S.kdsZone !== 'ALL' && !zones.includes(S.kdsZone)) S.kdsZone = 'ALL';
    if (S.kdsWaiter !== 'ALL' && !waiters.includes(S.kdsWaiter)) S.kdsWaiter = 'ALL';
    const seconds = Math.max(1, Math.round((S.context.polling.kdsMs || 2000) / 1000));
    $('#view').innerHTML = `<section class="kds-v2">
      <header class="kds-v2-header"><div><div class="ri-eyebrow">PRODUCCIÓN EN VIVO</div><h1 class="ri-title">Cocina / Barra</h1></div><div class="kds-v2-header-right"><span class="cc-live-pill">Actualización automática cada ${seconds} s · En vivo</span><div class="kds-header-actions"><button type="button" class="ri-btn" id="kdsRefresh">↻ Actualizar</button><button type="button" class="ri-btn" id="kdsSound">${S.kdsSoundEnabled ? '🔊 Sonido ON' : '🔇 Sonido OFF'}</button><button type="button" class="ri-btn" id="kdsFullscreen">${document.fullscreenElement ? 'Salir pantalla completa' : '⛶ Pantalla completa'}</button></div></div></header>
      <div class="kds-kpis">${kdsMetricCard('▤','Pendientes',kpis.pending)}${kdsMetricCard('♨','En preparación',kpis.preparing)}${kdsMetricCard('✓','Listas',kpis.ready,'ready')}${kdsMetricCard('◷','Atrasadas',kpis.late,'late')}${kdsMetricCard('◴','Tiempo prom.',`${kpis.average} min`,'time')}</div>
      <div class="kds-filterbar"><div class="kds-state-filters">${[['ALL','Todas'],['PENDIENTE','Pendientes'],['EN_PREPARACION','En preparación'],['LISTA','Listas']].map(([value,label]) => `<button type="button" class="ri-btn ${S.kdsFilter === value ? 'primary' : ''}" data-kds-filter="${value}">${label}</button>`).join('')}</div><select id="kdsZoneFilter" class="ri-select"><option value="ALL">Zona · Todas</option>${zones.map((zone) => `<option value="${esc(zone)}" ${S.kdsZone === zone ? 'selected' : ''}>${esc(zone)}</option>`).join('')}</select><select id="kdsWaiterFilter" class="ri-select"><option value="ALL">Mesero · Todos</option>${waiters.map((waiter) => `<option value="${esc(waiter)}" ${S.kdsWaiter === waiter ? 'selected' : ''}>${esc(waiter)}</option>`).join('')}</select><label class="kds-search"><span>⌕</span><input id="kdsSearch" class="ri-input" value="${esc(S.kdsSearch)}" placeholder="Buscar mesa o pedido"></label></div>
      <div class="kds-v2-lanes">${kdsStations().map((station) => kdsLaneMarkup(station, filtered)).join('')}</div>
      <dialog id="kdsDetailDialog" class="kds-detail-dialog ri-card"></dialog>
    </section>`;
    bindKds();
    kdsRestoreFocus(focus);
    if (!fromPoll) {
      stopPoll();
      S.poll = setInterval(() => { if (S.tab === 'kds') renderKds(true).catch(() => {}); }, S.context.polling.kdsMs || 2000);
    }
  }
  function bindKds() {
    $$('[data-command]').forEach((button) => button.addEventListener('click', () => setCommand(button.dataset.command, button.dataset.commandState)));
    $$('[data-kds-detail]').forEach((button) => button.addEventListener('click', () => openKdsDetail(button.dataset.kdsDetail)));
    $$('[data-kds-filter]').forEach((button) => button.addEventListener('click', () => { S.kdsFilter = button.dataset.kdsFilter; renderKds(true, true).catch((error) => message(error.message, true)); }));
    $('#kdsZoneFilter')?.addEventListener('change', (event) => { S.kdsZone = event.target.value; renderKds(true, true).catch((error) => message(error.message, true)); });
    $('#kdsWaiterFilter')?.addEventListener('change', (event) => { S.kdsWaiter = event.target.value; renderKds(true, true).catch((error) => message(error.message, true)); });
    $('#kdsSearch')?.addEventListener('input', (event) => { S.kdsSearch = event.target.value; renderKds(true, true).catch((error) => message(error.message, true)); });
    $('#kdsRefresh')?.addEventListener('click', () => renderKds(true).catch((error) => message(error.message, true)));
    $('#kdsSound')?.addEventListener('click', () => { S.kdsSoundEnabled = !S.kdsSoundEnabled; localStorage.setItem('restaurant_kds_sound_v1', S.kdsSoundEnabled ? 'on' : 'off'); if (S.kdsSoundEnabled) playKdsTone(); renderKds(true, true).catch(() => {}); });
    $('#kdsFullscreen')?.addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); await renderKds(true, true); } catch (error) { message('Pantalla completa no está disponible en este dispositivo.', true); } });
    $('#kdsDetailDialog')?.addEventListener('click', (event) => { if (event.target.id === 'kdsDetailDialog') event.target.close?.(); });
  }
  async function setCommand(id, state) {
    try {
      const result = await api(`/api/v1/restaurante/comandas/${id}`, { method:'PATCH', body:JSON.stringify({ state }) });
      if (state === 'LISTA') message('Comanda lista. El Mesero V2 la verá en su panel en vivo.');
      else if (state === 'ENTREGADA') message('Comanda entregada y retirada del tablero.');
      else message('Comanda tomada. Producción actualizada.');
      if (result.notification?.queued) message('Pedido listo; notificación al cliente también fue encolada.');
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

  function cashMetricRows(summary, kind) {
    const rows = Array.isArray(summary?.tables) ? [...summary.tables].reverse() : [];
    if (kind === 'CASH') return rows.filter((row) => String(row.formaPago || '').toUpperCase() === 'EFECTIVO');
    if (kind === 'OTHER') return rows.filter((row) => String(row.formaPago || '').toUpperCase() !== 'EFECTIVO');
    return rows;
  }

  function cashMetricDetail(kind, summary, dueTables) {
    if (!kind) return '';
    const requested = dueTables.filter((table) => table.state === 'CUENTA_PEDIDA');
    if (kind === 'DUE') {
      return `<section class="cash-panel" data-cash-metric-detail="DUE"><div class="cash-panel-head"><div><button type="button" class="ri-btn small" data-cash-metric-back>← Atrás · Caja</button><h2>Mesas por cobrar</h2><p>Selecciona una mesa para llevarla directamente al cobro rápido.</p></div><span class="cash-count-badge">${requested.length}</span></div><div class="cash-due-list">${requested.length ? requested.map((table) => cashTableRow(table, false)).join('') : '<div class="empty-ticket">No hay cuentas pedidas pendientes de cobro.</div>'}</div></section>`;
    }
    const rows = cashMetricRows(summary, kind);
    const labels = {
      SALES:['Ventas del turno','Todos los cierres registrados durante este turno.'],
      CASH:['Efectivo registrado','Cierres del turno pagados en efectivo.'],
      OTHER:['Otros medios','Cierres pagados por medios distintos del efectivo.']
    };
    const [title, description] = labels[kind] || labels.SALES;
    const total = rows.reduce((sum, row) => sum + number(row.total), 0);
    return `<section class="cash-panel" data-cash-metric-detail="${esc(kind)}"><div class="cash-panel-head"><div><button type="button" class="ri-btn small" data-cash-metric-back>← Atrás · Caja</button><h2>${esc(title)}</h2><p>${esc(description)}</p></div><strong>${money(total)}</strong></div><div class="cash-recent-list">${rows.length ? rows.map((row) => `<div class="cash-recent-row"><span><b>${esc(row.table || 'Mesa')}</b><small>${esc(row.saleNumber || 'Venta')} · ${esc(String(row.formaPago || 'SIN MEDIO').replaceAll('_',' '))}</small></span><span>${money(row.total)}</span><span class="cash-recent-state">Registrado</span></div>`).join('') : '<div class="empty-ticket">Todavía no hay movimientos en este indicador durante el turno.</div>'}</div></section>`;
  }

  async function renderCash() {
    await loadTables();
    const cajas = await api('/api/v1/tesoreria/cajas-bancos');
    let summary = null;
    if (S.cashShiftId) {
      try { summary = await api(`/api/v1/restaurante/caja/turnos/${S.cashShiftId}/resumen`); }
      catch { S.cashShiftId = null; S.cashMetric = null; localStorage.removeItem(SHIFT_KEY); }
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
      S.cashMetric = null;
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
        <button type="button" class="cash-kpi" data-cash-metric="SALES" aria-pressed="${S.cashMetric === 'SALES'}"><span>↗</span><div><small>Ventas del turno</small><b>${money(closedTotal)}</b><em>${recent.length} cierre(s) registrado(s) · Ver detalle</em></div></button>
        <button type="button" class="cash-kpi green" data-cash-metric="CASH" aria-pressed="${S.cashMetric === 'CASH'}"><span>▣</span><div><small>Efectivo registrado</small><b>${money(cashRecorded)}</b><em>Dato real del turno · Ver detalle</em></div></button>
        <button type="button" class="cash-kpi blue" data-cash-metric="OTHER" aria-pressed="${S.cashMetric === 'OTHER'}"><span>▤</span><div><small>Otros medios</small><b>${money(otherRecorded)}</b><em>Ventas cerradas menos efectivo · Ver detalle</em></div></button>
        <button type="button" class="cash-kpi orange" data-cash-metric="DUE" aria-pressed="${S.cashMetric === 'DUE'}"><span>▱</span><div><small>Mesas por cobrar</small><b>${requestedCount}</b><em>${openTables.length} mesa(s) abiertas · Ver detalle</em></div></button>
      </div>

      ${cashMetricDetail(S.cashMetric, summary, dueTables)}

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
        S.cashMetric = null;
        localStorage.setItem(SHIFT_KEY, shift.id);
        message('Caja abierta. Ya puedes recibir cobros.');
        await renderCash();
      } catch (error) { message(error.message, true); }
    });

    $$('[data-cash-metric]').forEach((button) => button.addEventListener('click', async () => {
      S.cashMetric = S.cashMetric === button.dataset.cashMetric ? null : button.dataset.cashMetric;
      await renderCash();
      document.querySelector('[data-cash-metric-detail]')?.scrollIntoView({ behavior:'smooth', block:'start' });
    }));
    $('[data-cash-metric-back]')?.addEventListener('click', async () => {
      S.cashMetric = null;
      await renderCash();
    });

    $$('[data-cash-table]').forEach((button) => button.addEventListener('click', async () => {
      S.selectedTableId = button.dataset.cashTable;
      S.cashMetric = null;
      await renderCash();
      document.querySelector('.cash-fast-panel')?.scrollIntoView({ behavior:'smooth', block:'start' });
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
        S.cashMetric = null;
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
        S.cashMetric = null;
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
