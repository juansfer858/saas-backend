'use strict';

(() => {
  const SESSION_KEY = 'vantixgc_core_session_v1';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) {
    location.replace('/app/login');
    return;
  }

  const st = {
    tab: 'resumen',
    status: null,
    bikes: [],
    orders: [],
    appointments: [],
    services: [],
    users: [],
    customers: [],
    rules: [],
    blocks: []
  };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[char]);
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota'
    }).format(new Date(value));
  }

  function money(value) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: session?.tenant?.moneda || 'COP', maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'x-tenant-subdomain': session.subdomain,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (response.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      location.replace('/app/login');
      throw new Error('Sesión vencida');
    }
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function badge(status) {
    const good = new Set(['READY', 'DELIVERED', 'COMPLETED', 'CONFIRMED', 'ACTIVE']);
    const bad = new Set(['CANCELLED', 'NO_SHOW']);
    const warn = new Set(['DIAGNOSIS', 'WAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'FINAL_TEST', 'PENDING', 'RECEIVED']);
    const cls = good.has(status) ? 'good' : bad.has(status) ? 'danger' : warn.has(status) ? 'warn' : '';
    return `<span class="badge ${cls}">${esc(status || '—')}</span>`;
  }

  function flash(message, error = false) {
    const target = $('#flash');
    if (!target) return;
    target.innerHTML = `<div class="${error ? 'error' : 'notice'}">${esc(message)}</div>`;
    setTimeout(() => { if ($('#flash')) $('#flash').innerHTML = ''; }, 5000);
  }

  function modal(content) {
    $('#modalRoot').innerHTML = `<div class="modal-back"><div class="modal">${content}</div></div>`;
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; }

  function navButton(tab, label) {
    return `<button data-tab="${tab}" class="${st.tab === tab ? 'active' : ''}">${label}</button>`;
  }

  function shell() {
    return `<div class="app">
      <aside class="side">
        <div class="brand">VANTIX BIKE<small>Super Core · vertical ciclismo</small></div>
        <div class="tenant"><strong>${esc(session.tenant?.nombreEmpresa || session.subdomain)}</strong><span>${esc(session.subdomain)}</span></div>
        <nav class="nav">
          ${navButton('resumen', 'Resumen')}
          ${navButton('taller', 'Taller')}
          ${navButton('agenda', 'Agenda')}
          ${navButton('bicicletas', 'Bicicletas')}
          ${navButton('horarios', 'Horarios de mecánicos')}
          <a href="/app/inventario">Inventario / Kardex</a>
          <a href="/app/ventas">Ventas / Caja</a>
          <a href="/app/terceros">Clientes / Terceros</a>
          <a href="/app/dashboard">Super Core</a>
        </nav>
      </aside>
      <main class="main">
        <header class="top"><div><strong>Centro Bike</strong><br><small>Operación de tienda y taller</small></div><button class="btn small" id="logout">Salir</button></header>
        <section class="content"><div id="flash"></div><div id="view"></div></section>
      </main>
    </div>`;
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.items)) return value.items;
    return [];
  }

  async function loadBase() {
    const results = await Promise.all([
      api('/api/v1/bike/status'),
      api('/api/v1/bike/bicicletas?limit=500'),
      api('/api/v1/bike/ordenes?limit=500'),
      api('/api/v1/bike/agenda/citas?limit=500'),
      api('/api/v1/bike/servicios?active=true&limit=500'),
      api('/api/v1/usuarios'),
      api('/api/v1/terceros?activo=true&limit=500'),
      api('/api/v1/bike/agenda/reglas?active=true'),
      api('/api/v1/bike/agenda/bloqueos')
    ]);
    st.status = results[0];
    st.bikes = normalizeList(results[1]);
    st.orders = normalizeList(results[2]);
    st.appointments = normalizeList(results[3]);
    st.services = normalizeList(results[4]);
    st.users = normalizeList(results[5]);
    st.customers = normalizeList(results[6]).filter((row) => ['CLIENTE', 'CLIENTE_PROVEEDOR'].includes(row.tipo));
    st.rules = normalizeList(results[7]);
    st.blocks = normalizeList(results[8]);
  }

  async function refresh() { await loadBase(); }

  function mechanicName(userId) {
    const user = st.users.find((row) => row.id === userId);
    return user?.nombre || user?.email || userId || 'Sin asignar';
  }

  function ordersTable(rows) {
    if (!rows.length) return '<div class="empty">No hay órdenes.</div>';
    return `<div class="table-wrap"><table class="table"><thead><tr><th>OT</th><th>Bicicleta</th><th>Estado</th><th>Mecánico</th><th>Total</th></tr></thead><tbody>${rows.map((row) => `
      <tr><td><strong>${esc(row.number)}</strong></td><td>${esc(row.bike?.brand || '')} ${esc(row.bike?.model || '')}</td><td>${badge(row.status)}</td><td>${esc(mechanicName(row.assignedUserId))}</td><td>${money(row.total)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderSummary() {
    const open = st.orders.filter((row) => !['DELIVERED', 'CANCELLED'].includes(row.status)).length;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const todayAppointments = st.appointments.filter((row) => new Date(row.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) === today && !['CANCELLED', 'NO_SHOW'].includes(row.status)).length;
    const waiting = st.orders.filter((row) => row.status === 'WAITING_APPROVAL').length;
    $('#view').innerHTML = `<div class="head"><div><h1>Operación Bike</h1><div class="muted">Tienda, taller y agenda sobre contratos del Super Core.</div></div><div class="toolbar"><button class="btn primary" data-new-appointment>+ Cita</button><button class="btn" data-go="taller">Ver taller</button></div></div>
      <div class="grid4"><div class="stat"><span class="muted">Bicicletas</span><b>${st.bikes.length}</b></div><div class="stat"><span class="muted">OT abiertas</span><b>${open}</b></div><div class="stat"><span class="muted">Esperando autorización</span><b>${waiting}</b></div><div class="stat"><span class="muted">Citas hoy</span><b>${todayAppointments}</b></div></div>
      <div class="panel"><div class="panel-head"><strong>Últimas órdenes</strong></div>${ordersTable(st.orders.slice(0, 8))}</div>`;
    bindPageActions();
  }

  function renderWorkshop() {
    $('#view').innerHTML = `<div class="head"><div><h1>Taller</h1><div class="muted">Órdenes reales, diagnóstico, autorizaciones, repuestos y prueba final.</div></div></div><div class="panel"><div class="panel-head"><strong>Órdenes de trabajo</strong><span class="muted">${st.orders.length}</span></div>${ordersTable(st.orders)}</div>`;
  }

  function renderAgenda() {
    const rows = st.appointments.map((row) => `<tr>
      <td>${formatDate(row.startsAt)}</td><td>${esc(row.service?.name || 'Servicio')}</td><td>${esc(mechanicName(row.assignedUserId))}</td><td>${esc(row.bike ? `${row.bike.brand} ${row.bike.model}` : 'Sin bicicleta')}</td><td>${badge(row.status)}</td>
      <td><div class="toolbar">${row.status === 'PENDING' ? `<button class="btn small" data-confirm="${row.id}">Confirmar</button>` : ''}${['PENDING', 'CONFIRMED'].includes(row.status) ? `<button class="btn small danger" data-cancel="${row.id}">Cancelar</button>` : ''}${row.status === 'CONFIRMED' && row.bikeId ? `<button class="btn small primary" data-convert="${row.id}">Ingresar al taller</button>` : ''}</div></td></tr>`).join('');
    $('#view').innerHTML = `<div class="head"><div><h1>Agenda</h1><div class="muted">Recepción, portal y WhatsApp comparten los mismos cupos.</div></div><button class="btn primary" data-new-appointment>+ Nueva cita</button></div><div class="panel"><div class="panel-head"><strong>Citas</strong><span class="muted">${st.appointments.length}</span></div>${rows ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Servicio</th><th>Mecánico</th><th>Bicicleta</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No hay citas.</div>'}</div>`;
    bindPageActions();
    $$('[data-confirm]').forEach((button) => button.onclick = () => simpleAction(`/api/v1/bike/agenda/citas/${button.dataset.confirm}/confirmar`, 'POST', 'Cita confirmada.'));
    $$('[data-cancel]').forEach((button) => button.onclick = () => cancelAppointment(button.dataset.cancel));
    $$('[data-convert]').forEach((button) => button.onclick = () => simpleAction(`/api/v1/bike/agenda/citas/${button.dataset.convert}/convertir-ot`, 'POST', 'Cita convertida en OT.'));
  }

  function renderBikes() {
    const rows = st.bikes.map((row) => `<tr><td><strong>${esc(row.code)}</strong></td><td>${esc(row.brand)} ${esc(row.model)}</td><td>${esc(row.serial || '—')}</td><td>${esc(row.bikeType || '—')}</td><td>${esc(row.frameSize || '—')}</td><td>${badge(row.status)}</td><td>${row._count?.workOrders || 0}</td></tr>`).join('');
    $('#view').innerHTML = `<div class="head"><div><h1>Bicicletas</h1><div class="muted">Pasaporte permanente, serial y trazabilidad.</div></div><button class="btn primary" id="newBike">+ Bicicleta</button></div><div class="panel">${rows ? `<div class="table-wrap"><table class="table"><thead><tr><th>Código</th><th>Bicicleta</th><th>Serial</th><th>Tipo</th><th>Talla</th><th>Estado</th><th>OT</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No hay bicicletas.</div>'}</div>`;
    $('#newBike').onclick = openBikeModal;
  }

  function renderSchedules() {
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const rows = st.rules.map((row) => `<tr><td>${esc(mechanicName(row.userId))}</td><td>${days[row.dayOfWeek]}</td><td>${String(Math.floor(row.startMinute / 60)).padStart(2, '0')}:${String(row.startMinute % 60).padStart(2, '0')} – ${String(Math.floor(row.endMinute / 60)).padStart(2, '0')}:${String(row.endMinute % 60).padStart(2, '0')}</td><td>${esc(row.timeZone)}</td></tr>`).join('');
    $('#view').innerHTML = `<div class="head"><div><h1>Horarios de mecánicos</h1><div class="muted">Estas reglas determinan la disponibilidad que ve el cliente.</div></div><button class="btn primary" id="newRule">+ Horario</button></div><div class="panel">${rows ? `<div class="table-wrap"><table class="table"><thead><tr><th>Mecánico</th><th>Día</th><th>Horario</th><th>Zona</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No hay horarios configurados.</div>'}</div>`;
    $('#newRule').onclick = openRuleModal;
  }

  function render() {
    $$('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === st.tab));
    if (st.tab === 'resumen') renderSummary();
    else if (st.tab === 'taller') renderWorkshop();
    else if (st.tab === 'agenda') renderAgenda();
    else if (st.tab === 'bicicletas') renderBikes();
    else renderSchedules();
  }

  function bindPageActions() {
    $$('[data-new-appointment]').forEach((button) => button.onclick = openAppointmentModal);
    $$('[data-go]').forEach((button) => button.onclick = () => { st.tab = button.dataset.go; render(); });
  }

  function customerOptions() {
    return st.customers.map((row) => `<option value="${row.id}">${esc(row.nombre || row.razonSocial)} · ${esc(row.telefono || row.identificacion)}</option>`).join('');
  }
  function serviceOptions() {
    return st.services.map((row) => `<option value="${row.id}">${esc(row.name)} · ${row.estimatedMinutes} min</option>`).join('');
  }
  function userOptions() {
    return st.users.map((row) => `<option value="${row.id}">${esc(row.nombre || row.email)}</option>`).join('');
  }

  function openAppointmentModal() {
    modal(`<h2>Nueva cita</h2><form id="appointmentForm"><div class="form-grid">
      <div class="field"><label>Cliente</label><select class="select" id="aCustomer" required><option value="">Seleccione</option>${customerOptions()}</select></div>
      <div class="field"><label>Bicicleta</label><select class="select" id="aBike"><option value="">Sin seleccionar</option></select></div>
      <div class="field"><label>Servicio</label><select class="select" id="aService" required><option value="">Seleccione</option>${serviceOptions()}</select></div>
      <div class="field"><label>Fecha</label><input class="input" id="aDate" type="date" required></div></div>
      <div class="panel" id="slotPanel" style="display:none"><div class="panel-head"><strong>Cupos disponibles</strong></div><div class="panel-body"><div class="slot-grid" id="slots"></div></div></div>
      <input type="hidden" id="aMechanic"><input type="hidden" id="aStart"><div class="field"><label>Nota del cliente</label><textarea class="input" id="aNote" rows="3"></textarea></div>
      <div class="actions"><button type="button" class="btn" id="closeModal">Cancelar</button><button class="btn primary" type="submit">Reservar</button></div></form>`);
    const customer = $('#aCustomer');
    const bike = $('#aBike');
    customer.onchange = () => {
      bike.innerHTML = '<option value="">Sin seleccionar</option>' + st.bikes.filter((row) => row.customerThirdPartyId === customer.value).map((row) => `<option value="${row.id}">${esc(row.brand)} ${esc(row.model)} · ${esc(row.code)}</option>`).join('');
    };
    async function loadSlots() {
      const date = $('#aDate').value;
      const serviceId = $('#aService').value;
      if (!date || !serviceId) return;
      try {
        const slots = normalizeList(await api(`/api/v1/bike/agenda/disponibilidad?date=${encodeURIComponent(date)}&serviceCatalogId=${encodeURIComponent(serviceId)}&stepMinutes=15`));
        $('#slotPanel').style.display = 'block';
        $('#slots').innerHTML = slots.length ? slots.map((slot) => `<button type="button" class="slot" data-start="${slot.startsAt}" data-user="${slot.assignedUserId}"><strong>${new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }).format(new Date(slot.startsAt))}</strong><br><small>${esc(slot.mechanicName || 'Mecánico')} · ${slot.durationMinutes} min</small></button>`).join('') : '<div class="empty">No hay cupos disponibles.</div>';
        $$('.slot').forEach((button) => button.onclick = () => {
          $$('.slot').forEach((item) => item.classList.remove('selected'));
          button.classList.add('selected');
          $('#aStart').value = button.dataset.start;
          $('#aMechanic').value = button.dataset.user;
        });
      } catch (error) { flash(error.message, true); }
    }
    $('#aDate').onchange = loadSlots;
    $('#aService').onchange = loadSlots;
    $('#closeModal').onclick = closeModal;
    $('#appointmentForm').onsubmit = async (event) => {
      event.preventDefault();
      if (!$('#aStart').value) { flash('Selecciona un cupo disponible.', true); return; }
      try {
        await api('/api/v1/bike/agenda/citas', {
          method: 'POST',
          body: JSON.stringify({
            customerThirdPartyId: customer.value,
            bikeId: bike.value || null,
            serviceCatalogId: $('#aService').value,
            assignedUserId: $('#aMechanic').value,
            startsAt: $('#aStart').value,
            source: 'INTERNAL',
            customerNotes: $('#aNote').value || null
          })
        });
        closeModal();
        await refresh();
        st.tab = 'agenda';
        render();
        flash('Cita creada.');
      } catch (error) { flash(error.message, true); }
    };
  }

  function openBikeModal() {
    modal(`<h2>Nueva bicicleta</h2><form id="bikeForm"><div class="form-grid">
      <div class="field"><label>Cliente</label><select id="bCustomer" class="select" required><option value="">Seleccione</option>${customerOptions()}</select></div>
      <div class="field"><label>Código</label><input id="bCode" class="input" required placeholder="VB-0001"></div><div class="field"><label>Marca</label><input id="bBrand" class="input" required></div><div class="field"><label>Modelo</label><input id="bModel" class="input" required></div>
      <div class="field"><label>Serial</label><input id="bSerial" class="input"></div><div class="field"><label>Tipo</label><input id="bType" class="input" placeholder="MTB / ruta / urbana"></div><div class="field"><label>Talla</label><input id="bSize" class="input"></div><div class="field"><label>Color</label><input id="bColor" class="input"></div></div>
      <div class="actions"><button type="button" class="btn" id="closeModal">Cancelar</button><button class="btn primary" type="submit">Guardar</button></div></form>`);
    $('#closeModal').onclick = closeModal;
    $('#bikeForm').onsubmit = async (event) => {
      event.preventDefault();
      try {
        await api('/api/v1/bike/bicicletas', { method: 'POST', body: JSON.stringify({ customerThirdPartyId: $('#bCustomer').value, code: $('#bCode').value, brand: $('#bBrand').value, model: $('#bModel').value, serial: $('#bSerial').value || null, bikeType: $('#bType').value || null, frameSize: $('#bSize').value || null, color: $('#bColor').value || null }) });
        closeModal(); await refresh(); st.tab = 'bicicletas'; render(); flash('Bicicleta registrada.');
      } catch (error) { flash(error.message, true); }
    };
  }

  function openRuleModal() {
    modal(`<h2>Horario del mecánico</h2><form id="ruleForm"><div class="form-grid">
      <div class="field"><label>Mecánico</label><select id="rUser" class="select" required><option value="">Seleccione</option>${userOptions()}</select></div>
      <div class="field"><label>Día</label><select id="rDay" class="select"><option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option><option value="0">Domingo</option></select></div>
      <div class="field"><label>Desde</label><input id="rStart" class="input" type="time" value="08:00" required></div><div class="field"><label>Hasta</label><input id="rEnd" class="input" type="time" value="17:00" required></div></div>
      <div class="actions"><button type="button" class="btn" id="closeModal">Cancelar</button><button class="btn primary" type="submit">Guardar</button></div></form>`);
    $('#closeModal').onclick = closeModal;
    $('#ruleForm').onsubmit = async (event) => {
      event.preventDefault();
      const minutes = (value) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
      try {
        await api('/api/v1/bike/agenda/reglas', { method: 'POST', body: JSON.stringify({ userId: $('#rUser').value, dayOfWeek: Number($('#rDay').value), startMinute: minutes($('#rStart').value), endMinute: minutes($('#rEnd').value), timeZone: 'America/Bogota' }) });
        closeModal(); await refresh(); st.tab = 'horarios'; render(); flash('Horario guardado.');
      } catch (error) { flash(error.message, true); }
    };
  }

  async function simpleAction(path, method, message) {
    try { await api(path, { method }); await refresh(); render(); flash(message); }
    catch (error) { flash(error.message, true); }
  }

  async function cancelAppointment(id) {
    const reason = prompt('Motivo de cancelación:');
    if (!reason) return;
    try {
      await api(`/api/v1/bike/agenda/citas/${id}/cancelar`, { method: 'POST', body: JSON.stringify({ reason, source: 'INTERNAL' }) });
      await refresh(); render(); flash('Cita cancelada.');
    } catch (error) { flash(error.message, true); }
  }

  async function boot() {
    $('#root').innerHTML = shell();
    $('#logout').onclick = () => { localStorage.removeItem(SESSION_KEY); location.replace('/app/login'); };
    $$('[data-tab]').forEach((button) => button.onclick = () => { st.tab = button.dataset.tab; render(); });
    try { await refresh(); render(); }
    catch (error) {
      flash(error.message, true);
      $('#view').innerHTML = '<div class="panel"><div class="empty">No se pudo cargar Bike. Verifica que el vertical BIKE esté habilitado para esta empresa y que el usuario tenga permisos.</div></div>';
    }
  }

  boot();
})();
