(() => {
  const SESSION_KEY = 'vantixgc_core_session_v1';
  let coreSession = null;
  try { coreSession = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!coreSession?.token) return;

  let observerBusy = false;
  let lastWaiterTable = null;
  let lastCashTable = null;
  let cashSummary = null;
  let cashAccounts = [];
  let paymentMethod = 'EFECTIVO';
  let selectedPartKey = null;

  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (value) => new Intl.NumberFormat('es-CO', { style:'currency', currency:coreSession.tenant?.moneda || 'COP', maximumFractionDigits:0 }).format(Number(value || 0));

  async function api(path, opts = {}) {
    const response = await fetch(path, {
      ...opts,
      cache:'no-store',
      headers:{
        'Content-Type':'application/json',
        Authorization:`Bearer ${coreSession.token}`,
        'x-tenant-subdomain':coreSession.subdomain,
        ...(opts.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function ensureStyles() {
    if ($('#restaurantVisitPaymentStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantVisitPaymentStyles';
    style.textContent = `
      .rvp-visit-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;margin:12px 0;padding:14px 16px;border:1px solid #c9d9d1;border-radius:15px;background:#eef8f2;color:#244f40}
      .rvp-visit-card small{display:block;font-size:10px;font-weight:900;letter-spacing:.09em;text-transform:uppercase}.rvp-visit-card strong{display:block;margin-top:4px;font-size:27px;letter-spacing:.2em;font-variant-numeric:tabular-nums}.rvp-visit-card span{display:block;margin-top:4px;font-size:12px}
      .rvp-code-actions{display:flex;gap:7px;align-items:center}.rvp-code-actions button{min-height:42px}
      .rvp-split-entry{width:100%;min-height:54px;margin-top:10px;border:2px solid #0d6b43;border-radius:13px;background:#eef8f2;color:#0d6b43;font-weight:900;font-size:14px}.rvp-split-entry.active{background:#0d6b43;color:#fff}
      .rvp-dialog[open]{display:grid}.rvp-dialog{width:min(760px,calc(100% - 18px));max-height:90vh;padding:0;border:0;border-radius:22px;background:#fff;box-shadow:0 30px 80px rgba(0,0,0,.3);overflow:hidden}.rvp-dialog::backdrop{background:rgba(17,24,39,.58);backdrop-filter:blur(4px)}
      .rvp-head{display:flex;align-items:center;gap:12px;padding:17px 19px;border-bottom:1px solid #e5e7eb}.rvp-head h2{margin:0;font-size:23px}.rvp-head button{margin-left:auto;width:44px;height:44px;border:1px solid #d1d5db;border-radius:12px;background:#fff;font-size:22px}
      .rvp-body{padding:18px;overflow:auto}.rvp-note{padding:12px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12;font-size:13px;line-height:1.45}
      .rvp-modes{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.rvp-mode{min-height:82px;padding:12px;border:2px solid #d8dee0;border-radius:14px;background:#fff;text-align:left}.rvp-mode b{display:block;font-size:15px}.rvp-mode span{display:block;margin-top:5px;color:#667178;font-size:12px;line-height:1.35}.rvp-mode.selected{border-color:#0d6b43;background:#eef8f2;color:#0d6b43}
      .rvp-equal{display:flex;gap:10px;align-items:end;margin-top:12px}.rvp-equal label{display:grid;gap:5px;font-weight:800}.rvp-equal input{width:110px;min-height:46px;border:1px solid #cbd5e1;border-radius:10px;padding:0 10px}
      .rvp-prepare{width:100%;min-height:56px;margin-top:15px;border:0;border-radius:13px;background:#0d6b43;color:#fff;font-weight:900;font-size:16px}
      .rvp-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}.rvp-kpi{padding:11px;border:1px solid #dfe5e2;border-radius:12px;background:#f8faf9}.rvp-kpi small{display:block;color:#667178;font-size:10px;font-weight:850;text-transform:uppercase}.rvp-kpi b{display:block;margin-top:4px;font-size:20px}
      .rvp-part{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:13px 0;border-bottom:1px solid #e5e7eb}.rvp-part b{display:block}.rvp-part small{display:block;margin-top:3px;color:#667178}.rvp-part-amount{font-size:18px;font-weight:900}.rvp-paid{padding:7px 9px;border-radius:999px;background:#e8f7ef;color:#067647;font-size:11px;font-weight:900}.rvp-pay{min-height:42px;border:1px solid #0d6b43;border-radius:10px;background:#fff;color:#0d6b43;font-weight:900}
      .rvp-paybox{margin-top:15px;padding:14px;border:1px solid #d6ded9;border-radius:14px;background:#f8faf9}.rvp-paybox h3{margin:0 0 10px}.rvp-methods{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.rvp-method{min-height:50px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font-weight:850}.rvp-method.active{border-color:#0d6b43;background:#0d6b43;color:#fff}.rvp-account{display:grid;gap:5px;margin-top:10px;font-weight:800}.rvp-account select,.rvp-account input{min-height:48px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:0 10px}.rvp-confirm-pay{width:100%;min-height:54px;margin-top:11px;border:0;border-radius:11px;background:#0d6b43;color:#fff;font-weight:900}
      .rvp-manual{margin-top:12px}.rvp-manual-row{display:grid;grid-template-columns:minmax(0,1fr) 170px;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #e5e7eb}.rvp-manual-row select{min-height:42px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;padding:0 8px}
      .rvp-done{padding:24px;text-align:center}.rvp-done strong{display:block;font-size:26px;color:#067647}.rvp-done span{display:block;margin-top:8px;color:#667178}
      @media(max-width:640px){.rvp-visit-card{grid-template-columns:1fr}.rvp-code-actions{justify-content:stretch}.rvp-code-actions button{flex:1}.rvp-modes{grid-template-columns:1fr}.rvp-summary{grid-template-columns:1fr 1fr}.rvp-part{grid-template-columns:1fr auto}.rvp-part .rvp-pay,.rvp-part .rvp-paid{grid-column:1/-1}.rvp-methods{grid-template-columns:1fr}.rvp-manual-row{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function ensureDialog() {
    let dialog = $('#restaurantSplitPaymentDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'restaurantSplitPaymentDialog';
      dialog.className = 'rvp-dialog';
      dialog.innerHTML = '<header class="rvp-head"><h2>Cuenta separada</h2><button type="button" aria-label="Cerrar">×</button></header><div class="rvp-body"></div>';
      document.body.appendChild(dialog);
      $('.rvp-head button', dialog).addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    }
    return dialog;
  }

  function selectedWaiterTableId() { return $('[data-waiter-table].selected')?.dataset.waiterTable || null; }
  function selectedCashTableId() { return $('[data-cash-table].selected')?.dataset.cashTable || null; }

  async function enhanceWaiter() {
    const top = $('.waiter-top-card');
    const tableId = selectedWaiterTableId();
    if (!top || !tableId) { $('#restaurantVisitStaffCard')?.remove(); lastWaiterTable = null; return; }
    if ($('#restaurantVisitStaffCard')?.dataset.tableId === tableId) return;
    $('#restaurantVisitStaffCard')?.remove();
    lastWaiterTable = tableId;
    try {
      const status = await api(`/api/v1/restaurante/mesas/${tableId}/qr-visita`);
      if (selectedWaiterTableId() !== tableId) return;
      const card = document.createElement('section');
      card.id = 'restaurantVisitStaffCard';
      card.dataset.tableId = tableId;
      card.className = 'rvp-visit-card';
      card.innerHTML = status.open
        ? `<div><small>Seguridad del autopedido QR</small><strong>${esc(status.visitCode)}</strong><span>Dile estos 4 números a las personas de ${esc(status.table.name)} · ${status.activeDevices} teléfono(s) autorizados.</span></div><div class="rvp-code-actions"><button type="button" class="ri-btn" data-rotate-visit>Cambiar código</button></div>`
        : `<div><small>Seguridad del autopedido QR</small><b>Mesa cerrada</b><span>El código aparecerá automáticamente cuando abras la mesa.</span></div>`;
      top.insertAdjacentElement('afterend', card);
      $('[data-rotate-visit]', card)?.addEventListener('click', async (event) => {
        if (!confirm('¿Cambiar el código? Los teléfonos autorizados actualmente tendrán que ingresar el nuevo código.')) return;
        const button = event.currentTarget; button.disabled = true;
        try {
          const result = await api(`/api/v1/restaurante/mesas/${tableId}/qr-visita/regenerar`, { method:'POST', body:'{}' });
          $('strong', card).textContent = result.visitCode;
          $('span', card).textContent = `Código cambiado · 0 teléfonos autorizados. Dile el nuevo código a la mesa.`;
        } catch (error) { alert(error.message); }
        finally { button.disabled = false; }
      });
    } catch (error) {
      if (selectedWaiterTableId() === tableId) {
        const card = document.createElement('section'); card.id='restaurantVisitStaffCard'; card.dataset.tableId=tableId; card.className='rvp-visit-card'; card.innerHTML=`<div><small>Seguridad QR</small><b>No disponible</b><span>${esc(error.message)}</span></div>`; top.insertAdjacentElement('afterend', card);
      }
    }
  }

  function syncBaseCashLock(summary) {
    const baseClose = $('#closeTable');
    if (!baseClose) return;
    if (summary?.prepared && !summary?.closed) {
      baseClose.disabled = true;
      baseClose.textContent = 'Cuenta separada activa · cobra las partes';
      $$('.cash-method').forEach((button) => { button.disabled = true; });
      $('#tip')?.setAttribute('disabled','');
      $('#parts')?.setAttribute('disabled','');
    }
  }

  async function enhanceCash() {
    const panel = $('.cash-fast-panel');
    const tableId = selectedCashTableId();
    if (!panel || !tableId) { $('#restaurantSplitEntry')?.remove(); lastCashTable = null; cashSummary = null; return; }
    if ($('#restaurantSplitEntry')?.dataset.tableId === tableId) return;
    $('#restaurantSplitEntry')?.remove();
    lastCashTable = tableId;
    const button = document.createElement('button');
    button.id = 'restaurantSplitEntry'; button.dataset.tableId = tableId; button.type='button'; button.className='rvp-split-entry'; button.textContent='CUENTA SEPARADA / PAGOS POR PERSONA';
    panel.appendChild(button);
    try {
      cashSummary = await api(`/api/v1/restaurante/mesas/${tableId}/pagos-divididos`);
      if (cashSummary?.prepared && !cashSummary.closed) { button.classList.add('active'); button.textContent=`CUENTA SEPARADA · ${money(cashSummary.remaining)} PENDIENTE`; syncBaseCashLock(cashSummary); }
      if (cashSummary?.closed) { button.classList.add('active'); button.textContent='CUENTA PAGADA · MESA CERRADA'; }
    } catch {}
    button.addEventListener('click', () => openSplitDialog(tableId));
  }

  async function loadAccounts() {
    if (!cashAccounts.length) cashAccounts = (await api('/api/v1/tesoreria/cajas-bancos')) || [];
    return cashAccounts;
  }

  function modeScreen(summary) {
    const guestCount = Math.max(Number(summary.guestCount || 1), 1);
    return `<div class="rvp-note"><b>Al preparar la cuenta se congela el consumo.</b><br>Desde ese momento no entran más pedidos y cada parte puede pagarse con un medio diferente. La mesa sólo se libera cuando todo quede pagado.</div>
      <div class="rvp-modes">
        <button class="rvp-mode selected" type="button" data-split-mode="TOGETHER"><b>Pagar todo junto</b><span>Una sola parte por el total de la mesa.</span></button>
        <button class="rvp-mode" type="button" data-split-mode="BY_SEAT" ${guestCount < 2 ? 'disabled' : ''}><b>Cada uno paga lo suyo</b><span>Usa Persona 1, Persona 2… según los productos registrados a cada persona.</span></button>
        <button class="rvp-mode" type="button" data-split-mode="EQUAL"><b>Dividir entre todos</b><span>Reparte el total en partes iguales.</span></button>
        <button class="rvp-mode" type="button" data-split-mode="BY_ITEM"><b>Elegir productos</b><span>Asigna manualmente cada línea de la cuenta a una persona.</span></button>
      </div>
      <div class="rvp-equal" id="rvpEqual" hidden><label>Número de partes<input id="rvpParts" type="number" min="2" max="50" value="${Math.max(guestCount,2)}"></label></div>
      <div id="rvpManual" class="rvp-manual" hidden></div>
      <button id="rvpPrepare" type="button" class="rvp-prepare">PREPARAR CUENTA</button>`;
  }

  async function manualAssignmentsHtml(summary) {
    const session = await api(`/api/v1/restaurante/sesiones/${summary.sessionId}`);
    const details = session?.sale?.detalles || [];
    const people = Math.max(Number(summary.guestCount || 1), 1);
    if (!details.length) return '<div class="rvp-note">No hay productos disponibles para asignar.</div>';
    return `<div class="rvp-note">Elige quién paga cada línea. Una línea completa sólo puede quedar en una parte.</div>${details.map((detail, index) => `<div class="rvp-manual-row" data-detail="${detail.id}"><div><b>${esc(detail.descripcion)}</b><small>${esc(detail.cantidad)} × · ${money(detail.totalLinea)}</small></div><select aria-label="Quién paga ${esc(detail.descripcion)}">${Array.from({length:people},(_,i)=>i+1).map((seat)=>`<option value="${seat}">Persona ${seat}</option>`).join('')}</select></div>`).join('')}`;
  }

  function paymentScreen(summary) {
    return `<div class="rvp-summary"><div class="rvp-kpi"><small>Total</small><b>${money(summary.total)}</b></div><div class="rvp-kpi"><small>Pagado</small><b>${money(summary.paid)}</b></div><div class="rvp-kpi"><small>Pendiente</small><b>${money(summary.remaining)}</b></div></div>
      <div>${(summary.parts || []).map((part)=>`<div class="rvp-part"><div><b>${esc(part.name)}</b><small>${part.paid ? `${esc(part.payment?.metodoPago || 'PAGADO')} · registrado` : 'Pendiente de pago'}</small></div><span class="rvp-part-amount">${money(part.saleAmount)}</span>${part.paid ? '<span class="rvp-paid">PAGADA ✓</span>' : `<button type="button" class="rvp-pay" data-pay-part="${part.key}">Cobrar</button>`}</div>`).join('')}</div>
      <div id="rvpPayBox"></div>`;
  }

  async function openSplitDialog(tableId) {
    ensureStyles();
    const dialog = ensureDialog();
    const body = $('.rvp-body', dialog);
    body.innerHTML = '<div class="rvp-note">Cargando cuenta…</div>';
    if (!dialog.open) dialog.showModal();
    try {
      cashSummary = await api(`/api/v1/restaurante/mesas/${tableId}/pagos-divididos`);
      if (cashSummary.closed) {
        body.innerHTML = '<div class="rvp-done"><strong>✓ Mesa completamente pagada</strong><span>No quedan saldos pendientes.</span></div>';
        return;
      }
      if (!cashSummary.prepared) {
        body.innerHTML = modeScreen(cashSummary);
        bindPrepare(tableId, cashSummary, body);
      } else {
        body.innerHTML = paymentScreen(cashSummary);
        syncBaseCashLock(cashSummary);
        bindPartPayments(tableId, body);
      }
    } catch (error) { body.innerHTML = `<div class="rvp-note">${esc(error.message)}</div>`; }
  }

  function bindPrepare(tableId, summary, body) {
    let mode = 'TOGETHER';
    $$('[data-split-mode]', body).forEach((button) => button.addEventListener('click', async () => {
      if (button.disabled) return;
      mode = button.dataset.splitMode;
      $$('[data-split-mode]', body).forEach((row)=>row.classList.toggle('selected', row===button));
      $('#rvpEqual', body).hidden = mode !== 'EQUAL';
      const manual = $('#rvpManual', body);
      manual.hidden = mode !== 'BY_ITEM';
      if (mode === 'BY_ITEM' && !manual.dataset.loaded) {
        manual.innerHTML = 'Cargando productos…';
        try { manual.innerHTML = await manualAssignmentsHtml(summary); manual.dataset.loaded='1'; }
        catch (error) { manual.innerHTML = `<div class="rvp-note">${esc(error.message)}</div>`; }
      }
    }));
    $('#rvpPrepare', body).addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const payload = { mode, tipAmount:0 };
      if (mode === 'EQUAL') payload.parts = Math.max(2, Number($('#rvpParts', body)?.value || summary.guestCount || 2));
      if (mode === 'BY_ITEM') {
        const groups = new Map();
        $$('.rvp-manual-row', body).forEach((row) => {
          const seat = Number($('select', row).value);
          if (!groups.has(seat)) groups.set(seat, []);
          groups.get(seat).push(row.dataset.detail);
        });
        payload.assignments = [...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([seat,saleDetailIds])=>({ name:`Persona ${seat}`, saleDetailIds }));
      }
      button.disabled=true; button.textContent='PREPARANDO…';
      try {
        cashSummary = await api(`/api/v1/restaurante/mesas/${tableId}/pagos-divididos/preparar`, { method:'POST', body:JSON.stringify(payload) });
        body.innerHTML = paymentScreen(cashSummary); syncBaseCashLock(cashSummary); bindPartPayments(tableId, body);
        const entry=$('#restaurantSplitEntry'); if(entry){entry.classList.add('active');entry.textContent=`CUENTA SEPARADA · ${money(cashSummary.remaining)} PENDIENTE`;}
      } catch (error) { alert(error.message); button.disabled=false; button.textContent='PREPARAR CUENTA'; }
    });
  }

  async function renderPayBox(tableId, partKey, root) {
    selectedPartKey = partKey;
    await loadAccounts();
    const part = cashSummary.parts.find((row)=>row.key===partKey);
    const box = $('#rvpPayBox', root);
    if (!part || !box) return;
    paymentMethod='EFECTIVO';
    box.innerHTML = `<section class="rvp-paybox"><h3>Cobrar ${esc(part.name)} · ${money(part.saleAmount)}</h3><div class="rvp-methods"><button class="rvp-method active" data-rvp-method="EFECTIVO">Efectivo</button><button class="rvp-method" data-rvp-method="TRANSFERENCIA">Transferencia</button><button class="rvp-method" data-rvp-method="TARJETA">Tarjeta</button></div><label class="rvp-account">Caja / banco<select id="rvpAccount"></select></label><label class="rvp-account">Referencia opcional<input id="rvpReference" maxlength="160" placeholder="Comprobante, últimos dígitos…"></label><button id="rvpConfirmPay" class="rvp-confirm-pay" type="button">CONFIRMAR PAGO · ${money(part.saleAmount)}</button></section>`;
    const refreshAccounts = () => {
      const rows = cashAccounts.filter((row)=>row.activo && (paymentMethod==='EFECTIVO' ? row.tipo==='CAJA' : row.tipo==='BANCO'));
      $('#rvpAccount',box).innerHTML = rows.map((row)=>`<option value="${row.id}">${esc(row.nombre)}</option>`).join('');
      $('#rvpConfirmPay',box).disabled = !rows.length;
    };
    refreshAccounts();
    $$('[data-rvp-method]',box).forEach((button)=>button.addEventListener('click',()=>{paymentMethod=button.dataset.rvpMethod;$$('[data-rvp-method]',box).forEach((row)=>row.classList.toggle('active',row===button));refreshAccounts();}));
    $('#rvpConfirmPay',box).addEventListener('click',async(event)=>{
      const button=event.currentTarget; const cajaBancoId=$('#rvpAccount',box).value; if(!cajaBancoId)return;
      button.disabled=true;button.textContent='REGISTRANDO…';
      try{
        cashSummary=await api(`/api/v1/restaurante/mesas/${tableId}/pagos-divididos`,{method:'POST',body:JSON.stringify({partKey:selectedPartKey,metodoPago:paymentMethod,cajaBancoId,referencia:$('#rvpReference',box).value||null})});
        if(cashSummary.closed){root.innerHTML='<div class="rvp-done"><strong>✓ Todo pagado</strong><span>La mesa quedó liberada automáticamente porque el saldo llegó a cero.</span></div>';const entry=$('#restaurantSplitEntry');if(entry){entry.textContent='CUENTA PAGADA · MESA CERRADA';entry.classList.add('active');}setTimeout(()=>{$('[data-tab="caja"]')?.click();},900);}
        else{root.innerHTML=paymentScreen(cashSummary);syncBaseCashLock(cashSummary);bindPartPayments(tableId,root);const entry=$('#restaurantSplitEntry');if(entry)entry.textContent=`CUENTA SEPARADA · ${money(cashSummary.remaining)} PENDIENTE`;}
      }catch(error){alert(error.message);button.disabled=false;button.textContent=`CONFIRMAR PAGO · ${money(part.saleAmount)}`;}
    });
  }

  function bindPartPayments(tableId, body) { $$('[data-pay-part]', body).forEach((button)=>button.addEventListener('click',()=>renderPayBox(tableId,button.dataset.payPart,body).catch((error)=>alert(error.message)))); }

  async function scan() {
    if (observerBusy) return;
    observerBusy = true;
    try { await enhanceWaiter(); await enhanceCash(); } finally { observerBusy = false; }
  }

  ensureStyles();
  const observer = new MutationObserver(() => { queueMicrotask(() => scan().catch(() => {})); });
  if (document.body) observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan().catch(() => {}), { once:true }); else scan().catch(() => {});
})();
