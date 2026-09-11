/* VANTIX_RESTAURANT_DELIVERY_ORDERS_COMPACT_V93 */
(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_DELIVERY_ORDERS_COMPACT_V93';
  if (window[MARKER]) return;

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const MENU_PATH = '/api/v1/restaurante/domicilios/carta';
  const DELIVERY_PATH = '/api/v1/restaurante/domicilios';
  const PAGE_SIZE = 24;

  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[m]));
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const money = (value) => new Intl.NumberFormat('es-CO', {
    style:'currency', currency:session.tenant?.moneda || 'COP', maximumFractionDigits:0
  }).format(Number(value || 0));

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

  function injectStyles() {
    if (document.querySelector('#restaurantDeliveryOrdersCompactV93Style')) return;
    const style = document.createElement('style');
    style.id = 'restaurantDeliveryOrdersCompactV93Style';
    style.textContent = `
      .delivery-v93-menu{display:grid;gap:10px}
      .delivery-v93-menu .menu-head{display:grid;grid-template-columns:1fr minmax(180px,320px);gap:12px;align-items:end}
      .delivery-v93-menu .menu-head h3{margin:0;font-size:17px}.delivery-v93-menu .menu-head small{color:var(--cc-muted,#61706a)}
      .delivery-v93-menu .menu-head input{width:100%;min-height:44px;padding:9px 11px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;font:inherit;font-size:15px}
      .delivery-v93-menu .categories{display:flex;gap:6px;overflow:auto;margin:2px 0 0;padding-bottom:2px;scrollbar-width:none}.delivery-v93-menu .categories::-webkit-scrollbar{display:none}
      .delivery-v93-menu .categories button{white-space:nowrap;min-height:40px;padding:7px 11px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;color:#344054;font-weight:850;cursor:pointer}
      .delivery-v93-menu .categories button.rv2-btn-primary{border-color:var(--rv2-primary,#0d6b43);background:var(--rv2-primary,#0d6b43);color:#fff}
      .delivery-v93-menu .menu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:9px}
      .delivery-v93-menu .menu-item{border:1px solid var(--rv2-line,#e4e7ec);border-radius:12px;background:#fff;padding:12px;display:grid;gap:8px;align-content:start}
      .delivery-v93-menu .menu-item b{font-size:14px}.delivery-v93-menu .menu-item small{color:var(--rv2-muted,#667085)}.delivery-v93-menu .menu-item strong{color:var(--rv2-primary-hover,#0d6b43)}
      .delivery-v93-menu .menu-item button{width:100%;min-height:40px}.delivery-v93-menu .menu-warning{color:#b45309!important;font-weight:800}
      .delivery-v93-more{grid-column:1/-1;min-height:42px;border:1px dashed #94a3b8;border-radius:10px;background:#fff;font-weight:900;cursor:pointer}
      .delivery-v93-cart{display:grid;gap:7px;margin-top:10px;padding-top:10px;border-top:1px solid var(--cc-line,#dce6e0)}
      .delivery-v93-cart-title{display:flex;justify-content:space-between;gap:10px;align-items:center}.delivery-v93-cart-title b{font-size:13px}.delivery-v93-cart-title span{font-size:11px;color:var(--cc-muted,#61706a)}
      .delivery-v93-cart-line{display:grid;grid-template-columns:1fr auto;gap:9px;align-items:center;padding:9px 10px;border:1px solid var(--cc-line,#dce6e0);border-radius:10px;background:#f9fafb}
      .delivery-v93-cart-line b{display:block;font-size:13px}.delivery-v93-cart-line small{color:var(--cc-muted,#61706a)}
      .delivery-v93-qty{display:flex;gap:5px;align-items:center}.delivery-v93-qty button{width:36px;height:36px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-size:18px;font-weight:950;cursor:pointer}.delivery-v93-qty strong{min-width:24px;text-align:center}
      .delivery-v93-empty{padding:16px;border:1px dashed #cbd5e1;border-radius:10px;text-align:center;color:var(--cc-muted,#61706a)}
      .delivery-v93-error{padding:10px 12px;border:1px solid #fecaca;border-radius:10px;background:#fff7f7;color:#991b1b;font-weight:800}
      @media(max-width:720px){.delivery-v93-menu .menu-head{grid-template-columns:1fr}.delivery-v93-menu .menu-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:430px){.delivery-v93-menu .menu-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function freshDialog() {
    document.querySelector('#deliveryCreateDialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'deliveryCreateDialog';
    dialog.className = 'delivery-dialog';
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    document.body.appendChild(dialog);
    return dialog;
  }

  function openDialogShell() {
    const dialog = freshDialog();
    dialog.innerHTML = `<div class="delivery-dialog-head"><div><div class="ri-eyebrow">NUEVO DOMICILIO</div><h2>¿Qué necesita el cliente?</h2><p class="ri-muted">La misma Carta de Pedidos, sin mesa.</p></div><button type="button" class="ri-btn" data-v93-close>Cerrar</button></div><div class="delivery-dialog-body">
      <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">1</span><b>¿A quién se lo llevamos?</b></div><div class="delivery-fields"><label class="delivery-field">Teléfono<input id="deliveryPhone" inputmode="tel" autocomplete="tel" placeholder="300 123 4567"></label><label class="delivery-field">Nombre<input id="deliveryName" autocomplete="name" placeholder="Nombre del cliente"></label></div><div id="deliveryKnown"></div></section>
      <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">2</span><b>¿Dónde lo entregamos?</b></div><div class="delivery-fields"><label class="delivery-field full">Dirección<input id="deliveryAddress" autocomplete="street-address" placeholder="Ej. Cra 20 #14-22"></label><label class="delivery-field">Barrio / zona<input id="deliveryNeighborhood" placeholder="Ej. Centro"></label><label class="delivery-field">Referencia<input id="deliveryReference" placeholder="Ej. Casa verde, segundo piso"></label></div></section>
      <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">3</span><b>Carta</b></div><div class="delivery-v93-menu">
        <div class="menu-head"><div><small>PRODUCTOS DEL RESTAURANTE</small><h3>Carta</h3></div><input id="deliveryV93Search" placeholder="Buscar en toda la carta…" disabled></div>
        <div id="deliveryV93Categories" class="categories"></div>
        <div id="deliveryV93Menu" class="menu-grid"></div>
        <div class="delivery-v93-cart"><div class="delivery-v93-cart-title"><b>Pedido en curso</b><span id="deliveryV93Count">0 productos</span></div><div id="deliveryV93Cart"><div class="delivery-v93-empty">Agrega productos desde la carta.</div></div></div>
      </div></section>
      <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">4</span><b>Entrega</b></div><div class="delivery-fields"><label class="delivery-field">Valor domicilio<input id="deliveryFee" inputmode="numeric" type="number" min="0" step="500" value="5000"></label><label class="delivery-field">Tiempo prometido<select id="deliveryMinutes"><option value="30">30 minutos</option><option value="45" selected>45 minutos</option><option value="60">60 minutos</option><option value="90">90 minutos</option></select></label><label class="delivery-field full">Nota para cocina o entrega<textarea id="deliveryNotes" rows="2" placeholder="Ej. Sin cebolla / tocar el timbre"></textarea></label></div></section>
      <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">5</span><b>Revisar y crear</b></div><div id="deliveryCreateError"></div></section>
    </div><div class="delivery-confirm"><div><small>Total estimado</small><strong id="deliveryCreateTotal">${money(5000)}</strong></div><button type="button" id="deliveryCreateSubmit" disabled>CREAR DOMICILIO</button></div>`;
    dialog.showModal?.();
    return dialog;
  }

  function wireKnownCustomer(dialog) {
    let timer = null;
    dialog.querySelector('#deliveryPhone')?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const phone = String(dialog.querySelector('#deliveryPhone')?.value || '').replace(/\D+/g, '');
        if (phone.length < 7) return;
        try {
          const known = await api(`/api/v1/restaurante/domicilios/clientes/telefono/${encodeURIComponent(phone)}`);
          const box = dialog.querySelector('#deliveryKnown');
          if (!known) { box.innerHTML = ''; return; }
          box.innerHTML = `<div class="delivery-known"><b>Ya conocemos a ${esc(known.customerName)}</b><div>${esc(known.address)}${known.neighborhood ? ` · ${esc(known.neighborhood)}` : ''}</div><button type="button" class="ri-btn small" data-v93-known>USAR ESTA DIRECCIÓN</button></div>`;
          box.querySelector('[data-v93-known]')?.addEventListener('click', () => {
            dialog.querySelector('#deliveryName').value = known.customerName || '';
            dialog.querySelector('#deliveryAddress').value = known.address || '';
            dialog.querySelector('#deliveryNeighborhood').value = known.neighborhood || '';
            dialog.querySelector('#deliveryReference').value = known.deliveryReference || '';
          });
        } catch {}
      }, 450);
    });
  }

  async function openNewDelivery() {
    injectStyles();
    const dialog = openDialogShell();
    wireKnownCustomer(dialog);

    const quantities = new Map();
    let menu = [];
    let byId = new Map();
    const state = { category:'TODAS', search:'', limit:PAGE_SIZE };

    const categoriesRoot = dialog.querySelector('#deliveryV93Categories');
    const menuRoot = dialog.querySelector('#deliveryV93Menu');
    const cartRoot = dialog.querySelector('#deliveryV93Cart');
    const countRoot = dialog.querySelector('#deliveryV93Count');
    const totalRoot = dialog.querySelector('#deliveryCreateTotal');
    const errorRoot = dialog.querySelector('#deliveryCreateError');
    const submit = dialog.querySelector('#deliveryCreateSubmit');

    const selectedRows = () => [...quantities.entries()].filter(([, quantity]) => quantity > 0);
    const categoryList = () => ['TODAS', ...new Set(menu.map((row) => row.category || 'MENÚ'))];
    const filtered = () => {
      const q = normalize(state.search);
      return menu.filter((item) => {
        const cat = item.category || 'MENÚ';
        if (state.category !== 'TODAS' && cat !== state.category) return false;
        if (!q) return true;
        return normalize(`${item.product?.nombre || ''} ${cat} ${item.station || ''}`).includes(q);
      });
    };

    function updateTotal() {
      let total = Number(dialog.querySelector('#deliveryFee')?.value || 0);
      for (const [id, quantity] of selectedRows()) total += Number(byId.get(id)?.product?.precio1 || 0) * quantity;
      totalRoot.textContent = money(total);
    }

    function renderCart() {
      const selected = selectedRows();
      const units = selected.reduce((sum, [, quantity]) => sum + quantity, 0);
      countRoot.textContent = `${units} producto${units === 1 ? '' : 's'}`;
      cartRoot.innerHTML = selected.length ? selected.map(([id, quantity]) => {
        const item = byId.get(id);
        return `<div class="delivery-v93-cart-line"><div><b>${esc(item?.product?.nombre || 'Producto')}</b><small>${money(item?.product?.precio1)} c/u</small></div><div class="delivery-v93-qty"><button type="button" data-v93-minus="${esc(id)}">−</button><strong>${quantity}</strong><button type="button" data-v93-plus="${esc(id)}">+</button></div></div>`;
      }).join('') : '<div class="delivery-v93-empty">Agrega productos desde la carta.</div>';
      submit.disabled = !selected.length;
      updateTotal();
    }

    function renderCategories() {
      categoriesRoot.innerHTML = categoryList().map((category) => `<button type="button" class="rv2-btn ${state.category === category ? 'rv2-btn-primary' : ''}" data-v93-category="${esc(category)}">${esc(category === 'TODAS' ? 'Todo' : category)}</button>`).join('');
    }

    function renderMenu() {
      const rows = filtered();
      const shown = rows.slice(0, state.limit);
      menuRoot.innerHTML = shown.map((item) => {
        const warning = item.warning ? `<small class="menu-warning">${esc(item.warning)}</small>` : '';
        return `<article class="menu-item"><b>${esc(item.product?.nombre || 'Producto')}</b><small>${esc(item.category || '')} · ${esc(item.station || '')}</small><strong>${money(item.product?.precio1)}</strong>${warning}<button type="button" class="rv2-btn rv2-btn-primary" data-v93-add="${esc(item.id)}" ${item.warning ? 'disabled' : ''}>+ Agregar</button></article>`;
      }).join('') || '<div class="delivery-v93-empty">No hay productos que coincidan.</div>';
      if (rows.length > shown.length) menuRoot.insertAdjacentHTML('beforeend', `<button type="button" class="delivery-v93-more" data-v93-more>VER ${Math.min(PAGE_SIZE, rows.length - shown.length)} MÁS</button>`);
    }

    function setQty(id, delta) {
      const item = byId.get(id);
      if (!item || item.warning) return;
      quantities.set(id, Math.max(0, Math.min(99, Number(quantities.get(id) || 0) + delta)));
      renderCart();
    }

    dialog.addEventListener('click', (event) => {
      const button = event.target?.closest?.('button');
      if (!button) return;
      if (button.matches('[data-v93-close]')) return dialog.close();
      if (button.dataset.v93Category) {
        state.category = button.dataset.v93Category; state.limit = PAGE_SIZE; renderCategories(); renderMenu(); return;
      }
      if (button.hasAttribute('data-v93-more')) { state.limit += PAGE_SIZE; renderMenu(); return; }
      if (button.dataset.v93Add) return setQty(button.dataset.v93Add, 1);
      if (button.dataset.v93Plus) return setQty(button.dataset.v93Plus, 1);
      if (button.dataset.v93Minus) return setQty(button.dataset.v93Minus, -1);
    });

    dialog.querySelector('#deliveryFee')?.addEventListener('input', updateTotal);
    dialog.querySelector('#deliveryV93Search')?.addEventListener('input', (event) => {
      state.search = event.target.value || ''; state.limit = PAGE_SIZE; renderMenu();
    });

    try {
      menu = (await api(MENU_PATH)).filter((row) => row?.product);
      byId = new Map(menu.map((row) => [row.id, row]));
      renderCategories();
      renderMenu();
      renderCart();
      dialog.querySelector('#deliveryV93Search').disabled = false;
    } catch (error) {
      menuRoot.innerHTML = `<div class="delivery-v93-error">${esc(error.message || 'No se pudo abrir la carta.')}</div>`;
      return;
    }

    submit.addEventListener('click', async () => {
      const items = selectedRows().map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
      const customerName = String(dialog.querySelector('#deliveryName')?.value || '').trim();
      const customerPhone = String(dialog.querySelector('#deliveryPhone')?.value || '').trim();
      const address = String(dialog.querySelector('#deliveryAddress')?.value || '').trim();
      errorRoot.innerHTML = '';
      if (!customerName || !customerPhone || !address || !items.length) {
        errorRoot.innerHTML = '<div class="delivery-v93-error">Completa nombre, teléfono, dirección y agrega al menos un producto.</div>';
        return;
      }
      submit.disabled = true;
      submit.textContent = 'CREANDO…';
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
        setTimeout(() => document.querySelector('.delivery-filterbar button.active')?.click(), 80);
      } catch (error) {
        errorRoot.innerHTML = `<div class="delivery-v93-error">${esc(error.message)}</div>`;
        submit.disabled = false;
        submit.textContent = 'CREAR DOMICILIO';
      }
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-new-delivery]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openNewDelivery();
  }, true);

  injectStyles();
  document.documentElement.dataset.deliveryOrdersCompactV93 = '1';
  window[MARKER] = Object.freeze({
    version:'93.0.0',
    sameProductsAsOrders:true,
    sameVisualContractAsOrders:true,
    menuSource:MENU_PATH,
    fullOrdersMenuEndpoint:false,
    pageSize:PAGE_SIZE,
    requiresTable:false
  });
})();
