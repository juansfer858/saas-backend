/* VANTIX_RESTAURANT_DELIVERY_ORDERS_MENU_V91 */
(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_DELIVERY_ORDERS_MENU_V91';
  if (window[MARKER]) return;

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const MENU_PATH = '/api/v1/restaurante/menu';
  const DELIVERY_PATH = '/api/v1/restaurante/domicilios';

  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) return;

  let menuPromise = null;
  let menuCache = null;
  let opening = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[m]));
  const money = (value) => new Intl.NumberFormat('es-CO', {
    style:'currency',
    currency:session.tenant?.moneda || 'COP',
    maximumFractionDigits:0
  }).format(Number(value || 0));
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function headers(withBody = false) {
    return {
      Authorization:`Bearer ${session.token}`,
      'x-tenant-subdomain':session.subdomain,
      ...(withBody ? { 'Content-Type':'application/json' } : {})
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache:'no-store',
      headers:{ ...headers(Boolean(options.body)), ...(options.headers || {}) }
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

  function preloadMenu(force = false) {
    if (!force && menuCache) return Promise.resolve(menuCache);
    if (!force && menuPromise) return menuPromise;
    menuPromise = api(MENU_PATH)
      .then((raw) => {
        menuCache = (Array.isArray(raw) ? raw : []).filter((row) => row?.product);
        return menuCache;
      })
      .finally(() => { menuPromise = null; });
    return menuPromise;
  }

  function injectStyles() {
    if (document.querySelector('#restaurantDeliveryOrdersMenuV91Style')) return;
    const style = document.createElement('style');
    style.id = 'restaurantDeliveryOrdersMenuV91Style';
    style.textContent = `
      .delivery-v91-pedidos-menu{display:grid;gap:10px}
      .delivery-v91-pedidos-menu .menu-head{display:grid;grid-template-columns:1fr minmax(180px,320px);gap:12px;align-items:end}
      .delivery-v91-pedidos-menu .menu-head h3{margin:0;font-size:17px}
      .delivery-v91-pedidos-menu .menu-head small{color:var(--cc-muted,#61706a)}
      .delivery-v91-pedidos-menu .menu-head input{width:100%;min-height:44px;padding:9px 11px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;font:inherit;font-size:15px}
      .delivery-v91-pedidos-menu .categories{display:flex;gap:6px;overflow:auto;margin:2px 0 0;padding-bottom:2px;scrollbar-width:none}
      .delivery-v91-pedidos-menu .categories::-webkit-scrollbar{display:none}
      .delivery-v91-pedidos-menu .categories button{white-space:nowrap;min-height:40px;padding:7px 11px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;color:#344054;font-weight:850;cursor:pointer}
      .delivery-v91-pedidos-menu .categories button.rv2-btn-primary{border-color:var(--rv2-primary,#0d6b43);background:var(--rv2-primary,#0d6b43);color:#fff}
      .delivery-v91-pedidos-menu .menu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:9px}
      .delivery-v91-pedidos-menu .menu-item{border:1px solid var(--rv2-line,#e4e7ec);border-radius:12px;background:#fff;padding:12px;display:grid;gap:8px;align-content:start}
      .delivery-v91-pedidos-menu .menu-item b{font-size:14px}
      .delivery-v91-pedidos-menu .menu-item small{color:var(--rv2-muted,#667085)}
      .delivery-v91-pedidos-menu .menu-item strong{color:var(--rv2-primary-hover,#0d6b43)}
      .delivery-v91-pedidos-menu .menu-item button{width:100%;min-height:40px}
      .delivery-v91-pedidos-menu .menu-item .menu-warning{color:#b45309;font-weight:800}
      .delivery-v91-cart{display:grid;gap:7px;margin-top:10px;padding-top:10px;border-top:1px solid var(--cc-line,#dce6e0)}
      .delivery-v91-cart-title{display:flex;justify-content:space-between;gap:10px;align-items:center}
      .delivery-v91-cart-title b{font-size:13px}.delivery-v91-cart-title span{font-size:11px;color:var(--cc-muted,#61706a)}
      .delivery-v91-cart-line{display:grid;grid-template-columns:1fr auto;gap:9px;align-items:center;padding:9px 10px;border:1px solid var(--cc-line,#dce6e0);border-radius:10px;background:#f9fafb}
      .delivery-v91-cart-line b{display:block;font-size:13px}.delivery-v91-cart-line small{color:var(--cc-muted,#61706a)}
      .delivery-v91-qty{display:flex;gap:5px;align-items:center}.delivery-v91-qty button{width:36px;height:36px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-size:18px;font-weight:950;cursor:pointer}.delivery-v91-qty strong{min-width:24px;text-align:center}
      .delivery-v91-empty{padding:16px;border:1px dashed #cbd5e1;border-radius:10px;text-align:center;color:var(--cc-muted,#61706a)}
      .delivery-v91-error{padding:10px 12px;border:1px solid #fecaca;border-radius:10px;background:#fff7f7;color:#991b1b;font-weight:800}
      .delivery-v91-toast{position:fixed;right:18px;bottom:18px;z-index:99999;max-width:420px;padding:12px 14px;border-radius:12px;background:#111c2b;color:#fff;font-weight:850;box-shadow:0 12px 30px rgba(15,23,42,.3)}
      @media(max-width:720px){.delivery-v91-pedidos-menu .menu-head{grid-template-columns:1fr}.delivery-v91-pedidos-menu .menu-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:430px){.delivery-v91-pedidos-menu .menu-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function flash(text) {
    document.querySelector('.delivery-v91-toast')?.remove();
    const node = document.createElement('div');
    node.className = 'delivery-v91-toast';
    node.textContent = text;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  function freshDialog() {
    document.querySelector('#deliveryCreateDialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'deliveryCreateDialog';
    dialog.className = 'delivery-dialog';
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  function categories(menu) {
    return ['TODAS', ...new Set(menu.map((row) => row.displayCategory || row.category || 'MENÚ'))];
  }

  function buildDialog(dialog, menu) {
    const quantities = new Map();
    const byId = new Map(menu.map((row) => [row.id, row]));
    const state = { category:'TODAS', search:'' };

    dialog.innerHTML = `<div class="delivery-dialog-head"><div><div class="ri-eyebrow">NUEVO DOMICILIO</div><h2>¿Qué necesita el cliente?</h2><p class="ri-muted">Selecciona directamente desde la Carta de Pedidos.</p></div><button type="button" class="ri-btn" data-v91-close>Cerrar</button></div><div class="delivery-dialog-body">
      <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">1</span><b>¿A quién se lo llevamos?</b></div><div class="delivery-fields"><label class="delivery-field">Teléfono<input id="deliveryPhone" inputmode="tel" autocomplete="tel" placeholder="300 123 4567"></label><label class="delivery-field">Nombre<input id="deliveryName" autocomplete="name" placeholder="Nombre del cliente"></label></div><div id="deliveryKnown"></div></section>
      <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">2</span><b>¿Dónde lo entregamos?</b></div><div class="delivery-fields"><label class="delivery-field full">Dirección<input id="deliveryAddress" autocomplete="street-address" placeholder="Ej. Cra 20 #14-22"></label><label class="delivery-field">Barrio / zona<input id="deliveryNeighborhood" placeholder="Ej. Centro"></label><label class="delivery-field">Referencia<input id="deliveryReference" placeholder="Ej. Casa verde, segundo piso"></label></div></section>
      <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">3</span><b>Carta</b></div><div class="delivery-v91-pedidos-menu">
        <div class="menu-head"><div><small>PRODUCTOS DEL RESTAURANTE</small><h3>Carta</h3></div><input id="deliveryV91Search" placeholder="Buscar en toda la carta…"></div>
        <div id="deliveryV91Categories" class="categories"></div>
        <div id="deliveryV91Menu" class="menu-grid"></div>
        <div class="delivery-v91-cart"><div class="delivery-v91-cart-title"><b>Pedido en curso</b><span id="deliveryV91Count">0 productos</span></div><div id="deliveryV91Cart"></div></div>
      </div></section>
      <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">4</span><b>Entrega</b></div><div class="delivery-fields"><label class="delivery-field">Valor domicilio<input id="deliveryFee" inputmode="numeric" type="number" min="0" step="500" value="5000"></label><label class="delivery-field">Tiempo prometido<select id="deliveryMinutes"><option value="30">30 minutos</option><option value="45" selected>45 minutos</option><option value="60">60 minutos</option><option value="90">90 minutos</option></select></label><label class="delivery-field full">Nota para cocina o entrega<textarea id="deliveryNotes" rows="2" placeholder="Ej. Sin cebolla / tocar el timbre"></textarea></label></div></section>
      <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">5</span><b>Revisar y crear</b></div><p class="ri-muted">El domicilio queda como NUEVO. Al aceptarlo se envía a Cocina / Barra con sus estaciones normales.</p><div id="deliveryCreateError"></div></section>
    </div><div class="delivery-confirm"><div><small>Total estimado</small><strong id="deliveryCreateTotal">${money(5000)}</strong></div><button type="button" id="deliveryCreateSubmit">CREAR DOMICILIO</button></div>`;

    const categoriesRoot = dialog.querySelector('#deliveryV91Categories');
    const menuRoot = dialog.querySelector('#deliveryV91Menu');
    const cartRoot = dialog.querySelector('#deliveryV91Cart');
    const countRoot = dialog.querySelector('#deliveryV91Count');
    const errorRoot = dialog.querySelector('#deliveryCreateError');

    function filteredMenu() {
      const q = normalize(state.search);
      return menu.filter((item) => {
        const cat = item.displayCategory || item.category || 'MENÚ';
        if (state.category !== 'TODAS' && cat !== state.category) return false;
        if (!q) return true;
        return normalize(`${item.product?.nombre || ''} ${item.product?.descripcion || ''} ${item.product?.sku || ''} ${cat}`).includes(q);
      });
    }

    function renderCategories() {
      categoriesRoot.innerHTML = categories(menu).map((category) => `<button type="button" class="rv2-btn ${state.category === category ? 'rv2-btn-primary' : ''}" data-v91-category="${esc(category)}">${esc(category === 'TODAS' ? 'Todo' : category)}</button>`).join('');
    }

    function renderMenu() {
      const rows = filteredMenu();
      menuRoot.innerHTML = rows.map((item) => {
        const warning = item.warning ? `<small class="menu-warning">${esc(item.warning)}</small>` : '';
        return `<article class="menu-item"><b>${esc(item.product?.nombre || 'Producto')}</b><small>${esc(item.displayCategory || item.category || '')} · ${esc(item.station || '')}</small><strong>${money(item.product?.precio1)}</strong>${warning}<button type="button" class="rv2-btn rv2-btn-primary" data-v91-add="${esc(item.id)}" ${item.warning ? 'disabled' : ''}>+ Agregar</button></article>`;
      }).join('') || '<div class="delivery-v91-empty">No hay productos que coincidan.</div>';
    }

    function selectedRows() {
      return [...quantities.entries()].filter(([, quantity]) => quantity > 0);
    }

    function updateTotal() {
      let total = Number(dialog.querySelector('#deliveryFee')?.value || 0);
      for (const [id, quantity] of selectedRows()) total += Number(byId.get(id)?.product?.precio1 || 0) * quantity;
      dialog.querySelector('#deliveryCreateTotal').textContent = money(total);
    }

    function renderCart() {
      const selected = selectedRows();
      const units = selected.reduce((sum, [, quantity]) => sum + quantity, 0);
      countRoot.textContent = `${units} producto${units === 1 ? '' : 's'}`;
      cartRoot.innerHTML = selected.length ? selected.map(([id, quantity]) => {
        const item = byId.get(id);
        return `<div class="delivery-v91-cart-line"><div><b>${esc(item?.product?.nombre || 'Producto')}</b><small>${money(item?.product?.precio1)} c/u</small></div><div class="delivery-v91-qty"><button type="button" data-v91-minus="${esc(id)}">−</button><strong>${quantity}</strong><button type="button" data-v91-plus="${esc(id)}">+</button></div></div>`;
      }).join('') : '<div class="delivery-v91-empty">Agrega productos desde la carta.</div>';
      updateTotal();
    }

    function setQty(id, delta) {
      const item = byId.get(id);
      if (!item || item.warning) return;
      const value = Math.max(0, Math.min(99, Number(quantities.get(id) || 0) + delta));
      quantities.set(id, value);
      renderCart();
    }

    renderCategories();
    renderMenu();
    renderCart();

    dialog.querySelector('#deliveryV91Search')?.addEventListener('input', (event) => {
      state.search = event.target.value || '';
      renderMenu();
    });
    dialog.querySelector('#deliveryFee')?.addEventListener('input', updateTotal);

    dialog.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.matches('[data-v91-close]')) return dialog.close();
      if (target.dataset.v91Category) {
        state.category = target.dataset.v91Category;
        renderCategories();
        renderMenu();
        return;
      }
      if (target.dataset.v91Add) return setQty(target.dataset.v91Add, 1);
      if (target.dataset.v91Plus) return setQty(target.dataset.v91Plus, 1);
      if (target.dataset.v91Minus) return setQty(target.dataset.v91Minus, -1);
    });

    dialog.querySelector('#deliveryCreateSubmit')?.addEventListener('click', async () => {
      const button = dialog.querySelector('#deliveryCreateSubmit');
      const items = selectedRows().map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
      const customerName = String(dialog.querySelector('#deliveryName')?.value || '').trim();
      const customerPhone = String(dialog.querySelector('#deliveryPhone')?.value || '').trim();
      const address = String(dialog.querySelector('#deliveryAddress')?.value || '').trim();
      errorRoot.innerHTML = '';
      if (!customerName || !customerPhone || !address || !items.length) {
        errorRoot.innerHTML = '<div class="delivery-v91-error">Completa nombre, teléfono, dirección y agrega al menos un producto.</div>';
        return;
      }

      button.disabled = true;
      button.textContent = 'CREANDO…';
      try {
        const minutes = Math.max(1, Number(dialog.querySelector('#deliveryMinutes')?.value || 45));
        await api(DELIVERY_PATH, {
          method:'POST',
          body:JSON.stringify({
            customerName,
            customerPhone,
            address,
            neighborhood:String(dialog.querySelector('#deliveryNeighborhood')?.value || '').trim() || null,
            deliveryReference:String(dialog.querySelector('#deliveryReference')?.value || '').trim() || null,
            notes:String(dialog.querySelector('#deliveryNotes')?.value || '').trim() || null,
            deliveryFee:Number(dialog.querySelector('#deliveryFee')?.value || 0),
            promisedAt:new Date(Date.now() + minutes * 60000).toISOString(),
            channel:'MANUAL',
            items
          })
        });
        dialog.close();
        flash('Domicilio creado. Quedó en NUEVO para aceptar y enviar a producción.');
        setTimeout(() => {
          const activeFilter = document.querySelector('.delivery-filterbar button.active');
          activeFilter?.click();
        }, 120);
      } catch (error) {
        errorRoot.innerHTML = `<div class="delivery-v91-error">${esc(error.message)}</div>`;
        button.disabled = false;
        button.textContent = 'CREAR DOMICILIO';
      }
    });
  }

  async function openOrdersMenuDeliveryDialog() {
    if (opening) return;
    opening = true;
    injectStyles();
    try {
      // La carta se precarga al entrar a Domicilios. Al pulsar NUEVO no se muestra pantalla de carga.
      const menu = await preloadMenu();
      const dialog = freshDialog();
      buildDialog(dialog, menu);
      dialog.showModal?.();
    } catch (error) {
      const dialog = freshDialog();
      dialog.innerHTML = `<div class="delivery-dialog-head"><div><div class="ri-eyebrow">NUEVO DOMICILIO</div><h2>No se pudo abrir la carta</h2></div><button type="button" class="ri-btn" data-v91-close>Cerrar</button></div><div class="delivery-dialog-body"><div class="delivery-v91-error">${esc(error?.message || 'Reintenta en unos segundos.')}</div><button type="button" class="ri-btn primary" data-v91-retry>REINTENTAR</button></div>`;
      dialog.showModal?.();
    } finally {
      opening = false;
    }
  }

  // Captura antes del flujo histórico: Domicilios conserva su dominio pero usa la carta visual de Pedidos.
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-new-delivery]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openOrdersMenuDeliveryDialog();
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-v91-retry]')) {
      event.preventDefault();
      preloadMenu(true).then(() => openOrdersMenuDeliveryDialog()).catch(() => openOrdersMenuDeliveryDialog());
    }
    if (event.target?.closest?.('[data-v91-close]')) document.querySelector('#deliveryCreateDialog')?.close?.();
  }, true);

  injectStyles();
  preloadMenu().catch(() => {});
  document.documentElement.dataset.deliveryOrdersMenuV91 = '1';
  window[MARKER] = Object.freeze({
    version:'91.0.0',
    menuSource:MENU_PATH,
    sameMenuAsOrders:true,
    sameVisualContractAsOrders:true,
    requiresTable:false,
    preload:true,
    loadingOverlay:false
  });
})();
