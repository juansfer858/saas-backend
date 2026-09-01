(() => {
  const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => [...document.querySelectorAll(q)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (v) => new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(Number(v || 0));
  const FILTERS = [
    { id:'FEATURED', label:'★ MÁS PEDIDOS' },
    { id:'ENTRADAS', label:'ENTRADAS' },
    { id:'FUERTES', label:'FUERTES' },
    { id:'BEBIDAS', label:'BEBIDAS' },
    { id:'POSTRES', label:'POSTRES' }
  ];
  const CLIENT_REVIEW_MODE = 'SYSTEM_ONLY_NO_WHATSAPP_V5';
  const S = { ctx:null, cart:new Map(), filter:'FEATURED', sending:false };

  async function req(path, opts = {}) {
    const response = await fetch(path, {
      ...opts,
      cache:'no-store',
      headers:{ 'Content-Type':'application/json', ...(opts.headers || {}) }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || 'No fue posible continuar');
    return body.data;
  }

  function lineTotal(menuItem, quantity) {
    const price = Number(menuItem.product?.price || 0);
    const iva = Number(menuItem.product?.ivaPct || 0);
    const impoconsumo = Number(menuItem.product?.impoconsumoPct || 0);
    const base = price * quantity;
    return Math.round((base + base * iva / 100 + base * impoconsumo / 100) * 100) / 100;
  }

  function cartCount() {
    return [...S.cart.values()].reduce((sum, qty) => sum + Number(qty || 0), 0);
  }

  function total() {
    let value = 0;
    for (const [id, quantity] of S.cart.entries()) {
      const item = S.ctx?.menu?.find((x) => x.id === id);
      if (item) value += lineTotal(item, quantity);
    }
    return Math.round(value * 100) / 100;
  }

  function products() {
    return (S.ctx?.menu || []).filter((item) => item.product);
  }

  function clientSpotlight() {
    const config = S.ctx?.theme?.clientSpotlight;
    if (!config?.active || !config.menuItemId) return null;
    const item = products().find((row) => row.id === config.menuItemId && row.available);
    return item ? { config, item } : null;
  }

  function visibleProducts() {
    const rows = products();
    if (S.filter === 'FEATURED') {
      const available = rows.filter((item) => item.available);
      const spotlightId = clientSpotlight()?.item?.id;
      const withoutSpotlight = (available.length ? available : rows).filter((item) => item.id !== spotlightId);
      return withoutSpotlight.slice(0, 6);
    }
    return rows.filter((item) => item.category === S.filter);
  }

  function titleForFilter() {
    if (S.filter === 'FEATURED') return { title:'Más pedidos', subtitle:'Una selección rápida de la carta.' };
    const filter = FILTERS.find((row) => row.id === S.filter);
    return { title:filter?.label || 'Menú', subtitle:'Toca + para agregar. No necesitas abrir otra pantalla.' };
  }

  function renderAccount() {
    const strip = $('#accountStrip');
    if (!strip || !S.ctx) return;
    if (S.ctx.open) {
      strip.innerHTML = `<b>Mesa activa · pedido directo a producción</b><span>Cuenta actual ${money(S.ctx.currentTotal)}</span>`;
    } else {
      strip.innerHTML = '<b>Mesa pendiente de apertura</b><span>CERRADA</span>';
    }
  }

  function renderNav() {
    const wrap = $('#categoryWrap');
    const nav = $('#categoryNav');
    if (!wrap || !nav || !S.ctx?.open) return;
    wrap.hidden = false;
    nav.innerHTML = FILTERS.map((filter) => `<button class="qrv3-filter" type="button" data-filter="${filter.id}" aria-selected="${filter.id === S.filter ? 'true' : 'false'}">${filter.label}</button>`).join('');
    $$('[data-filter]').forEach((button) => button.addEventListener('click', () => {
      S.filter = button.dataset.filter;
      renderNav();
      renderProducts();
      window.scrollTo({ top:0, behavior:'smooth' });
    }));
  }

  function stepperMarkup(item, qty) {
    if (!item.available) return '<div class="qrv3-unavailable">No disponible</div>';
    return `<div class="qrv3-stepper" aria-label="Cantidad de ${esc(item.product.name)}">
      <button type="button" data-minus="${item.id}" ${qty <= 0 ? 'disabled' : ''} aria-label="Quitar una unidad">−</button>
      <span aria-live="polite">${qty}</span>
      <button type="button" data-plus="${item.id}" aria-label="Agregar una unidad">+</button>
    </div>`;
  }

  function productCard(item, index) {
    const qty = S.cart.get(item.id) || 0;
    const price = money(lineTotal(item, 1));
    const featured = S.filter === 'FEATURED' && index < 2;
    return `<article class="qrv3-menu-row" data-product-id="${item.id}">
      <div class="qrv3-menu-copy">
        ${featured ? '<span class="qrv3-badge">Destacado</span>' : ''}
        <h3 class="qrv3-product-name">${esc(item.product.name)}</h3>
      </div>
      <strong class="qrv3-price">${price}</strong>
      <div class="qrv3-menu-actions">${stepperMarkup(item, qty)}</div>
    </article>`;
  }

  function spotlightMarkup() {
    const spotlight = clientSpotlight();
    if (!spotlight) return '';
    const { config, item } = spotlight;
    const qty = Number(S.cart.get(item.id) || 0);
    const label = config.label || (config.kind === 'PROMO_DIA' ? 'Promo del día' : 'Plato del día');
    return `<section data-client-spotlight="true" class="qrv3-menu-row qrv3-menu-row-spotlight">
      <div class="qrv3-menu-copy">
        <span class="qrv3-badge">${esc(label)}</span>
        <h2 class="qrv3-product-name">${esc(item.product.name)}</h2>
        ${config.description ? `<p class="qrv3-product-meta">${esc(config.description)}</p>` : ''}
      </div>
      <strong class="qrv3-price">${money(lineTotal(item, 1))}</strong>
      <div class="qrv3-menu-actions"><button type="button" class="qrv3-review" data-spotlight-add="${item.id}">${qty ? `AGREGAR OTRO · ${qty}` : 'AGREGAR AL PEDIDO'}</button></div>
    </section>`;
  }

  function renderProducts() {
    const app = $('#app');
    if (!app || !S.ctx) return;
    if (!S.ctx.open) {
      app.innerHTML = `<section class="qrv3-closed">
        <div class="qrv3-closed-icon" aria-hidden="true">🪑</div>
        <h2>${esc(S.ctx.table.name)}</h2>
        <p>Esta mesa todavía no está abierta. Pídele al mesero que la abra y luego vuelve a intentar. No necesitas cambiar de QR.</p>
      </section>`;
      return;
    }
    const rows = visibleProducts();
    const heading = titleForFilter();
    app.innerHTML = `${spotlightMarkup()}<div class="qrv3-intro"><div><h2>${esc(heading.title)}</h2><p>${esc(heading.subtitle)}</p></div><strong>${rows.length} producto${rows.length === 1 ? '' : 's'}</strong></div>
      ${rows.length ? `<div class="qrv3-menu-list">${rows.map(productCard).join('')}</div>` : '<div class="qrv3-empty"><strong>Aún no hay productos aquí.</strong><span>Prueba otra categoría.</span></div>'}`;
    bindProductButtons();
    $('[data-spotlight-add]')?.addEventListener('click', (event) => setQuantity(event.currentTarget.dataset.spotlightAdd, 1));
  }

  function setQuantity(id, delta) {
    const current = Number(S.cart.get(id) || 0);
    const next = Math.max(0, Math.min(99, current + delta));
    if (next > 0) S.cart.set(id, next);
    else S.cart.delete(id);
    renderProducts();
    renderCartBar();
    if (!$('#orderPanel')?.hidden) renderOrderPanel();
  }

  function bindProductButtons() {
    $$('[data-plus]').forEach((button) => button.addEventListener('click', () => setQuantity(button.dataset.plus, 1)));
    $$('[data-minus]').forEach((button) => button.addEventListener('click', () => setQuantity(button.dataset.minus, -1)));
  }

  function renderCartBar() {
    const bar = $('#cartBar');
    if (!bar || !S.ctx?.open) {
      if (bar) bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const count = cartCount();
    $('#cartCount').textContent = count;
    $('#cartTotal').textContent = money(total());
    $('#cartLabel').textContent = count ? `${count} producto${count === 1 ? '' : 's'} en tu pedido` : 'Tu pedido está vacío';
    const review = $('#reviewButton');
    review.disabled = count === 0;
    review.textContent = count ? 'VER PEDIDO' : 'ELIGE UN PRODUCTO';
  }

  function renderOrderPanel() {
    const body = $('#orderPanelBody');
    if (!body) return;
    const lines = [...S.cart.entries()].map(([id, quantity]) => {
      const item = products().find((row) => row.id === id);
      if (!item) return '';
      return `<div class="qrv3-orderline">
        <div><b>${esc(item.product.name)}</b><small>${money(lineTotal(item, quantity))}</small></div>
        <div class="qrv3-order-controls">
          <button type="button" data-order-minus="${id}" aria-label="Quitar una unidad">−</button>
          <span>${quantity}</span>
          <button type="button" data-order-plus="${id}" aria-label="Agregar una unidad">+</button>
        </div>
      </div>`;
    }).join('');
    body.innerHTML = `${lines || '<div class="qrv3-empty"><strong>Tu pedido está vacío.</strong><span>Agrega un producto para continuar.</span></div>'}
      <div class="qrv3-order-total"><span>Total a enviar</span><strong>${money(total())}</strong></div>
      <div class="qrv3-form">
        <button id="confirm" class="qrv3-send" type="button" ${!S.cart.size || S.sending ? 'disabled' : ''}>${S.sending ? 'ENVIANDO…' : 'ENVIAR PEDIDO A COCINA'}</button>
      </div>`;
    $$('[data-order-plus]').forEach((button) => button.addEventListener('click', () => setQuantity(button.dataset.orderPlus, 1)));
    $$('[data-order-minus]').forEach((button) => button.addEventListener('click', () => setQuantity(button.dataset.orderMinus, -1)));
    $('#confirm')?.addEventListener('click', send);
  }

  function openPanel(selector) {
    const panel = $(selector);
    if (!panel) return;
    panel.hidden = false;
    document.body.style.overflow = 'hidden';
    panel.querySelector('button')?.focus();
  }

  function closePanel(selector) {
    const panel = $(selector);
    if (!panel) return;
    panel.hidden = true;
    if ($('#helpPanel')?.hidden && $('#orderPanel')?.hidden) document.body.style.overflow = '';
  }

  function openOrder() {
    if (!S.cart.size) return;
    renderOrderPanel();
    openPanel('#orderPanel');
  }

  function showSuccess(order) {
    closePanel('#orderPanel');
    $('#categoryWrap').hidden = true;
    $('#cartBar').hidden = true;
    $('#accountStrip').innerHTML = '<b>Pedido enviado correctamente</b><span>EN COCINA</span>';
    $('#app').innerHTML = `<section class="qrv3-success">
      <div class="qrv3-success-mark">✓</div>
      <h2>Pedido recibido</h2>
      <p>Ya entró directo a Cocina / Barra. No necesitas avisarle al mesero para que lo apruebe.</p>
      <strong>Pedido ${esc(String(order.id || '').slice(0, 8))} · ${money(order.total)}</strong><br>
      <button type="button" onclick="location.reload()">AGREGAR OTRO PEDIDO</button>
    </section>`;
  }

  async function send() {
    if (!S.cart.size || S.sending) return;
    S.sending = true;
    renderOrderPanel();
    const payload = {
      items:[...S.cart.entries()].map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
      confirmedTotal:total(),
      externalRequestId:`QR-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    };
    try {
      const order = await req(`/api/public/restaurante/qr/${encodeURIComponent(token)}/pedidos`, {
        method:'POST',
        body:JSON.stringify(payload)
      });
      S.cart.clear();
      showSuccess(order);
    } catch (error) {
      S.sending = false;
      renderOrderPanel();
      alert(error.message);
    }
  }

  $('#helpButton')?.addEventListener('click', () => openPanel('#helpPanel'));
  $$('[data-close-help]').forEach((button) => button.addEventListener('click', () => closePanel('#helpPanel')));
  $$('[data-close-order]').forEach((button) => button.addEventListener('click', () => closePanel('#orderPanel')));
  $('#reviewButton')?.addEventListener('click', openOrder);
  $('#helpPanel')?.addEventListener('click', (event) => { if (event.target.id === 'helpPanel') closePanel('#helpPanel'); });
  $('#orderPanel')?.addEventListener('click', (event) => { if (event.target.id === 'orderPanel') closePanel('#orderPanel'); });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closePanel('#helpPanel');
    closePanel('#orderPanel');
  });

  req(`/api/public/restaurante/qr/${encodeURIComponent(token)}`).then((ctx) => {
    S.ctx = ctx;
    window.RestaurantTheme?.apply(ctx.theme);
    document.querySelectorAll('[data-restaurant-name]').forEach((node) => { node.textContent = ctx.restaurantName || 'Restaurante'; });
    document.querySelectorAll('[data-table-name]').forEach((node) => { node.textContent = ctx.table.code || ctx.table.name || 'Mesa'; });
    renderAccount();
    renderNav();
    renderProducts();
    renderCartBar();
  }).catch((error) => {
    $('#categoryWrap').hidden = true;
    $('#cartBar').hidden = true;
    $('#accountStrip').innerHTML = '<b>No pudimos abrir este QR</b><span>ERROR</span>';
    $('#app').innerHTML = `<div class="qrv3-closed"><div class="qrv3-closed-icon">!</div><h2>No fue posible cargar la mesa</h2><p>${esc(error.message)}</p></div>`;
  });

  void CLIENT_REVIEW_MODE;
})();