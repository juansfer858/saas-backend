(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) return;

  const $ = (query, root = document) => root.querySelector(query);
  const $$ = (query, root = document) => [...root.querySelectorAll(query)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (value) => new Intl.NumberFormat('es-CO', { style:'currency', currency:session.tenant?.moneda || 'COP', maximumFractionDigits:0 }).format(Number(value || 0));
  const canPay = ['ADMIN','SUPER_ADMIN','CAJERO'].includes(String(session.user?.rol || '').toUpperCase());
  let poll = null;
  let active = false;
  let creating = false;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache:'no-store',
      headers:{
        Authorization:`Bearer ${session.token}`,
        'x-tenant-subdomain':session.subdomain,
        ...(options.body ? { 'Content-Type':'application/json' } : {}),
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
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function injectStyles() {
    if ($('#restaurantDeliveryUiStyle')) return;
    const style = document.createElement('style');
    style.id = 'restaurantDeliveryUiStyle';
    style.textContent = `
      .cc-actions.delivery-layout{grid-template-columns:repeat(3,minmax(145px,1fr))!important;gap:10px!important}
      .cc-actions.delivery-layout .cc-action.cash{grid-row:auto!important;min-height:102px!important;text-align:center!important}
      .cc-actions.delivery-layout .cc-action.delivery-primary{min-height:102px!important;display:flex!important;flex-direction:column!important;justify-content:center!important;font-size:18px!important}
      .cc-actions.delivery-layout .cc-action.delivery-primary small{display:block;margin-top:5px;font-size:11px;font-weight:800;opacity:.8}
      .cc-actions.delivery-layout .cc-action.mesas-primary{background:#111c2b!important;border-color:#334155!important;color:#fff!important}
      .cc-actions.delivery-layout .cc-action.delivery-entry{background:linear-gradient(145deg,var(--verdigris,#0f8f85),#08766f)!important;border-color:#0f766e!important;color:#fff!important;box-shadow:0 8px 20px rgba(15,118,110,.22)!important}
      .delivery-shell{display:grid;gap:14px}.delivery-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.delivery-head h1{margin:2px 0;font-size:30px}.delivery-head p{margin:5px 0 0;color:var(--cc-muted)}
      .delivery-summary{display:grid;grid-template-columns:repeat(5,minmax(125px,1fr));gap:9px}.delivery-summary button{min-height:86px;padding:13px;border:1px solid var(--cc-line);border-radius:14px;background:#fff;text-align:left;cursor:pointer}.delivery-summary small{display:block;color:var(--cc-muted);font-size:10px;font-weight:900;text-transform:uppercase}.delivery-summary strong{display:block;margin-top:5px;font-size:25px}.delivery-summary .attention{border-color:#99f6e4;background:#f0fdfa}.delivery-summary .attention strong{color:#0f766e}.delivery-summary .late{border-color:#fecaca;background:#fff7f7}.delivery-summary .late strong{color:#b91c1c}
      .delivery-filterbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.delivery-filterbar button{min-height:42px;padding:8px 12px;border:1px solid var(--cc-line);border-radius:999px;background:#fff;color:var(--cc-ink);font-weight:850;cursor:pointer}.delivery-filterbar button.active{background:#111c2b;color:#fff;border-color:#111c2b}
      .delivery-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:11px}.delivery-card{padding:16px;border:1px solid var(--cc-line);border-left:5px solid #94a3b8;border-radius:16px;background:#fff;box-shadow:0 6px 18px rgba(15,23,42,.05);display:grid;gap:10px}.delivery-card.NUEVO{border-left-color:#0f8f85}.delivery-card.EN_PREPARACION,.delivery-card.CONFIRMADO{border-left-color:#f59e0b}.delivery-card.LISTO{border-left-color:#16a34a}.delivery-card.EN_CAMINO{border-left-color:#2563eb}.delivery-card.late{box-shadow:0 0 0 2px #fecaca inset}.delivery-card-top{display:flex;justify-content:space-between;gap:12px}.delivery-code{font-size:18px;font-weight:950;color:#0f766e}.delivery-age{font-size:11px;color:var(--cc-muted)}.delivery-state{display:inline-flex;align-items:center;gap:5px;min-height:27px;padding:4px 8px;border-radius:999px;background:#f1f5f9;font-size:10px;font-weight:950}.delivery-card-customer b{font-size:16px}.delivery-card-customer span{display:block;margin-top:3px;color:var(--cc-muted);font-size:12px}.delivery-items{display:grid;gap:4px;padding:9px 0;border-top:1px solid #eef2f7;border-bottom:1px solid #eef2f7}.delivery-item{display:flex;justify-content:space-between;gap:10px;font-size:13px}.delivery-finance{display:flex;justify-content:space-between;gap:12px;align-items:end}.delivery-total small{display:block;color:var(--cc-muted);font-size:10px}.delivery-total strong{font-size:20px}.delivery-payment{padding:5px 8px;border-radius:999px;font-size:10px;font-weight:950}.delivery-payment.PAGADO{background:#dcfce7;color:#166534}.delivery-payment.PENDIENTE{background:#fff7ed;color:#9a3412}.delivery-actions{display:grid;grid-template-columns:1fr auto;gap:8px}.delivery-actions .primary-next{min-height:50px;border:0;border-radius:11px;background:#0f8f85;color:#fff;font-weight:950;font-size:14px;cursor:pointer}.delivery-actions .secondary-next{min-height:50px;padding:0 13px;border:1px solid var(--cc-line);border-radius:11px;background:#fff;color:var(--cc-ink);font-weight:900;cursor:pointer}
      .delivery-dialog{width:min(900px,calc(100vw - 24px));max-height:92dvh;padding:0;border:0;border-radius:20px;overflow:auto}.delivery-dialog::backdrop{background:rgba(15,23,42,.5)}.delivery-dialog-head{position:sticky;top:0;z-index:2;padding:17px 20px;border-bottom:1px solid var(--cc-line);background:#fff;display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.delivery-dialog-head h2{margin:2px 0;font-size:24px}.delivery-dialog-body{padding:18px 20px;display:grid;gap:17px}.delivery-step{padding:15px;border:1px solid var(--cc-line);border-radius:15px;background:#fff}.delivery-step-title{display:flex;align-items:center;gap:9px;margin-bottom:12px}.delivery-step-number{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#0f8f85;color:#fff;font-weight:950}.delivery-step-title b{font-size:15px}.delivery-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.delivery-field{display:grid;gap:5px;font-size:12px;font-weight:850}.delivery-field.full{grid-column:1/-1}.delivery-field input,.delivery-field textarea,.delivery-field select{width:100%;min-height:48px;padding:10px 11px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font:inherit;font-size:15px}.delivery-known{margin-top:9px;padding:10px 12px;border:1px solid #99f6e4;border-radius:11px;background:#f0fdfa;color:#115e59}.delivery-products{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.delivery-product{min-height:72px;padding:10px;border:1px solid var(--cc-line);border-radius:12px;background:#f8fafc;display:grid;grid-template-columns:1fr auto;gap:9px;align-items:center}.delivery-product b{display:block}.delivery-product small{color:var(--cc-muted)}.delivery-qty{display:flex;align-items:center;gap:6px}.delivery-qty button{width:42px;height:42px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font-size:20px;font-weight:950;cursor:pointer}.delivery-qty span{min-width:28px;text-align:center;font-size:16px;font-weight:950}.delivery-confirm{position:sticky;bottom:0;padding:13px 20px;background:#fff;border-top:1px solid var(--cc-line);display:flex;justify-content:space-between;gap:12px;align-items:center}.delivery-confirm strong{font-size:20px}.delivery-confirm button{min-height:52px;padding:0 20px;border:0;border-radius:11px;background:#0f8f85;color:#fff;font-size:15px;font-weight:950;cursor:pointer}.delivery-confirm button:disabled{opacity:.5;cursor:not-allowed}
      @media(max-width:900px){.delivery-summary{grid-template-columns:repeat(3,1fr)}.delivery-products{grid-template-columns:1fr}}
      @media(max-width:780px){.cc-actions.delivery-layout{grid-template-columns:repeat(2,1fr)!important}.cc-actions.delivery-layout .cc-action.cash,.cc-actions.delivery-layout .cc-action.delivery-primary{min-height:82px!important}.delivery-head{display:grid}.delivery-summary{grid-template-columns:repeat(2,1fr)}.delivery-list{grid-template-columns:1fr}.delivery-fields{grid-template-columns:1fr}.delivery-field.full{grid-column:auto}.delivery-actions{grid-template-columns:1fr}.delivery-actions button{width:100%}.delivery-confirm{display:grid}.delivery-confirm button{width:100%}}
      @media(max-width:480px){.cc-actions.delivery-layout{grid-template-columns:1fr!important}.delivery-summary{grid-template-columns:1fr 1fr}.delivery-step{padding:12px}.delivery-dialog-body{padding:12px}.delivery-dialog-head{padding:14px}.delivery-confirm{padding:12px}}
      @media(pointer:coarse){.delivery-summary button,.delivery-filterbar button,.delivery-actions button,.delivery-qty button{min-height:48px}}
    `;
    document.head.appendChild(style);
  }

  function normalizeDashboardActions() {
    const actions = $('.cc-actions');
    if (!actions) return;
    if (actions.dataset.deliveryLayoutReady === '1') return;
    injectStyles();
    actions.classList.add('delivery-layout');

    const cash = $('.cc-action.cash', actions);
    const newOrder = $$('.cc-action', actions).find((node) => /Nuevo pedido/i.test(node.textContent || ''));
    const orders = $('[data-cc-orders]', actions);
    const tables = $('[data-cc-tab="salon"]', actions);
    const kds = $('[data-cc-tab="kds"]', actions);
    const menu = $('[data-cc-menu]', actions);
    let waiter = $$('.cc-action', actions).find((node) => /^\s*👤?\s*Mesero\s*$/i.test(node.textContent || ''));
    const oldTheme = $('[data-cc-tab="estado"]', actions);
    if (!waiter && oldTheme) {
      waiter = oldTheme;
      waiter.dataset.ccTab = 'mesero';
      waiter.textContent = '👤 Mesero';
    }

    if (tables) {
      tables.classList.add('delivery-primary', 'mesas-primary');
      tables.innerHTML = '<strong>▱ Mesas</strong><small>Salón</small>';
    }
    if (cash) cash.classList.add('delivery-primary');

    let deliveryButton = $('[data-cc-deliveries]', actions);
    if (!deliveryButton) {
      deliveryButton = document.createElement('button');
      deliveryButton.type = 'button';
      deliveryButton.className = 'cc-action delivery-primary delivery-entry';
      deliveryButton.dataset.ccDeliveries = 'true';
      deliveryButton.innerHTML = '<strong>🛵 Domicilios</strong><small>Pedidos afuera</small>';
      deliveryButton.addEventListener('click', () => openDeliveries());
    }

    [cash, tables, deliveryButton, newOrder, orders, waiter, kds, menu].filter(Boolean).forEach((node) => actions.appendChild(node));
    actions.dataset.deliveryLayoutReady = '1';
  }

  function showCustom(pushState = true) {
    const canonical = window.VantixGCRestaurantControlCenter?.openCustomView?.('domicilios', pushState);
    if (canonical) return canonical;
    const dashboard = $('#ccDashboard');
    const custom = $('#ccCustomView');
    const message = $('#message');
    const view = $('#view');
    if (dashboard) dashboard.hidden = true;
    if (custom) custom.hidden = false;
    if (message) message.hidden = true;
    if (view) view.hidden = true;
    return custom;
  }

  function stopPoll() {
    if (poll) clearInterval(poll);
    poll = null;
  }

  function goHome() {
    active = false;
    stopPoll();
    if (window.VantixGCRestaurantControlCenter?.navigateBack) window.VantixGCRestaurantControlCenter.navigateBack();
    else window.VantixGCRestaurantControlCenter?.showDashboard?.();
  }

  function age(value) {
    const ms = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(ms)) return '';
    const minutes = Math.max(0, Math.floor(ms / 60000));
    if (minutes < 1) return 'ahora';
    if (minutes < 60) return `hace ${minutes} min`;
    return `hace ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  function isLate(row) {
    return !['ENTREGADO','CANCELADO'].includes(row.state) && row.promisedAt && new Date(row.promisedAt).getTime() < Date.now();
  }

  const stateInfo = Object.freeze({
    NUEVO: ['●','NUEVO'],
    CONFIRMADO: ['✓','CONFIRMADO'],
    EN_PREPARACION: ['♨','PREPARANDO'],
    LISTO: ['✓','LISTO'],
    EN_CAMINO: ['🛵','EN CAMINO'],
    ENTREGADO: ['✓','ENTREGADO'],
    CANCELADO: ['×','CANCELADO']
  });

  function stateBadge(row) {
    const [icon, label] = stateInfo[row.state] || ['', row.state];
    return `<span class="delivery-state">${icon} ${esc(label)}</span>`;
  }

  function primaryAction(row) {
    if (row.state === 'NUEVO') return { label:'✓ ACEPTAR PEDIDO', action:'accept' };
    if (['CONFIRMADO','EN_PREPARACION'].includes(row.state)) return { label:'♨ VER EN COCINA / KDS', action:'kds' };
    if (row.state === 'LISTO') return { label:'🛵 MARCAR EN CAMINO', action:'route' };
    if (row.state === 'EN_CAMINO') return { label:'✓ MARCAR ENTREGADO', action:'delivered' };
    if (row.state === 'ENTREGADO' && row.paymentStatus === 'PENDIENTE' && canPay) return { label:'$ REGISTRAR PAGO', action:'pay' };
    return { label:'VER DETALLE', action:'detail' };
  }

  function card(row) {
    const action = primaryAction(row);
    const itemRows = (row.items || []).slice(0, 5);
    return `<article class="delivery-card ${esc(row.state)} ${isLate(row) ? 'late' : ''}" data-delivery-card="${esc(row.id)}">
      <div class="delivery-card-top"><div><div class="delivery-code">#${esc(row.code)}</div><span class="delivery-age">${esc(age(row.creadoEn))}${isLate(row) ? ' · ⚠ RETRASADO' : ''}</span></div>${stateBadge(row)}</div>
      <div class="delivery-card-customer"><b>${esc(row.customerName)}</b><span>☎ ${esc(row.customerPhone)}</span><span>⌖ ${esc(row.address)}${row.neighborhood ? ` · ${esc(row.neighborhood)}` : ''}</span>${row.deliveryReference ? `<span>Referencia: ${esc(row.deliveryReference)}</span>` : ''}</div>
      <div class="delivery-items">${itemRows.map((item) => `<div class="delivery-item"><span>${esc(item.quantity)}× ${esc(item.description)}</span><b>${money(item.lineTotal)}</b></div>`).join('')}${(row.items || []).length > 5 ? `<small class="ri-muted">+ ${(row.items || []).length - 5} producto(s)</small>` : ''}${Number(row.deliveryFee || 0) > 0 ? `<div class="delivery-item"><span>Servicio domicilio</span><b>${money(row.deliveryFee)}</b></div>` : ''}</div>
      <div class="delivery-finance"><div class="delivery-total"><small>TOTAL</small><strong>${money(row.total)}</strong></div><span class="delivery-payment ${esc(row.paymentStatus)}">${row.paymentStatus === 'PAGADO' ? '✓ PAGADO' : '$ PAGO PENDIENTE'}</span></div>
      <div class="delivery-actions"><button type="button" class="primary-next" data-delivery-action="${action.action}" data-delivery-id="${esc(row.id)}">${action.label}</button>${row.paymentStatus === 'PENDIENTE' && canPay && action.action !== 'pay' ? `<button type="button" class="secondary-next" data-delivery-action="pay" data-delivery-id="${esc(row.id)}">$ Pago</button>` : row.state === 'NUEVO' ? `<button type="button" class="secondary-next" data-delivery-action="cancel" data-delivery-id="${esc(row.id)}">Cancelar</button>` : '<span></span>'}</div>
    </article>`;
  }

  function priority(row) {
    const state = { NUEVO:0, LISTO:1, EN_PREPARACION:2, CONFIRMADO:3, EN_CAMINO:4, ENTREGADO:5, CANCELADO:6 }[row.state] ?? 9;
    return (isLate(row) ? -100 : 0) + state;
  }

  async function openDeliveries(filter = 'ACTIVOS', fromPoll = false, pushState = true) {
    active = true;
    const root = fromPoll ? ($('#ccCustomView') || showCustom(false)) : showCustom(pushState);
    if (!root) return;
    if (!fromPoll) root.innerHTML = '<div class="ri-muted">Cargando domicilios…</div>';
    try {
      const [rows, summary] = await Promise.all([
        api('/api/v1/restaurante/domicilios?limit=200'),
        api('/api/v1/restaurante/domicilios/resumen')
      ]);
      if (!active) return;
      const list = (Array.isArray(rows) ? rows : []).sort((a, b) => priority(a) - priority(b) || new Date(a.creadoEn) - new Date(b.creadoEn));
      const visible = filter === 'ACTIVOS' ? list.filter((row) => !['ENTREGADO','CANCELADO'].includes(row.state)) : filter === 'PENDIENTE_PAGO' ? list.filter((row) => row.paymentStatus === 'PENDIENTE' && row.state !== 'CANCELADO') : filter === 'TODOS' ? list : list.filter((row) => row.state === filter);
      root.innerHTML = `<section class="delivery-shell">
        <header class="delivery-head"><div><div class="ri-eyebrow">CANAL DOMICILIOS</div><h1>Domicilios</h1><p>Primero lo que necesita atención. El sistema te muestra la siguiente acción.</p></div><div class="ri-actions"><button type="button" class="ri-btn primary" data-new-delivery>+ NUEVO DOMICILIO</button></div></header>
        <div class="delivery-summary"><button class="attention" data-delivery-filter="NUEVO"><small>Nuevos</small><strong>${summary.counts?.NUEVO || 0}</strong></button><button data-delivery-filter="EN_PREPARACION"><small>Preparando</small><strong>${summary.counts?.EN_PREPARACION || 0}</strong></button><button data-delivery-filter="LISTO"><small>Listos para salir</small><strong>${summary.counts?.LISTO || 0}</strong></button><button data-delivery-filter="EN_CAMINO"><small>En camino</small><strong>${summary.counts?.EN_CAMINO || 0}</strong></button><button class="late" data-delivery-filter="ACTIVOS"><small>Retrasados</small><strong>${summary.late || 0}</strong></button></div>
        <div class="delivery-filterbar">${[['ACTIVOS','Necesitan atención'],['NUEVO','Nuevos'],['LISTO','Listos'],['EN_CAMINO','En camino'],['PENDIENTE_PAGO','Pago pendiente'],['TODOS','Todos']].map(([value,label]) => `<button type="button" class="${filter === value ? 'active' : ''}" data-delivery-filter="${value}">${label}</button>`).join('')}</div>
        <div class="delivery-list">${visible.map(card).join('') || '<div class="ri-card"><b>No hay domicilios en este estado.</b><p class="ri-muted">Cuando llegue uno aparecerá aquí automáticamente.</p></div>'}</div>
      </section>`;
      bindDeliveryView(root, filter);
      if (!poll) poll = setInterval(() => {
        const current = new URLSearchParams(location.search).get('view') || 'dashboard';
        if (current !== 'domicilios') { active = false; stopPoll(); return; }
        if (active && !creating) openDeliveries(filter, true, false).catch(() => {});
      }, 5000);
    } catch (error) {
      root.innerHTML = `<div class="ri-error">${esc(error.message)}</div>`;
    }
  }

  function bindDeliveryView(root, currentFilter) {
    $('[data-new-delivery]', root)?.addEventListener('click', openCreateDialog);
    $$('[data-delivery-filter]', root).forEach((button) => button.addEventListener('click', () => openDeliveries(button.dataset.deliveryFilter || currentFilter)));
    $$('[data-delivery-action]', root).forEach((button) => button.addEventListener('click', () => runAction(button.dataset.deliveryAction, button.dataset.deliveryId, currentFilter)));
  }

  async function runAction(action, id, filter) {
    try {
      if (action === 'accept') await api(`/api/v1/restaurante/domicilios/${id}/aceptar`, { method:'POST', body:'{}' });
      else if (action === 'kds') { active = false; stopPoll(); window.VantixGCRestaurantControlCenter?.openOperationalTab?.('kds'); return; }
      else if (action === 'route') {
        const courierName = prompt('¿Quién lleva este domicilio? (opcional)', '') ?? '';
        await api(`/api/v1/restaurante/domicilios/${id}/en-camino`, { method:'POST', body:JSON.stringify({ courierName }) });
      } else if (action === 'delivered') {
        if (!confirm('¿El pedido ya fue entregado al cliente?')) return;
        await api(`/api/v1/restaurante/domicilios/${id}/entregado`, { method:'POST', body:'{}' });
      } else if (action === 'pay') { await openPaymentDialog(id); return; }
      else if (action === 'cancel') {
        if (!confirm('¿Cancelar este domicilio?')) return;
        await api(`/api/v1/restaurante/domicilios/${id}/cancelar`, { method:'POST', body:'{}' });
      } else if (action === 'detail') {
        const row = await api(`/api/v1/restaurante/domicilios/${id}`);
        alert(`${row.code}\n${row.customerName}\n${row.address}\nTotal: ${money(row.total)}\nEstado: ${row.state}\nPago: ${row.paymentStatus}`);
        return;
      }
      await openDeliveries(filter, true);
    } catch (error) { alert(error.message); }
  }

  function ensureDialog(id) {
    let dialog = document.getElementById(id);
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = id;
      dialog.className = 'delivery-dialog';
      document.body.appendChild(dialog);
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close?.(); });
    }
    return dialog;
  }

  async function openCreateDialog() {
    creating = true;
    const dialog = ensureDialog('deliveryCreateDialog');
    dialog.innerHTML = '<div class="delivery-dialog-body"><div class="ri-muted">Cargando carta…</div></div>';
    dialog.showModal?.();
    try {
      const menu = (await api('/api/v1/restaurante/menu')).filter((row) => row.product && !row.warning);
      const quantities = new Map();
      dialog.innerHTML = `<div class="delivery-dialog-head"><div><div class="ri-eyebrow">NUEVO DOMICILIO</div><h2>¿Qué necesita el cliente?</h2><p class="ri-muted">Cinco pasos cortos. Nada se envía a cocina hasta que lo aceptes.</p></div><button type="button" class="ri-btn" data-delivery-close>Cerrar</button></div><div class="delivery-dialog-body">
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">1</span><b>¿A quién se lo llevamos?</b></div><div class="delivery-fields"><label class="delivery-field">Teléfono<input id="deliveryPhone" inputmode="tel" autocomplete="tel" placeholder="300 123 4567"></label><label class="delivery-field">Nombre<input id="deliveryName" autocomplete="name" placeholder="Nombre del cliente"></label></div><div id="deliveryKnown"></div></section>
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">2</span><b>¿Dónde lo entregamos?</b></div><div class="delivery-fields"><label class="delivery-field full">Dirección<input id="deliveryAddress" autocomplete="street-address" placeholder="Ej. Cra 20 #14-22"></label><label class="delivery-field">Barrio / zona<input id="deliveryNeighborhood" placeholder="Ej. Centro"></label><label class="delivery-field">Referencia<input id="deliveryReference" placeholder="Ej. Casa verde, segundo piso"></label></div></section>
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">3</span><b>¿Qué pidió?</b></div><div class="delivery-products">${menu.map((row) => `<article class="delivery-product" data-menu-id="${esc(row.id)}"><div><b>${esc(row.product.nombre)}</b><small>${esc(row.category || '')} · ${money(row.product.precio1)}</small></div><div class="delivery-qty"><button type="button" data-delivery-minus="${esc(row.id)}">−</button><span data-delivery-qty="${esc(row.id)}">0</span><button type="button" data-delivery-plus="${esc(row.id)}">+</button></div></article>`).join('')}</div></section>
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">4</span><b>Entrega</b></div><div class="delivery-fields"><label class="delivery-field">Valor domicilio<input id="deliveryFee" inputmode="numeric" type="number" min="0" step="500" value="5000"></label><label class="delivery-field">Tiempo prometido<select id="deliveryMinutes"><option value="30">30 minutos</option><option value="45" selected>45 minutos</option><option value="60">60 minutos</option><option value="90">90 minutos</option></select></label><label class="delivery-field full">Nota para cocina o entrega<textarea id="deliveryNotes" rows="2" placeholder="Ej. Sin cebolla / tocar el timbre"></textarea></label></div></section>
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">5</span><b>Revisar y crear</b></div><p class="ri-muted">El pedido quedará como NUEVO. Sólo entra al KDS cuando pulses ACEPTAR PEDIDO.</p></section>
      </div><div class="delivery-confirm"><div><small>Total estimado</small><strong id="deliveryCreateTotal">${money(5000)}</strong></div><button type="button" id="deliveryCreateSubmit">CREAR DOMICILIO</button></div>`;

      const byId = new Map(menu.map((row) => [row.id, row]));
      const updateTotal = () => {
        let total = Number($('#deliveryFee', dialog)?.value || 0);
        for (const [id, quantity] of quantities) total += Number(byId.get(id)?.product?.precio1 || 0) * quantity;
        $('#deliveryCreateTotal', dialog).textContent = money(total);
      };
      const setQty = (id, delta) => {
        const value = Math.max(0, Math.min((quantities.get(id) || 0) + delta, 99));
        quantities.set(id, value);
        $(`[data-delivery-qty="${id}"]`, dialog).textContent = String(value);
        updateTotal();
      };
      $$('[data-delivery-plus]', dialog).forEach((button) => button.addEventListener('click', () => setQty(button.dataset.deliveryPlus, 1)));
      $$('[data-delivery-minus]', dialog).forEach((button) => button.addEventListener('click', () => setQty(button.dataset.deliveryMinus, -1)));
      $('#deliveryFee', dialog)?.addEventListener('input', updateTotal);
      $('[data-delivery-close]', dialog)?.addEventListener('click', () => { creating = false; dialog.close?.(); });
      dialog.addEventListener('close', () => { creating = false; }, { once:true });

      let lookupTimer = null;
      $('#deliveryPhone', dialog)?.addEventListener('input', () => {
        clearTimeout(lookupTimer);
        lookupTimer = setTimeout(async () => {
          const phone = String($('#deliveryPhone', dialog)?.value || '').replace(/\D+/g, '');
          if (phone.length < 7) return;
          try {
            const known = await api(`/api/v1/restaurante/domicilios/clientes/telefono/${encodeURIComponent(phone)}`);
            const box = $('#deliveryKnown', dialog);
            if (!known) { box.innerHTML = ''; return; }
            box.innerHTML = `<div class="delivery-known"><b>Ya conocemos a ${esc(known.customerName)}</b><div>${esc(known.address)}${known.neighborhood ? ` · ${esc(known.neighborhood)}` : ''}</div><button type="button" class="ri-btn small" data-use-known style="margin-top:7px">USAR ESTA DIRECCIÓN</button></div>`;
            $('[data-use-known]', box)?.addEventListener('click', () => {
              $('#deliveryName', dialog).value = known.customerName || '';
              $('#deliveryAddress', dialog).value = known.address || '';
              $('#deliveryNeighborhood', dialog).value = known.neighborhood || '';
              $('#deliveryReference', dialog).value = known.deliveryReference || '';
            });
          } catch {}
        }, 450);
      });

      $('#deliveryCreateSubmit', dialog)?.addEventListener('click', async () => {
        const button = $('#deliveryCreateSubmit', dialog);
        const items = [...quantities.entries()].filter(([, q]) => q > 0).map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
        const customerName = String($('#deliveryName', dialog)?.value || '').trim();
        const customerPhone = String($('#deliveryPhone', dialog)?.value || '').trim();
        const address = String($('#deliveryAddress', dialog)?.value || '').trim();
        if (!customerName || !customerPhone || !address || !items.length) {
          alert('Completa teléfono, nombre, dirección y agrega al menos un producto.');
          return;
        }
        button.disabled = true;
        button.textContent = 'CREANDO…';
        try {
          const minutes = Number($('#deliveryMinutes', dialog)?.value || 45);
          await api('/api/v1/restaurante/domicilios', {
            method:'POST',
            body:JSON.stringify({
              customerName,
              customerPhone,
              address,
              neighborhood:String($('#deliveryNeighborhood', dialog)?.value || '').trim() || null,
              deliveryReference:String($('#deliveryReference', dialog)?.value || '').trim() || null,
              notes:String($('#deliveryNotes', dialog)?.value || '').trim() || null,
              deliveryFee:Number($('#deliveryFee', dialog)?.value || 0),
              promisedAt:new Date(Date.now() + minutes * 60000).toISOString(),
              channel:'MANUAL',
              items
            })
          });
          creating = false;
          dialog.close?.();
          await openDeliveries('NUEVO', true);
        } catch (error) {
          alert(error.message);
          button.disabled = false;
          button.textContent = 'CREAR DOMICILIO';
        }
      });
    } catch (error) {
      dialog.innerHTML = `<div class="delivery-dialog-body"><div class="ri-error">${esc(error.message)}</div><button type="button" class="ri-btn" onclick="this.closest('dialog').close()">Cerrar</button></div>`;
    }
  }

  async function openPaymentDialog(id) {
    creating = true;
    const dialog = ensureDialog('deliveryPaymentDialog');
    dialog.innerHTML = '<div class="delivery-dialog-body"><div class="ri-muted">Cargando medios de pago…</div></div>';
    dialog.showModal?.();
    try {
      const [delivery, accounts] = await Promise.all([
        api(`/api/v1/restaurante/domicilios/${id}`),
        api('/api/v1/tesoreria/cajas-bancos')
      ]);
      const activeAccounts = (Array.isArray(accounts) ? accounts : []).filter((row) => row.activo !== false);
      dialog.innerHTML = `<div class="delivery-dialog-head"><div><div class="ri-eyebrow">REGISTRAR PAGO</div><h2>${esc(delivery.code)} · ${money(delivery.total)}</h2><p class="ri-muted">El estado de entrega y el estado de pago son independientes.</p></div><button class="ri-btn" data-payment-close>Cerrar</button></div><div class="delivery-dialog-body"><section class="delivery-step"><div class="delivery-fields"><label class="delivery-field">¿Cómo pagó?<select id="deliveryPayMethod"><option value="EFECTIVO">Efectivo</option><option value="TRANSFERENCIA">Transferencia</option><option value="TARJETA">Tarjeta</option></select></label><label class="delivery-field">Caja / Banco<select id="deliveryPayAccount">${activeAccounts.map((row) => `<option value="${esc(row.id)}" data-account-type="${esc(row.tipo)}">${esc(row.nombre)} · ${esc(row.tipo)}</option>`).join('')}</select></label><label class="delivery-field full">Referencia<input id="deliveryPayReference" placeholder="Opcional"></label></div></section><button type="button" class="ri-btn primary" id="deliveryPaySubmit">CONFIRMAR PAGO ${money(delivery.total)}</button></div>`;
      const chooseCompatible = () => {
        const method = $('#deliveryPayMethod', dialog)?.value;
        const wanted = method === 'EFECTIVO' ? 'CAJA' : 'BANCO';
        const option = $$('option', $('#deliveryPayAccount', dialog)).find((row) => row.dataset.accountType === wanted);
        if (option) $('#deliveryPayAccount', dialog).value = option.value;
      };
      $('#deliveryPayMethod', dialog)?.addEventListener('change', chooseCompatible);
      chooseCompatible();
      $('[data-payment-close]', dialog)?.addEventListener('click', () => { creating = false; dialog.close?.(); });
      dialog.addEventListener('close', () => { creating = false; }, { once:true });
      $('#deliveryPaySubmit', dialog)?.addEventListener('click', async () => {
        const button = $('#deliveryPaySubmit', dialog);
        button.disabled = true;
        try {
          await api(`/api/v1/restaurante/domicilios/${id}/pago`, { method:'POST', body:JSON.stringify({ metodoPago:$('#deliveryPayMethod', dialog).value, cajaBancoId:$('#deliveryPayAccount', dialog).value, referencia:String($('#deliveryPayReference', dialog).value || '').trim() || null }) });
          creating = false;
          dialog.close?.();
          await openDeliveries('ACTIVOS', true);
        } catch (error) { alert(error.message); button.disabled = false; }
      });
    } catch (error) {
      dialog.innerHTML = `<div class="delivery-dialog-body"><div class="ri-error">${esc(error.message)}</div></div>`;
    }
  }

  const observer = new MutationObserver(() => normalizeDashboardActions());
  observer.observe(document.documentElement, { childList:true, subtree:true });
  injectStyles();
  normalizeDashboardActions();

  window.VantixGCRestaurantDelivery = Object.freeze({
    open: (pushState = true) => openDeliveries('ACTIVOS', false, pushState),
    refresh: () => openDeliveries('ACTIVOS', true, false),
    deactivate: () => { active = false; stopPoll(); }
  });
})();
