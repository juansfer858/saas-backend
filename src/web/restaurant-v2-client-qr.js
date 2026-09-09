/* VANTIX_RESTAURANT_V2_CLIENT_QR_P7 */
(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V2_CLIENT_QR_P7';
  const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  if (!token) return;

  const prefix = `/api/public/restaurante/qr/${encodeURIComponent(token)}`;
  const visitKey = `vantixgc_restaurant_visit_v2:${token}`;
  const S = {
    context: null,
    visit: null,
    visitToken: localStorage.getItem(visitKey) || '',
    category: 'TODO',
    cart: new Map(),
    tracking: null,
    waiterCall: null,
    sheet: null,
    submitPending: false,
    scrollY: 0,
    streams: { presence: null, tracking: null, call: null }
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (value) => new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(Number(value || 0));
  const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

  function savedVisit(value) {
    S.visitToken = String(value || '');
    if (S.visitToken) localStorage.setItem(visitKey, S.visitToken);
    else localStorage.removeItem(visitKey);
  }

  function headers(withVisit = false) {
    return {
      Accept: 'application/json',
      ...(withVisit && S.visitToken ? { 'x-vantix-restaurant-visit': S.visitToken } : {})
    };
  }

  async function api(path, options = {}, withVisit = false) {
    const response = await fetch(path, {
      ...options,
      cache: 'no-store',
      headers: {
        ...headers(withVisit),
        ...(options.body ? { 'Content-Type':'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = body?.error?.code || body?.code || null;
      error.details = body?.error?.details || null;
      throw error;
    }
    return body?.data;
  }

  function toast(message) {
    const node = $('toast');
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 2600);
  }

  function menuRows() {
    return Array.isArray(S.context?.menu) ? S.context.menu.filter((row) => row?.product) : [];
  }

  function menuById(id) {
    return menuRows().find((row) => row.id === id) || null;
  }

  function lineTotal(row, quantity) {
    const subtotal = Number(row?.product?.price || 0) * Number(quantity || 0);
    const iva = subtotal * Number(row?.product?.ivaPct || 0) / 100;
    const impoconsumo = subtotal * Number(row?.product?.impoconsumoPct || 0) / 100;
    return roundMoney(subtotal + iva + impoconsumo);
  }

  function cartTotal() {
    let total = 0;
    for (const [id, item] of S.cart) total += lineTotal(menuById(id), item.quantity);
    return roundMoney(total);
  }

  function cartUnits() {
    let total = 0;
    for (const item of S.cart.values()) total += Number(item.quantity || 0);
    return total;
  }

  function setQty(id, quantity) {
    const row = menuById(id);
    if (!row?.available) return;
    const next = Math.max(0, Math.min(Number(quantity || 0), 20));
    if (!next) S.cart.delete(id);
    else {
      const current = S.cart.get(id) || { quantity:0, notes:'' };
      S.cart.set(id, { ...current, quantity:next });
    }
    renderMenu();
    renderCartBar();
    if (S.sheet === 'cart') renderCartSheet();
  }

  function setNotes(id, notes) {
    const current = S.cart.get(id);
    if (!current) return;
    S.cart.set(id, { ...current, notes:String(notes || '').slice(0, 300) });
    renderMenu();
  }

  function theme() {
    return S.context?.theme || {};
  }

  function applyTheme() {
    const tokens = theme().tokens || {};
    const root = document.documentElement;
    if (tokens.verdigris) root.style.setProperty('--accent', tokens.verdigris);
    if (tokens.success) root.style.setProperty('--accent2', tokens.success);
    if (tokens.ink) root.style.setProperty('--ink', tokens.ink);
  }

  function currentTable() {
    if (S.visit?.authorized && S.visit?.currentTable) return S.visit.currentTable;
    return S.context?.table || null;
  }

  function publicOpen() {
    if (S.visit?.authorized) return Boolean(S.visit.open);
    if (S.visit && Object.prototype.hasOwnProperty.call(S.visit, 'open')) return Boolean(S.visit.open);
    return Boolean(S.context?.open);
  }

  function renderHeader() {
    const table = currentTable();
    $('restaurantName').textContent = S.context?.restaurantName || theme().restaurantName || 'Restaurante';
    $('tableName').textContent = table?.name || table?.code || 'Mesa';
    const badge = $('visitBadge');
    if (S.visit?.authorized) badge.textContent = S.visit.relocated ? 'VISITA ACTIVA · MESA MOVIDA' : 'VISITA ACTIVA';
    else badge.textContent = publicOpen() ? 'MESA ABIERTA' : 'MESA SIN ABRIR';
    const seat = $('seatBadge');
    if (S.visit?.authorized && S.visit.seatNumber) {
      seat.hidden = false;
      seat.textContent = `Persona ${S.visit.seatNumber}`;
    } else seat.hidden = true;

    const card = $('availabilityCard');
    const open = publicOpen();
    card.dataset.open = open ? '1' : '0';
    const account = S.tracking?.account;
    card.dataset.account = account?.requested ? '1' : '0';
    if (!open) {
      $('availabilityTitle').textContent = 'La mesa todavía no está abierta';
      $('availabilityText').textContent = 'Puedes mirar la carta y preparar tu pedido. El código se pedirá sólo al enviarlo.';
    } else if (account?.requested) {
      const labels = { REQUESTED:'Cuenta solicitada', PREPARING:'Preparando tu cuenta', IN_CASH:'Cuenta en Caja', CLOSED:'Visita finalizada' };
      $('availabilityTitle').textContent = labels[account.state] || 'Cuenta solicitada';
      $('availabilityText').textContent = 'El estado se actualizará automáticamente.';
    } else if (S.visit?.authorized) {
      $('availabilityTitle').textContent = S.visit.relocated ? `Tu visita continúa en ${table?.name || 'la nueva mesa'}` : 'Este teléfono está autorizado';
      $('availabilityText').textContent = 'Puedes enviar pedidos, llamar al mesero y pedir la cuenta.';
    } else {
      $('availabilityTitle').textContent = 'Carta disponible';
      $('availabilityText').textContent = 'Agrega lo que quieras. Te pediremos el código de 4 dígitos únicamente al enviar.';
    }
  }

  function renderSpotlight() {
    const node = $('spotlight');
    const spot = theme().clientSpotlight;
    const row = spot?.active ? menuById(spot.menuItemId) : null;
    if (!spot?.active || !row?.product || !row.available) { node.hidden = true; node.innerHTML = ''; return; }
    node.hidden = false;
    node.innerHTML = `<small>${esc(spot.label || (spot.kind === 'PROMO_DIA' ? 'PROMO DEL DÍA' : 'PLATO DEL DÍA'))}</small><h2>${esc(row.product.name)}</h2>${spot.description ? `<p>${esc(spot.description)}</p>` : ''}<footer><strong>${money(lineTotal(row,1))}</strong><button class="p7-add" type="button" data-spot-add="${esc(row.id)}">Agregar</button></footer>`;
  }

  function categories() {
    return ['TODO', ...new Set(menuRows().map((row) => row.category).filter(Boolean))];
  }

  function renderCategories() {
    const rows = categories();
    if (!rows.includes(S.category)) S.category = 'TODO';
    $('categoryNav').innerHTML = rows.map((category) => `<button class="p7-category" type="button" data-category="${esc(category)}" aria-selected="${category === S.category ? 'true':'false'}">${esc(category === 'TODO' ? 'Todo' : category)}</button>`).join('');
    $('categoryTitle').textContent = S.category === 'TODO' ? 'Todo' : S.category;
  }

  function renderMenu() {
    const rows = menuRows().filter((row) => S.category === 'TODO' || row.category === S.category);
    const list = $('menuList');
    if (!rows.length) {
      list.innerHTML = '<div class="p7-empty"><b>No hay productos en esta categoría.</b><span>Prueba otra sección de la carta.</span></div>';
      return;
    }
    list.innerHTML = rows.map((row) => {
      const cart = S.cart.get(row.id);
      const qty = Number(cart?.quantity || 0);
      const taxes = [Number(row.product.ivaPct || 0) ? `IVA ${row.product.ivaPct}%` : '', Number(row.product.impoconsumoPct || 0) ? `Impoconsumo ${row.product.impoconsumoPct}%` : ''].filter(Boolean).join(' · ');
      return `<article class="p7-row"><div class="p7-product"><h3>${esc(row.product.name)}</h3><div class="p7-meta"><span>${esc(row.category || '')}</span><span>${esc(row.station || '')}</span>${taxes ? `<span>${esc(taxes)}</span>` : ''}${cart?.notes ? '<span class="p7-note-dot">• Con nota</span>' : ''}</div><div class="p7-price">${money(lineTotal(row,1))}</div></div><div class="p7-actions">${row.available ? `<button class="p7-step" type="button" data-minus="${esc(row.id)}" ${qty ? '' : 'disabled'}>−</button><span class="p7-qty">${qty}</span><button class="p7-step plus" type="button" data-plus="${esc(row.id)}">+</button>` : '<span class="p7-message warn">No disponible</span>'}</div></article>`;
    }).join('');
  }

  function renderCartBar() {
    const bar = $('cartBar');
    const units = cartUnits();
    bar.hidden = !units;
    $('cartCount').textContent = String(units);
    $('cartTotal').textContent = money(cartTotal());
  }

  function openSheet(kind, title, kicker = 'PEDIDO') {
    S.sheet = kind;
    $('sheetTitle').textContent = title;
    $('sheetKicker').textContent = kicker;
    $('sheet').hidden = false;
    $('sheetBackdrop').hidden = false;
    S.scrollY = window.scrollY;
    document.body.style.top = `-${S.scrollY}px`;
    document.body.classList.add('p7-lock');
    $('p7App').inert = true;
    $('cartBar').inert = true;
    $('sheetClose').focus({ preventScroll:true });
  }

  function closeSheet() {
    S.sheet = null;
    $('sheet').hidden = true;
    $('sheetBackdrop').hidden = true;
    $('p7App').inert = false;
    $('cartBar').inert = false;
    document.body.classList.remove('p7-lock');
    document.body.style.top = '';
    window.scrollTo(0, S.scrollY);
  }

  function renderCartSheet() {
    const rows = [...S.cart.entries()].map(([id,item]) => ({ row:menuById(id), item })).filter((x) => x.row);
    $('sheetBody').innerHTML = `${rows.map(({row,item}) => `<article class="p7-line"><div><h3>${esc(row.product.name)}</h3><small>${money(lineTotal(row,item.quantity))} · ${esc(row.station || '')}</small></div><div class="p7-line-controls"><button type="button" data-sheet-minus="${esc(row.id)}">−</button><b>${item.quantity}</b><button type="button" data-sheet-plus="${esc(row.id)}">+</button></div><label class="p7-note"><span class="p7-kicker">NOTA PARA ESTE PRODUCTO</span><textarea data-note="${esc(row.id)}" maxlength="300" placeholder="Ej. sin cebolla, salsa aparte…">${esc(item.notes || '')}</textarea></label></article>`).join('')}<div class="p7-summary"><span>Total confirmado</span><strong>${money(cartTotal())}</strong></div><div class="p7-message">Puedes armar el pedido sin código. La autorización de 4 dígitos sólo se solicita al tocar <b>Enviar a cocina/barra</b>.</div><button id="submitOrder" class="p7-primary" type="button" ${S.submitPending ? 'disabled':''}>${S.submitPending ? 'ENVIANDO…' : 'ENVIAR A COCINA / BARRA'}</button>`;
  }

  async function ensureVisitForSubmit() {
    const visit = await loadVisit();
    if (visit.localModeRequired && visit.localFallbackUrl) {
      const err = new Error('Esta sede requiere el acceso local para recibir el pedido en este momento.');
      err.code = 'EDGE_LOCAL_REQUIRED';
      err.localFallbackUrl = visit.localFallbackUrl;
      throw err;
    }
    if (!visit.open) throw new Error('La mesa todavía no está abierta. Pide al mesero abrirla y conserva este pedido; no se perderá.');
    if (visit.authorized && S.visitToken) return true;
    openAuthorizationSheet();
    return false;
  }

  function openAuthorizationSheet(errorMessage = '') {
    const guestCount = Math.max(Number(S.visit?.guestCount || S.context?.session?.guestCount || 1), 1);
    if (S.sheet !== 'auth') openSheet('auth', 'Autoriza este teléfono', 'CÓDIGO DE MESA');
    $('sheetBody').innerHTML = `<div class="p7-code">${errorMessage ? `<div class="p7-message warn">${esc(errorMessage)}</div>` : '<div class="p7-message">Pide al mesero el código actual de 4 dígitos. Esta autorización dura hasta que se cierre la mesa.</div>'}<input id="visitCode" class="p7-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="4" pattern="[0-9]{4}" aria-label="Código de 4 dígitos" placeholder="••••"><label><span class="p7-kicker">¿QUIÉN ESTÁ PIDIENDO?</span><select id="visitSeat" class="p7-select">${Array.from({length:guestCount},(_,i)=>`<option value="${i+1}">Persona ${i+1}</option>`).join('')}</select></label><button id="authorizeVisit" class="p7-primary" type="button">AUTORIZAR Y ENVIAR</button></div>`;
    setTimeout(() => $('visitCode')?.focus({ preventScroll:true }), 0);
  }

  async function authorizeAndResume() {
    const code = String($('visitCode')?.value || '').replace(/\D/g,'').slice(0,4);
    const seatNumber = Number($('visitSeat')?.value || 1);
    if (code.length !== 4) { openAuthorizationSheet('Ingresa los 4 dígitos del código de la mesa.'); return; }
    const button = $('authorizeVisit');
    button.disabled = true;
    button.textContent = 'AUTORIZANDO…';
    try {
      const result = await api(`${prefix}/autorizar`, { method:'POST', body:JSON.stringify({ code, seatNumber }) });
      savedVisit(result.visitToken);
      S.visit = { ...(S.visit || {}), open:true, authorized:true, seatNumber:result.seatNumber, guestCount:result.guestCount };
      await refreshAuthorizedState();
      closeSheet();
      renderAll();
      toast(`Teléfono autorizado · Persona ${result.seatNumber}`);
      await submitOrder();
    } catch (error) {
      openAuthorizationSheet(error.message || 'No fue posible autorizar este teléfono.');
    }
  }

  function payloadFromCart() {
    return {
      items: [...S.cart.entries()].map(([menuItemId,item]) => ({ menuItemId, quantity:item.quantity, notes:item.notes || undefined })),
      confirmedTotal: cartTotal(),
      externalRequestId: crypto.randomUUID()
    };
  }

  async function submitOrder() {
    if (S.submitPending || !cartUnits()) return;
    S.submitPending = true;
    if (S.sheet === 'cart') renderCartSheet();
    try {
      if (!await ensureVisitForSubmit()) return;
      const payload = payloadFromCart();
      await api(`${prefix}/pedidos`, { method:'POST', body:JSON.stringify(payload) }, true);
      S.cart.clear();
      closeSheet();
      renderMenu();
      renderCartBar();
      toast('Pedido enviado. Ya está en la operación del restaurante.');
      await refreshAuthorizedState();
      openTrackingSheet();
    } catch (error) {
      if (['RESTAURANT_QR_VISIT_INVALID','RESTAURANT_QR_VISIT_REQUIRED'].includes(error.code) || error.status === 401) {
        savedVisit('');
        await loadVisit();
        openAuthorizationSheet('La autorización anterior venció. Ingresa el código actual; tu pedido sigue aquí.');
      } else if (error.code === 'EDGE_LOCAL_REQUIRED' && error.localFallbackUrl) {
        if (S.sheet !== 'cart') openSheet('cart', 'Revisar pedido');
        $('sheetBody').innerHTML = `<div class="p7-message warn">${esc(error.message)}</div><a class="p7-primary" style="display:grid;place-items:center;text-decoration:none;margin-top:10px" href="${esc(error.localFallbackUrl)}">ABRIR ACCESO LOCAL</a>`;
      } else {
        if (S.sheet !== 'cart') openSheet('cart', 'Revisar pedido');
        renderCartSheet();
        const body = $('sheetBody');
        body.insertAdjacentHTML('afterbegin', `<div class="p7-message warn">${esc(error.message || 'No fue posible enviar el pedido.')}</div>`);
      }
    } finally {
      S.submitPending = false;
      if (S.sheet === 'cart') renderCartSheet();
    }
  }

  async function loadContext() {
    S.context = await api(prefix);
    applyTheme();
    return S.context;
  }

  async function loadVisit() {
    try {
      S.visit = await api(`${prefix}/visita`, {}, Boolean(S.visitToken));
      if (!S.visit?.authorized && S.visitToken) savedVisit('');
    } catch (error) {
      if ([401,403,409].includes(error.status)) {
        savedVisit('');
        S.visit = await api(`${prefix}/visita`);
      } else throw error;
    }
    return S.visit;
  }

  async function loadTracking() {
    if (!S.visitToken || !S.visit?.authorized) { S.tracking = null; return null; }
    try { S.tracking = await api(`${prefix}/mis-pedidos`, {}, true); }
    catch (error) {
      if (error.status === 401) { savedVisit(''); S.tracking = null; }
      else throw error;
    }
    return S.tracking;
  }

  async function loadCall() {
    if (!S.visitToken || !S.visit?.authorized) { S.waiterCall = null; return null; }
    try { S.waiterCall = await api(`${prefix}/llamar-mesero`, {}, true); }
    catch (error) { if (error.status !== 401) throw error; }
    return S.waiterCall;
  }

  function trackingStatus(order) {
    const states = (order?.stations || []).map((x) => x.state);
    if (states.length && states.every((x) => ['ENTREGADA','CANCELADA'].includes(x))) return 'ENTREGADO';
    if (states.includes('LISTA')) return 'LISTO';
    if (states.includes('EN_PREPARACION')) return 'EN PREPARACIÓN';
    return order?.state === 'CANCELADO' ? 'CANCELADO' : 'RECIBIDO';
  }

  function openTrackingSheet() {
    openSheet('tracking', 'Tu atención', 'SEGUIMIENTO');
    renderTrackingSheet();
  }

  function renderTrackingSheet() {
    const tracking = S.tracking;
    const orders = Array.isArray(tracking?.orders) ? tracking.orders : [];
    const callActive = Boolean(S.waiterCall?.active);
    const account = tracking?.account || { state:'OPEN', requested:false };
    const accountLabels = { OPEN:'Pedir la cuenta', REQUESTED:'Cuenta solicitada', PREPARING:'Preparando tu cuenta', IN_CASH:'Cuenta en Caja', CLOSED:'Cuenta finalizada' };
    $('sheetBody').innerHTML = `<div class="p7-orders">${orders.length ? orders.map((order,index) => `<article class="p7-order"><div class="p7-order-head"><b>Pedido ${index+1}</b><span class="p7-order-status">${esc(trackingStatus(order))}</span></div><div class="p7-stations">${(order.stations||[]).map((station)=>`<span class="p7-station">${esc(station.station)} · ${esc(station.state)}</span>`).join('')}</div><div class="p7-order-items">${(order.items||[]).map((item)=>`${esc(item.description)} × ${Number(item.quantity||0)}`).join('<br>')}</div></article>`).join('') : '<div class="p7-message">Todavía no hay pedidos enviados desde este teléfono.</div>'}</div><div class="p7-account-actions"><button id="callWaiter" class="p7-secondary ${callActive ? 'p7-call-active':''}" type="button" ${callActive ? 'disabled':''}>${callActive ? 'MESERO AVISADO' : 'LLAMAR AL MESERO'}</button><button id="requestAccount" class="p7-primary" type="button" ${account.state !== 'OPEN' ? 'disabled':''}>${esc(accountLabels[account.state] || 'Pedir la cuenta')}</button>${S.visit?.authorized && Number(S.visit.guestCount||1)>1 ? `<label><span class="p7-kicker">PERSONA DE ESTE TELÉFONO</span><select id="trackingSeat" class="p7-select">${Array.from({length:Number(S.visit.guestCount)},(_,i)=>`<option value="${i+1}" ${Number(S.visit.seatNumber)===i+1?'selected':''}>Persona ${i+1}</option>`).join('')}</select></label>`:''}</div>`;
  }

  async function callWaiter() {
    if (!S.visitToken) return openAuthorizationSheet();
    try {
      S.waiterCall = await api(`${prefix}/llamar-mesero`, { method:'POST', body:'{}' }, true);
      renderTrackingSheet();
      toast('El mesero fue avisado.');
    } catch (error) { toast(error.message || 'No fue posible llamar al mesero.'); }
  }

  async function requestAccount() {
    if (!S.visitToken) return openAuthorizationSheet();
    try {
      const account = await api(`${prefix}/pedir-cuenta`, { method:'POST', body:'{}' }, true);
      S.tracking = { ...(S.tracking || {}), account };
      renderHeader();
      renderTrackingSheet();
      toast('Cuenta solicitada.');
    } catch (error) { toast(error.message || 'No fue posible pedir la cuenta.'); }
  }

  async function changeSeat(value) {
    try {
      const result = await api(`${prefix}/persona`, { method:'PATCH', body:JSON.stringify({ seatNumber:Number(value) }) }, true);
      S.visit = { ...S.visit, seatNumber:result.seatNumber, guestCount:result.guestCount };
      if (S.tracking) S.tracking.seatNumber = result.seatNumber;
      renderHeader();
      renderTrackingSheet();
      toast(`Este teléfono ahora corresponde a Persona ${result.seatNumber}.`);
    } catch (error) { toast(error.message || 'No fue posible cambiar de persona.'); renderTrackingSheet(); }
  }

  function parseSseChunk(buffer, emit) {
    const frames = buffer.split('\n\n');
    const rest = frames.pop() || '';
    for (const frame of frames) {
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      try { emit(event, JSON.parse(data)); } catch {}
    }
    return rest;
  }

  async function consumeSse(path, controller, withVisit, onEvent) {
    const response = await fetch(path, { cache:'no-store', headers:headers(withVisit), signal:controller.signal });
    if (!response.ok || !response.body) throw new Error(`SSE ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!controller.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream:true }).replace(/\r\n/g,'\n');
      buffer = parseSseChunk(buffer, onEvent);
    }
  }

  function stopStream(name) {
    S.streams[name]?.abort();
    S.streams[name] = null;
  }

  function startStream(name, path, withVisit, onEvent) {
    stopStream(name);
    const controller = new AbortController();
    S.streams[name] = controller;
    const run = async () => {
      while (!controller.signal.aborted) {
        try { await consumeSse(path, controller, withVisit, onEvent); }
        catch { if (controller.signal.aborted) return; }
        await new Promise((resolve) => setTimeout(resolve, 1800));
      }
    };
    run();
  }

  function startPresence() {
    startStream('presence', `${prefix}/visita/realtime`, false, (event, data) => {
      if (!['ready','availability'].includes(event)) return;
      S.visit = { ...(S.visit || {}), open:Boolean(data.open), guestCount:Number(data.guestCount || 0) };
      if (!data.open && S.visitToken) {
        savedVisit('');
        S.tracking = null;
        S.waiterCall = null;
        stopStream('tracking');
        stopStream('call');
      }
      loadContext().catch(()=>{}).finally(renderAll);
    });
  }

  function startAuthorizedStreams() {
    if (!S.visitToken || !S.visit?.authorized) { stopStream('tracking'); stopStream('call'); return; }
    startStream('tracking', `${prefix}/mis-pedidos/stream`, true, (event, data) => {
      if (event === 'snapshot') { S.tracking = data; renderHeader(); renderTrackingButton(); if (S.sheet === 'tracking') renderTrackingSheet(); }
      if (event === 'visit-ended') { savedVisit(''); S.visit = { ...(S.visit||{}), authorized:false, open:false }; stopStream('tracking'); stopStream('call'); renderAll(); }
    });
    startStream('call', `${prefix}/llamar-mesero/stream`, true, (event, data) => {
      if (event === 'snapshot') { S.waiterCall = data; if (S.sheet === 'tracking') renderTrackingSheet(); }
      if (event === 'visit-ended') { savedVisit(''); stopStream('tracking'); stopStream('call'); }
    });
  }

  async function refreshAuthorizedState() {
    await loadVisit();
    if (S.visit?.authorized) await Promise.all([loadTracking(), loadCall()]);
    startAuthorizedStreams();
    renderAll();
  }

  function renderTrackingButton() {
    const button = $('trackingButton');
    const hasOrders = Boolean(S.tracking?.orders?.length);
    button.hidden = !S.visit?.authorized && !hasOrders;
    if (hasOrders) {
      const last = S.tracking.orders[S.tracking.orders.length - 1];
      button.textContent = `Mi pedido · ${trackingStatus(last)}`;
    } else button.textContent = 'Mi atención';
  }

  function renderAll() {
    renderHeader();
    renderSpotlight();
    renderCategories();
    renderMenu();
    renderCartBar();
    renderTrackingButton();
  }

  function openHelp() {
    openSheet('help','Cómo funciona','AYUDA');
    $('sheetBody').innerHTML = '<div class="p7-help"><article><b>1. Arma tu pedido</b><span>Puedes navegar, agregar productos y escribir notas sin código.</span></article><article><b>2. Autoriza al enviar</b><span>El código de 4 dígitos lo entrega el mesero y autoriza sólo este teléfono durante la visita.</span></article><article><b>3. Sigue todo en vivo</b><span>Verás Cocina, Barra/Postres, llamado al mesero y estado de la cuenta sin recargar la página.</span></article></div>';
  }

  function bind() {
    $('categoryNav').addEventListener('click', (event) => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      S.category = button.dataset.category;
      renderCategories();
      renderMenu();
    });
    $('menuList').addEventListener('click', (event) => {
      const plus = event.target.closest('[data-plus]');
      const minus = event.target.closest('[data-minus]');
      if (plus) setQty(plus.dataset.plus, Number(S.cart.get(plus.dataset.plus)?.quantity || 0) + 1);
      if (minus) setQty(minus.dataset.minus, Number(S.cart.get(minus.dataset.minus)?.quantity || 0) - 1);
    });
    $('spotlight').addEventListener('click', (event) => {
      const add = event.target.closest('[data-spot-add]');
      if (add) setQty(add.dataset.spotAdd, Number(S.cart.get(add.dataset.spotAdd)?.quantity || 0) + 1);
    });
    $('cartButton').addEventListener('click', () => { openSheet('cart','Revisar pedido'); renderCartSheet(); });
    $('trackingButton').addEventListener('click', openTrackingSheet);
    $('helpButton').addEventListener('click', openHelp);
    $('sheetClose').addEventListener('click', closeSheet);
    $('sheetBackdrop').addEventListener('click', closeSheet);
    $('sheetBody').addEventListener('click', (event) => {
      const minus = event.target.closest('[data-sheet-minus]');
      const plus = event.target.closest('[data-sheet-plus]');
      if (minus) setQty(minus.dataset.sheetMinus, Number(S.cart.get(minus.dataset.sheetMinus)?.quantity || 0) - 1);
      if (plus) setQty(plus.dataset.sheetPlus, Number(S.cart.get(plus.dataset.sheetPlus)?.quantity || 0) + 1);
      if (event.target.closest('#submitOrder')) submitOrder();
      if (event.target.closest('#authorizeVisit')) authorizeAndResume();
      if (event.target.closest('#callWaiter')) callWaiter();
      if (event.target.closest('#requestAccount')) requestAccount();
    });
    $('sheetBody').addEventListener('input', (event) => {
      if (event.target.matches('[data-note]')) setNotes(event.target.dataset.note, event.target.value);
      if (event.target.id === 'visitCode') event.target.value = event.target.value.replace(/\D/g,'').slice(0,4);
    });
    $('sheetBody').addEventListener('change', (event) => {
      if (event.target.id === 'trackingSeat') changeSeat(event.target.value);
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && S.sheet) closeSheet(); });
  }

  async function boot() {
    document.documentElement.dataset.restaurantV2ClientQr = MARKER;
    bind();
    try {
      await Promise.all([loadContext(), loadVisit()]);
      if (S.visit?.authorized) await Promise.all([loadTracking(), loadCall()]);
      renderAll();
      startPresence();
      startAuthorizedStreams();
    } catch (error) {
      $('menuList').innerHTML = `<div class="p7-empty"><b>No pudimos abrir esta carta.</b><span>${esc(error.message || 'Verifica el QR o intenta nuevamente.')}</span></div>`;
      $('availabilityTitle').textContent = 'QR no disponible';
      $('availabilityText').textContent = 'Solicita ayuda al restaurante.';
    }
  }

  boot();
})();
