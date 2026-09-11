/* VANTIX_RESTAURANT_DELIVERY_SHARED_MENU_V90 */
(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_DELIVERY_SHARED_MENU_V90';
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
      .delivery-v90-selection{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
      .delivery-v90-chip{padding:6px 9px;border-radius:999px;background:#ecfdf5;color:#065f46;font-size:11px;font-weight:850}
      .delivery-v90-empty{grid-column:1/-1;padding:18px;border:1px dashed #cbd5e1;border-radius:12px;text-align:center;color:var(--cc-muted,#61706a)}
      .delivery-v90-error{padding:10px 12px;border:1px solid #fecaca;border-radius:10px;background:#fff7f7;color:#991b1b;font-weight:800}
      .delivery-v90-toast{position:fixed;right:18px;bottom:18px;z-index:99999;max-width:420px;padding:12px 14px;border-radius:12px;background:#111c2b;color:#fff;font-weight:850;box-shadow:0 12px 30px rgba(15,23,42,.3)}
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
      // Fuente única de carta: exactamente el mismo endpoint consumido por Mesero.
      const rawMenu = await api(MENU_PATH);
      const menu = (Array.isArray(rawMenu) ? rawMenu : []).filter((row) => row?.product);
      const categories = categoriesFor(menu);
      const quantities = new Map();
      const byId = new Map(menu.map((row) => [row.id, row]));
      const state = {
        category: categories[0] || null,
        search:'',
        limit:MENU_PAGE
      };

      dialog.innerHTML = `<div class="delivery-dialog-head"><div><div class="ri-eyebrow">NUEVO DOMICILIO · CARTA COMPARTIDA</div><h2>¿Qué necesita el cliente?</h2><p class="ri-muted">La misma carta que usa Mesero, sin abrir una mesa.</p></div><button type="button" class="ri-btn" data-v90-close>Cerrar</button></div><div class="delivery-dialog-body">
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">1</span><b>¿A quién se lo llevamos?</b></div><div class="delivery-fields"><label class="delivery-field">Teléfono<input id="deliveryPhone" inputmode="tel" autocomplete="tel" placeholder="300 123 4567"></label><label class="delivery-field">Nombre<input id="deliveryName" autocomplete="name" placeholder="Nombre del cliente"></label></div><div id="deliveryKnown"></div></section>
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">2</span><b>¿Dónde lo entregamos?</b></div><div class="delivery-fields"><label class="delivery-field full">Dirección<input id="deliveryAddress" autocomplete="street-address" placeholder="Ej. Cra 20 #14-22"></label><label class="delivery-field">Barrio / zona<input id="deliveryNeighborhood" placeholder="Ej. Centro"></label><label class="delivery-field">Referencia<input id="deliveryReference" placeholder="Ej. Casa verde, segundo piso"></label></div></section>
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">3</span><b>Carta del restaurante</b></div>
          <div class="delivery-v90-menu-tools"><div id="deliveryV90Tabs" class="delivery-v90-tabs"></div><div class="delivery-v90-search"><input id="deliveryV90Search" placeholder="Buscar producto…"><span id="deliveryV90Meta" class="delivery-v90-meta"></span></div></div>
          <div id="deliveryV90Products" class="delivery-products"></div><div id="deliveryV90Selection" class="delivery-v90-selection"></div>
        </section>
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">4</span><b>Entrega</b></div><div class="delivery-fields"><label class="delivery-field">Valor domicilio<input id="deliveryFee" inputmode="numeric" type="number" min="0" step="500" value="5000"></label><label class="delivery-field">Tiempo prometido<select id="deliveryMinutes"><option value="30">30 minutos</option><option value="45" selected>45 minutos</option><option value="60">60 minutos</option><option value="90">90 minutos</option></select></label><label class="delivery-field full">Nota para cocina o entrega<textarea id="deliveryNotes" rows="2" placeholder="Ej. Sin cebolla / tocar el timbre"></textarea></label></div></section>
        <section class="delivery-step"><div class="delivery-step-title"><span class="delivery-step-number">5</span><b>Revisar y crear</b></div><p class="ri-muted">El domicilio queda como NUEVO. Al aceptarlo se envía a Cocina / Barra con sus estaciones normales.</p><div id="deliveryCreateError"></div></section>
      </div><div class="delivery-confirm"><div><small>Total estimado</small><strong id="deliveryCreateTotal">${money(5000)}</strong></div><button type="button" id="deliveryCreateSubmit">CREAR DOMICILIO</button></div>`;

      const tabsRoot = dialog.querySelector('#deliveryV90Tabs');
      const productsRoot = dialog.querySelector('#deliveryV90Products');
      const metaRoot = dialog.querySelector('#deliveryV90Meta');
      const selectionRoot = dialog.querySelector('#deliveryV90Selection');
      const errorRoot = dialog.querySelector('#deliveryCreateError');

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

      function renderSelection() {
        const selected = [...quantities.entries()].filter(([, quantity]) => quantity > 0);
        selectionRoot.innerHTML = selected.length
          ? selected.map(([id, quantity]) => `<span class="delivery-v90-chip">${quantity}× ${esc(byId.get(id)?.product?.nombre || 'Producto')}</span>`).join('')
          : '<span class="ri-muted">Aún no has agregado productos.</span>';
      }

      function updateTotal() {
        let total = Number(dialog.querySelector('#deliveryFee')?.value || 0);
        for (const [id, quantity] of quantities) total += Number(byId.get(id)?.product?.precio1 || 0) * quantity;
        dialog.querySelector('#deliveryCreateTotal').textContent = money(total);
        renderSelection();
      }

      function renderProducts() {
        const rows = visibleRows();
        const shown = rows.slice(0, state.limit);
        metaRoot.textContent = `${rows.length} producto${rows.length === 1 ? '' : 's'} · mostrando ${Math.min(shown.length, rows.length)}`;
        productsRoot.innerHTML = shown.length ? shown.map((row) => {
          const quantity = Number(quantities.get(row.id) || 0);
          const warning = row.warning ? `<small class="delivery-v90-product-warning">${esc(row.warning)}</small>` : '';
          const controls = row.warning ? '' : `<div class="delivery-qty"><button type="button" data-v90-minus="${esc(row.id)}">−</button><span data-v90-qty="${esc(row.id)}">${quantity}</span><button type="button" data-v90-plus="${esc(row.id)}">+</button></div>`;
          return `<article class="delivery-product" data-v90-menu-id="${esc(row.id)}"><div><b>${esc(row.product.nombre)}</b><small>${esc(row.station || '')} · ${money(row.product.precio1)}</small>${warning}</div>${controls}</article>`;
        }).join('') : '<div class="delivery-v90-empty">No hay productos para este filtro.</div>';
        if (rows.length > shown.length) productsRoot.insertAdjacentHTML('beforeend', `<button type="button" class="delivery-v90-more" data-v90-more>VER ${Math.min(MENU_PAGE, rows.length - shown.length)} MÁS</button>`);
      }

      function setQty(id, delta) {
        const row = byId.get(id);
        if (!row || row.warning) return;
        const value = Math.max(0, Math.min(99, Number(quantities.get(id) || 0) + delta));
        quantities.set(id, value);
        const node = dialog.querySelector(`[data-v90-qty="${CSS.escape(id)}"]`);
        if (node) node.textContent = String(value);
        updateTotal();
      }

      renderTabs();
      renderProducts();
      renderSelection();

      dialog.querySelector('#deliveryV90Search')?.addEventListener('input', (event) => {
        state.search = event.target.value || '';
        state.limit = MENU_PAGE;
        renderProducts();
      });
      dialog.querySelector('#deliveryFee')?.addEventListener('input', updateTotal);

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
        if (target.dataset.v90Plus) return setQty(target.dataset.v90Plus, 1);
        if (target.dataset.v90Minus) return setQty(target.dataset.v90Minus, -1);
      });

      dialog.querySelector('#deliveryCreateSubmit')?.addEventListener('click', async () => {
        const button = dialog.querySelector('#deliveryCreateSubmit');
        const items = [...quantities.entries()].filter(([, quantity]) => quantity > 0).map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
        const customerName = String(dialog.querySelector('#deliveryName')?.value || '').trim();
        const customerPhone = String(dialog.querySelector('#deliveryPhone')?.value || '').trim();
        const address = String(dialog.querySelector('#deliveryAddress')?.value || '').trim();
        errorRoot.innerHTML = '';
        if (!customerName || !customerPhone || !address || !items.length) {
          errorRoot.innerHTML = '<div class="delivery-v90-error">Completa nombre, teléfono, dirección y agrega al menos un producto.</div>';
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
          errorRoot.innerHTML = `<div class="delivery-v90-error">${esc(error.message)}</div>`;
          button.disabled = false;
          button.textContent = 'CREAR DOMICILIO';
        }
      });
    } catch (error) {
      renderLoadError(dialog, error);
    }
  }

  // Captura antes del listener histórico de Domicilios para no ejecutar su render masivo.
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
    version:'90.0.0',
    menuSource:MENU_PATH,
    sameMenuAsWaiter:true,
    requiresTable:false,
    pageSize:MENU_PAGE,
    renderAllAtOnce:false
  });
})();
