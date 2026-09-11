/* VANTIX_RESTAURANT_DELIVERY_CUSTOMER_AUTOFILL_V83 */
(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_DELIVERY_CUSTOMER_AUTOFILL_V83';
  if (window[MARKER]) return;
  window[MARKER] = Object.freeze({
    version: '83.0.0',
    phoneLookup: true,
    automaticFill: true,
    latestDeliveryWins: true,
    manualCorrectionPersistsOnCreate: true,
    crossCustomerLeakGuard: true
  });

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const FIELD_MAP = Object.freeze([
    ['deliveryName', 'customerName'],
    ['deliveryAddress', 'address'],
    ['deliveryNeighborhood', 'neighborhood'],
    ['deliveryReference', 'deliveryReference']
  ]);

  let timer = null;
  let requestSeq = 0;
  let activePhone = '';
  let confirmedPhone = '';
  let confirmedCustomer = null;
  let observer = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const digits = (value) => String(value || '').replace(/\D+/g, '');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[m]));

  function authHeaders() {
    let session = null;
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
    if (!session?.token || !session?.subdomain) return null;
    return {
      Authorization: `Bearer ${session.token}`,
      'x-tenant-subdomain': session.subdomain
    };
  }

  function dialog() {
    return $('#deliveryCreateDialog');
  }

  function phoneInput(root = dialog()) {
    return root ? $('#deliveryPhone', root) : null;
  }

  function knownBox(root = dialog()) {
    return root ? $('#deliveryKnown', root) : null;
  }

  function clearCustomerFields(root) {
    FIELD_MAP.forEach(([id]) => {
      const field = $(`#${id}`, root);
      if (field) field.value = '';
    });
  }

  function resetForDifferentPhone(root, nextPhone) {
    if (activePhone && nextPhone !== activePhone) {
      clearCustomerFields(root);
      const box = knownBox(root);
      if (box) box.innerHTML = '';
      confirmedPhone = '';
      confirmedCustomer = null;
    }
    activePhone = nextPhone;
  }

  function renderKnown(root, phone, known) {
    const box = knownBox(root);
    if (!box) return;
    if (!known) {
      box.innerHTML = '';
      return;
    }
    const address = [known.address, known.neighborhood].filter(Boolean).join(' · ');
    box.innerHTML = `<div class="delivery-known" data-delivery-autofill-v83="1"><b>✓ Cliente encontrado · ${esc(known.customerName || phone)}</b><div>Datos del último domicilio cargados automáticamente${address ? `: ${esc(address)}` : '.'}</div><small style="display:block;margin-top:5px">Puedes corregir nombre, dirección, barrio o referencia antes de crear el domicilio. Lo corregido quedará como dato más reciente para la próxima vez.</small></div>`;
  }

  function fillCustomer(root, phone, known) {
    FIELD_MAP.forEach(([id, key]) => {
      const field = $(`#${id}`, root);
      if (!field) return;
      const current = String(field.value || '').trim();
      const next = String(known?.[key] || '').trim();
      // Si el operador ya escribió algo mientras respondía la consulta, se respeta.
      if (!current) field.value = next;
    });
    activePhone = phone;
    confirmedPhone = phone;
    confirmedCustomer = known || null;
    renderKnown(root, phone, known);
  }

  async function lookup(root, phone, seq) {
    const headers = authHeaders();
    if (!headers || phone.length < 7) return;
    try {
      const response = await fetch(`/api/v1/restaurante/domicilios/clientes/telefono/${encodeURIComponent(phone)}`, {
        method: 'GET',
        cache: 'no-store',
        headers
      });
      let body = null;
      try { body = await response.json(); } catch {}
      if (seq !== requestSeq || digits(phoneInput(root)?.value) !== phone) return;
      if (!response.ok) return;
      fillCustomer(root, phone, body?.data || null);
    } catch {}
  }

  function scheduleLookup(root, delay = 260) {
    const input = phoneInput(root);
    if (!input) return;
    const phone = digits(input.value);
    resetForDifferentPhone(root, phone);
    requestSeq += 1;
    const seq = requestSeq;
    clearTimeout(timer);
    if (phone.length < 7) {
      confirmedPhone = '';
      confirmedCustomer = null;
      const box = knownBox(root);
      if (box) box.innerHTML = '';
      return;
    }
    timer = setTimeout(() => lookup(root, phone, seq), delay);
  }

  function neutralizeLegacyPrompt(root) {
    const box = knownBox(root);
    const phone = digits(phoneInput(root)?.value);
    if (!box || !phone) return;
    const legacyButton = $('[data-use-known]', box);
    if (!legacyButton) return;
    // El lookup V83 es la fuente visual autoritativa para el número actual.
    if (confirmedPhone === phone) renderKnown(root, phone, confirmedCustomer);
    else box.innerHTML = '';
  }

  function attach(root) {
    if (!root || root.dataset.deliveryCustomerAutofillV83 === '1') return;
    const input = phoneInput(root);
    if (!input) return;
    root.dataset.deliveryCustomerAutofillV83 = '1';
    input.addEventListener('input', () => scheduleLookup(root), true);
    input.addEventListener('blur', () => scheduleLookup(root, 0), true);

    const box = knownBox(root);
    if (box) {
      const boxObserver = new MutationObserver(() => neutralizeLegacyPrompt(root));
      boxObserver.observe(box, { childList: true, subtree: true });
    }
    scheduleLookup(root, 0);
  }

  function scan() {
    const root = dialog();
    if (root) attach(root);
  }

  function start() {
    scan();
    if (observer) return;
    observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    document.documentElement.dataset.deliveryCustomerAutofillV83 = '1';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
