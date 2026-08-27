from pathlib import Path

# --- restaurant.routes.js: canonical QR endpoints ---
routes_path = Path('src/modules/restaurant/restaurant.routes.js')
routes = routes_path.read_text()
needle = "const theme = require('./restaurant-theme.service');\n"
if needle not in routes:
    raise SystemExit('routes theme require marker missing')
routes = routes.replace(needle, needle + "const qr = require('./restaurant-qr.service');\n", 1)
marker = "router.get('/mesas', requirePermission('MESAS.VER'), async (req, res, next) => {\n"
qr_routes = """router.get('/qrs', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await qr.visibleMaterials(req.tenantId, req.user) }); } catch (error) { next(error); }
});
router.get('/zonas/:id/qrs', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await qr.visibleMaterials(req.tenantId, req.user, { zoneId:req.params.id }) }); } catch (error) { next(error); }
});
router.get('/mesas/:id/qr', requirePermission('MESAS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await qr.tableMaterial(req.tenantId, req.user, req.params.id) }); } catch (error) { next(error); }
});
router.post('/mesas/:id/qr/regenerar', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await qr.regenerateTableQr(req.tenantId, req.params.id) }); } catch (error) { next(error); }
});

"""
if marker not in routes:
    raise SystemExit('mesas route marker missing')
routes = routes.replace(marker, qr_routes + marker, 1)
routes_path.write_text(routes)

# --- .env.example: explicit public QR origin ---
env_path = Path('.env.example')
env = env_path.read_text()
if 'RESTAURANT_PUBLIC_BASE_URL=' not in env:
    env = env.rstrip() + '\nRESTAURANT_PUBLIC_BASE_URL="https://core.tusaas.com"\n'
env_path.write_text(env)

# --- restaurant-ui.js: Salon V2, QR management, no location.origin ---
ui_path = Path('src/web/restaurant-ui.js')
ui = ui_path.read_text()
state_marker = "    waiterSearch: '',\n    kdsFilter: 'ALL',"
if state_marker not in ui:
    raise SystemExit('UI state marker missing')
ui = ui.replace(state_marker, "    waiterSearch: '',\n    salonView: localStorage.getItem('restaurant_salon_view_v2') === 'LISTA' ? 'LISTA' : 'PLANO',\n    salonEdit: false,\n    kdsFilter: 'ALL',", 1)

block_start = ui.index('  function tableTicket(table)')
block_end = ui.index('  function draftQty(', block_start)
new_block = r'''  function salonStateLabel(state) { return String(state || 'LIBRE').replaceAll('_', ' '); }
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

'''
ui = ui[:block_start] + new_block + ui[block_end:]
if 'location.origin}/r/' in ui or 'location.origin}/r/${' in ui:
    raise SystemExit('location.origin QR dependency still present')
ui_path.write_text(ui)

# --- canonical Salon V2 CSS replaces obsolete floor/table rules ---
css_path = Path('src/web/restaurant-control-center.css')
css = css_path.read_text()
start = css.index('.floor{')
end = css.index('.menu-section{', start)
salon_css = r'''/* Salón V2 — operación de mesas separada de edición y gestión QR. */
.salon-shell{display:grid;gap:14px}.salon-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.salon-head p{margin:5px 0 0}.salon-head-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.salon-view-toggle{display:flex;padding:4px;border:1px solid var(--cc-line);border-radius:12px;background:#fff}.salon-view-toggle button{min-height:38px;padding:7px 12px;border:0;border-radius:9px;background:transparent;color:var(--cc-muted);font:inherit;font-size:12px;font-weight:900;cursor:pointer}.salon-view-toggle button.active{background:#111c2b;color:#fff}.salon-zone-tabs{display:flex;gap:8px;overflow:auto;padding:2px 1px 4px}.salon-zone-tab{appearance:none;min-height:48px;padding:8px 12px;border:1px solid var(--cc-line);border-radius:12px;background:#fff;color:var(--cc-ink);display:flex;align-items:center;gap:9px;white-space:nowrap;cursor:pointer}.salon-zone-tab b{font-size:13px}.salon-zone-tab span{display:grid;place-items:center;min-width:24px;height:24px;padding:0 6px;border-radius:999px;background:#f1f5f9;color:var(--cc-muted);font-size:10px;font-weight:900}.salon-zone-tab.active{border-color:#fdba74;background:#fff7ed;color:var(--cc-orange-dark)}.salon-zone-tab.active span{background:#ffedd5;color:#c2410c}.salon-zone-summary{display:grid;grid-template-columns:1.5fr repeat(5,minmax(85px,.55fr));gap:1px;overflow:hidden;border:1px solid var(--cc-line);border-radius:15px;background:var(--cc-line)}.salon-zone-summary>div{min-height:68px;padding:11px 13px;background:#fff;display:grid;align-content:center}.salon-zone-summary small{color:var(--cc-muted);font-size:10px;font-weight:850}.salon-zone-summary b{font-size:18px;line-height:1.2}.salon-zone-summary .free b{color:#15803d}.salon-zone-summary .occupied b{color:#c2410c}.salon-zone-summary .bill b{color:#be123c}.salon-edit-notice{padding:10px 13px;border:1px solid #fdba74;border-radius:11px;background:#fff7ed;color:#9a3412;font-size:12px;font-weight:850}.salon-floor{position:relative;min-height:560px;border:1px solid var(--cc-line);border-radius:18px;background:linear-gradient(90deg,rgba(226,232,240,.42) 1px,transparent 1px),linear-gradient(rgba(226,232,240,.42) 1px,transparent 1px),#f8fafc;background-size:28px 28px;overflow:auto}.salon-floor.editing{border-style:dashed;border-color:#fdba74}.salon-table{position:absolute;min-width:150px;min-height:120px;padding:13px;border:2px solid #dbe3ea;border-radius:18px;background:#fff;box-shadow:0 8px 22px rgba(15,23,42,.08);display:flex;flex-direction:column;gap:8px;transition:box-shadow .14s ease,border-color .14s ease}.salon-table.LIBRE{border-color:#bbf7d0;background:#f8fdf9}.salon-table.OCUPADA{border-color:#fdba74;background:#fffaf5}.salon-table.CUENTA_PEDIDA{border-color:#fca5a5;background:#fff7f7}.salon-table.RESERVADA{border-color:#bfdbfe;background:#f8fbff}.salon-table.edit-mode{cursor:grab;box-shadow:0 10px 26px rgba(249,115,22,.15)}.salon-table.edit-mode:active{cursor:grabbing}.salon-table-top{display:flex;justify-content:space-between;gap:8px;align-items:center}.salon-table-state{display:inline-flex;align-items:center;width:max-content;min-height:26px;padding:4px 8px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:9px;font-weight:950;letter-spacing:.06em}.salon-table.LIBRE .salon-table-state,.salon-list-row.LIBRE .salon-table-state{background:#dcfce7;color:#15803d}.salon-table.OCUPADA .salon-table-state,.salon-list-row.OCUPADA .salon-table-state{background:#ffedd5;color:#c2410c}.salon-table.CUENTA_PEDIDA .salon-table-state,.salon-list-row.CUENTA_PEDIDA .salon-table-state{background:#ffe4e6;color:#be123c}.salon-table.RESERVADA .salon-table-state,.salon-list-row.RESERVADA .salon-table-state{background:#dbeafe;color:#1d4ed8}.salon-drag-hint{color:var(--cc-orange-dark);font-size:10px;font-weight:900}.salon-table-name{font-size:19px;font-weight:950;color:var(--cc-ink)}.salon-table-main{display:flex;align-items:baseline;gap:6px}.salon-table-main strong{font-size:22px;line-height:1;color:var(--cc-ink)}.salon-table-main span{color:var(--cc-muted);font-size:11px;font-weight:800}.salon-table-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:auto}.salon-table-actions .ri-btn{flex:1 1 90px!important}.salon-list{display:grid;gap:8px}.salon-list-row{min-height:72px;padding:10px 12px;border:1px solid var(--cc-line);border-left:5px solid #cbd5e1;border-radius:13px;background:#fff;display:grid;grid-template-columns:minmax(180px,1fr) auto auto;gap:14px;align-items:center}.salon-list-row.LIBRE{border-left-color:#22c55e}.salon-list-row.OCUPADA{border-left-color:#f97316}.salon-list-row.CUENTA_PEDIDA{border-left-color:#ef4444}.salon-list-row.RESERVADA{border-left-color:#3b82f6}.salon-list-main{display:grid;gap:2px}.salon-list-main b{font-size:15px}.salon-list-main small{color:var(--cc-muted);font-size:11px}.salon-list-row>strong{font-size:18px}.salon-list-actions{display:flex;gap:7px}.salon-empty{min-height:220px;padding:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--cc-muted);gap:5px}.salon-empty b{color:var(--cc-ink);font-size:16px}.salon-dialog{width:min(720px,calc(100vw - 28px));max-height:88vh;overflow:auto;border:0!important}.salon-dialog::backdrop{background:rgba(15,23,42,.38)}.salon-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}.salon-dialog-head h2{margin:3px 0;font-size:24px}.salon-dialog-head p{margin:3px 0}.salon-manager-list{display:grid;gap:8px;margin:12px 0}.salon-manager-row{min-height:64px;padding:10px 12px;border:1px solid var(--cc-line);border-radius:12px;background:#f8fafc;display:flex;align-items:center;justify-content:space-between;gap:12px}.salon-manager-row>div:first-child{display:grid;gap:2px}.salon-manager-row small{color:var(--cc-muted);font-size:11px}.qr-manager-note{padding:12px;border:1px solid #bfdbfe;border-radius:12px;background:#eff6ff;color:#1e3a8a;display:grid;gap:3px}.qr-manager-note span{font-size:12px}.qr-detail-code{width:min(340px,90%);margin:16px auto}.qr-detail-code svg{display:block;width:100%;height:auto}.qr-public-url{padding:10px 12px;border:1px solid var(--cc-line);border-radius:10px;background:#f8fafc;overflow-wrap:anywhere;font-size:12px}.qr-print-body{margin:0;background:white;color:black;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.qr-print-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:18px}.qr-print-card{break-inside:avoid;min-height:500px;padding:24px;border:1px solid lightgray;border-radius:18px;text-align:center;display:flex;flex-direction:column;align-items:center}.qr-print-brand{font-size:15px;font-weight:900;text-transform:uppercase}.qr-print-card h2{margin:8px 0 0;font-size:30px}.qr-print-card>p{margin:4px 0;color:dimgray}.qr-print-code{width:300px;max-width:90%;margin:14px auto}.qr-print-code svg{display:block;width:100%;height:auto}.qr-print-card h3{margin:5px 0;font-size:18px}.qr-print-card small{margin-top:auto;max-width:100%;overflow-wrap:anywhere;color:dimgray;font-size:9px}
'''
css = css[:start] + salon_css + css[end:]
old_mobile = ".floor{min-height:0!important;display:grid!important;grid-template-columns:repeat(auto-fit,minmax(155px,1fr))!important;gap:10px!important;padding:10px!important}.table-ticket{position:relative!important;left:auto!important;top:auto!important;width:auto!important;height:auto!important;min-height:150px!important}.table-actions .ri-btn{flex:1 1 70px!important}"
css = css.replace(old_mobile, '')
css = css.replace('.floor{grid-template-columns:1fr!important}', '')
insert_before = '/* Caja V2 — propietario visual del flujo de cobro y turno. */'
responsive = r'''@media(max-width:1120px){.salon-head{display:grid}.salon-head-actions{justify-content:flex-start}.salon-zone-summary{grid-template-columns:1.4fr repeat(3,1fr)}.salon-zone-summary>div:nth-child(n+5){display:none}}
@media(max-width:780px){.salon-head-actions{display:grid;grid-template-columns:1fr 1fr}.salon-view-toggle{grid-column:1/-1}.salon-view-toggle button{flex:1}.salon-zone-summary{grid-template-columns:1fr 1fr}.salon-zone-summary>div{min-height:60px}.salon-floor{min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:10px;background:#f8fafc}.salon-table{position:relative!important;left:auto!important;top:auto!important;width:auto!important;height:auto!important;min-height:150px}.salon-floor.editing{display:grid}.salon-list-row{grid-template-columns:1fr auto}.salon-list-actions{grid-column:1/-1}.salon-manager-row{align-items:flex-start;flex-direction:column}.salon-manager-row .ri-actions{width:100%}.qr-print-grid{grid-template-columns:1fr}}
@media(max-width:480px){.salon-head-actions{grid-template-columns:1fr}.salon-view-toggle{grid-column:auto}.salon-floor{grid-template-columns:1fr}.salon-list-row{grid-template-columns:1fr}.salon-list-row>strong{justify-self:start}.salon-list-actions{grid-column:auto;width:100%}.salon-list-actions .ri-btn{width:100%}.qr-print-grid{padding:8px}.qr-print-card{min-height:0;padding:16px}}
@media print{.qr-print-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8mm;padding:0}.qr-print-card{min-height:125mm;border:1px solid gray;box-shadow:none;page-break-inside:avoid}.qr-print-code{width:72mm}}

'''
if insert_before not in css:
    raise SystemExit('Caja marker missing')
css = css.replace(insert_before, responsive + insert_before, 1)
css_path.write_text(css)

# --- cache keys in restaurant.html ---
html_path = Path('src/web/restaurant.html')
html = html_path.read_text()
html = html.replace('restaurant-control-center.css?v=workspace-v7-kds', 'restaurant-control-center.css?v=workspace-v8-salon')
html = html.replace('restaurant-ui.js?v=kds-v2', 'restaurant-ui.js?v=salon-qr-v2')
html_path.write_text(html)

# --- PostgreSQL smoke: URL canonical, SVG and regeneration invalidates old token ---
zones_smoke_path = Path('scripts/restaurant-zones-smoke.js')
zones_smoke = zones_smoke_path.read_text()
zones_smoke = zones_smoke.replace("const zones = require('../src/modules/restaurant/restaurant-zones.service');\n", "const zones = require('../src/modules/restaurant/restaurant-zones.service');\nconst qr = require('../src/modules/restaurant/restaurant-qr.service');\n", 1)
marker = "    const second = await restaurant.createTable(tenant.id, { code: 'M2', name: 'Mesa nueva', seats: 2 });\n"
qr_test = """    process.env.RESTAURANT_PUBLIC_BASE_URL = 'https://qr.example.test';
    const qrBefore = await qr.tableMaterial(tenant.id, null, legacyTable.id);
    assert.equal(qrBefore.url.startsWith('https://qr.example.test/r/'), true);
    assert.match(qrBefore.svg, /<svg/);
    assert.ok(!qrBefore.url.includes('192.168.'));
    assert.ok(!qrBefore.url.includes('localhost'));
    const oldToken = (await prisma.restaurantTable.findUnique({ where: { id:legacyTable.id } })).qrToken;
    const qrAfter = await qr.regenerateTableQr(tenant.id, legacyTable.id);
    assert.notEqual(qrAfter.url, qrBefore.url);
    assert.equal(await prisma.restaurantTable.count({ where: { tenantId:tenant.id, qrToken:oldToken } }), 0, 'old QR token must be invalidated immediately');

"""
if marker not in zones_smoke:
    raise SystemExit('zones smoke marker missing')
zones_smoke = zones_smoke.replace(marker, qr_test + marker, 1)
zones_smoke = zones_smoke.replace("      deletedZoneReactivated: true\n", "      deletedZoneReactivated: true,\n      canonicalPublicQr: true,\n      qrSvgGeneratedLocally: true,\n      qrRegenerationInvalidatesOldToken: true\n", 1)
zones_smoke_path.write_text(zones_smoke)

# --- UI smoke tokens and cache expectations ---
smoke_path = Path('scripts/restaurant-control-center-operational-smoke.js')
smoke = smoke_path.read_text()
smoke = smoke.replace('restaurant-control-center\\.css\\?v=workspace-v7-kds', 'restaurant-control-center\\.css\\?v=workspace-v8-salon')
smoke = smoke.replace('restaurant-ui\\.js\\?v=kds-v2', 'restaurant-ui\\.js\\?v=salon-qr-v2')
insert = """  // Salón V2 + QR canónico: operación separada de edición, lista/plano y URL pública del servidor.
  for (const token of [
    "salonView:", "salonEdit:", 'OPERACIÓN DEL SALÓN', 'Gestionar zonas', 'Gestionar QR', 'Editar plano',
    'data-salon-view="PLANO"', 'data-salon-view="LISTA"', 'openQrManager', 'showQr', 'regenerateQr',
    '/mesas/${id}/qr', '/qr/regenerar', '/zonas/${zone.id}/qrs', "api('/api/v1/restaurante/qrs')",
    'URL pública canónica', 'datos móviles o el Wi-Fi del restaurante', 'qrPrintHtml'
  ]) assert.ok(operationalEngine.includes(token), `Salon/QR V2 must contain ${token}`);
  assert.ok(!operationalEngine.includes('location.origin}/r/'), 'Printed table QR must never depend on the current browser origin');
  assert.match(shellCss, /\/\* Salón V2 — operación de mesas separada de edición y gestión QR\. \*\//);
  assert.match(shellCss, /\.salon-floor\{[^}]*min-height:560px/);
  assert.match(shellCss, /\.qr-print-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);

"""
anchor = '  // KDS V2: KPIs reales, filtros, sonido, fullscreen, detalle y contexto zona/mesero.\n'
if anchor not in smoke:
    raise SystemExit('operational smoke KDS anchor missing')
smoke = smoke.replace(anchor, insert + anchor, 1)
smoke_path.write_text(smoke)

phase2_path = Path('scripts/restaurant-phase2-ui-smoke.js')
phase2 = phase2_path.read_text().replace('restaurant-ui.js?v=kds-v2', 'restaurant-ui.js?v=salon-qr-v2').replace('workspace-v7-kds', 'workspace-v8-salon')
phase2_path.write_text(phase2)

identity_path = Path('scripts/restaurant-identity-ui-smoke.js')
identity = identity_path.read_text()
if "assert.ok(ui.includes('/api/v1/restaurante/comandas'));" in identity:
    identity = identity.replace("assert.ok(ui.includes('/api/v1/restaurante/comandas'));", "assert.ok(ui.includes('/api/v1/restaurante/comandas'));\nassert.ok(ui.includes('/qr/regenerar'));\nassert.ok(!ui.includes('location.origin}/r/'));", 1)
identity_path.write_text(identity)

# Routes source smoke for canonical QR management.
waiter_smoke_path = Path('scripts/restaurant-waiter-v2-smoke.js')
waiter_smoke = waiter_smoke_path.read_text()
if "const routes = fs.readFileSync('src/modules/restaurant/restaurant.routes.js', 'utf8');" in waiter_smoke and "restaurant-qr.service" not in waiter_smoke:
    waiter_smoke = waiter_smoke.replace("const routes = fs.readFileSync('src/modules/restaurant/restaurant.routes.js', 'utf8');", "const routes = fs.readFileSync('src/modules/restaurant/restaurant.routes.js', 'utf8');\n  const qrService = fs.readFileSync('src/modules/restaurant/restaurant-qr.service.js', 'utf8');", 1)
    waiter_smoke = waiter_smoke.replace("assert.match(routes, /enviar-caja/);", "assert.match(routes, /enviar-caja/);\n  assert.match(routes, /mesas\\/:id\\/qr/);\n  assert.match(routes, /qr\\/regenerar/);\n  assert.match(qrService, /RESTAURANT_PUBLIC_BASE_URL/);\n  assert.match(qrService, /https:\\/\\/core\\.\\$\\{tenantBaseDomain\\}/);\n  assert.match(qrService, /QRCode\\.toString/);", 1)
waiter_smoke_path.write_text(waiter_smoke)

print('SALON_QR_V2_APPLIED')
