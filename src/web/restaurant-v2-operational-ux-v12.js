/* VANTIX_RESTAURANT_V2_OPERATIONAL_UX_V12 */
(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V2_OPERATIONAL_UX_V12';
  const ACCOUNT_TARGET_KEY = 'vantixgc_restaurant_account_target_v12';
  const path = location.pathname;
  document.documentElement.dataset.restaurantV2OperationalUx = MARKER;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  }

  function money(value) {
    return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(Number(value || 0));
  }

  function canonicalTitle() {
    const configured = String(document.body?.dataset.rv2ModuleTitle || '').trim();
    if (configured === 'AUTO_ADMIN') return path.endsWith('/dispositivos') ? 'Dispositivos' : 'QR de mesas';
    return configured;
  }

  function installCanonicalHeader() {
    const body = document.body;
    if (!body || body.dataset.rv2ModuleHeader !== 'true') return;
    const header = [...body.children].find((node) => node.tagName === 'HEADER');
    if (!header) return;
    header.classList.add('rv2-module-top');
    const title = canonicalTitle();
    const h1 = header.querySelector('h1');
    if (!title || !h1) return;
    let applying = false;
    const enforce = () => {
      if (applying || h1.textContent.trim() === title) return;
      applying = true;
      h1.textContent = title;
      applying = false;
    };
    enforce();
    new MutationObserver(enforce).observe(h1, { childList:true, subtree:true, characterData:true });
  }

  function rememberAccountTarget(module, tableId) {
    sessionStorage.setItem(ACCOUNT_TARGET_KEY, JSON.stringify({
      module,
      tableId:String(tableId),
      expiresAt:Date.now() + 120000
    }));
  }

  function goToAccountTarget(module, tableId) {
    rememberAccountTarget(module, tableId);
    const shellUrl = `/app/centro-de-control-v2?module=${encodeURIComponent(module)}`;
    const directUrl = module === 'division'
      ? `/app/restaurante-v2/division?tableId=${encodeURIComponent(tableId)}`
      : `/app/restaurante-v2/caja?tableId=${encodeURIComponent(tableId)}`;
    try {
      if (window.top && window.top !== window) {
        window.top.location.assign(shellUrl);
        return;
      }
    } catch {}
    location.assign(directUrl);
  }

  function ensureAccountChoiceDialog() {
    let dialog = document.getElementById('rv2AccountChoiceDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'rv2AccountChoiceDialog';
    dialog.className = 'rv2-account-choice-dialog';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    return dialog;
  }

  function openAccountChoice(tableId, tableName) {
    const dialog = ensureAccountChoiceDialog();
    dialog.innerHTML = `<div class="rv2-account-choice-card">
      <div class="rv2-account-choice-head"><div><small>CUENTA SOLICITADA</small><h2>${esc(tableName || 'Mesa')}</h2></div><button class="rv2-btn" type="button" data-account-choice-close>Cerrar</button></div>
      <p>¿Cómo se va a cobrar esta mesa?</p>
      <div class="rv2-account-choice-grid">
        <button class="rv2-account-choice" type="button" data-account-target="caja"><b>Cuenta conjunta</b><span>Abre Caja con esta mesa ya seleccionada.</span></button>
        <button class="rv2-account-choice" type="button" data-account-target="division"><b>Cuenta dividida</b><span>Abre División con esta mesa ya seleccionada.</span></button>
      </div>
      <small class="rv2-account-choice-note">Esta confirmación evita enviar por error una cuenta dividida como conjunta.</small>
    </div>`;
    dialog.querySelector('[data-account-choice-close]')?.addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('[data-account-target]').forEach((button) => button.addEventListener('click', () => {
      const module = button.dataset.accountTarget;
      dialog.close();
      goToAccountTarget(module, tableId);
    }));
    dialog.showModal();
  }

  function installRequestedAccountShortcut() {
    if (path !== '/app/restaurante-v2/mesas') return;
    document.addEventListener('click', (event) => {
      const card = event.target.closest?.('[data-table].rv2-table-account-requested');
      if (!card) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const tableName = card.querySelector('h3')?.textContent?.trim() || 'Mesa';
      openAccountChoice(card.dataset.table, tableName);
    }, true);
  }

  function readAccountTarget(module) {
    const direct = new URLSearchParams(location.search).get('tableId');
    if (direct) return { tableId:direct, stored:false };
    try {
      const payload = JSON.parse(sessionStorage.getItem(ACCOUNT_TARGET_KEY) || 'null');
      if (!payload || payload.module !== module || !payload.tableId || Number(payload.expiresAt || 0) < Date.now()) {
        if (payload && Number(payload.expiresAt || 0) < Date.now()) sessionStorage.removeItem(ACCOUNT_TARGET_KEY);
        return null;
      }
      return { tableId:String(payload.tableId), stored:true };
    } catch {
      sessionStorage.removeItem(ACCOUNT_TARGET_KEY);
      return null;
    }
  }

  function installAccountAutoSelect(module) {
    const target = readAccountTarget(module);
    if (!target) return;
    let done = false;
    let observer = null;
    const select = () => {
      if (done) return true;
      const button = [...document.querySelectorAll('[data-table]')]
        .find((node) => String(node.dataset.table) === String(target.tableId));
      if (!button) return false;
      done = true;
      if (target.stored) sessionStorage.removeItem(ACCOUNT_TARGET_KEY);
      observer?.disconnect();
      button.click();
      setTimeout(() => button.scrollIntoView?.({ block:'nearest', behavior:'smooth' }), 80);
      return true;
    };
    if (select()) return;
    observer = new MutationObserver(select);
    observer.observe(document.body, { childList:true, subtree:true });
    setTimeout(() => observer?.disconnect(), 15000);
  }

  function apiClient() {
    const R = window.RestaurantV2;
    if (!R) throw new Error('Restaurant V2 SDK no disponible');
    R.requireSession();
    return R;
  }

  function ensurePromoDialog() {
    let dialog = document.getElementById('rv2PromoDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'rv2PromoDialog';
    dialog.className = 'rv2-promo-dialog';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    return dialog;
  }

  function promoPreview(dialog, rows) {
    const select = dialog.querySelector('#rv2PromoItem');
    const selected = rows.find((row) => String(row.id) === String(select?.value));
    const label = dialog.querySelector('#rv2PromoLabel')?.value.trim() || 'Promo del día';
    const description = dialog.querySelector('#rv2PromoDescription')?.value.trim() || '';
    const preview = dialog.querySelector('#rv2PromoPreview');
    if (!preview) return;
    preview.innerHTML = `<div class="rv2-promo-preview-art"><span>PROMO</span></div><div class="rv2-promo-preview-copy"><small>${esc(label)}</small><h3>${esc(selected?.product?.nombre || 'Selecciona un producto')}</h3>${description ? `<p>${esc(description)}</p>` : ''}<strong>${selected ? money(selected.product?.precio1) : 'Precio de la Carta'}</strong></div>`;
  }

  async function openPromoEditor() {
    const R = apiClient();
    const dialog = ensurePromoDialog();
    dialog.innerHTML = '<div class="rv2-promo-loading">Cargando Promo del día…</div>';
    dialog.showModal();
    try {
      const [theme, menu] = await Promise.all([
        R.api('/api/v1/restaurante/theme'),
        R.api('/api/v1/restaurante/menu?active=true')
      ]);
      const rows = (Array.isArray(menu) ? menu : []).filter((row) => row?.product && row.active !== false);
      const current = theme?.clientSpotlight || {};
      const selectedId = rows.some((row) => row.id === current.menuItemId) ? current.menuItemId : '';
      dialog.innerHTML = `<div class="rv2-promo-card">
        <div class="rv2-promo-head"><div><small>VISTA DESTACADA DEL CLIENTE</small><h2>Promo del día</h2><p>Se muestra al frente del QR como tarjeta destacada, separada del listado normal.</p></div><button class="rv2-btn" type="button" data-promo-close>Cerrar</button></div>
        <div class="rv2-promo-layout">
          <section class="rv2-promo-form">
            <label>Producto de la Carta<select id="rv2PromoItem" class="rv2-input"><option value="">Selecciona un producto…</option>${rows.map((row) => `<option value="${esc(row.id)}" ${row.id === selectedId ? 'selected' : ''}>${esc(row.product.nombre)} · ${money(row.product.precio1)}</option>`).join('')}</select></label>
            <label>Título<input id="rv2PromoLabel" class="rv2-input" maxlength="60" value="${esc(current.kind === 'PROMO_DIA' ? (current.label || 'Promo del día') : 'Promo del día')}"></label>
            <label>Descripción corta<textarea id="rv2PromoDescription" class="rv2-input rv2-promo-textarea" maxlength="180" rows="3" placeholder="Ej. Hoy incluye papas y bebida">${esc(current.kind === 'PROMO_DIA' ? (current.description || '') : '')}</textarea></label>
            <label class="rv2-promo-check"><input id="rv2PromoActive" type="checkbox" ${current.active && current.kind === 'PROMO_DIA' ? 'checked' : ''}> Mostrar esta promo en el QR</label>
            <div id="rv2PromoMessage"></div>
            <div class="rv2-promo-actions"><button id="rv2PromoDisable" class="rv2-btn" type="button" ${current.active && current.kind === 'PROMO_DIA' ? '' : 'disabled'}>Quitar promo</button><button id="rv2PromoSave" class="rv2-btn rv2-btn-primary" type="button" ${rows.length ? '' : 'disabled'}>Guardar y publicar</button></div>
          </section>
          <aside><small class="rv2-promo-preview-label">ASÍ LA VERÁ EL CLIENTE</small><div id="rv2PromoPreview" class="rv2-promo-preview"></div></aside>
        </div>
      </div>`;
      dialog.querySelector('[data-promo-close]')?.addEventListener('click', () => dialog.close());
      ['rv2PromoItem','rv2PromoLabel','rv2PromoDescription'].forEach((id) => dialog.querySelector(`#${id}`)?.addEventListener('input', () => promoPreview(dialog, rows)));
      dialog.querySelector('#rv2PromoItem')?.addEventListener('change', () => promoPreview(dialog, rows));
      promoPreview(dialog, rows);

      dialog.querySelector('#rv2PromoSave')?.addEventListener('click', async () => {
        const itemId = dialog.querySelector('#rv2PromoItem')?.value || null;
        const active = Boolean(dialog.querySelector('#rv2PromoActive')?.checked);
        const message = dialog.querySelector('#rv2PromoMessage');
        if (active && !itemId) {
          message.innerHTML = '<div class="rv2-promo-message error">Selecciona el producto que vas a destacar.</div>';
          return;
        }
        const button = dialog.querySelector('#rv2PromoSave');
        button.disabled = true;
        message.innerHTML = '<div class="rv2-promo-message">Guardando…</div>';
        try {
          await R.api('/api/v1/restaurante/theme', {
            method:'PATCH',
            body:JSON.stringify({ clientSpotlight:{
              active,
              kind:'PROMO_DIA',
              menuItemId:itemId,
              label:dialog.querySelector('#rv2PromoLabel')?.value.trim() || 'Promo del día',
              description:dialog.querySelector('#rv2PromoDescription')?.value.trim() || null
            } })
          });
          message.innerHTML = `<div class="rv2-promo-message ok">${active ? 'Promo publicada en el QR.' : 'Promo guardada sin publicar.'}</div>`;
          dialog.querySelector('#rv2PromoDisable').disabled = !active;
        } catch (error) {
          message.innerHTML = `<div class="rv2-promo-message error">${esc(error.message || 'No fue posible guardar la promo.')}</div>`;
        } finally {
          button.disabled = false;
        }
      });

      dialog.querySelector('#rv2PromoDisable')?.addEventListener('click', async () => {
        const button = dialog.querySelector('#rv2PromoDisable');
        const message = dialog.querySelector('#rv2PromoMessage');
        button.disabled = true;
        try {
          await R.api('/api/v1/restaurante/theme', {
            method:'PATCH',
            body:JSON.stringify({ clientSpotlight:{
              active:false,
              kind:'PROMO_DIA',
              menuItemId:dialog.querySelector('#rv2PromoItem')?.value || current.menuItemId || null,
              label:dialog.querySelector('#rv2PromoLabel')?.value.trim() || 'Promo del día',
              description:dialog.querySelector('#rv2PromoDescription')?.value.trim() || null
            } })
          });
          dialog.querySelector('#rv2PromoActive').checked = false;
          message.innerHTML = '<div class="rv2-promo-message ok">Promo retirada del QR.</div>';
        } catch (error) {
          button.disabled = false;
          message.innerHTML = `<div class="rv2-promo-message error">${esc(error.message || 'No fue posible quitar la promo.')}</div>`;
        }
      });
    } catch (error) {
      dialog.innerHTML = `<div class="rv2-promo-card"><div class="rv2-promo-head"><div><small>PROMO DEL DÍA</small><h2>No fue posible cargar</h2><p>${esc(error.message || 'Intenta nuevamente.')}</p></div><button class="rv2-btn" type="button" data-promo-close>Cerrar</button></div></div>`;
      dialog.querySelector('[data-promo-close]')?.addEventListener('click', () => dialog.close());
    }
  }

  function installPromoButton() {
    if (path !== '/app/restaurante-v2/carta') return;
    const actions = document.querySelector('.menu-actions');
    if (!actions || document.getElementById('promoDay')) return;
    const button = document.createElement('button');
    button.id = 'promoDay';
    button.className = 'rv2-btn';
    button.type = 'button';
    button.textContent = '★ Promo del día';
    button.addEventListener('click', openPromoEditor);
    actions.appendChild(button);
  }

  installCanonicalHeader();
  installRequestedAccountShortcut();
  if (path === '/app/restaurante-v2/caja') installAccountAutoSelect('caja');
  if (path === '/app/restaurante-v2/division') installAccountAutoSelect('division');
  installPromoButton();
})();
