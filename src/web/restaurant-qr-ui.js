(() => {
  const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const S = { ctx:null, cart:new Map() };
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => [...document.querySelectorAll(q)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (v) => new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(Number(v || 0));

  async function req(path, opts = {}) {
    const response = await fetch(path, { ...opts, cache:'no-store', headers:{ 'Content-Type':'application/json', ...(opts.headers || {}) } });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || 'No fue posible continuar');
    return body.data;
  }
  function lineTotal(menuItem, quantity) {
    const price = Number(menuItem.product?.price || 0);
    const iva = Number(menuItem.product?.ivaPct || 0);
    const impoconsumo = Number(menuItem.product?.impoconsumoPct || 0);
    const base = price * quantity;
    return Math.round((base + base * iva / 100 + base * impoconsumo / 100) * 100) / 100;
  }
  function total() {
    let value = 0;
    for (const [id, quantity] of S.cart.entries()) {
      const item = S.ctx.menu.find((x) => x.id === id);
      if (item) value += lineTotal(item, quantity);
    }
    return Math.round(value * 100) / 100;
  }
  function cartHtml() {
    if (!S.cart.size) return '<div class="empty-ticket">Aún no has agregado productos.</div>';
    const lines = [...S.cart.entries()].map(([id, quantity]) => {
      const item = S.ctx.menu.find((x) => x.id === id);
      return `<div class="receipt-row"><span>${quantity}× ${esc(item.product.name)}</span><b>${money(lineTotal(item, quantity))}</b></div>`;
    }).join('');
    return `${lines}<div class="receipt-row total"><span>Total</span><b>${money(total())}</b></div><label class="ri-label">WhatsApp opcional<input id="phone" class="ri-input" inputmode="tel" placeholder="+573001234567"></label><label class="ri-checkbox"><input id="consent" type="checkbox"> Acepto recibir avisos transaccionales de este pedido por WhatsApp.</label><button id="confirm" class="ri-btn primary">Revisé el total · Confirmar pedido</button>`;
  }
  function render() {
    const ctx = S.ctx;
    $('[data-restaurant-name]').textContent = ctx.restaurantName || 'Restaurante';
    if (!ctx.open) {
      $('#app').innerHTML = `<div class="qr-card"><div class="ri-error"><b>${esc(ctx.table.name)}</b><p>La mesa todavía no está abierta. Solicita al personal abrirla antes de hacer el autopedido.</p></div></div>`;
      return;
    }
    const categories = ['ENTRADAS','FUERTES','BEBIDAS','POSTRES'];
    $('#app').innerHTML = `<section class="qr-card"><div class="ri-eyebrow">Mesa activa</div><h2 class="ri-title">${esc(ctx.table.name)}</h2><p class="ri-muted">Pedido directo a producción · sin aprobación previa del mesero</p><div class="ri-notice">Cuenta actual: ${money(ctx.currentTotal)}</div></section><section class="qr-card">${categories.map((category) => `<h2 class="qr-cat">${category}</h2>${ctx.menu.filter((x) => x.category === category && x.product).map((item) => `<article class="qr-item"><div><div class="menu-station">${esc(item.station)}</div><div class="qr-item-name">${esc(item.product.name)}</div><div class="menu-price">${money(lineTotal(item,1))}</div>${!item.available ? '<div class="ri-muted">No disponible: receta pendiente</div>' : ''}</div><div class="qty-control">${item.available ? `<button class="ri-btn small" data-minus="${item.id}">−</button><span class="qty-number">${S.cart.get(item.id) || 0}</span><button class="ri-btn small primary" data-plus="${item.id}">+</button>` : '<span class="ri-muted">—</span>'}</div></article>`).join('') || '<div class="ri-muted">Sin productos</div>'}`).join('')}</section><section class="qr-cart"><div class="ri-eyebrow">Tu pedido</div><div id="cart">${cartHtml()}</div></section>`;
    $$('[data-plus]').forEach((button) => button.addEventListener('click', () => { S.cart.set(button.dataset.plus, (S.cart.get(button.dataset.plus) || 0) + 1); render(); }));
    $$('[data-minus]').forEach((button) => button.addEventListener('click', () => { const next = (S.cart.get(button.dataset.minus) || 0) - 1; if (next > 0) S.cart.set(button.dataset.minus, next); else S.cart.delete(button.dataset.minus); render(); }));
    $('#confirm')?.addEventListener('click', send);
  }
  async function send() {
    if (!S.cart.size) return;
    const phone = $('#phone')?.value.trim() || '';
    const consent = Boolean($('#consent')?.checked);
    if (phone && !consent) return alert('Marca el consentimiento si deseas usar tu número para avisos del pedido.');
    const button = $('#confirm');
    button.disabled = true; button.textContent = 'Enviando…';
    const payload = {
      items:[...S.cart.entries()].map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
      confirmedTotal:total(),
      customerPhoneE164:phone || null,
      consentWhatsApp:Boolean(phone && consent),
      externalRequestId:`QR-${Date.now()}-${Math.random().toString(36).slice(2,9)}`
    };
    try {
      const order = await req(`/api/public/restaurante/qr/${encodeURIComponent(token)}/pedidos`, { method:'POST', body:JSON.stringify(payload) });
      $('#app').innerHTML = `<section class="qr-card qr-sent"><div class="check">✓</div><div class="ri-eyebrow">Comanda enviada</div><h2>Pedido recibido</h2><p>Entró de inmediato a Cocina / Barra y aparecerá marcado como <b>vía autopedido QR</b>.</p><div class="ri-muted">Pedido ${esc(order.id.slice(0,8))} · ${money(order.total)}</div><button class="ri-btn primary" onclick="location.reload()">Agregar otro pedido</button></section>`;
    } catch (error) {
      button.disabled = false; button.textContent = 'Revisé el total · Confirmar pedido'; alert(error.message);
    }
  }

  req(`/api/public/restaurante/qr/${encodeURIComponent(token)}`).then((ctx) => {
    S.ctx = ctx;
    window.RestaurantTheme?.apply(ctx.theme);
    render();
  }).catch((error) => { $('#app').innerHTML = `<div class="qr-card ri-error">${esc(error.message)}</div>`; });
})();
