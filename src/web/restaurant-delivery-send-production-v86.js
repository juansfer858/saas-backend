/* VANTIX_RESTAURANT_DELIVERY_SEND_PRODUCTION_V86 */
/* VANTIX_RESTAURANT_DELIVERY_FREEZE_ROOT_FIX_V94 */
(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const SENT_STATES = new Set(['CONFIRMADO','EN_PREPARACION','LISTO','EN_CAMINO','ENTREGADO']);

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  async function api(path, options = {}) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) throw new Error('Sesión de Restaurante no disponible');
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
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function value(dialog, selector) {
    return String(dialog.querySelector(selector)?.value || '').trim();
  }

  function setTextIfChanged(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function patchDialog(dialog) {
    if (!dialog || dialog.id !== 'deliveryCreateDialog') return;
    const intro = dialog.querySelector('.delivery-dialog-head .ri-muted');
    if (intro && /Cinco pasos|Nada se envía|misma Carta de Pedidos/i.test(intro.textContent || '')) {
      setTextIfChanged(intro, 'Al confirmar, el pedido entra inmediatamente a Producción / KDS.');
    }
    const steps = [...dialog.querySelectorAll('.delivery-step')];
    const review = steps.find((step) => /Revisar y crear|Revisar y enviar/i.test(step.textContent || ''));
    if (review) {
      setTextIfChanged(review.querySelector('.delivery-step-title b'), 'Revisar y enviar');
      const note = review.querySelector('.ri-muted');
      if (note) setTextIfChanged(note, 'Al confirmar, el domicilio queda aceptado y sus comandas pasan a Producción por estación.');
    }
    const button = dialog.querySelector('#deliveryCreateSubmit');
    if (button && button.dataset.deliverySendV86Busy !== '1') setTextIfChanged(button, 'ENVIAR A PRODUCCIÓN');
  }

  function patchVisibleDialog() {
    patchDialog(document.getElementById('deliveryCreateDialog'));
  }

  // V94: NO observar todo el DOM. V86 antes usaba un MutationObserver sobre
  // document.documentElement y el propio patch cambiaba textContent dentro del diálogo.
  // Esa combinación se realimentaba al abrir Nuevo domicilio y podía bloquear el hilo UI.
  // Ahora se parchea una sola vez, después del clic que abre el diálogo.
  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('[data-new-delivery]')) return;
    requestAnimationFrame(() => patchVisibleDialog());
  }, true);

  function collectItems(dialog) {
    const items = new Map();

    // Contrato histórico.
    for (const node of dialog.querySelectorAll('[data-delivery-qty]')) {
      const id = node.dataset.deliveryQty;
      const quantity = Number(node.textContent || 0);
      if (id && quantity > 0) items.set(id, quantity);
    }

    // Contrato activo V93: el id vive en el botón + y la cantidad en el <strong> hermano.
    for (const plus of dialog.querySelectorAll('[data-v93-plus]')) {
      const id = plus.dataset.v93Plus;
      const quantity = Number(plus.parentElement?.querySelector('strong')?.textContent || 0);
      if (id && quantity > 0) items.set(id, quantity);
    }

    return [...items.entries()].map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('#deliveryCreateSubmit');
    if (!button) return;
    const dialog = button.closest('dialog');
    if (!dialog || dialog.id !== 'deliveryCreateDialog') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (button.dataset.deliverySendV86Busy === '1') return;

    patchDialog(dialog);
    const items = collectItems(dialog);
    const customerName = value(dialog, '#deliveryName');
    const customerPhone = value(dialog, '#deliveryPhone');
    const address = value(dialog, '#deliveryAddress');
    if (!customerName || !customerPhone || !address || !items.length) {
      alert('Completa teléfono, nombre, dirección y agrega al menos un producto.');
      return;
    }

    button.dataset.deliverySendV86Busy = '1';
    button.disabled = true;
    button.textContent = 'ENVIANDO A PRODUCCIÓN…';

    try {
      let deliveryId = button.dataset.deliveryCreatedId || '';
      if (!deliveryId) {
        const minutes = Number(dialog.querySelector('#deliveryMinutes')?.value || 45);
        const created = await api('/api/v1/restaurante/domicilios', {
          method:'POST',
          body:JSON.stringify({
            customerName,
            customerPhone,
            address,
            neighborhood:value(dialog, '#deliveryNeighborhood') || null,
            deliveryReference:value(dialog, '#deliveryReference') || null,
            notes:value(dialog, '#deliveryNotes') || null,
            deliveryFee:Number(dialog.querySelector('#deliveryFee')?.value || 0),
            promisedAt:new Date(Date.now() + minutes * 60000).toISOString(),
            channel:'MANUAL',
            items
          })
        });
        deliveryId = String(created?.id || '');
        if (!deliveryId) throw new Error('El Core creó el domicilio sin devolver su identificador');
        button.dataset.deliveryCreatedId = deliveryId;
        button.dataset.deliveryCreatedCode = String(created?.code || '');
      }

      const accepted = await api(`/api/v1/restaurante/domicilios/${encodeURIComponent(deliveryId)}/aceptar`, {
        method:'POST',
        body:'{}'
      });
      if (!SENT_STATES.has(String(accepted?.state || '').toUpperCase())) {
        throw new Error('El domicilio no confirmó su envío a Producción');
      }

      dialog.close?.();
      await window.VantixGCRestaurantDelivery?.refresh?.();
    } catch (error) {
      const alreadyCreated = Boolean(button.dataset.deliveryCreatedId);
      alert(alreadyCreated
        ? `El domicilio ${button.dataset.deliveryCreatedCode || ''} quedó creado, pero no pudo enviarse a Producción: ${error.message}. Pulsa ENVIAR A PRODUCCIÓN para reintentar sin crear otro pedido.`
        : error.message);
      button.dataset.deliverySendV86Busy = '0';
      button.disabled = false;
      button.textContent = 'ENVIAR A PRODUCCIÓN';
    }
  }, true);

  window.VantixGCRestaurantDeliverySendProductionV94 = Object.freeze({
    version:'94.0.0',
    rootCause:'V86 MutationObserver feedback loop',
    globalObserver:false,
    supportsV93:true
  });
})();
