(() => {
  'use strict';

  const qrToken = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  if (!qrToken) return;
  const qrApi = `/api/public/restaurante/qr/${encodeURIComponent(qrToken)}`;
  const state = { context:null, loading:false, reporting:false, selectedAccountId:null, streamAbort:null };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (value) => new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(Number(value || 0));

  function ensureStyles() {
    if (document.getElementById('restaurantQrElectronicPaymentStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantQrElectronicPaymentStyles';
    style.textContent = `
      .qrep-dialog[hidden]{display:none}.qrep-dialog{position:fixed;inset:0;z-index:180;display:grid;place-items:end center;padding:8px;background:rgba(20,18,16,.62);backdrop-filter:blur(4px)}
      .qrep-sheet{width:min(620px,100%);max-height:88vh;overflow:auto;border-radius:22px 22px 14px 14px;background:#fffdf8;color:#201c18;box-shadow:0 24px 60px rgba(0,0,0,.28)}
      .qrep-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;padding:16px 17px;border-bottom:1px solid #e7dac8;background:#fffdf8}.qrep-head h2{margin:0;font-size:22px}.qrep-close{margin-left:auto;width:44px;height:44px;border:1px solid #dccdb9;border-radius:13px;background:#fff;font-size:22px}
      .qrep-body{display:grid;gap:12px;padding:16px}.qrep-question{margin:0;font-size:17px;font-weight:900}.qrep-methods{display:grid;grid-template-columns:1fr 1fr;gap:10px}.qrep-method{min-height:92px;padding:13px;border:2px solid #ded1bf;border-radius:15px;background:#fff;text-align:left;color:#201c18}.qrep-method b{display:block;font-size:16px}.qrep-method span{display:block;margin-top:5px;color:#70665c;font-size:12px;line-height:1.35}.qrep-method.electronic{border-color:#b8d9ca;background:#f2fbf6}.qrep-method:disabled{opacity:.48}
      .qrep-note{padding:12px;border:1px solid #ead7c1;border-radius:13px;background:#fff8ef;color:#6a4a28;font-size:12px;line-height:1.45}.qrep-cash{padding:17px;border:1px solid #dfd1be;border-radius:15px;background:#fff}.qrep-cash b{display:block;font-size:19px}.qrep-cash span{display:block;margin-top:5px;color:#6f655b;line-height:1.4}
      .qrep-total{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px;border-radius:14px;background:#181614;color:#fff}.qrep-total b{font-size:14px}.qrep-total strong{font-size:24px;color:#f28a39}
      .qrep-accounts{display:grid;gap:8px}.qrep-account{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:center;padding:12px;border:2px solid #ddd1c0;border-radius:14px;background:#fff;text-align:left}.qrep-account.selected{border-color:#168454;background:#eef9f3}.qrep-radio{display:grid;place-items:center;width:24px;height:24px;border:2px solid #9c9186;border-radius:50%;font-size:13px}.qrep-account.selected .qrep-radio{border-color:#168454;background:#168454;color:#fff}.qrep-account b{display:block}.qrep-account small{display:block;margin-top:3px;color:#6d635a;font-size:12px;line-height:1.35}
      .qrep-reference{display:grid;gap:5px;font-size:12px;font-weight:800}.qrep-reference input{width:100%;min-height:50px;padding:0 12px;border:1px solid #d8c9b6;border-radius:12px;background:#fff;font-size:15px}.qrep-send{width:100%;min-height:56px;border:0;border-radius:13px;background:#168454;color:#fff;font-size:15px;font-weight:950}.qrep-send:disabled{opacity:.48}
      .qrep-status{margin:10px 14px 0;padding:12px 14px;border:1px solid #c9d9d1;border-radius:14px;background:#f2fbf6}.qrep-status b{display:block;font-size:13px}.qrep-status span{display:block;margin-top:4px;color:#5e6d66;font-size:11px;line-height:1.4}.qrep-status button{width:100%;min-height:44px;margin-top:9px;border:0;border-radius:11px;background:#168454;color:#fff;font-weight:900}.qrep-status.reported{border-color:#f3c39f;background:#fff5ec}.qrep-status.confirmed{border-color:#9bd4b8;background:#eaf9f1}.qrep-status.confirmed b{color:#087044}
      @media(max-width:460px){.qrep-methods{grid-template-columns:1fr}.qrep-sheet{max-height:92vh}}
    `;
    document.head.appendChild(style);
  }

  function ensureDialog() {
    ensureStyles();
    let modal = document.getElementById('restaurantElectronicPaymentDialog');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'restaurantElectronicPaymentDialog';
    modal.className = 'qrep-dialog';
    modal.hidden = true;
    modal.innerHTML = '<section class="qrep-sheet"><header class="qrep-head"><h2>¿Cómo vas a pagar?</h2><button type="button" class="qrep-close" aria-label="Cerrar">×</button></header><div class="qrep-body"></div></section>';
    document.body.appendChild(modal);
    modal.querySelector('.qrep-close')?.addEventListener('click', closeDialog);
    modal.addEventListener('click', (event) => { if (event.target === modal) closeDialog(); });
    return modal;
  }

  function openDialog() {
    const modal = ensureDialog();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeDialog() {
    const modal = document.getElementById('restaurantElectronicPaymentDialog');
    if (!modal) return;
    modal.hidden = true;
    if (document.getElementById('helpPanel')?.hidden !== false && document.getElementById('orderPanel')?.hidden !== false && document.getElementById('restaurantOrderTrackingPanel')?.hidden !== false) document.body.style.overflow = '';
  }

  async function jsonFetch(url, options = {}) {
    const response = await window.fetch(url, { cache:'no-store', ...options, headers:{ Accept:'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  async function loadContext() {
    if (state.loading) return state.context;
    state.loading = true;
    try {
      state.context = await jsonFetch(`${qrApi}/pago-electronico`);
      if (!state.selectedAccountId && state.context?.destinations?.length) state.selectedAccountId = state.context.destinations[0].id;
      renderPersistentStatus();
      const reportId = state.context?.report?.reportId;
      if (reportId && ['REPORTED','CONFIRMING'].includes(state.context.report.state)) startReportStream(reportId);
      return state.context;
    } finally { state.loading = false; }
  }

  function methodChoiceHtml(ctx) {
    return `<p class="qrep-question">Elige cómo quieres pagar esta cuenta.</p>
      <div class="qrep-methods">
        <button type="button" class="qrep-method" data-payment-method="CASH"><b>EFECTIVO</b><span>Solicitamos la cuenta y te indicamos que te acerques a Caja.</span></button>
        <button type="button" class="qrep-method electronic" data-payment-method="ELECTRONIC" ${ctx?.electronicAvailable ? '' : 'disabled'}><b>PAGO ELECTRÓNICO</b><span>Transfiere desde tu celular y avisa al mesero para que confirme el pago.</span></button>
      </div>
      ${ctx?.electronicAvailable ? '' : '<div class="qrep-note">Este restaurante todavía no tiene una cuenta electrónica activa configurada. Puedes pagar en efectivo.</div>'}`;
  }

  async function showMethodChoice() {
    const modal = ensureDialog();
    const body = modal.querySelector('.qrep-body');
    body.innerHTML = '<div class="qrep-note">Cargando medios de pago…</div>';
    openDialog();
    try {
      const ctx = await loadContext();
      body.innerHTML = methodChoiceHtml(ctx);
      body.querySelector('[data-payment-method="CASH"]')?.addEventListener('click', chooseCash);
      body.querySelector('[data-payment-method="ELECTRONIC"]')?.addEventListener('click', chooseElectronic);
    } catch (error) { body.innerHTML = `<div class="qrep-note">${esc(error.message || 'No fue posible cargar los medios de pago')}</div>`; }
  }

  async function requestAccount() {
    return jsonFetch(`${qrApi}/pedir-cuenta`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:'{}' });
  }

  async function chooseCash() {
    const body = ensureDialog().querySelector('.qrep-body');
    body.innerHTML = '<div class="qrep-note">Solicitando la cuenta…</div>';
    try {
      await requestAccount();
      body.innerHTML = '<div class="qrep-cash"><b>PAGO EN EFECTIVO</b><span>Acércate a Caja para pagar. El mesero ya recibió la solicitud y está preparando tu cuenta.</span></div><button type="button" class="qrep-send" data-done>ENTENDIDO</button>';
      body.querySelector('[data-done]')?.addEventListener('click', closeDialog);
      renderPersistentStatus('cash');
    } catch (error) { body.innerHTML = `<div class="qrep-note">${esc(error.message)}</div>`; }
  }

  async function chooseElectronic() {
    const body = ensureDialog().querySelector('.qrep-body');
    body.innerHTML = '<div class="qrep-note">Preparando el pago electrónico…</div>';
    try {
      await requestAccount();
      const ctx = await loadContext();
      renderElectronicForm(ctx);
    } catch (error) { body.innerHTML = `<div class="qrep-note">${esc(error.message)}</div>`; }
  }

  function renderElectronicForm(ctx = state.context) {
    const body = ensureDialog().querySelector('.qrep-body');
    const accounts = Array.isArray(ctx?.destinations) ? ctx.destinations : [];
    if (!accounts.length) {
      body.innerHTML = '<div class="qrep-note">No hay un medio de pago electrónico configurado. Paga en efectivo en Caja.</div>';
      return;
    }
    if (!state.selectedAccountId || !accounts.some((a) => a.id === state.selectedAccountId)) state.selectedAccountId = accounts[0].id;
    body.innerHTML = `<div class="qrep-total"><b>Total de la mesa</b><strong>${money(ctx?.amount)}</strong></div>
      <div class="qrep-note"><b>Haz la transferencia desde tu app bancaria, Nequi, Daviplata u otro medio que corresponda a la cuenta mostrada.</b><br>VantixGC no marcará la cuenta como pagada hasta que el mesero verifique y confirme el abono.</div>
      <div class="qrep-accounts">${accounts.map((account) => `<button type="button" class="qrep-account ${account.id === state.selectedAccountId ? 'selected' : ''}" data-account="${esc(account.id)}"><span class="qrep-radio">${account.id === state.selectedAccountId ? '✓' : ''}</span><div><b>${esc(account.nombre || account.banco || 'Cuenta electrónica')}</b><small>${esc(account.banco || '')}${account.numeroCuenta ? `${account.banco ? ' · ' : ''}${esc(account.numeroCuenta)}` : ''}</small></div></button>`).join('')}</div>
      <label class="qrep-reference">Referencia o últimos 4 dígitos (opcional)<input id="qrepReference" maxlength="160" placeholder="Ej. 4821"></label>
      <button type="button" class="qrep-send" id="qrepReportPayment">YA PAGUÉ · AVISAR AL MESERO</button>`;
    body.querySelectorAll('[data-account]').forEach((button) => button.addEventListener('click', () => { state.selectedAccountId = button.dataset.account; renderElectronicForm(ctx); }));
    body.querySelector('#qrepReportPayment')?.addEventListener('click', reportPayment);
  }

  async function reportPayment() {
    if (state.reporting || !state.selectedAccountId) return;
    const button = document.getElementById('qrepReportPayment');
    const reference = String(document.getElementById('qrepReference')?.value || '').trim();
    state.reporting = true;
    if (button) { button.disabled = true; button.textContent = 'AVISANDO AL MESERO…'; }
    try {
      const report = await jsonFetch(`${qrApi}/pago-electronico/reportar`, {
        method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ cajaBancoId:state.selectedAccountId, reference })
      });
      state.context = { ...(state.context || {}), report };
      const body = ensureDialog().querySelector('.qrep-body');
      body.innerHTML = '<div class="qrep-cash"><b>PAGO REPORTADO</b><span>El mesero recibió el aviso. La cuenta se cerrará cuando confirme que el pago electrónico sí fue recibido.</span></div><button type="button" class="qrep-send" data-done>LISTO</button>';
      body.querySelector('[data-done]')?.addEventListener('click', closeDialog);
      renderPersistentStatus();
      if (report?.reportId) startReportStream(report.reportId);
    } catch (error) { alert(error.message || 'No fue posible avisar al mesero'); }
    finally { state.reporting = false; if (button) { button.disabled = false; button.textContent = 'YA PAGUÉ · AVISAR AL MESERO'; } }
  }

  function persistentAnchor() {
    return document.getElementById('restaurantAccountRequestWrap') || document.getElementById('accountStrip');
  }

  function renderPersistentStatus(forced = null) {
    ensureStyles();
    let box = document.getElementById('restaurantElectronicPaymentStatus');
    const anchor = persistentAnchor();
    if (!anchor) return;
    if (!box) {
      box = document.createElement('section'); box.id = 'restaurantElectronicPaymentStatus'; box.className = 'qrep-status';
      anchor.insertAdjacentElement('afterend', box);
    }
    if (forced === 'cash') {
      box.className = 'qrep-status'; box.innerHTML = '<b>PAGO EN EFECTIVO</b><span>Acércate a Caja. El mesero está preparando la cuenta.</span>'; return;
    }
    const ctx = state.context;
    if (!ctx?.accountRequested) { box.remove(); return; }
    const report = ctx.report || { state:'READY' };
    if (report.state === 'CONFIRMED') {
      box.className = 'qrep-status confirmed'; box.innerHTML = '<b>✓ PAGO ELECTRÓNICO CONFIRMADO</b><span>El mesero confirmó el pago. Tu cuenta quedó pagada.</span>'; return;
    }
    if (['REPORTED','CONFIRMING'].includes(report.state)) {
      box.className = 'qrep-status reported'; box.innerHTML = '<b>PAGO ELECTRÓNICO REPORTADO</b><span>Esperando que el mesero confirme el abono.</span>'; return;
    }
    if (ctx.electronicAvailable) {
      box.className = 'qrep-status'; box.innerHTML = '<b>¿Prefieres pagar desde el celular?</b><span>Puedes hacer un pago electrónico y avisar al mesero.</span><button type="button" data-open-electronic>PAGAR ELECTRÓNICAMENTE</button>';
      box.querySelector('[data-open-electronic]')?.addEventListener('click', () => { openDialog(); renderElectronicForm(ctx); });
    } else box.remove();
  }

  function parseSseBlock(block) {
    const lines = block.split(/\r?\n/); let eventName = 'message'; const data = [];
    for (const line of lines) { if (line.startsWith('event:')) eventName = line.slice(6).trim(); else if (line.startsWith('data:')) data.push(line.slice(5).trim()); }
    if (!data.length) return;
    try {
      const payload = JSON.parse(data.join('\n'));
      if (eventName === 'confirmed' || payload?.state === 'CONFIRMED') {
        state.context = { ...(state.context || {}), accountRequested:true, report:payload };
        renderPersistentStatus();
        const modal = ensureDialog(); const body = modal.querySelector('.qrep-body');
        if (!modal.hidden) body.innerHTML = '<div class="qrep-cash"><b>✓ PAGO CONFIRMADO</b><span>El mesero verificó el pago. La cuenta quedó pagada.</span></div><button type="button" class="qrep-send" data-done>CERRAR</button>';
        body?.querySelector('[data-done]')?.addEventListener('click', closeDialog);
        stopReportStream();
      }
    } catch {}
  }

  async function streamLoop(controller, reportId) {
    const response = await window.fetch(`${qrApi}/pago-electronico/${encodeURIComponent(reportId)}/stream`, { cache:'no-store', headers:{ Accept:'text/event-stream' }, signal:controller.signal });
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream:true }); let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); if (block && !block.startsWith(':')) parseSseBlock(block); }
    }
  }

  function startReportStream(reportId) {
    if (!reportId || state.streamAbort) return;
    const controller = new AbortController(); state.streamAbort = controller;
    streamLoop(controller, reportId).catch(() => {}).finally(() => { if (state.streamAbort === controller) state.streamAbort = null; });
  }

  function stopReportStream() { state.streamAbort?.abort(); state.streamAbort = null; }

  function interceptAccountRequest(event) {
    const button = event.target?.closest?.('#restaurantRequestAccountButton');
    if (!button || button.disabled) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
    showMethodChoice().catch(() => {});
  }

  function boot() {
    ensureDialog();
    document.addEventListener('click', interceptAccountRequest, true);
    loadContext().catch(() => {});
    window.addEventListener('pageshow', () => loadContext().catch(() => {}));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadContext().catch(() => {}); });
  }

  window.addEventListener('pagehide', stopReportStream);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true }); else boot();
})();
