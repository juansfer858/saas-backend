/* VANTIX_RESTAURANT_DELIVERY_SEND_PRODUCTION_V86 */
/* VANTIX_RESTAURANT_DELIVERY_FREEZE_ROOT_FIX_V94 */
/* VANTIX_RESTAURANT_DELIVERY_REQUIRED_FIELDS_V95 */
(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const SENT_STATES = new Set(['CONFIRMADO','EN_PREPARACION','LISTO','EN_CAMINO','ENTREGADO']);
  const v94MenuByLine = new Map();

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

  function markOptional(dialog, selector, label) {
    const input = dialog.querySelector(selector);
    const field = input?.closest?.('label');
    if (!field) return;
    const textNode = [...field.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && String(node.textContent || '').trim());
    if (textNode && String(textNode.textContent || '').trim() !== label) textNode.textContent = label;
    input.setAttribute('aria-label', label);
  }

  function patchDialog(dialog) {
    if (!dialog || dialog.id !== 'deliveryCreateDialog') return;
    const intro = dialog.querySelector('.delivery-dialog-head .ri-muted');
    if (intro && /Cinco pasos|Nada se envía|misma Carta de Pedidos/i.test(intro.textContent || '')) {
      setTextIfChanged(intro, 'Al confirmar, el pedido entra inmediatamente a Producción / KDS.');
    }
    markOptional(dialog, '#deliveryNeighborhood', 'Barrio / zona (opcional)');
    markOptional(dialog, '#deliveryReference', 'Referencia (opcional)');
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
    v94MenuByLine.clear();
    requestAnimationFrame(() => patchVisibleDialog());
  }, true);

  // V95: V94 separa cada producto del domicilio en líneas independientes para conservar
  // precio aplicado y nota. El id de menú vive en el botón de Carta, mientras el carrito
  // conserva un id de línea. Mantenemos una relación local entre ambos sin tocar el modelo.
  document.addEventListener('click', (event) => {
    const dialog = event.target.closest?.('#deliveryCreateDialog');
    if (!dialog) return;
    const add = event.target.closest?.('[data-v93-add]');
    const duplicate = event.target.closest?.('[data-v94-duplicate]');
    if (!add && !duplicate) return;

    const sourceLineId = duplicate?.dataset?.v94Duplicate || null;
    const menuItemId = add?.dataset?.v93Add || (sourceLineId ? v94MenuByLine.get(sourceLineId) : null);
    if (!menuItemId) return;

    const rows = [...dialog.querySelectorAll('[data-v94-line]')];
    const untracked = rows.filter((row) => !v94MenuByLine.has(String(row.dataset.v94Line || '')));
    const created = untracked[untracked.length - 1];
    if (!created) return;
    const lineId = String(created.dataset.v94Line || '');
    if (!lineId) return;
    v94MenuByLine.set(lineId, String(menuItemId));
  }, false);

  function collectItems(dialog) {
    // Contrato activo V94. Se preservan por línea el precio aplicado y la nota, por lo
    // que dos unidades del mismo producto pueden viajar separadas si son diferentes.
    const v94Rows = [...dialog.querySelectorAll('[data-v94-line]')];
    if (v94Rows.length) {
      return v94Rows.map((row) => {
        const lineId = String(row.dataset.v94Line || '');
        const menuItemId = v94MenuByLine.get(lineId) || null;
        const quantity = Number(row.querySelector('.delivery-v93-line-side .delivery-v93-qty strong')?.textContent || 0);
        const rawPrice = Number(row.querySelector('[data-v94-price]')?.value);
        const notes = String(row.querySelector('[data-v94-note]')?.value || '').trim();
        if (!menuItemId || !Number.isFinite(quantity) || quantity <= 0) return null;
        return {
          menuItemId,
          quantity,
          ...(Number.isFinite(rawPrice) && rawPrice >= 0 ? { appliedUnitPrice: rawPrice } : {}),
          notes: notes || null
        };
      }).filter(Boolean);
    }

    const items = new Map();

    // Contrato histórico.
    for (const node of dialog.querySelectorAll('[data-delivery-qty]')) {
      const id = node.dataset.deliveryQty;
      const quantity = Number(node.textContent || 0);
      if (id && quantity > 0) items.set(id, quantity);
    }

    // Contrato V93 previo a las líneas editables.
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
    if (!customerName || !customerPhone || !address) {
      alert('Completa teléfono, nombre y dirección. Barrio y referencia son opcionales.');
      return;
    }
    if (!items.length) {
      alert('Agrega al menos un producto antes de enviar a Producción.');
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

  const contract = Object.freeze({
    version:'95.0.0',
    rootCause:'V86 no reconocía las líneas editables V94 al enviar a Producción',
    globalObserver:false,
    supportsV93:true,
    supportsV94Lines:true,
    preservesAppliedUnitPrice:true,
    preservesLineNotes:true,
    requiredFields:['customerPhone','customerName','address'],
    optionalFields:['neighborhood','deliveryReference']
  });
  window.VantixGCRestaurantDeliverySendProductionV94 = contract;
  window.VantixGCRestaurantDeliverySendProductionV95 = contract;
})();
