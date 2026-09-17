(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V2_EXPENSES_NATIVE_V117';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const $ = (q) => document.querySelector(q);
  const session = (() => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } })();
  if (!session?.token || !session?.subdomain) { location.replace('/app'); return; }

  document.documentElement.dataset.restaurantV2Expenses = MARKER;
  const state = { context:null, day:null, saving:false };
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

  function bind() {
    $('#expenseForm')?.addEventListener('submit', saveExpense);
    $('#expenseMethod')?.addEventListener('change', () => { renderContext(); setStatus(''); });
    $('#refreshExpenses')?.addEventListener('click', () => refresh().catch(() => {}));
    $('#downloadDailySales')?.addEventListener('click', downloadDailySales);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh().catch(() => {}); });
  }

  async function boot() {
    bind();
    try { await refresh(); }
    catch {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
