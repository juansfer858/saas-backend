(() => {
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const SHIFT_KEY = 'restaurant_cash_shift';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token) return;

  let methods = [];
  let accounts = [];
  let selectedMethodId = null;
  let scanBusy = false;
  let managerEditingId = null;

  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (value) => new Intl.NumberFormat('es-CO', { style:'currency', currency:session.tenant?.moneda || 'COP', maximumFractionDigits:0 }).format(Number(value || 0));
  const canManage = () => ['ADMIN','ADMINISTRADOR','SUPER_ADMIN'].includes(String(session.user?.rol || '').toUpperCase());

  async function api(path, opts = {}) {
    const response = await fetch(path, {
      ...opts,
      cache:'no-store',
      headers:{
        'Content-Type':'application/json',
        Authorization:`Bearer ${session.token}`,
        'x-tenant-subdomain':session.subdomain,
        ...(opts.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function ensureStyles() {
    if ($('#restaurantPaymentMethodsStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantPaymentMethodsStyles';
    style.textContent = `
      .rpm-panel{margin:10px 0 4px;padding:12px;border:1px solid #d9e2e7;border-radius:14px;background:#f8fbfc}
      .rpm-panel-head{display:flex;align-items:center;gap:10px;margin-bottom:9px}.rpm-panel-head>div{min-width:0}.rpm-panel-head b{display:block;color:#122b4a;font-size:13px}.rpm-panel-head span{display:block;margin-top:2px;color:#66778b;font-size:11px}.rpm-panel-head button{margin-left:auto}
      .rpm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:7px}.rpm-method{min-height:58px;padding:9px 10px;border:1px solid #ccd7e0;border-radius:11px;background:#fff;color:#122b4a;text-align:left;font-weight:900;box-shadow:none}.rpm-method small{display:block;margin-top:3px;color:#6b7b8d;font-size:9px;font-weight:800}.rpm-method.active{border-color:#ff6b2c;background:#fff4ee;color:#b83f0e;box-shadow:0 0 0 2px rgba(255,107,44,.12)}
      .rpm-reference{display:grid;gap:4px;margin-top:9px;font-size:11px;font-weight:850;color:#44566b}.rpm-reference input{min-height:42px;padding:0 10px;border:1px solid #ccd7e0;border-radius:9px;background:#fff}.rpm-empty{padding:12px;border:1px dashed #d0d8de;border-radius:10px;color:#6b7280;font-size:12px}
      .rpm-dialog{width:min(780px,calc(100% - 20px));max-height:90vh;padding:0;border:0;border-radius:18px;background:#fff;box-shadow:0 28px 80px rgba(15,23,42,.28);overflow:hidden}.rpm-dialog::backdrop{background:rgba(15,23,42,.55);backdrop-filter:blur(3px)}.rpm-dialog-head{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #e5e7eb}.rpm-dialog-head h2{margin:0;font-size:21px}.rpm-dialog-head button{margin-left:auto}.rpm-dialog-body{padding:16px;overflow:auto;max-height:calc(90vh - 70px)}
      .rpm-list{display:grid;gap:8px}.rpm-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px;border:1px solid #e1e7eb;border-radius:12px}.rpm-row b{display:block}.rpm-row small{display:block;margin-top:3px;color:#6b7280}.rpm-row.inactive{opacity:.58}.rpm-actions{display:flex;gap:6px;flex-wrap:wrap}
      .rpm-form{display:grid;grid-template-columns:1.2fr 1fr 1.2fr auto;gap:8px;align-items:end;margin-top:14px;padding:13px;border-radius:12px;background:#f6f8fa;border:1px solid #e1e7eb}.rpm-form label{display:grid;gap:4px;font-size:10px;font-weight:900;color:#475569}.rpm-form input,.rpm-form select{min-height:43px;padding:0 9px;border:1px solid #cbd5e1;border-radius:9px;background:#fff}.rpm-form-check{display:flex!important;align-items:center!important;gap:6px!important;min-height:43px}.rpm-form-check input{min-height:0!important;width:18px;height:18px}.rpm-form-buttons{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end}.rpm-account-create{margin-top:10px;padding:10px;border:1px dashed #cbd5e1;border-radius:10px;background:#fff}
      .rpm-report-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.rpm-report-kpi{padding:11px;border:1px solid #e1e7eb;border-radius:11px;background:#f8fafc}.rpm-report-kpi small{display:block;color:#64748b;font-size:10px;font-weight:850;text-transform:uppercase}.rpm-report-kpi b{display:block;margin-top:4px;font-size:19px;color:#0f172a}.rpm-report-kpi.cash b{color:#067647}.rpm-report-kpi.transfer b{color:#0b68a8}.rpm-report-kpi.card b{color:#6d28d9}.rpm-report-kpi.diff.good b{color:#067647}.rpm-report-kpi.diff.bad b{color:#b42318}
      .rpm-report-table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}.rpm-report-table th,.rpm-report-table td{padding:9px;border-bottom:1px solid #e5e7eb;text-align:left}.rpm-report-table th{color:#64748b;font-size:10px;text-transform:uppercase}.rpm-report-table td:last-child,.rpm-report-table th:last-child{text-align:right}.rpm-report-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.cash-methods.rpm-base-hidden,#accountLabel.rpm-base-hidden{display:none!important}
      @media(max-width:700px){.rpm-form{grid-template-columns:1fr}.rpm-form-buttons{grid-column:auto}.rpm-report-kpis{grid-template-columns:1fr 1fr}.rpm-row{grid-template-columns:1fr}.rpm-actions{justify-content:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function ensureDialog(id, title) {
    let dialog = document.getElementById(id);
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = id;
      dialog.className = 'rpm-dialog';
      dialog.innerHTML = `<header class="rpm-dialog-head"><h2>${esc(title)}</h2><button type="button" class="ri-btn small" data-rpm-close>Cerrar</button></header><div class="rpm-dialog-body"></div>`;
      document.body.appendChild(dialog);
      $('[data-rpm-close]', dialog).addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    }
    return dialog;
  }

  async function loadMethods(force = false) {
    if (!methods.length || force) methods = await api('/api/v1/restaurante/metodos-pago') || [];
    return methods;
  }

  async function loadAccounts(force = false) {
    if (!accounts.length || force) accounts = await api('/api/v1/tesoreria/cajas-bancos') || [];
    return accounts;
  }

  function methodSub(method) {
    const labels = { EFECTIVO:'Efectivo', TRANSFERENCIA:'Transferencia / QR', TARJETA:'Tarjeta', CREDITO:'Crédito' };
    return `${labels[method.kind] || method.kind}${method.account?.nombre ? ` · ${method.account.nombre}` : ''}`;
  }

  function activeMethod() {
    return methods.find((row) => row.id === selectedMethodId && row.active) || null;
  }

  function parseMoneyText(text) {
    const cleaned = String(text || '').replace(/[^0-9,-]/g, '').replace(/\./g, '').replace(',', '.');
    return Number(cleaned || 0);
  }

  function selectedTableId() {
    return $('[data-cash-table].selected')?.dataset.cashTable || null;
  }

  function selectedAmount() {
    const nodes = $$('.cash-selected-summary b');
    return nodes.length ? parseMoneyText(nodes[nodes.length - 1].textContent) : 0;
  }

  function setMessage(text, error = false) {
    const root = $('#message');
    if (!root) return;
    root.innerHTML = `<div class="${error ? 'ri-error' : 'ri-notice'}">${esc(text)}</div>`;
  }

  function refreshCashInputs() {
    const method = activeMethod();
    const receivedRow = $('#cashReceivedRow');
    const reference = $('#rpmPaymentReferenceWrap');
    const close = $('#closeTable');
    if (receivedRow) receivedRow.hidden = method?.kind !== 'EFECTIVO';
    if (reference) reference.hidden = !['TRANSFERENCIA','TARJETA'].includes(method?.kind || '');
    if (!close) return;
    close.disabled = !method;
    const total = selectedAmount() + Number($('#tip')?.value || 0);
    if (method?.kind === 'EFECTIVO') {
      const received = Number($('#cashReceived')?.value || 0);
      close.disabled = !method || received < total;
      const change = $('#cashChange');
      if (change) change.textContent = money(Math.max(0, received - total));
    }
    close.textContent = method ? `Confirmar cobro · ${money(total)}` : 'Configura un método de pago';
  }

  async function renderCashMethods() {
    const panel = $('.cash-fast-panel');
    const baseMethods = $('.cash-methods');
    if (!panel || !baseMethods || $('#restaurantPaymentMethodPanel')) return;
    await loadMethods();
    const active = methods.filter((row) => row.active);
    if (!selectedMethodId || !active.some((row) => row.id === selectedMethodId)) selectedMethodId = active[0]?.id || null;
    baseMethods.classList.add('rpm-base-hidden');
    $('#accountLabel')?.classList.add('rpm-base-hidden');
    const root = document.createElement('section');
    root.id = 'restaurantPaymentMethodPanel';
    root.className = 'rpm-panel';
    root.innerHTML = `<div class="rpm-panel-head"><div><b>Método de pago</b><span>El cierre guardará el método exacto para el arqueo.</span></div>${canManage() ? '<button type="button" class="ri-btn small" data-rpm-manage>Gestionar métodos</button>' : ''}</div>${active.length ? `<div class="rpm-grid">${active.map((method) => `<button type="button" class="rpm-method ${method.id === selectedMethodId ? 'active' : ''}" data-rpm-method="${method.id}"><b>${esc(method.name)}</b><small>${esc(methodSub(method))}</small></button>`).join('')}</div>` : `<div class="rpm-empty">No hay métodos de pago activos.${canManage() ? ' Usa “Gestionar métodos” para crear el primero.' : ' Solicita al Administrador que los configure.'}</div>`}<label id="rpmPaymentReferenceWrap" class="rpm-reference" hidden>Referencia / comprobante<input id="rpmPaymentReference" maxlength="160" placeholder="Ej. comprobante 4821"></label>`;
    baseMethods.insertAdjacentElement('beforebegin', root);
    $$('[data-rpm-method]', root).forEach((button) => button.addEventListener('click', () => {
      selectedMethodId = button.dataset.rpmMethod;
      $$('[data-rpm-method]', root).forEach((row) => row.classList.toggle('active', row === button));
      refreshCashInputs();
    }));
    $('[data-rpm-manage]', root)?.addEventListener('click', () => openManager().catch((error) => alert(error.message)));
    $('#tip')?.addEventListener('input', refreshCashInputs);
    $('#cashReceived')?.addEventListener('input', refreshCashInputs);
    refreshCashInputs();
  }

  function accountOptions(kind, selected = null) {
    if (kind === 'CREDITO') return '<option value="">No aplica</option>';
    const wanted = kind === 'EFECTIVO' ? 'CAJA' : 'BANCO';
    const rows = accounts.filter((row) => row.activo && row.tipo === wanted);
    return `<option value="">Seleccionar…</option>${rows.map((row) => `<option value="${row.id}" ${row.id === selected ? 'selected' : ''}>${esc(row.nombre)}${row.banco ? ` · ${esc(row.banco)}` : ''}</option>`).join('')}`;
  }

  function managerBody() {
    const rows = methods.map((method) => `<div class="rpm-row ${method.active ? '' : 'inactive'}"><div><b>${esc(method.name)}</b><small>${esc(methodSub(method))} · ${method.active ? 'Activo' : 'Inactivo'}</small></div><div class="rpm-actions"><button type="button" class="ri-btn small" data-rpm-edit="${method.id}">Editar</button>${method.active ? `<button type="button" class="ri-btn small danger" data-rpm-disable="${method.id}">Desactivar</button>` : `<button type="button" class="ri-btn small" data-rpm-enable="${method.id}">Activar</button>`}</div></div>`).join('');
    return `<div class="rpm-list">${rows || '<div class="rpm-empty">Aún no hay métodos configurados.</div>'}</div><div class="rpm-account-create"><b>¿Necesitas Nequi, Daviplata, Bancolombia u otra billetera?</b><div style="margin-top:7px"><button type="button" class="ri-btn small" id="rpmCreateBank">+ Crear cuenta / billetera</button></div></div><form id="rpmMethodForm" class="rpm-form"><label>Nombre<input id="rpmName" maxlength="80" placeholder="Ej. Nequi"></label><label>Tipo<select id="rpmKind"><option value="EFECTIVO">Efectivo</option><option value="TRANSFERENCIA">Transferencia / QR</option><option value="TARJETA">Tarjeta</option><option value="CREDITO">Crédito</option></select></label><label>Caja / banco<select id="rpmAccount"></select></label><label class="rpm-form-check"><input id="rpmActive" type="checkbox" checked> Activo</label><div class="rpm-form-buttons"><button type="button" class="ri-btn" id="rpmCancelEdit" hidden>Cancelar edición</button><button type="submit" class="ri-btn primary" id="rpmSave">Guardar método</button></div></form>`;
  }

  function bindManager(dialog) {
    const body = $('.rpm-dialog-body', dialog);
    const kind = $('#rpmKind', body);
    const account = $('#rpmAccount', body);
    const refreshAccountOptions = (selected = null) => { account.innerHTML = accountOptions(kind.value, selected); account.disabled = kind.value === 'CREDITO'; };
    refreshAccountOptions();
    kind.addEventListener('change', () => refreshAccountOptions());

    $$('[data-rpm-edit]', body).forEach((button) => button.addEventListener('click', () => {
      const method = methods.find((row) => row.id === button.dataset.rpmEdit); if (!method) return;
      managerEditingId = method.id;
      $('#rpmName', body).value = method.name;
      kind.value = method.kind;
      $('#rpmActive', body).checked = method.active;
      refreshAccountOptions(method.cajaBancoId);
      $('#rpmCancelEdit', body).hidden = false;
      $('#rpmSave', body).textContent = 'Guardar cambios';
      $('#rpmName', body).focus();
    }));
    $$('[data-rpm-disable]', body).forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('¿Desactivar este método de pago? Los cierres anteriores conservarán su nombre.')) return;
      await api(`/api/v1/restaurante/metodos-pago/${button.dataset.rpmDisable}`, { method:'DELETE' });
      await refreshManager(dialog);
    }));
    $$('[data-rpm-enable]', body).forEach((button) => button.addEventListener('click', async () => {
      const method = methods.find((row) => row.id === button.dataset.rpmEnable); if (!method) return;
      await api(`/api/v1/restaurante/metodos-pago/${method.id}`, { method:'PATCH', body:JSON.stringify({ name:method.name, kind:method.kind, cajaBancoId:method.cajaBancoId, active:true, sortOrder:method.sortOrder }) });
      await refreshManager(dialog);
    }));
    $('#rpmCancelEdit', body).addEventListener('click', () => { managerEditingId = null; $('#rpmMethodForm', body).reset(); $('#rpmActive', body).checked=true; kind.value='EFECTIVO'; refreshAccountOptions(); $('#rpmCancelEdit', body).hidden=true; $('#rpmSave', body).textContent='Guardar método'; });
    $('#rpmMethodForm', body).addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = { name:$('#rpmName', body).value, kind:kind.value, cajaBancoId:account.value || null, active:$('#rpmActive', body).checked, sortOrder:managerEditingId ? (methods.find((row)=>row.id===managerEditingId)?.sortOrder || 100) : (methods.length + 1) * 10 };
      const save = $('#rpmSave', body); save.disabled=true;
      try {
        await api(managerEditingId ? `/api/v1/restaurante/metodos-pago/${managerEditingId}` : '/api/v1/restaurante/metodos-pago', { method:managerEditingId ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
        managerEditingId = null;
        await refreshManager(dialog);
      } catch (error) { alert(error.message); save.disabled=false; }
    });
    $('#rpmCreateBank', body).addEventListener('click', async () => {
      const name = prompt('Nombre visible, por ejemplo Nequi o Bancolombia QR'); if (!name?.trim()) return;
      const bank = prompt('Banco o billetera', name.trim()); if (bank === null) return;
      const number = prompt('Número de cuenta / celular (opcional)', '') || null;
      try {
        await api('/api/v1/tesoreria/cajas-bancos', { method:'POST', body:JSON.stringify({ tipo:'BANCO', nombre:name.trim(), banco:bank?.trim() || null, numeroCuenta:number?.trim() || null, saldoActual:0, activo:true }) });
        await loadAccounts(true);
        await refreshManager(dialog);
      } catch (error) { alert(error.message); }
    });
  }

  async function refreshManager(dialog) {
    methods = await api('/api/v1/restaurante/metodos-pago') || [];
    await loadAccounts(true);
    const body = $('.rpm-dialog-body', dialog);
    body.innerHTML = managerBody();
    bindManager(dialog);
    $('#restaurantPaymentMethodPanel')?.remove();
    $('.cash-methods')?.classList.remove('rpm-base-hidden');
    $('#accountLabel')?.classList.remove('rpm-base-hidden');
    await renderCashMethods();
  }

  async function openManager() {
    ensureStyles();
    await Promise.all([loadMethods(true), loadAccounts(true)]);
    managerEditingId = null;
    const dialog = ensureDialog('restaurantPaymentMethodsDialog', 'Métodos de pago');
    const body = $('.rpm-dialog-body', dialog);
    body.innerHTML = managerBody();
    bindManager(dialog);
    if (!dialog.open) dialog.showModal();
  }

  async function handleCloseTable(event, button) {
    const method = activeMethod();
    const tableId = selectedTableId();
    if (!method || !tableId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const saleTotal = selectedAmount();
    const tipAmount = Number($('#tip')?.value || 0);
    const total = saleTotal + tipAmount;
    if (method.kind === 'EFECTIVO' && Number($('#cashReceived')?.value || 0) < total) {
      alert('El efectivo recibido es menor que el total a cobrar.');
      return;
    }
    const parts = Math.max(1, Number($('#parts')?.value || 1));
    button.disabled = true; button.textContent = 'REGISTRANDO COBRO…';
    try {
      const result = await api(`/api/v1/restaurante/mesas/${tableId}/cerrar-con-metodo`, {
        method:'POST',
        body:JSON.stringify({
          paymentMethodId:method.id,
          reference:$('#rpmPaymentReference')?.value || null,
          tipAmount,
          split:parts > 1 ? { mode:'EQUAL', parts } : { mode:'NONE' }
        })
      });
      setMessage(`Cobro registrado · ${result.paymentMethod?.name || method.name} · ${result.sale?.numero || 'venta cerrada'}.`);
      selectedMethodId = null;
      $('[data-tab="caja"]')?.click();
    } catch (error) {
      setMessage(error.message, true);
      button.disabled = false;
      refreshCashInputs();
    }
  }

  function reportHtml(result, counted) {
    const summary = result.before || {};
    const breakdown = summary.paymentBreakdown || {};
    const closed = result.closed || {};
    const diff = Number(closed.descuadre || 0);
    const byMethod = Array.isArray(breakdown.byMethod) ? breakdown.byMethod : [];
    return `<div class="rpm-report-kpis"><div class="rpm-report-kpi"><small>Ventas del turno</small><b>${money(breakdown.restaurantTotal ?? summary.restaurantClosedTablesTotal)}</b></div><div class="rpm-report-kpi cash"><small>Efectivo</small><b>${money(breakdown.cashSales)}</b></div><div class="rpm-report-kpi transfer"><small>Transferencias / QR</small><b>${money(breakdown.transferSales)}</b></div><div class="rpm-report-kpi card"><small>Tarjetas</small><b>${money(breakdown.cardSales)}</b></div><div class="rpm-report-kpi"><small>Crédito</small><b>${money(breakdown.creditSales)}</b></div><div class="rpm-report-kpi"><small>Otros electrónicos</small><b>${money(breakdown.otherElectronicSales)}</b></div><div class="rpm-report-kpi"><small>Propinas</small><b>${money(breakdown.tips)}</b></div><div class="rpm-report-kpi"><small>Efectivo esperado</small><b>${money(summary.systemCashExpected)}</b></div><div class="rpm-report-kpi"><small>Efectivo contado</small><b>${money(counted)}</b></div><div class="rpm-report-kpi diff ${Math.abs(diff) < .005 ? 'good' : 'bad'}"><small>Diferencia</small><b>${money(diff)}</b></div></div>${byMethod.length ? `<table class="rpm-report-table"><thead><tr><th>Método</th><th>Tipo</th><th>Operaciones</th><th>Total</th></tr></thead><tbody>${byMethod.map((row) => `<tr><td><b>${esc(row.label)}</b>${row.accountName && row.accountName !== row.label ? `<small style="display:block;color:#64748b">${esc(row.accountName)}</small>` : ''}</td><td>${esc(String(row.kind || '').replaceAll('_',' '))}</td><td>${Number(row.count || 0)}</td><td>${money(row.total)}</td></tr>`).join('')}</tbody></table>` : '<div class="rpm-empty" style="margin-top:12px">No hubo cobros registrados en el turno.</div>'}<div class="rpm-report-foot"><button type="button" class="ri-btn" id="rpmPrintReport">Imprimir reporte</button><button type="button" class="ri-btn primary" id="rpmFinishReport">Cerrar reporte</button></div>`;
  }

  function printReport(dialog) {
    const body = $('.rpm-dialog-body', dialog)?.innerHTML || '';
    const popup = window.open('', '_blank', 'width=760,height=820');
    if (!popup) return;
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Cierre de caja</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}button{display:none}.rpm-report-kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.rpm-report-kpi{border:1px solid #ccc;padding:10px}.rpm-report-kpi small{display:block}.rpm-report-kpi b{font-size:18px}.rpm-report-table{width:100%;border-collapse:collapse;margin-top:16px}.rpm-report-table th,.rpm-report-table td{border-bottom:1px solid #ddd;padding:8px;text-align:left}.rpm-report-table td:last-child,.rpm-report-table th:last-child{text-align:right}</style></head><body><h1>Cierre de caja · VantixGC</h1>${body}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),100));<\/script></body></html>`);
    popup.document.close();
  }

  async function handleCloseShift(event, button) {
    const shiftId = localStorage.getItem(SHIFT_KEY);
    const physical = $('#physicalCount');
    if (!shiftId || !physical || physical.value === '') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const counted = Number(physical.value || 0);
    button.disabled = true; button.textContent = 'CERRANDO TURNO…';
    try {
      const result = await api(`/api/v1/restaurante/caja/turnos/${shiftId}/cerrar`, { method:'POST', body:JSON.stringify({ saldoFinal:counted }) });
      localStorage.removeItem(SHIFT_KEY);
      const dialog = ensureDialog('restaurantCashCloseReportDialog', 'Reporte de cierre de caja');
      const body = $('.rpm-dialog-body', dialog);
      body.innerHTML = reportHtml(result, counted);
      $('#rpmPrintReport', body)?.addEventListener('click', () => printReport(dialog));
      $('#rpmFinishReport', body)?.addEventListener('click', () => { dialog.close(); location.reload(); });
      dialog.addEventListener('close', () => { if (!localStorage.getItem(SHIFT_KEY)) location.reload(); }, { once:true });
      dialog.showModal();
    } catch (error) {
      alert(error.message);
      button.disabled = false; button.textContent = 'Cerrar turno';
    }
  }

  document.addEventListener('click', (event) => {
    const closeTable = event.target.closest?.('#closeTable');
    if (closeTable && $('#restaurantPaymentMethodPanel')) { handleCloseTable(event, closeTable).catch((error) => { alert(error.message); closeTable.disabled=false; }); return; }
    const closeShift = event.target.closest?.('#closeShift');
    if (closeShift) handleCloseShift(event, closeShift).catch((error) => { alert(error.message); closeShift.disabled=false; });
  }, true);

  async function scan() {
    if (scanBusy) return;
    scanBusy = true;
    try {
      if ($('.cash-fast-panel')) await renderCashMethods();
      else selectedMethodId = null;
    } finally { scanBusy = false; }
  }

  ensureStyles();
  const observer = new MutationObserver(() => queueMicrotask(() => scan().catch(() => {})));
  if (document.body) observer.observe(document.body, { childList:true, subtree:true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan().catch(() => {}), { once:true }); else scan().catch(() => {});
})();
