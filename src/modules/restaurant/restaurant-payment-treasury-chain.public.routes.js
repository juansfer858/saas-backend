'use strict';

const MARKER = 'VANTIX_RESTAURANT_PAYMENT_TREASURY_CHAIN_V27';
const PANEL_MARKER = 'VANTIX_TREASURY_RECENT_COLLECTIONS_V27';

function paymentTreasuryChainBrowserRuntime() {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_PAYMENT_TREASURY_CHAIN_V27';
  if (window[MARKER]) return;
  window[MARKER] = Object.freeze({
    version:'27.0.0',
    authoritativeCashierChain:true,
    configuredMethodOwnsDestination:true,
    legacyGenericAccountSelector:false,
    creditRequiresCustomerPortfolio:true,
    failClosedOnConfigurationError:true,
    eventDrivenMount:true,
    noMutationObserver:true
  });

  const SESSION_KEY = 'vantixgc_core_session_v1';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token) return;

  let methods = null;
  let loadingMethods = null;
  let selectedMethodId = null;
  let scanBusy = false;
  let scanTimer = null;
  let renderKey = '';

  const $ = (query, root = document) => root.querySelector(query);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const money = (value) => new Intl.NumberFormat('es-CO', { style:'currency', currency:session?.tenant?.moneda || 'COP', maximumFractionDigits:0 }).format(Number(value || 0));

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache:'no-store',
      headers:{
        'Content-Type':'application/json',
        Authorization:`Bearer ${session.token}`,
        'x-tenant-subdomain':session.subdomain,
        ...(options.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function ensureStyle() {
    if ($('#restaurantPaymentTreasuryChainV27Style')) return;
    const style = document.createElement('style');
    style.id = 'restaurantPaymentTreasuryChainV27Style';
    style.textContent = `
      .cash-methods.v27-legacy-hidden,#accountLabel.v27-legacy-hidden,#restaurantPaymentMethodPanel.v27-legacy-hidden{display:none!important}
      .v27-payment-chain{display:grid;gap:10px;margin:8px 0 2px}
      .v27-payment-chain-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .v27-payment-chain-head b{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#334155}
      .v27-payment-chain-head span{font-size:11px;color:#64748b}
      .v27-payment-methods{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:7px}
      .v27-payment-method{min-height:70px;padding:10px;border:1px solid #d7dee8;border-radius:12px;background:#fff;color:#1e293b;text-align:left;cursor:pointer}
      .v27-payment-method strong{display:block;font-size:13px}.v27-payment-method small{display:block;margin-top:4px;color:#64748b;font-size:10px;line-height:1.25}
      .v27-payment-method.active{border:2px solid #f25b05;background:#fff7ed;box-shadow:0 0 0 2px rgba(242,91,5,.08)}
      .v27-payment-method:disabled{cursor:not-allowed;background:#f8fafc;color:#94a3b8;border-style:dashed}.v27-payment-method:disabled small{color:#94a3b8}
      .v27-payment-destination{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid #dbe4ee;border-radius:10px;background:#f8fafc}
      .v27-payment-destination span{font-size:11px;color:#64748b}.v27-payment-destination b{font-size:12px;color:#0f172a;text-align:right}
      .v27-payment-reference label{display:block;font-size:11px;font-weight:800;color:#475569;margin-bottom:4px}.v27-payment-reference input{width:100%;box-sizing:border-box}
      .v27-payment-error{padding:10px 12px;border:1px solid #fecaca;border-radius:10px;background:#fff1f2;color:#991b1b;font-size:12px;line-height:1.35}
      .v27-payment-credit-note{padding:8px 10px;border-radius:9px;background:#f8fafc;color:#64748b;font-size:10px;line-height:1.3}
    `;
    document.head.appendChild(style);
  }

  function selectedTableId() {
    return $('[data-cash-table].selected')?.dataset.cashTable || null;
  }

  function parseMoneyText(value) {
    const normalized = String(value || '').replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function selectedAmount() {
    const seeded = Number($('#cashReceived')?.defaultValue || 0);
    if (Number.isFinite(seeded) && seeded >= 0) return seeded;
    return parseMoneyText($('.cash-due-row.selected .cash-due-total b')?.textContent || '0');
  }

  function isOperational(method) {
    if (!method?.active || method.kind === 'CREDITO') return false;
    const account = method.account;
    if (!account?.activo) return false;
    if (method.kind === 'EFECTIVO') return account.tipo === 'CAJA';
    if (method.kind === 'TRANSFERENCIA' || method.kind === 'TARJETA') return account.tipo === 'BANCO';
    return false;
  }

  function kindLabel(kind) {
    return {
      EFECTIVO:'Efectivo',
      TRANSFERENCIA:'Transferencia / QR',
      TARJETA:'Tarjeta',
      CREDITO:'Crédito'
    }[kind] || String(kind || '').replaceAll('_',' ');
  }

  function methodStatus(method) {
    if (method.kind === 'CREDITO') return 'Requiere cliente y genera Cartera; no entra a Caja/Banco';
    if (!method.account?.activo) return 'Cuenta destino inactiva o no disponible';
    return `${kindLabel(method.kind)} · Destino: ${method.account?.nombre || 'sin cuenta'}`;
  }

  function hideLegacy() {
    $('.cash-methods')?.classList.add('v27-legacy-hidden');
    $('#accountLabel')?.classList.add('v27-legacy-hidden');
    $('#restaurantPaymentMethodPanel')?.classList.add('v27-legacy-hidden');
  }

  function ensureRoot() {
    const panel = $('.cash-fast-panel');
    const base = $('.cash-methods');
    if (!panel || !base) return null;
    hideLegacy();
    let root = $('#restaurantPaymentTreasuryChainV27');
    if (!root) {
      root = document.createElement('section');
      root.id = 'restaurantPaymentTreasuryChainV27';
      root.className = 'v27-payment-chain';
      base.insertAdjacentElement('beforebegin', root);
    }
    return root;
  }

  async function loadMethods(force = false) {
    if (methods && !force) return methods;
    if (loadingMethods) return loadingMethods;
    loadingMethods = api('/api/v1/restaurante/metodos-pago')
      .then((rows) => {
        methods = Array.isArray(rows) ? rows : [];
        if (!methods.some((method) => method.id === selectedMethodId && isOperational(method))) {
          selectedMethodId = methods.find(isOperational)?.id || null;
        }
        return methods;
      })
      .finally(() => { loadingMethods = null; });
    return loadingMethods;
  }

  function activeMethod() {
    return (methods || []).find((method) => method.id === selectedMethodId && isOperational(method)) || null;
  }

  function refreshAmounts() {
    const method = activeMethod();
    const tip = Number($('#tip')?.value || 0);
    const total = selectedAmount() + tip;
    const close = $('#closeTable');
    if (close) {
      close.disabled = !method;
      close.textContent = method ? `CONFIRMAR COBRO · ${money(total)}` : 'SELECCIONA UN MÉTODO DE PAGO';
    }
    const receivedRow = $('#cashReceivedRow');
    if (receivedRow) receivedRow.hidden = method?.kind !== 'EFECTIVO';
    const change = $('#cashChange');
    if (change && method?.kind === 'EFECTIVO') {
      const received = Number($('#cashReceived')?.value || 0);
      change.textContent = money(Math.max(received - total, 0));
    }
  }

  function renderPanel() {
    const root = ensureRoot();
    if (!root || !methods) return;
    const active = methods.filter((method) => method.active);
    const method = activeMethod();
    const key = JSON.stringify([
      selectedTableId(), selectedMethodId,
      active.map((row) => [row.id,row.name,row.kind,row.active,row.account?.id,row.account?.nombre,row.account?.tipo,row.account?.activo])
    ]);
    if (root.dataset.renderKey !== key) {
      root.dataset.renderKey = key;
      root.innerHTML = `
        <div class="v27-payment-chain-head"><b>Método de pago</b><span>El método define la cuenta destino</span></div>
        <div class="v27-payment-methods">
          ${active.length ? active.map((row) => `
            <button type="button" class="v27-payment-method ${row.id === selectedMethodId ? 'active' : ''}" data-v27-payment-method="${esc(row.id)}" ${isOperational(row) ? '' : 'disabled'}>
              <strong>${esc(row.name)}</strong><small>${esc(methodStatus(row))}</small>
            </button>`).join('') : '<div class="v27-payment-error">No hay métodos de pago activos. Configúralos desde “Métodos de pago”.</div>'}
        </div>
        ${method ? `<div class="v27-payment-destination"><span>Cuenta destino del cobro</span><b>${esc(method.account?.nombre || '—')} · ${esc(method.account?.tipo || '')}</b></div>` : ''}
        ${method && ['TRANSFERENCIA','TARJETA'].includes(method.kind) ? '<div class="v27-payment-reference"><label>Referencia / comprobante</label><input id="v27PaymentReference" class="ri-input" maxlength="160" placeholder="Opcional"></div>' : ''}
        ${active.some((row) => row.kind === 'CREDITO') ? '<div class="v27-payment-credit-note">Crédito no se registra como dinero recibido. Debe identificar al cliente y generar la cuenta por cobrar en Cartera.</div>' : ''}
      `;
    }
    refreshAmounts();
  }

  function renderLoading() {
    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = '<div class="v27-payment-destination"><span>Cargando cadena de cobro…</span><b>Verificando método y destino</b></div>';
    const close = $('#closeTable');
    if (close) { close.disabled = true; close.textContent = 'CARGANDO MÉTODOS DE PAGO…'; }
  }

  function renderError(error) {
    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = `<div class="v27-payment-error"><b>No se puede registrar el cobro.</b><br>${esc(error?.message || 'No fue posible cargar los métodos de pago y sus cuentas destino.')}</div>`;
    const close = $('#closeTable');
    if (close) { close.disabled = true; close.textContent = 'MÉTODOS DE PAGO NO DISPONIBLES'; }
  }

  function setMessage(text, error = false) {
    const node = $('#message');
    if (!node) return;
    node.className = error ? 'error' : 'success';
    node.textContent = text || '';
  }

  async function closeSelectedTable(button) {
    const method = activeMethod();
    const tableId = selectedTableId();
    if (!method || !tableId) return;
    const saleTotal = selectedAmount();
    const tipAmount = Number($('#tip')?.value || 0);
    const total = saleTotal + tipAmount;
    if (method.kind === 'EFECTIVO' && Number($('#cashReceived')?.value || 0) < total) {
      alert('El efectivo recibido es menor que el total a cobrar.');
      return;
    }
    const parts = Math.max(1, Number($('#parts')?.value || 1));
    button.disabled = true;
    button.textContent = 'REGISTRANDO COBRO…';
    try {
      const result = await api(`/api/v1/restaurante/mesas/${tableId}/cerrar-con-metodo`, {
        method:'POST',
        body:JSON.stringify({
          paymentMethodId:method.id,
          reference:$('#v27PaymentReference')?.value || null,
          tipAmount,
          split:parts > 1 ? { mode:'EQUAL', parts } : { mode:'NONE' }
        })
      });
      setMessage(`Cobro registrado · ${result.paymentMethod?.name || method.name} → ${method.account?.nombre || 'destino registrado'} · ${result.sale?.numero || 'venta cerrada'}.`);
      methods = null;
      selectedMethodId = null;
      document.querySelector('.cash-collect-close-v40')?.click();
      $('[data-tab="caja"]')?.click();
    } catch (error) {
      setMessage(error.message, true);
      button.disabled = false;
      refreshAmounts();
    }
  }

  async function scan(force = false) {
    if (scanBusy) return;
    if (!$('.cash-fast-panel')) { selectedMethodId = null; renderKey = ''; return; }
    scanBusy = true;
    try {
      ensureStyle();
      hideLegacy();
      if (!methods || force) {
        renderLoading();
        await loadMethods(force);
      }
      renderPanel();
    } catch (error) {
      methods = null;
      renderError(error);
    } finally {
      scanBusy = false;
    }
  }

  function scheduleScan(force = false, delay = 0) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan(force).catch(() => {});
    }, delay);
  }

  window.addEventListener('click', (event) => {
    const methodButton = event.target?.closest?.('[data-v27-payment-method]');
    if (methodButton) {
      const next = (methods || []).find((method) => method.id === methodButton.dataset.v27PaymentMethod && isOperational(method));
      if (next) {
        selectedMethodId = next.id;
        renderKey = '';
        renderPanel();
      }
      return;
    }
    const close = event.target?.closest?.('#closeTable');
    if (close && $('#restaurantPaymentTreasuryChainV27')) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeSelectedTable(close).catch((error) => { setMessage(error.message, true); close.disabled = false; });
      return;
    }
    if (event.target?.closest?.('[data-cash-table],[data-tab="caja"],.cash-collect-close-v40')) {
      scheduleScan(false, 0);
      setTimeout(() => scheduleScan(false, 0), 120);
    }
  }, true);

  window.addEventListener('input', (event) => {
    if (['cashReceived','tip','parts'].includes(event.target?.id)) queueMicrotask(refreshAmounts);
  }, true);

  window.addEventListener('pageshow', () => scheduleScan(false, 0));
  window.addEventListener('focus', () => scheduleScan(false, 0));
  window.addEventListener('vantix:tenant-realtime', (event) => {
    const topics = event.detail?.topics || event.detail?.event?.topics || [];
    if (!Array.isArray(topics) || (!topics.includes('treasury') && !topics.includes('restaurant.account'))) return;
    if (!$('.cash-fast-panel')) return;
    methods = null;
    renderKey = '';
    scheduleScan(true, 0);
  });

  ensureStyle();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scheduleScan(false, 0), { once:true });
  else scheduleScan(false, 0);
}

const paymentTreasuryChainRuntime = `;(${paymentTreasuryChainBrowserRuntime.toString()})();`;

function patchTreasuryPanelSource(source) {
  let patched = String(source || '');
  patched = patched.replace(
    "api('/api/v1/tesoreria/pagos?limit=50')",
    "api('/api/v1/tesoreria/recaudos-recientes?limit=50')"
  );
  patched = patched.replace(
    '<th>Fecha</th><th>Documento</th><th>Método</th><th class="money">Monto</th><th>Referencia</th>',
    '<th>Fecha</th><th>Documento</th><th>Método</th><th>Cuenta destino</th><th class="money">Monto</th><th>Referencia</th>'
  );
  patched = patched.replace(
    '${esc(x.metodoPago)}',
    "${esc(x.metodoLabel||x.metodoPago||'—')}"
  );
  patched = patched.replace(
    "<td class=\"money\">${money(x.monto)}</td><td>${esc(x.referencia||'')}</td>",
    "<td>${esc(x.cuentaDestino?.nombre||'—')}</td><td class=\"money\">${money(x.monto)}</td><td>${esc(x.referencia||'—')}</td>"
  );
  return patched.includes(PANEL_MARKER) ? patched : `/* ${PANEL_MARKER} */\n${patched}`;
}

function installPaymentTreasuryChainV27Runtime(req, res, next) {
  if (req.method !== 'GET') return next();
  if (!['/app/restaurant-ui.js', '/app/panel-integration-extras-core.js'].includes(req.path)) return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (!source) return originalSend(body);
    let patched = source;
    if (req.path === '/app/restaurant-ui.js') {
      if (!patched.includes(MARKER)) patched = `${patched}\n;${paymentTreasuryChainRuntime}\n`;
      res.set('X-VantixGC-Payment-Treasury-Chain', 'v27-configured-method-destination');
    } else {
      patched = patchTreasuryPanelSource(patched);
      res.set('X-VantixGC-Treasury-Recent-Collections', 'v27-movements');
    }
    return originalSend(isBuffer ? Buffer.from(patched, 'utf8') : patched);
  };
  return next();
}

module.exports = {
  MARKER,
  PANEL_MARKER,
  paymentTreasuryChainRuntime,
  patchTreasuryPanelSource,
  installPaymentTreasuryChainV27Runtime
};
