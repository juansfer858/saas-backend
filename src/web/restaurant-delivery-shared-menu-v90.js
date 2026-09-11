/* VANTIX_RESTAURANT_DELIVERY_SHARED_MENU_V90 · VANTIX_RESTAURANT_DELIVERY_LINE_PRICE_V94 */
(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_DELIVERY_SHARED_MENU_V90';
  const PRICE_MARKER = 'VANTIX_RESTAURANT_DELIVERY_LINE_PRICE_V94';
  if (window[MARKER]) return;

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const MENU_PATH = '/api/v1/restaurante/menu';
  const DELIVERY_PATH = '/api/v1/restaurante/domicilios';
  const MENU_PAGE = 40;
  const PREFERRED_CATEGORIES = ['ENTRADAS', 'FUERTES', 'BEBIDAS', 'POSTRES'];

  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[m]));
  const money = (value) => new Intl.NumberFormat('es-CO', {
    style:'currency',
    currency:session.tenant?.moneda || 'COP',
    maximumFractionDigits:0
  }).format(Number(value || 0));
  const amount = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0;
  };

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
    if (document.querySelector('#restaurantDeliverySharedMenuV90Style')) return;
    const style = document.createElement('style');
    style.id = 'restaurantDeliverySharedMenuV90Style';
    style.textContent = `
      .delivery-v90-menu-tools{display:grid;gap:10px;margin-bottom:12px}
      .delivery-v90-tabs{display:flex;gap:7px;flex-wrap:wrap}
      .delivery-v90-tabs button{min-height:40px;padding:7px 11px;border:1px solid var(--cc-line,#dce6e0);border-radius:999px;background:#fff;color:var(--cc-ink,#18221d);font-weight:900;cursor:pointer}
      .delivery-v90-tabs button.active{background:#111c2b;color:#fff;border-color:#111c2b}
      .delivery-v90-search{display:grid;grid-template-columns:1fr auto;gap:9px;align-items:center}
      .delivery-v90-search input{width:100%;min-height:46px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:11px;background:#fff;font:inherit;font-size:15px}
      .delivery-v90-meta{font-size:12px;font-weight:850;color:var(--cc-muted,#61706a);white-space:nowrap}
      .delivery-v90-product-warning{display:block;margin-top:4px;color:#b45309!important;font-weight:850}
      .delivery-v90-more{grid-column:1/-1;min-height:44px;border:1px dashed #94a3b8;border-radius:11px;background:#fff;font-weight:900;cursor:pointer}
      .delivery-v94-selected{display:grid;gap:9px;margin-top:13px}
      .delivery-v94-empty{padding:12px;border:1px dashed #cbd5e1;border-radius:11px;color:var(--cc-muted,#61706a);text-align:center}
      .delivery-v94-line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:11px;padding:12px;border:1px solid #dbe5df;border-radius:13px;background:#fff}
      .delivery-v94-line-main{display:grid;gap:8px}.delivery-v94-line-title{display:flex;justify-content:space-between;gap:10px;align-items:start}.delivery-v94-line-title b{font-size:14px}.delivery-v94-base{display:block;margin-top:3px;color:var(--cc-muted,#61706a);font-size:10px;font-weight:800}
      .delivery-v94-fields{display:grid;grid-template-columns:minmax(130px,.65fr) minmax(180px,1.35fr);gap:8px}.delivery-v94-field{display:grid;gap:4px;color:#475569;font-size:10px;font-weight:900;text-transform:uppercase}.delivery-v94-field input{width:100%;min-height:42px;padding:8px 9px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font:inherit;font-size:14px;text-transform:none}.delivery-v94-price-wrap{position:relative}.delivery-v94-price-wrap span{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-weight:900;color:#64748b}.delivery-v94-price-wrap input{padding-left:24px}
      .delivery-v94-actions{display:flex;gap:6px;align-items:center}.delivery-v94-actions button{min-width:39px;min-height:39px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-weight:950;cursor:pointer}.delivery-v94-actions strong{min-width:25px;text-align:center}.delivery-v94-duplicate{min-width:auto!important;padding:0 9px!important;font-size:11px}.delivery-v94-remove{color:#991b1b}.delivery-v94-subtotal{font-size:15px;font-weight:950;white-space:nowrap;text-align:right}
      .delivery-v90-error{padding:10px 12px;border:1px solid #fecaca;border-radius:10px;background:#fff7f7;color:#991b1b;font-weight:800}
      .delivery-v90-toast{position:fixed;right:18px;bottom:18px;z-index:99999;max-width:420px;padding:12px 14px;border-radius:12px;background:#111c2b;color:#fff;font-weight:850;box-shadow:0 12px 30px rgba(15,23,42,.3)}
      @media(max-width:720px){.delivery-v94-line{grid-template-columns:1fr}.delivery-v94-line-title{display:grid}.delivery-v94-subtotal{text-align:left}.delivery-v94-fields{grid-template-columns:1fr}}
      @media(max-width:620px){.delivery-v90-search{grid-template-columns:1fr}.delivery-v90-meta{white-space:normal}}
    `;
    document.head.appendChild(style);
  }

  function flash(text) {
    document.querySelector('.delivery-v90-toast')?.remove();
    const node = document.createElement('div');
    node.className = 'delivery-v90-toast';
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

  function categoriesFor(menu) {
    const unique = [...new Set(menu.map((row) => String(row.category || 'OTROS').trim().toUpperCase()).filter(Boolean))];
    return [
      ...PREFERRED_CATEGORIES.filter((category) => unique.includes(category)),
      ...unique.filter((category) => !PREFERRED_CATEGORIES.includes(category)).sort((a, b) => a.localeCompare(b, 'es'))
    ];
  }

  function renderLoadError(dialog, error) {
    dialog.innerHTML = `<div class="delivery-dialog-head"><div><div class="ri-eyebrow">NUEVO DOMICILIO</div><h2>No se pudo cargar la carta</h2></div><button type="button" class="ri-btn" data-v90-close>Cerrar</button></div><div class="delivery-dialog-body"><div class="delivery-v90-error">${esc(error?.message || 'Reintenta en unos segundos.')}</div><button type="button" class="ri-btn primary" data-v90-retry>REINTENTAR</button></div>`;
  }

  async function openSharedDeliveryDialog() {
    injectStyles();
    const dialog = freshDialog();
    dialog.innerHTML = '<div class="delivery-dialog-body"><div class="ri-muted">Cargando la misma carta de Mesero…</div></div>';
    dialog.showModal?.();

    try {
      const rawMenu = await api(MENU_PATH);
      const menu = (Array.isArray(rawMenu) ? rawMenu : []).filter((row) => row?.product);
      const categories = categoriesFor(menu);
      const byId = new Map(menu.map((row) => [row.id, row]));
      const lines = [];
      let lineSequence = 0;
      const state = { category: categories[0] || null, search:'', limit:MENU_PAGE };

      dialog.innerHTML = `<div class="delivery-dialog-head"><div><div class="ri-eyebrow">NUEVO DOMICILIO · CARTA COMPARTIDA</div><h2>¿Qué necesita el cliente?</h2><p class="ri-muted">Cada línea puede llevar su precio y su instrucción sin cambiar la Carta.</p></div><button type="button" class="ri-btn" data-v90-close>Cerrar</button></div><div class="delivery-dialog-body">
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">1</span><b>¿A quién se lo llevamos?</b></div><div class="delivery-fields"><label class="delivery-field">Teléfono<input id="deliveryPhone" inputmode="tel" autocomplete="tel" placeholder="300 123 4567"></label><label class="delivery-field">Nombre<input id="deliveryName" autocomplete="name" placeholder="Nombre del cliente"></label></div><div id="deliveryKnown"></div></section>
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">2</span><b>¿Dónde lo entregamos?</b></div><div class="delivery-fields"><label class="delivery-field full">Dirección<input id="deliveryAddress" autocomplete="street-address" placeholder="Ej. Cra 20 #14-22"></label><label class="delivery-field">Barrio / zona<input id="deliveryNeighborhood" placeholder="Ej. Centro"></label><label class="delivery-field">Referencia<input id="deliveryReference" placeholder="Ej. Casa verde, segundo piso"></label></div></section>
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">3</span><b>Carta del restaurante</b></div>
          <div class="delivery-v90-menu-tools"><div id="deliveryV90Tabs" class="delivery-v90-tabs"></div><div class="delivery-v90-search"><input id="deliveryV90Search" placeholder="Buscar producto…"><span id="deliveryV90Meta" class="delivery-v90-meta"></span></div></div>
          <div id="deliveryV90Products" class="delivery-products"></div>
          <div style="margin-top:15px"><b>Productos agregados</b><small class="ri-muted" style="display:block;margin-top:3px">Aquí puedes cambiar cantidad, precio unitario y nota de cada línea.</small></div><div id="deliveryV94Selected" class="delivery-v94-selected"></div>
        </section>
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">4</span><b>Entrega</b></div><div class="delivery-fields"><label class="delivery-field">Cargo de domicilio (opcional)<input id="deliveryFee" inputmode="numeric" type="number" min="0" step="500" value="0"></label><label class="delivery-field">Tiempo prometido<select id="deliveryMinutes"><option value="30">30 minutos</option><option value="45" selected>45 minutos</option><option value="60">60 minutos</option><option value="90">90 minutos</option></select></label><label class="delivery-field full">Nota general de entrega<textarea id="deliveryNotes" rows="2" placeholder="Ej. Tocar el timbre / llamar al llegar"></textarea></label></div></section>
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">5</span><b>Revisar y crear</b></div><p class="ri-muted">El domicilio queda como NUEVO. Al aceptarlo se envía a Cocina / Barra conservando precios e instrucciones de cada línea.</p><div id="deliveryCreateError"></div></section>
      </div><div class="delivery-confirm"><div><small>Total estimado</small><strong id="deliveryCreateTotal">${money(0)}</strong></div><button type="button" id="deliveryCreateSubmit">CREAR DOMICILIO</button></div>`;

      const tabsRoot = dialog.querySelector('#deliveryV90Tabs');
      const productsRoot = dialog.querySelector('#deliveryV90Products');
      const metaRoot = dialog.querySelector('#deliveryV90Meta');
      const selectedRoot = dialog.querySelector('#deliveryV94Selected');
      const errorRoot = dialog.querySelector('#deliveryCreateError');

      const basePrice = (menuItemId) => amount(byId.get(menuItemId)?.product?.precio1 || 0);
      const lineSubtotal = (line) => amount(line.quantity) * amount(line.appliedUnitPrice);
      const menuQuantity = (menuItemId) => lines.filter((line) => line.menuItemId === menuItemId).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
      const newLine = (menuItemId, copy = null) => ({
        id:`v94-${++lineSequence}`,
        menuItemId,
        quantity:Math.max(1, Number(copy?.quantity || 1)),
        appliedUnitPrice:amount(copy?.appliedUnitPrice ?? basePrice(menuItemId)),
        notes:String(copy?.notes || '')
      });

      function visibleRows() {
        const needle = state.search.trim().toLocaleLowerCase('es');
        return menu.filter((row) => {
          const category = String(row.category || 'OTROS').trim().toUpperCase();
          const matchesCategory = !state.category || category === state.category;
          const matchesSearch = !needle || String(row.product?.nombre || '').toLocaleLowerCase('es').includes(needle);
          return matchesCategory && matchesSearch;
        });
      }

      function renderTabs() {
        tabsRoot.innerHTML = categories.map((category) => `<button type="button" class="${category === state.category ? 'active' : ''}" data-v90-category="${esc(category)}">${esc(category)}</button>`).join('');
      }

      function updateTotal() {
        const fee = Math.max(0, amount(dialog.querySelector('#deliveryFee')?.value || 0));
        const total = lines.reduce((sum, line) => sum + lineSubtotal(line), fee);
        dialog.querySelector('#deliveryCreateTotal').textContent = money(total);
      }

      function renderSelected() {
        if (!lines.length) {
          selectedRoot.innerHTML = '<div class="delivery-v94-empty">Aún no has agregado productos.</div>';
          updateTotal();
          return;
        }
        selectedRoot.innerHTML = lines.map((line) => {
          const row = byId.get(line.menuItemId);
          const base = basePrice(line.menuItemId);
          return `<article class="delivery-v94-line" data-v94-line="${esc(line.id)}">
            <div class="delivery-v94-line-main"><div class="delivery-v94-line-title"><div><b>${esc(row?.product?.nombre || 'Producto')}</b><small class="delivery-v94-base">Precio Carta: ${money(base)}${amount(line.appliedUnitPrice)!==base?' · PRECIO MODIFICADO':''}</small></div><div class="delivery-v94-actions"><button type="button" data-v94-minus="${esc(line.id)}">−</button><strong>${Number(line.quantity||0)}</strong><button type="button" data-v94-plus="${esc(line.id)}">+</button><button type="button" class="delivery-v94-duplicate" data-v94-duplicate="${esc(line.id)}">+ Otra línea</button><button type="button" class="delivery-v94-remove" data-v94-remove="${esc(line.id)}">×</button></div></div>
            <div class="delivery-v94-fields"><label class="delivery-v94-field">Precio unitario<div class="delivery-v94-price-wrap"><span>$</span><input type="number" min="0" step="100" inputmode="decimal" data-v94-price="${esc(line.id)}" value="${amount(line.appliedUnitPrice)}"></div></label><label class="delivery-v94-field">Nota / instrucción<input maxlength="240" data-v94-note="${esc(line.id)}" value="${esc(line.notes)}" placeholder="Ej. SIN CEBOLLA / CON HIELO"></label></div></div>
            <div class="delivery-v94-subtotal">${money(lineSubtotal(line))}</div>
          </article>`;
        }).join('');
        updateTotal();
      }

      function renderProducts() {
        const rows = visibleRows();
        const shown = rows.slice(0, state.limit);
        metaRoot.textContent = `${rows.length} producto${rows.length === 1 ? '' : 's'} · mostrando ${Math.min(shown.length, rows.length)}`;
        productsRoot.innerHTML = shown.length ? shown.map((row) => {
          const quantity = menuQuantity(row.id);
          const warning = row.warning ? `<small class="delivery-v90-product-warning">${esc(row.warning)}</small>` : '';
          const controls = row.warning ? '' : `<div class="delivery-qty"><button type="button" data-v90-minus="${esc(row.id)}">−</button><span>${quantity}</span><button type="button" data-v90-plus="${esc(row.id)}">+</button></div>`;
          return `<article class="delivery-product"><div><b>${esc(row.product.nombre)}</b><small>${esc(row.station || '')} · ${money(row.product.precio1)}</small>${warning}</div>${controls}</article>`;
        }).join('') : '<div class="delivery-v94-empty">No hay productos para este filtro.</div>';
        if (rows.length > shown.length) productsRoot.insertAdjacentHTML('beforeend', `<button type="button" class="delivery-v90-more" data-v90-more>VER ${Math.min(MENU_PAGE, rows.length - shown.length)} MÁS</button>`);
      }

      function findLine(id) { return lines.find((line) => line.id === id) || null; }
      function removeLine(id) { const index = lines.findIndex((line) => line.id === id); if (index >= 0) lines.splice(index, 1); }
      function changeMenuQuantity(menuItemId, delta) {
        const row = byId.get(menuItemId);
        if (!row || row.warning) return;
        if (delta > 0) {
          const base = basePrice(menuItemId);
          const defaultLine = lines.find((line) => line.menuItemId === menuItemId && !String(line.notes || '').trim() && amount(line.appliedUnitPrice) === base);
          if (defaultLine) defaultLine.quantity = Math.min(99, Number(defaultLine.quantity || 0) + 1);
          else lines.push(newLine(menuItemId));
        } else {
          const candidates = lines.filter((line) => line.menuItemId === menuItemId);
          const target = candidates[candidates.length - 1];
          if (target) {
            target.quantity = Number(target.quantity || 0) - 1;
            if (target.quantity <= 0) removeLine(target.id);
          }
        }
        renderProducts();
        renderSelected();
      }

      renderTabs();
      renderProducts();
      renderSelected();

      dialog.querySelector('#deliveryV90Search')?.addEventListener('input', (event) => {
        state.search = event.target.value || '';
        state.limit = MENU_PAGE;
        renderProducts();
      });
      dialog.querySelector('#deliveryFee')?.addEventListener('input', updateTotal);

      dialog.addEventListener('input', (event) => {
        const priceId = event.target?.dataset?.v94Price;
        if (priceId) {
          const line = findLine(priceId);
          if (!line) return;
          const raw = Number(event.target.value);
          if (!Number.isFinite(raw) || raw < 0) return;
          line.appliedUnitPrice = amount(raw);
          const subtotal = event.target.closest('.delivery-v94-line')?.querySelector('.delivery-v94-subtotal');
          if (subtotal) subtotal.textContent = money(lineSubtotal(line));
          updateTotal();
          return;
        }
        const noteId = event.target?.dataset?.v94Note;
        if (noteId) {
          const line = findLine(noteId);
          if (line) line.notes = String(event.target.value || '').slice(0, 240);
        }
      });

      dialog.addEventListener('click', (event) => {
        const target = event.target.closest('button');
        if (!target) return;
        if (target.matches('[data-v90-close]')) return dialog.close();
        if (target.dataset.v90Category) {
          state.category = target.dataset.v90Category;
          state.limit = MENU_PAGE;
          renderTabs();
          renderProducts();
          return;
        }
        if (target.hasAttribute('data-v90-more')) {
          state.limit += MENU_PAGE;
          renderProducts();
          return;
        }
        if (target.dataset.v90Plus) return changeMenuQuantity(target.dataset.v90Plus, 1);
        if (target.dataset.v90Minus) return changeMenuQuantity(target.dataset.v90Minus, -1);
        if (target.dataset.v94Plus) {
          const line = findLine(target.dataset.v94Plus); if (line) line.quantity = Math.min(99, Number(line.quantity || 0) + 1); renderProducts(); renderSelected(); return;
        }
        if (target.dataset.v94Minus) {
          const line = findLine(target.dataset.v94Minus); if (line) { line.quantity -= 1; if (line.quantity <= 0) removeLine(line.id); } renderProducts(); renderSelected(); return;
        }
        if (target.dataset.v94Duplicate) {
          const line = findLine(target.dataset.v94Duplicate); if (line) lines.push(newLine(line.menuItemId, { appliedUnitPrice:line.appliedUnitPrice, notes:'', quantity:1 })); renderProducts(); renderSelected(); return;
        }
        if (target.dataset.v94Remove) { removeLine(target.dataset.v94Remove); renderProducts(); renderSelected(); }
      });

      dialog.querySelector('#deliveryCreateSubmit')?.addEventListener('click', async () => {
        const button = dialog.querySelector('#deliveryCreateSubmit');
        const items = lines.filter((line) => Number(line.quantity) > 0).map((line) => ({
          menuItemId:line.menuItemId,
          quantity:Number(line.quantity),
          notes:String(line.notes || '').trim() || null,
          appliedUnitPrice:amount(line.appliedUnitPrice)
        }));
        const customerName = String(dialog.querySelector('#deliveryName')?.value || '').trim();
        const customerPhone = String(dialog.querySelector('#deliveryPhone')?.value || '').trim();
        const address = String(dialog.querySelector('#deliveryAddress')?.value || '').trim();
        errorRoot.innerHTML = '';
        if (!customerName || !customerPhone || !address || !items.length) {
          errorRoot.innerHTML = '<div class="delivery-v90-error">Completa nombre, teléfono, dirección y agrega al menos un producto.</div>';
          return;
        }
        if (items.some((item) => !Number.isFinite(item.appliedUnitPrice) || item.appliedUnitPrice < 0)) {
          errorRoot.innerHTML = '<div class="delivery-v90-error">Revisa los precios. No se permiten valores negativos.</div>';
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
              deliveryFee:Math.max(0, amount(dialog.querySelector('#deliveryFee')?.value || 0)),
              promisedAt:new Date(Date.now() + minutes * 60000).toISOString(),
              channel:'MANUAL',
              items
            })
          });
          dialog.close();
          flash('Domicilio creado. Precios e instrucciones quedaron guardados en el pedido.');
          setTimeout(() => document.querySelector('.delivery-filterbar button.active')?.click(), 120);
        } catch (error) {
          errorRoot.innerHTML = `<div class="delivery-v90-error">${esc(error.message)}</div>`;
          button.disabled = false;
          button.textContent = 'CREAR DOMICILIO';
        }
      });
    } catch (error) {
      renderLoadError(dialog, error);
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-new-delivery]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openSharedDeliveryDialog();
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-v90-retry]')) {
      event.preventDefault();
      openSharedDeliveryDialog();
    }
    if (event.target?.closest?.('[data-v90-close]')) document.querySelector('#deliveryCreateDialog')?.close?.();
  }, true);

  injectStyles();
  document.documentElement.dataset.deliverySharedMenuV90 = '1';
  window[MARKER] = Object.freeze({
    version:'94.0.0',
    menuSource:MENU_PATH,
    sameMenuAsWaiter:true,
    requiresTable:false,
    linePriceOverride:true,
    lineNotes:true,
    basePriceUntouched:true,
    pageSize:MENU_PAGE,
    renderAllAtOnce:false
  });
  window[PRICE_MARKER] = window[MARKER];
})();
