(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V2_EXPENSES_NATIVE_V117';
  const DEMO_TURN_MARKER = 'VANTIX_DEMO_RESTAURANTE_TURNO_GASTOS_V1';
  const DEMO_TENANT = 'demo-restaurante';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const $ = (q) => document.querySelector(q);
  const session = (() => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } })();
  if (!session?.token || !session?.subdomain) { location.replace('/app'); return; }

  document.documentElement.dataset.restaurantV2Expenses = MARKER;
  const state = { context:null, day:null, saving:false, turn:null, turnSummary:null, closing:false, activeTab:'turno' };
  const money = (value) => new Intl.NumberFormat('es-CO',{style:'currency',currency:session.tenant?.moneda || 'COP',maximumFractionDigits:0}).format(Number(value || 0));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache:'no-store',
      headers:{
        ...(options.body ? {'Content-Type':'application/json'} : {}),
        Accept:'application/json',
        Authorization:`Bearer ${session.token}`,
        'x-tenant-subdomain':session.subdomain,
        ...(options.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (response.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      location.replace('/app');
      throw new Error('Sesión vencida');
    }
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function setStatus(text, kind = '') {
    const node = $('#expenseStatus');
    if (!node) return;
    node.textContent = text || '';
    node.className = `status ${kind}`.trim();
  }

  function selectedMethod() { return $('#expenseMethod')?.value || 'EFECTIVO'; }
  function currentAccounts() {
    if (!state.context) return [];
    return selectedMethod() === 'EFECTIVO'
      ? (state.context.cashAccount ? [state.context.cashAccount] : [])
      : (Array.isArray(state.context.bankAccounts) ? state.context.bankAccounts : []);
  }

  function renderContext() {
    const ctx = state.context || {};
    const accounts = currentAccounts();
    const select = $('#expenseAccount');
    if (select) {
      select.innerHTML = accounts.length
        ? accounts.map((account) => `<option value="${esc(account.id)}">${esc(account.nombre || account.tipo)}${account.banco ? ` · ${esc(account.banco)}` : ''}</option>`).join('')
        : '<option value="">Sin cuenta disponible</option>';
    }

    const notice = $('#shiftNotice');
    if (notice) {
      if (!ctx.shift) {
        notice.innerHTML = '<strong>No hay turno abierto.</strong> Abre Caja antes de registrar gastos.';
        notice.classList.add('warn');
      } else {
        const caja = ctx.shift.cajaBanco?.nombre || 'Caja';
        notice.innerHTML = `<strong>Turno abierto:</strong> ${esc(caja)} · ${selectedMethod() === 'EFECTIVO' ? 'el gasto saldrá del efectivo del turno' : 'el gasto saldrá de la cuenta bancaria elegida'}.`;
        notice.classList.remove('warn');
      }
    }

    const canSave = Boolean(ctx.shift && accounts.length && !state.saving);
    $('#saveExpense').disabled = !canSave;
    if (state.day) $('#businessDateLabel').textContent = `Día operativo ${state.day}`;
  }

  function renderExpenses(data) {
    const items = Array.isArray(data?.items) ? data.items : [];
    const rows = $('#expenseRows');
    if (rows) {
      rows.innerHTML = items.length ? items.map((item) => {
        const date = new Date(item.creadoEn || item.fecha || Date.now());
        const time = Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});
        const cash = String(item.medio || '').toUpperCase() === 'EFECTIVO';
        return `<tr><td>${esc(time)}</td><td><strong>${esc(item.concepto || 'Gasto')}</strong></td><td><span class="badge ${cash ? 'cash' : 'bank'}">${cash ? 'Efectivo' : 'Transferencia'}</span></td><td>${esc(item.cuenta || '—')}</td><td class="value"><strong>${money(item.valor)}</strong></td></tr>`;
      }).join('') : '<tr><td colspan="5" class="empty">No hay gastos registrados hoy.</td></tr>';
    }
    $('#cashTotal').textContent = money(data?.totals?.cash);
    $('#transferTotal').textContent = money(data?.totals?.transfer);
    $('#expenseTotal').textContent = money(data?.totals?.total);
    $('#expenseCount').textContent = String(data?.totals?.count || items.length || 0);
  }

  async function loadContext() {
    state.context = await api('/api/v1/restaurante/gastos-v116/contexto');
    state.day = state.context?.businessDate || state.day || new Date().toISOString().slice(0,10);
    renderContext();
  }

  async function loadExpenses() {
    const day = state.day || state.context?.businessDate || new Date().toISOString().slice(0,10);
    const data = await api(`/api/v1/restaurante/gastos-v116?date=${encodeURIComponent(day)}`);
    state.day = data?.businessDate || day;
    renderExpenses(data);
    renderContext();
  }

  async function refresh() {
    setStatus('');
    try {
      await loadContext();
      await loadExpenses();
    } catch (error) {
      setStatus(error.message || 'No fue posible cargar Gastos.', 'bad');
      throw error;
    }
  }

  async function saveExpense(event) {
    event.preventDefault();
    if (state.saving) return;
    const concepto = $('#expenseConcept').value.trim();
    const monto = Number($('#expenseAmount').value || 0);
    const medio = selectedMethod();
    const cajaBancoId = $('#expenseAccount').value || null;
    if (!concepto) { setStatus('Indica el concepto del gasto.', 'bad'); return; }
    if (!(monto > 0)) { setStatus('Indica un valor mayor que cero.', 'bad'); return; }
    if (!state.context?.shift) { setStatus('Abre Caja antes de registrar gastos.', 'bad'); return; }
    if (!cajaBancoId) { setStatus('Selecciona una cuenta de salida.', 'bad'); return; }

    const label = medio === 'EFECTIVO' ? 'efectivo de Caja' : 'la cuenta bancaria seleccionada';
    if (!window.confirm(`Registrar gasto por ${money(monto)} desde ${label}?\n\nConcepto: ${concepto}`)) return;

    state.saving = true;
    renderContext();
    setStatus('Registrando gasto…');
    try {
      await api('/api/v1/restaurante/gastos-v116', {
        method:'POST',
        body:JSON.stringify({ concepto, monto, medio, cajaBancoId })
      });
      $('#expenseConcept').value = '';
      $('#expenseAmount').value = '';
      setStatus('Gasto registrado. Caja/Banco, Tesorería y cierre quedaron actualizados.', 'ok');
      await loadContext();
      await loadExpenses();
      window.parent?.postMessage?.({type:'VANTIX_RESTAURANT_EXPENSE_RECORDED',marker:MARKER}, location.origin);
    } catch (error) {
      setStatus(error.message || 'No fue posible registrar el gasto.', 'bad');
    } finally {
      state.saving = false;
      renderContext();
    }
  }

  async function downloadDailySales() {
    const day = state.day || state.context?.businessDate;
    if (!day) { setStatus('No fue posible determinar el día operativo.', 'bad'); return; }
    setStatus('Preparando informe de ventas…');
    try {
      const response = await fetch(`/api/v1/restaurante/reportes/ventas-dia-v116.xls?date=${encodeURIComponent(day)}`, {
        cache:'no-store',
        headers:{ Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain }
      });
      if (!response.ok) {
        let body = {};
        try { body = await response.json(); } catch {}
        throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Ventas_${day}.xls`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('Informe de ventas descargado.', 'ok');
    } catch (error) {
      setStatus(error.message || 'No fue posible descargar el informe.', 'bad');
    }
  }

  function demoMode() { return session.subdomain === DEMO_TENANT; }
  function tzOffsetMinutes() { return new Date().getTimezoneOffset(); }

  function installDemoTurnExpenses() {
    if (!demoMode() || $('#demoTurnTabs')) return;
    document.documentElement.dataset.demoTurnExpenses = '1';
    document.documentElement.dataset.demoTurnExpensesMarker = DEMO_TURN_MARKER;
    document.title = 'Turno y gastos · VantixGC Restaurantes V2';
    const title = document.querySelector('.head h1');
    const subtitle = document.querySelector('.head p');
    if (title) title.textContent = 'Turno y gastos';
    if (subtitle) subtitle.textContent = 'Cierre de turno, registro de gastos e historial en un solo lugar.';

    const main = document.querySelector('.page');
    const head = document.querySelector('.head');
    const grid = document.querySelector('.grid');
    const list = document.querySelector('.list-card');
    if (!main || !head || !grid || !list) return;

    const tabs = document.createElement('nav');
    tabs.id = 'demoTurnTabs';
    tabs.className = 'turn-expense-tabs';
    tabs.innerHTML = '<button type="button" class="turn-expense-tab active" data-turn-tab="turno">Turno</button><button type="button" class="turn-expense-tab" data-turn-tab="gastos">Gastos</button><button type="button" class="turn-expense-tab" data-turn-tab="historial">Historial de cierres</button>';
    head.insertAdjacentElement('afterend', tabs);

    const turnPanel = document.createElement('section');
    turnPanel.id = 'demoTurnPanel';
    turnPanel.className = 'turn-expense-panel';
    turnPanel.innerHTML = '<div class="turn-close-grid"><article class="card"><div class="card-head"><h2>Cierre de turno</h2><p>Revisa el efectivo esperado, registra el efectivo contado y cierra el turno.</p></div><div class="turn-kpis"><div class="turn-kpi"><span>Base inicial</span><strong id="demoTurnBase">$ 0</strong></div><div class="turn-kpi"><span>Efectivo esperado</span><strong id="demoTurnExpected">$ 0</strong></div><div class="turn-kpi"><span>Ventas del turno</span><strong id="demoTurnSales">$ 0</strong></div></div><div id="demoTurnInfo" class="notice">Consultando turno…</div></article><aside class="card"><div class="card-head"><h2>Finalizar turno</h2><p>El valor contado queda guardado para la conciliación.</p></div><div class="turn-close-form"><label for="demoFinalBalance">Efectivo contado</label><input id="demoFinalBalance" type="number" min="0" step="100" inputmode="numeric" value="0"><div id="demoTurnStatus" class="status" role="status" aria-live="polite"></div><div id="demoTurnResult" hidden></div><div class="turn-close-actions"><button type="button" class="btn" id="demoGoHistory">Ver historial</button><button type="button" class="btn primary" id="demoCloseShift">Cerrar turno</button></div></div></aside></div>';
    tabs.insertAdjacentElement('afterend', turnPanel);

    const expensePanel = document.createElement('section');
    expensePanel.id = 'demoExpensePanel';
    expensePanel.className = 'turn-expense-panel';
    expensePanel.hidden = true;
    grid.insertAdjacentElement('beforebegin', expensePanel);
    expensePanel.appendChild(grid);
    expensePanel.appendChild(list);

    const historyPanel = document.createElement('section');
    historyPanel.id = 'demoHistoryPanel';
    historyPanel.className = 'turn-expense-panel';
    historyPanel.hidden = true;
    historyPanel.innerHTML = '<iframe id="demoHistoryFrame" class="turn-history-frame" title="Historial de cierres" loading="lazy" data-src="/app/cierres?embed=turno-gastos"></iframe>';
    expensePanel.insertAdjacentElement('afterend', historyPanel);

    tabs.querySelectorAll('[data-turn-tab]').forEach((button) => {
      button.addEventListener('click', () => selectDemoTab(button.dataset.turnTab));
    });
    $('#demoCloseShift')?.addEventListener('click', closeDemoShift);
    $('#demoGoHistory')?.addEventListener('click', () => selectDemoTab('historial'));
  }

  function selectDemoTab(tab) {
    if (!demoMode()) return;
    state.activeTab = ['turno','gastos','historial'].includes(tab) ? tab : 'turno';
    document.querySelectorAll('[data-turn-tab]').forEach((button) => button.classList.toggle('active', button.dataset.turnTab === state.activeTab));
    const turn = $('#demoTurnPanel'), expenses = $('#demoExpensePanel'), history = $('#demoHistoryPanel');
    if (turn) turn.hidden = state.activeTab !== 'turno';
    if (expenses) expenses.hidden = state.activeTab !== 'gastos';
    if (history) history.hidden = state.activeTab !== 'historial';
    if (state.activeTab === 'turno') loadDemoTurn().catch((error) => setDemoTurnStatus(error.message || 'No fue posible cargar el turno.', 'bad'));
    if (state.activeTab === 'historial') {
      const frame = $('#demoHistoryFrame');
      if (frame && !frame.src) frame.src = frame.dataset.src;
    }
  }

  function setDemoTurnStatus(text, kind = '') {
    const node = $('#demoTurnStatus');
    if (!node) return;
    node.textContent = text || '';
    node.className = `status ${kind}`.trim();
  }

  async function loadDemoTurn() {
    if (!demoMode()) return;
    const workspace = await api('/api/v1/restaurante/v2/caja');
    state.turn = workspace?.shift?.own || null;
    state.turnSummary = null;
    const info = $('#demoTurnInfo');
    const close = $('#demoCloseShift');
    const input = $('#demoFinalBalance');
    if (!state.turn) {
      if (info) info.innerHTML = '<strong>No hay turno abierto.</strong> El turno puede abrirse desde el primer cobro cuando haga falta.';
      if (close) close.disabled = true;
      if (input) { input.value = '0'; input.disabled = true; }
      $('#demoTurnBase').textContent = money(0);
      $('#demoTurnExpected').textContent = money(0);
      $('#demoTurnSales').textContent = money(0);
      return;
    }
    state.turnSummary = await api('/api/v1/restaurante/v2/caja/turno/resumen');
    const expected = Number(state.turnSummary?.systemCashExpected || state.turn?.saldoEsperado || 0);
    if (info) info.innerHTML = `<strong>Turno abierto:</strong> ${esc(state.turn?.cajaBanco?.nombre || 'Caja')} · registra el efectivo contado para cerrar.`;
    $('#demoTurnBase').textContent = money(state.turn?.saldoInicial || 0);
    $('#demoTurnExpected').textContent = money(expected);
    $('#demoTurnSales').textContent = money(state.turnSummary?.restaurantClosedTablesTotal || 0);
    if (input) {
      input.disabled = false;
      if (input.dataset.manual !== '1') input.value = String(Math.round(expected));
      input.oninput = () => { input.dataset.manual = '1'; };
    }
    if (close) close.disabled = state.closing;
  }

  async function closeDemoShift() {
    if (!demoMode() || state.closing || !state.turn) return;
    const input = $('#demoFinalBalance');
    const saldoFinal = Number(input?.value || 0);
    if (!Number.isFinite(saldoFinal) || saldoFinal < 0) { setDemoTurnStatus('Ingresa un efectivo contado válido.', 'bad'); return; }
    if (!window.confirm('¿Cerrar el turno con el efectivo contado indicado? Las diferencias o pendientes quedarán registradas para revisión.')) return;
    state.closing = true;
    const close = $('#demoCloseShift');
    if (close) { close.disabled = true; close.textContent = 'Cerrando…'; }
    setDemoTurnStatus('Cerrando turno…');
    try {
      const data = await api('/api/v1/restaurante/v2/caja/turno/cerrar', {
        method:'POST',
        body:JSON.stringify({ saldoFinal, tzOffsetMinutes:tzOffsetMinutes() })
      });
      const shiftId = data?.closed?.id || data?.closure?.shift?.id || null;
      const result = $('#demoTurnResult');
      if (result) {
        result.hidden = false;
        result.className = 'turn-close-result';
        result.innerHTML = `<strong>Turno cerrado.</strong><br>${esc(data?.closure?.status === 'REVISAR' ? 'Quedó marcado para revisión en el historial.' : 'La conciliación quedó registrada.')}<div class="turn-close-actions" style="margin-top:10px">${shiftId ? '<button type="button" class="btn" id="demoPrintClosure">Imprimir cierre</button>' : ''}<button type="button" class="btn" id="demoOpenHistoryAfterClose">Abrir historial</button></div>`;
        $('#demoPrintClosure')?.addEventListener('click', () => printDemoClosure(shiftId));
        $('#demoOpenHistoryAfterClose')?.addEventListener('click', () => selectDemoTab('historial'));
      }
      setDemoTurnStatus('Turno cerrado correctamente.', 'ok');
      const frame = $('#demoHistoryFrame');
      if (frame?.src) frame.src = `/app/cierres?embed=turno-gastos&v=${Date.now()}`;
      await loadContext().catch(() => {});
      await loadExpenses().catch(() => {});
      await loadDemoTurn();
    } catch (error) {
      setDemoTurnStatus(error.message || 'No fue posible cerrar el turno.', 'bad');
    } finally {
      state.closing = false;
      if (close) close.textContent = 'Cerrar turno';
      if (close) close.disabled = !state.turn;
    }
  }

  async function printDemoClosure(shiftId) {
    if (!shiftId) return;
    setDemoTurnStatus('Enviando cierre a impresión…');
    try {
      await api(`/api/v1/restaurante/cierres/${encodeURIComponent(shiftId)}/imprimir?tzOffsetMinutes=${encodeURIComponent(tzOffsetMinutes())}`, {
        method:'POST',
        body:JSON.stringify({ origin:'TURN_EXPENSES' })
      });
      setDemoTurnStatus('Cierre enviado a impresión.', 'ok');
    } catch (error) {
      setDemoTurnStatus(error.message || 'No fue posible imprimir el cierre.', 'bad');
    }
  }

  function bind() {
    $('#expenseForm')?.addEventListener('submit', saveExpense);
    $('#expenseMethod')?.addEventListener('change', () => { renderContext(); setStatus(''); });
    $('#refreshExpenses')?.addEventListener('click', () => refresh().catch(() => {}));
    $('#downloadDailySales')?.addEventListener('click', downloadDailySales);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh().catch(() => {}); });
  }

  async function boot() {
    installDemoTurnExpenses();
    bind();
    try {
      await refresh();
      if (demoMode()) await loadDemoTurn();
    } catch {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
