(() => {
  const qrToken = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  if (!qrToken) return;

  const STORAGE_KEY = `vantixgc_restaurant_visit_${qrToken}`;
  const DEFERRED_AUTH_MARKER = 'VANTIX_QR_DEFERRED_AUTH_V28';
  const nativeFetch = window.fetch.bind(window);
  let visitState = null;
  let selectedSeat = 1;
  let authorizationPromise = null;
  let authorizationResolve = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const storedToken = () => String(localStorage.getItem(STORAGE_KEY) || '').trim();
  const forgetToken = () => localStorage.removeItem(STORAGE_KEY);
  const qrApiPrefix = `/api/public/restaurante/qr/${encodeURIComponent(qrToken)}`;

  function targetUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function requestMethod(input, init) {
    return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  }

  function isOrderSubmit(input, init) {
    return requestMethod(input, init) === 'POST' && targetUrl(input).includes(`${qrApiPrefix}/pedidos`);
  }

  function optionsWithVisitToken(input, init = {}) {
    const token = storedToken();
    if (!token) return init;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    headers.set('x-vantix-restaurant-visit', token);
    return { ...init, headers };
  }

  function settleAuthorization(result) {
    const resolve = authorizationResolve;
    authorizationPromise = null;
    authorizationResolve = null;
    if (resolve) resolve(result);
  }

  function cancelledOrderResponse() {
    return new Response(JSON.stringify({
      ok:false,
      error:{
        code:'RESTAURANT_QR_VISIT_CANCELLED',
        message:'Tu pedido sigue guardado. Cuando quieras enviarlo, toca Enviar a cocina y pide el código al mesero.'
      }
    }), { status:409, headers:{ 'Content-Type':'application/json' } });
  }

  window.fetch = async (input, init = {}) => {
    const url = targetUrl(input);
    const shouldAttach = url.includes(qrApiPrefix);
    const orderSubmit = shouldAttach && isOrderSubmit(input, init);

    if (orderSubmit && !storedToken()) {
      const authorization = await ensureOrderAuthorization();
      if (authorization === 'cancelled') return cancelledOrderResponse();
    }

    let response = await nativeFetch(input, shouldAttach ? optionsWithVisitToken(input, init) : init);

    if (orderSubmit && response.status === 401) {
      forgetToken();
      await refreshVisit().catch(() => {});
      const authorization = await ensureOrderAuthorization();
      if (authorization === 'authorized') {
        response = await nativeFetch(input, optionsWithVisitToken(input, init));
      } else if (authorization === 'cancelled') {
        return cancelledOrderResponse();
      }
    } else if (shouldAttach && response.status === 401 && url.includes('/persona')) {
      forgetToken();
      setTimeout(() => refreshVisit().catch(() => {}), 0);
    }
    return response;
  };

  function ensureStyles() {
    if (document.getElementById('restaurantQrVisitStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantQrVisitStyles';
    style.textContent = `
      .qrv-visit-overlay{position:fixed;inset:0;z-index:120;display:grid;place-items:end center;padding:10px;background:rgba(20,18,16,.64);backdrop-filter:blur(5px)}
      .qrv-visit-card{width:min(620px,100%);max-height:92vh;overflow:auto;padding:22px;border-radius:24px 24px 16px 16px;background:#fffdf8;color:#201c18;box-shadow:0 26px 70px rgba(0,0,0,.3)}
      .qrv-visit-card h2{margin:0;font-size:30px;line-height:1.05}.qrv-visit-card>p{margin:9px 0 18px;color:#6f655b;font-size:16px;line-height:1.45}
      .qrv-visit-code-label{display:block;font-size:14px;font-weight:900}.qrv-visit-code{display:block;width:100%;height:76px;margin-top:7px;border:2px solid #d8c9b6;border-radius:16px;background:#fff;text-align:center;font-size:38px;font-weight:900;letter-spacing:.28em;padding-left:.28em;font-variant-numeric:tabular-nums}
      .qrv-visit-code:focus{outline:4px solid rgba(239,111,36,.16);border-color:#ef6f24}
      .qrv-visit-seat-title{margin:19px 0 8px;font-size:14px;font-weight:900}.qrv-visit-seats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
      .qrv-visit-seat{min-height:58px;border:2px solid #dccdb9;border-radius:14px;background:#fff;color:#201c18;font-size:16px;font-weight:900}.qrv-visit-seat.active{border-color:#ef6f24;background:#fff0e5;color:#b8430b}
      .qrv-visit-submit{width:100%;min-height:64px;margin-top:18px;border:0;border-radius:15px;background:#ef6f24;color:#fff;font-size:18px;font-weight:900}.qrv-visit-submit:disabled{opacity:.5}
      .qrv-visit-secondary{width:100%;min-height:48px;margin-top:8px;border:1px solid #d8c9b6;border-radius:13px;background:#fff;color:#51483f;font-weight:900}
      .qrv-visit-error{margin-top:12px;padding:11px 13px;border-radius:12px;background:#fff1f0;color:#991b1b;font-weight:800;line-height:1.35}
      .qrv-visit-note{display:flex;gap:9px;margin-top:14px;padding:11px;border-radius:12px;background:#f3eee6;color:#62584e;font-size:13px;line-height:1.4}
      .qrv-visit-person{display:flex;align-items:center;gap:8px;margin:10px 0 0;padding:9px 12px;border:1px solid #c9d9d1;border-radius:13px;background:#eef8f2;color:#255a48;font-weight:900}
      .qrv-visit-person button{margin-left:auto;min-height:38px;border:1px solid #8db7a6;border-radius:10px;background:#fff;color:#255a48;padding:0 11px;font-weight:900}
      .qrv-visit-close-state{text-align:center;padding:15px}.qrv-visit-close-state strong{display:block;font-size:24px}.qrv-visit-close-state span{display:block;margin-top:8px;color:#6f655b;line-height:1.4}
      @media(min-width:640px){.qrv-visit-overlay{place-items:center}.qrv-visit-card{border-radius:24px}.qrv-visit-seats{grid-template-columns:repeat(4,minmax(0,1fr))}}
      @media(max-width:420px){.qrv-visit-card{padding:18px}.qrv-visit-card h2{font-size:26px}.qrv-visit-code{height:70px;font-size:34px}.qrv-visit-seats{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  function seatButtons(guestCount) {
    const count = Math.max(Number(guestCount || 1), 1);
    return Array.from({ length: count }, (_, index) => index + 1).map((seat) => `<button type="button" class="qrv-visit-seat ${seat === selectedSeat ? 'active' : ''}" data-visit-seat="${seat}">Persona ${seat}</button>`).join('');
  }

  function removeOverlay() { document.getElementById('restaurantQrVisitOverlay')?.remove(); }

  function bindSeatButtons(root) {
    root.querySelectorAll('[data-visit-seat]').forEach((button) => button.addEventListener('click', () => {
      selectedSeat = Number(button.dataset.visitSeat);
      root.querySelectorAll('[data-visit-seat]').forEach((row) => row.classList.toggle('active', Number(row.dataset.visitSeat) === selectedSeat));
    }));
  }

  function showAuthorization() {
    ensureStyles();
    removeOverlay();
    if (!visitState?.open) {
      settleAuthorization('unavailable');
      return;
    }
    const overlay = document.createElement('div');
    overlay.id = 'restaurantQrVisitOverlay';
    overlay.className = 'qrv-visit-overlay';
    overlay.innerHTML = `<section class="qrv-visit-card" role="dialog" aria-modal="true" aria-labelledby="visitTitle">
      <h2 id="visitTitle">Antes de enviar, confirma la mesa</h2>
      <p>Tu pedido ya está listo. Pídele al mesero el código de 4 dígitos. Sólo lo necesitamos ahora para enviar el pedido a Cocina/Barra.</p>
      <label class="qrv-visit-code-label">Código de 4 dígitos
        <input id="restaurantVisitCode" class="qrv-visit-code" inputmode="numeric" autocomplete="one-time-code" maxlength="4" pattern="[0-9]*" placeholder="••••" aria-label="Código de 4 dígitos">
      </label>
      ${Number(visitState.guestCount || 1) > 1 ? `<div class="qrv-visit-seat-title">¿Quién eres en la mesa?</div><div class="qrv-visit-seats">${seatButtons(visitState.guestCount)}</div>` : ''}
      <button id="restaurantVisitAuthorize" type="button" class="qrv-visit-submit">CONFIRMAR Y ENVIAR A COCINA</button>
      <button id="restaurantVisitCancel" type="button" class="qrv-visit-secondary">VOLVER A MI PEDIDO</button>
      <div id="restaurantVisitError" hidden></div>
      <div class="qrv-visit-note"><span aria-hidden="true">🔒</span><span>El código autoriza este teléfono sólo durante la apertura actual de la mesa. Al cerrar la cuenta deja de servir automáticamente.</span></div>
    </section>`;
    document.body.appendChild(overlay);
    bindSeatButtons(overlay);
    const input = overlay.querySelector('#restaurantVisitCode');
    input?.focus({ preventScroll:true });
    input?.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0,4); });
    const submit = overlay.querySelector('#restaurantVisitAuthorize');
    const errorNode = overlay.querySelector('#restaurantVisitError');
    const authorize = async () => {
      const code = String(input?.value || '').trim();
      if (!/^\d{4}$/.test(code)) {
        errorNode.hidden = false; errorNode.className = 'qrv-visit-error'; errorNode.textContent = 'Escribe los 4 números que te dio el mesero.'; return;
      }
      submit.disabled = true; submit.textContent = 'COMPROBANDO…'; errorNode.hidden = true;
      try {
        const response = await nativeFetch(`${qrApiPrefix}/autorizar`, {
          method:'POST', cache:'no-store', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ code, seatNumber:selectedSeat })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error?.message || body?.message || 'No fue posible autorizar esta mesa');
        localStorage.setItem(STORAGE_KEY, body.data.visitToken);
        visitState = { ...visitState, authorized:true, seatNumber:body.data.seatNumber, guestCount:body.data.guestCount };
        selectedSeat = Number(body.data.seatNumber || 1);
        removeOverlay();
        renderPersonBadge();
        settleAuthorization('authorized');
      } catch (error) {
        errorNode.hidden = false; errorNode.className = 'qrv-visit-error'; errorNode.textContent = error.message;
        submit.disabled = false; submit.textContent = 'CONFIRMAR Y ENVIAR A COCINA';
      }
    };
    submit.addEventListener('click', authorize);
    overlay.querySelector('#restaurantVisitCancel').addEventListener('click', () => {
      removeOverlay();
      settleAuthorization('cancelled');
    });
    input?.addEventListener('keydown', (event) => { if (event.key === 'Enter') authorize(); });
  }

  async function ensureOrderAuthorization() {
    if (authorizationPromise) return authorizationPromise;
    if (storedToken() && visitState?.authorized) return 'authorized';

    await refreshVisit().catch(() => {});
    if (storedToken() && visitState?.authorized) return 'authorized';
    if (!visitState?.open) return 'unavailable';

    authorizationPromise = new Promise((resolve) => { authorizationResolve = resolve; });
    showAuthorization();
    return authorizationPromise;
  }

  function showSeatChange() {
    ensureStyles();
    removeOverlay();
    const overlay = document.createElement('div');
    overlay.id = 'restaurantQrVisitOverlay';
    overlay.className = 'qrv-visit-overlay';
    overlay.innerHTML = `<section class="qrv-visit-card" role="dialog" aria-modal="true">
      <h2>¿Para quién estás pidiendo?</h2>
      <p>Los productos que agregues desde este teléfono quedarán asociados a esa persona para facilitar la cuenta separada.</p>
      <div class="qrv-visit-seats">${seatButtons(visitState?.guestCount || 1)}</div>
      <button id="restaurantVisitSaveSeat" class="qrv-visit-submit" type="button">GUARDAR PERSONA</button>
      <button id="restaurantVisitCancelSeat" class="qrv-visit-secondary" type="button">Cancelar</button>
      <div id="restaurantVisitError" hidden></div>
    </section>`;
    document.body.appendChild(overlay);
    bindSeatButtons(overlay);
    overlay.querySelector('#restaurantVisitCancelSeat').addEventListener('click', removeOverlay);
    overlay.querySelector('#restaurantVisitSaveSeat').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true; button.textContent = 'GUARDANDO…';
      try {
        const response = await window.fetch(`${qrApiPrefix}/persona`, { method:'PATCH', cache:'no-store', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ seatNumber:selectedSeat }) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error?.message || 'No fue posible cambiar la persona');
        visitState.seatNumber = body.data.seatNumber;
        selectedSeat = Number(body.data.seatNumber || 1);
        removeOverlay(); renderPersonBadge();
      } catch (error) {
        const node = overlay.querySelector('#restaurantVisitError'); node.hidden = false; node.className = 'qrv-visit-error'; node.textContent = error.message;
        button.disabled = false; button.textContent = 'GUARDAR PERSONA';
      }
    });
  }

  function renderPersonBadge() {
    document.getElementById('restaurantVisitPerson')?.remove();
    if (!visitState?.authorized || !visitState?.open) return;
    const frame = document.querySelector('.qrv3-frame');
    const hero = document.querySelector('.qrv3-hero');
    if (!frame || !hero) return;
    const badge = document.createElement('div');
    badge.id = 'restaurantVisitPerson';
    badge.className = 'qrv-visit-person';
    badge.innerHTML = `<span>✓ Teléfono autorizado · Persona ${esc(visitState.seatNumber || 1)}</span>${Number(visitState.guestCount || 1) > 1 ? '<button type="button">Cambiar persona</button>' : ''}`;
    hero.insertAdjacentElement('afterend', badge);
    badge.querySelector('button')?.addEventListener('click', showSeatChange);
  }

  async function refreshVisit() {
    ensureStyles();
    const headers = {};
    if (storedToken()) headers['x-vantix-restaurant-visit'] = storedToken();
    const response = await nativeFetch(`${qrApiPrefix}/visita`, { cache:'no-store', headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return;
    visitState = body.data || {};
    if (visitState.authorized) {
      selectedSeat = Number(visitState.seatNumber || 1);
      removeOverlay();
      renderPersonBadge();
      settleAuthorization('authorized');
    } else {
      if (storedToken()) forgetToken();
      document.getElementById('restaurantVisitPerson')?.remove();
      if (!visitState.open) {
        removeOverlay();
        settleAuthorization('unavailable');
      } else if (!authorizationPromise) {
        removeOverlay();
      }
    }
  }

  window.VantixGCQrDeferredAuthorizationV28 = Object.freeze({
    marker:DEFERRED_AUTH_MARKER,
    browseBeforeCode:true,
    codeAtOrderSubmit:true,
    automaticOrderResume:true,
    backendAuthorizationPreserved:true
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => refreshVisit().catch(() => {}), { once:true });
  else refreshVisit().catch(() => {});
})();
