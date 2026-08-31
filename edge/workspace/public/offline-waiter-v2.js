(() => {
  'use strict';

  const MARKER = 'EDGE_OFFLINE_WAITER_REVIEW_HARD_GATE_V2';
  let current = null;
  let selectedSeat = 1;
  let busy = false;

  const moneyLocal = (value) => new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: state?.catalog?.tenant?.moneda || 'COP',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

  async function waiterApi(suffix = '', options = {}) {
    if (!selectedTable) throw new Error('Selecciona una mesa abierta.');
    return api(`/workspace/api/offline-waiter/tables/${encodeURIComponent(selectedTable)}${suffix}`, options);
  }

  function tableRow() {
    return (state?.restaurant?.tables || []).find((row) => row.id === selectedTable) || null;
  }

  function menuRows() {
    return (state?.restaurant?.menu || []).filter((row) => row.available !== false);
  }

  function lineFor(menuItemId, seatNumber) {
    return current?.draft?.items?.find((line) => line.menuItemId === menuItemId && Number(line.seatNumber || 0) === Number(seatNumber || 0)) || null;
  }

  function activeSeat() {
    if (current?.service?.billingMode !== 'INDIVIDUAL') return null;
    const count = Math.max(1, Number(current?.service?.guestCount || 1));
    if (selectedSeat > count) selectedSeat = count;
    if (selectedSeat < 1) selectedSeat = 1;
    return selectedSeat;
  }

  function reviewed() {
    return current?.draft?.reviewedRevision != null
      && Number(current.draft.reviewedRevision) === Number(current.draft.revision)
      && (current?.draft?.items || []).length > 0;
  }

  function lockMode() {
    const localOrders = state?.ledger?.tables?.[selectedTable]?.orders || [];
    return localOrders.length > 0 || (current?.draft?.items || []).length > 0;
  }

  function seatLabel(line) {
    if (current?.service?.billingMode !== 'INDIVIDUAL') return 'Cuenta conjunta';
    return `Persona ${Number(line.seatNumber || 1)}`;
  }

  function styles() {
    if (document.querySelector('#offlineWaiterV2Styles')) return;
    const tag = document.createElement('style');
    tag.id = 'offlineWaiterV2Styles';
    tag.textContent = `
      .ow-shell{display:grid;gap:12px}.ow-service{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px;border:1px solid var(--line);border-radius:13px;background:#f8faf9}
      .ow-service .label{font-size:11px;font-weight:900;color:var(--muted);letter-spacing:.05em}.ow-toggle{min-height:44px}.ow-toggle.active{background:var(--green);border-color:var(--green);color:#fff}
      .ow-persons{display:flex;gap:7px;overflow:auto;padding:3px 0}.ow-person{min-width:104px;min-height:46px}.ow-person.active{background:var(--soft);border-color:var(--green);color:var(--green);font-weight:900}
      .ow-menu{display:grid;grid-template-columns:repeat(auto-fill,minmax(225px,1fr));gap:10px}.ow-item{border:1px solid var(--line);border-radius:13px;padding:12px;background:#fff;display:grid;gap:8px}.ow-item .meta{font-size:11px;color:var(--muted)}
      .ow-stepper{display:grid;grid-template-columns:48px 1fr 48px;gap:6px;align-items:center}.ow-stepper button{min-height:48px;font-size:23px}.ow-qty{text-align:center;font-size:20px;font-weight:900}.ow-note{width:100%;min-height:42px;padding:9px;border:1px solid #cfd6d2;border-radius:9px}
      .ow-review{border:1px solid #b7dec9;background:#f0faf5;border-radius:14px;padding:13px}.ow-review h3{margin:0 0 8px}.ow-review-line{display:grid;grid-template-columns:1fr auto;gap:6px;padding:9px 0;border-bottom:1px dashed #cbded3}.ow-review-line:last-child{border-bottom:0}.ow-review-line small{color:var(--muted)}
      .ow-review-total{display:flex;justify-content:space-between;gap:10px;font-size:20px;font-weight:900;padding-top:12px}.ow-primary{width:100%;min-height:58px;font-size:15px}.ow-warning{padding:10px 12px;border-radius:11px;background:#fff7ed;border:1px solid #fed7aa;color:#9a4d00;font-size:12px;font-weight:760}
      .ow-status{font-size:11px;font-weight:900;color:var(--green);letter-spacing:.05em}.ow-actions{display:grid;grid-template-columns:1fr;gap:8px;margin-top:10px}
      @media(max-width:620px){.ow-menu{grid-template-columns:1fr}.ow-service{align-items:stretch}.ow-service .label{width:100%}.ow-toggle{flex:1}.ow-review-line{grid-template-columns:1fr}}
    `;
    document.head.appendChild(tag);
  }

  function serviceControls() {
    const service = current.service;
    const count = Math.max(1, Number(service.guestCount || 1));
    const modeLocked = lockMode();
    const persons = service.billingMode === 'INDIVIDUAL'
      ? `<div class="ow-persons">${Array.from({ length: count }, (_, index) => {
          const seat = index + 1;
          const total = (current.draft.items || []).filter((line) => Number(line.seatNumber || 1) === seat).reduce((sum, line) => sum + Number(line.lineTotal || 0), 0);
          return `<button type="button" class="btn ow-person ${seat === activeSeat() ? 'active' : ''}" data-ow-seat="${seat}">Persona ${seat}<br><small>${moneyLocal(total)}</small></button>`;
        }).join('')}</div>`
      : '';
    return `<div class="ow-service">
      <span class="label">TIPO DE CUENTA</span>
      <button type="button" class="btn ow-toggle ${service.billingMode === 'CONJUNTA' ? 'active' : ''}" data-ow-mode="CONJUNTA" ${modeLocked && service.billingMode !== 'CONJUNTA' ? 'disabled' : ''}>Conjunta</button>
      <button type="button" class="btn ow-toggle ${service.billingMode === 'INDIVIDUAL' ? 'active' : ''}" data-ow-mode="INDIVIDUAL" ${modeLocked && service.billingMode !== 'INDIVIDUAL' ? 'disabled' : ''}>Individual</button>
      <span class="label">PERSONAS · ${count}</span>
      <button type="button" class="btn" data-ow-person="minus" ${count <= 1 ? 'disabled' : ''}>− Persona</button>
      <button type="button" class="btn" data-ow-person="plus">+ Persona</button>
      ${modeLocked ? '<span class="muted" style="font-size:11px">El modo queda fijo después del primer producto.</span>' : ''}
    </div>${persons}`;
  }

  function productCards() {
    const seat = activeSeat();
    return `<div class="ow-menu">${menuRows().map((menu) => {
      const line = lineFor(menu.id, seat);
      const qty = Number(line?.quantity || 0);
      return `<div class="ow-item">
        <div class="meta">${esc(menu.category || '')} · ${esc(menu.station || '')}${seat ? ` · Persona ${seat}` : ''}</div>
        <b>${esc(menu.product?.nombre || 'Producto')}</b>
        <strong>${moneyLocal(menu.product?.precio1 || 0)}</strong>
        <div class="ow-stepper">
          <button type="button" class="btn" data-ow-delta="-1" data-menu-id="${menu.id}" ${qty <= 0 ? 'disabled' : ''}>−</button>
          <div class="ow-qty">${qty}</div>
          <button type="button" class="btn" data-ow-delta="1" data-menu-id="${menu.id}">+</button>
        </div>
        <input class="ow-note" data-ow-note="${menu.id}" value="${esc(line?.notes || '')}" placeholder="Nota: sin cebolla, término, alergia…" ${qty <= 0 ? 'disabled' : ''}>
      </div>`;
    }).join('')}</div>`;
  }

  function reviewPanel() {
    const items = current?.draft?.items || [];
    if (!items.length) return '<div class="ow-warning">Agrega productos. Nada se envía a Cocina, Barra o Postres mientras estés aquí.</div>';
    if (!reviewed()) {
      return `<div class="ow-actions"><button type="button" class="btn primary ow-primary" data-ow-review>REVISAR PEDIDO · ${moneyLocal(current.draft.total)}</button><div class="ow-warning">Revisa productos, cantidades, persona y notas antes de confirmar. Este botón todavía no envía nada.</div></div>`;
    }
    return `<div class="ow-review">
      <div class="ow-status">PEDIDO POR CONFIRMAR</div>
      <h3>Revisa antes de enviar</h3>
      ${items.map((line) => `<div class="ow-review-line"><div><b>${Number(line.quantity)}× ${esc(line.name)}</b><br><small>${esc(seatLabel(line))}${line.notes ? ` · ${esc(line.notes)}` : ''}</small></div><strong>${moneyLocal(line.lineTotal)}</strong></div>`).join('')}
      <div class="ow-review-total"><span>Total pedido</span><span>${moneyLocal(current.draft.total)}</span></div>
      <div class="ow-actions"><button type="button" class="btn primary ow-primary" data-ow-confirm>CONFIRMAR PEDIDO</button><button type="button" class="btn" data-ow-edit>Volver a editar</button></div>
    </div>`;
  }

  function paint() {
    if (view !== 'waiter' || !current || !selectedTable) return;
    const tables = (state.restaurant.tables || []).filter((row) => row.activeSession);
    const table = tableRow();
    $('#title').textContent = 'Mesero · Local';
    $('#view').innerHTML = `<div class="card ow-shell">
      <div class="section-head"><div><h2>${reviewed() ? 'Pedido por confirmar' : 'Tomar pedido'}</h2><div class="muted">${state.connected ? 'Edge local conectado al Core' : 'Modo offline: el pedido queda seguro en este PC'}</div></div>
      <select id="waiterTable" class="select push">${tables.map((row) => `<option value="${row.id}" ${row.id === selectedTable ? 'selected' : ''}>${esc(row.name)} · ${moneyLocal(tableBill(row.id))}</option>`).join('')}</select></div>
      <div class="notice"><b>${esc(table?.name || 'Mesa')}</b> · Total local ${moneyLocal(tableBill(selectedTable))} · ${current.service.guestCount} persona(s)</div>
      ${serviceControls()}
      ${reviewed() ? '' : productCards()}
      ${reviewPanel()}
    </div>`;
    bind();
  }

  async function loadDraft() {
    if (!selectedTable) return;
    try {
      current = await waiterApi();
      activeSeat();
      paint();
    } catch (error) {
      flash(error.message, true);
    }
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    try { await action(); } catch (error) { flash(error.message, true); }
    finally { busy = false; }
  }

  async function changeService(patch) {
    const next = await waiterApi('/service', { method: 'PUT', body: JSON.stringify(patch) });
    current = next;
    activeSeat();
    paint();
  }

  async function setLine(menuItemId, quantity, notes) {
    const next = await waiterApi('/line', {
      method: 'PUT',
      body: JSON.stringify({ menuItemId, quantity, seatNumber: activeSeat(), notes: notes || null })
    });
    current = next;
    paint();
  }

  function bind() {
    $('#waiterTable')?.addEventListener('change', (event) => {
      selectedTable = event.target.value;
      current = null;
      selectedSeat = 1;
      void loadDraft();
    });
    $$('[data-ow-mode]').forEach((button) => button.addEventListener('click', () => run(() => changeService({ billingMode: button.dataset.owMode }))));
    $$('[data-ow-person]').forEach((button) => button.addEventListener('click', () => run(() => {
      const count = Math.max(1, Number(current.service.guestCount || 1));
      return changeService({ guestCount: button.dataset.owPerson === 'plus' ? count + 1 : count - 1 });
    })));
    $$('[data-ow-seat]').forEach((button) => button.addEventListener('click', () => {
      selectedSeat = Number(button.dataset.owSeat || 1);
      paint();
    }));
    $$('[data-ow-delta]').forEach((button) => button.addEventListener('click', () => run(async () => {
      const menuItemId = button.dataset.menuId;
      const line = lineFor(menuItemId, activeSeat());
      const quantity = Math.max(0, Number(line?.quantity || 0) + Number(button.dataset.owDelta || 0));
      await setLine(menuItemId, quantity, line?.notes || null);
    })));
    $$('[data-ow-note]').forEach((input) => input.addEventListener('change', () => run(async () => {
      const line = lineFor(input.dataset.owNote, activeSeat());
      if (!line) return;
      await setLine(input.dataset.owNote, line.quantity, input.value);
    })));
    $('[data-ow-review]')?.addEventListener('click', () => run(async () => {
      current = await waiterApi('/review', { method: 'POST', body: '{}' });
      paint();
    }));
    $('[data-ow-edit]')?.addEventListener('click', () => {
      current = { ...current, draft: { ...current.draft, reviewedRevision: null } };
      paint();
    });
    $('[data-ow-confirm]')?.addEventListener('click', () => run(async () => {
      const result = await waiterApi('/confirm', { method: 'POST', body: '{}' });
      flash(state.connected ? 'Pedido confirmado. Enviado a KDS y sincronización automática.' : 'Pedido confirmado. Enviado al KDS local y guardado para sincronizar cuando vuelva Internet.');
      current = null;
      await load();
      if (view !== 'waiter') setView('waiter');
      await loadDraft();
      return result;
    }));
  }

  const originalRenderWaiter = renderWaiter;
  renderWaiter = function offlineRenderWaiterV2() {
    styles();
    const tables = (state?.restaurant?.tables || []).filter((row) => row.activeSession);
    if (!selectedTable || !tables.some((row) => row.id === selectedTable)) selectedTable = tables[0]?.id || null;
    $('#title').textContent = 'Mesero · Local';
    if (!selectedTable) {
      current = null;
      $('#view').innerHTML = '<div class="card"><div class="empty">No hay mesas abiertas.</div></div>';
      return;
    }
    $('#view').innerHTML = '<div class="card"><div class="empty">Cargando borrador local…</div></div>';
    void loadDraft();
  };

  window.VantixGCOfflineWaiterV2 = Object.freeze({
    marker: MARKER,
    reviewBeforeConfirm: true,
    directKitchenSendBlocked: true,
    personMigrationOnDecrease: true,
    noPolling: true,
    originalRenderAvailable: typeof originalRenderWaiter === 'function'
  });
})();
