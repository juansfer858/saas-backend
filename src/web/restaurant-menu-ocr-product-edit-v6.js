(() => {
  'use strict';

  const MARKER = 'VANTIX_MENU_OCR_EDIT_V6';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const OPERATIONAL = ['ENTRADAS', 'FUERTES', 'BEBIDAS', 'POSTRES'];
  const STATIONS = ['COCINA', 'BARRA', 'POSTRES'];
  let session = null;
  let refreshing = false;
  let scheduled = false;
  let rowsById = new Map();

  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (value) => new Intl.NumberFormat('es-CO', { style:'currency', currency:session.tenant?.moneda || 'COP', maximumFractionDigits:0 }).format(Number(value || 0));

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache:'no-store',
      headers:{
        'Content-Type':'application/json',
        Authorization:`Bearer ${session.token}`,
        'x-tenant-subdomain':session.subdomain,
        ...(options.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function cartaView() {
    const custom = document.querySelector('#ccCustomView');
    if (!custom || custom.hidden) return null;
    if (!/Carta y productos/i.test(custom.querySelector('h1')?.textContent || '')) return null;
    return custom;
  }

  function ensureStyle() {
    if (document.querySelector('#restaurantMenuOcrProductEditV6Style')) return;
    const style = document.createElement('style');
    style.id = 'restaurantMenuOcrProductEditV6Style';
    style.textContent = `
      .cc-ocr-product-card{position:relative}.cc-ocr-product-edit{min-height:36px;margin-top:10px;padding:0 12px;border:1px solid #b8c5ce;border-radius:9px;background:#fff;color:#24313a;font-weight:800;cursor:pointer}.cc-ocr-product-edit:hover{border-color:#137a53;color:#137a53;background:#f2fbf7}
      .cc-ocr-product-badge{display:inline-flex;margin-left:5px;padding:2px 6px;border-radius:999px;background:#e9f7f0;color:#137a53;font-size:9px;font-weight:900;letter-spacing:.04em}
      .cc-ocr-product-edit-overlay[hidden]{display:none}.cc-ocr-product-edit-overlay{position:fixed;inset:0;z-index:260;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.62);backdrop-filter:blur(5px)}
      .cc-ocr-product-edit-modal{width:min(620px,100%);overflow:hidden;border-radius:18px;background:#fff;color:#17212b;box-shadow:0 28px 80px rgba(0,0,0,.32)}
      .cc-ocr-product-edit-head{display:flex;gap:12px;align-items:flex-start;padding:18px 20px;border-bottom:1px solid #e2e8f0}.cc-ocr-product-edit-head h2{margin:0;font-size:23px}.cc-ocr-product-edit-head p{margin:5px 0 0;color:#64748b;font-size:13px;line-height:1.4}.cc-ocr-product-edit-close{margin-left:auto;width:42px;height:42px;border:1px solid #d7dee4;border-radius:10px;background:#fff;font-size:22px;cursor:pointer}
      .cc-ocr-product-edit-body{display:grid;grid-template-columns:1fr 1fr;gap:13px;padding:18px 20px}.cc-ocr-product-edit-field{display:grid;gap:6px}.cc-ocr-product-edit-field.wide{grid-column:1/-1}.cc-ocr-product-edit-field label{font-size:11px;font-weight:850;color:#475569;text-transform:uppercase;letter-spacing:.04em}.cc-ocr-product-edit-field input,.cc-ocr-product-edit-field select{width:100%;min-height:46px;padding:9px 11px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#17212b;font-size:14px}.cc-ocr-product-edit-field input:focus,.cc-ocr-product-edit-field select:focus{outline:2px solid rgba(19,122,83,.16);border-color:#137a53}
      .cc-ocr-product-edit-error{grid-column:1/-1;padding:10px 12px;border-radius:9px;background:#fff1f2;color:#9f1239;font-size:12px;font-weight:750}
      .cc-ocr-product-edit-foot{display:flex;justify-content:flex-end;gap:9px;padding:14px 20px;border-top:1px solid #e2e8f0;background:#f8fafc}.cc-ocr-product-edit-foot button{min-height:43px;padding:0 15px;border-radius:10px;font-weight:850;cursor:pointer}.cc-ocr-product-cancel{border:1px solid #cbd5e1;background:#fff;color:#334155}.cc-ocr-product-save{border:0;background:#137a53;color:#fff}.cc-ocr-product-save:disabled{opacity:.55;cursor:not-allowed}
      .cc-ocr-product-toast{position:fixed;z-index:280;right:18px;bottom:18px;max-width:min(420px,calc(100% - 36px));padding:12px 15px;border-radius:11px;background:#153c2d;color:#fff;font-size:13px;font-weight:800;box-shadow:0 14px 34px rgba(0,0,0,.22)}
      @media(max-width:700px){.cc-ocr-product-edit-overlay{padding:0;place-items:end center}.cc-ocr-product-edit-modal{border-radius:18px 18px 0 0}.cc-ocr-product-edit-body{grid-template-columns:1fr;padding:16px 14px}.cc-ocr-product-edit-field.wide{grid-column:auto}.cc-ocr-product-edit-head,.cc-ocr-product-edit-foot{padding-left:14px;padding-right:14px}.cc-ocr-product-edit-foot button{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function optionHtml(values, selected) {
    return values.map((value) => `<option value="${value}"${value === selected ? ' selected' : ''}>${value}</option>`).join('');
  }

  function renderCards(grid, rows) {
    const groups = new Map();
    rowsById = new Map(rows.map((row) => [row.id, row]));
    for (const row of rows) {
      const key = String(row.category || 'Otros').trim() || 'Otros';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    grid.className = 'cc-ocr-groups';
    grid.innerHTML = [...groups.entries()].map(([category, items]) => `<section class="cc-ocr-group"><header class="cc-ocr-group-head"><h2>${esc(category)}</h2><span>${items.length} producto${items.length === 1 ? '' : 's'}</span></header><div class="cc-menu-grid">${items.map((item) => `<article class="cc-menu-card cc-ocr-product-card" data-menu-item-id="${esc(item.id)}"><small>${esc(item.station || item.operationalCategory || '')}${item.importedByOcr ? '<span class="cc-ocr-product-badge">OCR</span>' : ''}</small><b>${esc(item.subcategory || 'Producto')}</b><strong>${money(item.price)}</strong>${item.importedByOcr ? `<button type="button" class="cc-ocr-product-edit" data-edit-ocr="${esc(item.id)}">Editar</button>` : ''}</article>`).join('')}</div></section>`).join('') || '<div class="ri-card">No hay productos visibles en la carta.</div>';
    grid.dataset.ocrEditV6 = '1';
    grid.querySelectorAll('[data-edit-ocr]').forEach((button) => button.addEventListener('click', () => openEditor(button.dataset.editOcr)));
  }

  async function refresh(force = false) {
    const custom = cartaView();
    if (!custom || refreshing) return;
    const grid = custom.querySelector('.cc-menu-grid, .cc-ocr-groups');
    if (!grid) return;
    if (!force && grid.dataset.ocrEditV6 === '1' && grid.querySelector('[data-edit-ocr]')) return;
    refreshing = true;
    try {
      const rows = await api('/api/v1/restaurante/carta-importacion/lista');
      if (Array.isArray(rows)) renderCards(grid, rows);
    } catch {}
    finally { refreshing = false; }
  }

  function ensureEditor() {
    ensureStyle();
    let overlay = document.querySelector('#ccMenuOcrProductEditOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'ccMenuOcrProductEditOverlay';
    overlay.className = 'cc-ocr-product-edit-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `<section class="cc-ocr-product-edit-modal" role="dialog" aria-modal="true" aria-labelledby="ccOcrProductEditTitle"><header class="cc-ocr-product-edit-head"><div><h2 id="ccOcrProductEditTitle">Editar producto</h2><p>Cambia la información detectada de la carta. El producto conserva su identidad y sus referencias internas.</p></div><button type="button" class="cc-ocr-product-edit-close" aria-label="Cerrar">×</button></header><form id="ccOcrProductEditForm"><div id="ccOcrProductEditBody" class="cc-ocr-product-edit-body"></div><footer class="cc-ocr-product-edit-foot"><button type="button" class="cc-ocr-product-cancel">Cancelar</button><button type="submit" class="cc-ocr-product-save">Guardar cambios</button></footer></form></section>`;
    document.body.appendChild(overlay);
    const close = () => { if (!overlay.dataset.busy) { overlay.hidden = true; document.body.style.overflow = ''; } };
    overlay.querySelector('.cc-ocr-product-edit-close').addEventListener('click', close);
    overlay.querySelector('.cc-ocr-product-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    return overlay;
  }

  function openEditor(id) {
    const item = rowsById.get(id);
    if (!item?.importedByOcr) return;
    const overlay = ensureEditor();
    overlay.dataset.menuItemId = item.id;
    delete overlay.dataset.busy;
    const body = overlay.querySelector('#ccOcrProductEditBody');
    body.innerHTML = `
      <div class="cc-ocr-product-edit-field wide"><label>Categoría de la carta</label><input name="category" maxlength="80" required value="${esc(item.category || '')}" placeholder="Ej. Hamburguesas"></div>
      <div class="cc-ocr-product-edit-field wide"><label>Producto / sabor</label><input name="subcategory" maxlength="180" required value="${esc(item.subcategory || '')}" placeholder="Ej. Ranchera"></div>
      <div class="cc-ocr-product-edit-field"><label>Precio</label><input name="price" type="number" min="1" step="1" required value="${Number(item.price || 0)}"></div>
      <div class="cc-ocr-product-edit-field"><label>Tipo operativo</label><select name="operationalCategory">${optionHtml(OPERATIONAL, item.operationalCategory)}</select></div>
      <div class="cc-ocr-product-edit-field wide"><label>Estación</label><select name="station">${optionHtml(STATIONS, item.station)}</select></div>`;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    const form = overlay.querySelector('#ccOcrProductEditForm');
    form.onsubmit = saveEditor;
    body.querySelector('input[name="subcategory"]')?.focus();
  }

  async function saveEditor(event) {
    event.preventDefault();
    const overlay = ensureEditor();
    if (overlay.dataset.busy) return;
    const form = event.currentTarget;
    const body = overlay.querySelector('#ccOcrProductEditBody');
    body.querySelector('.cc-ocr-product-edit-error')?.remove();
    const input = {
      category:String(form.elements.category.value || '').trim(),
      subcategory:String(form.elements.subcategory.value || '').trim(),
      price:Number(form.elements.price.value || 0),
      operationalCategory:String(form.elements.operationalCategory.value || ''),
      station:String(form.elements.station.value || '')
    };
    if (!input.category || !input.subcategory || !(input.price > 0)) {
      body.insertAdjacentHTML('beforeend', '<div class="cc-ocr-product-edit-error">Completa categoría, producto y un precio mayor que cero.</div>');
      return;
    }
    overlay.dataset.busy = '1';
    const save = overlay.querySelector('.cc-ocr-product-save');
    save.disabled = true;
    save.textContent = 'Guardando…';
    try {
      await api(`/api/v1/restaurante/carta-importacion/items/${encodeURIComponent(overlay.dataset.menuItemId)}`, { method:'PATCH', body:JSON.stringify(input) });
      overlay.hidden = true;
      document.body.style.overflow = '';
      const grid = cartaView()?.querySelector('.cc-ocr-groups, .cc-menu-grid');
      if (grid) delete grid.dataset.ocrEditV6;
      await refresh(true);
      showToast('Producto actualizado en la carta.');
    } catch (error) {
      body.insertAdjacentHTML('beforeend', `<div class="cc-ocr-product-edit-error">${esc(error.message)}</div>`);
    } finally {
      delete overlay.dataset.busy;
      save.disabled = false;
      save.textContent = 'Guardar cambios';
    }
  }

  function showToast(text) {
    document.querySelector('.cc-ocr-product-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'cc-ocr-product-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; ensureStyle(); refresh().catch(() => {}); }, 80);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once:true });
  else schedule();

  window.VantixGCMenuOcrEditV6 = Object.freeze({ marker:MARKER, version:'6.0.0', persisted:true, transactional:true });
})();
