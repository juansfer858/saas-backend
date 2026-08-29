(() => {
  'use strict';
  if (!location.pathname.startsWith('/app/centro-de-control')) return;

  const SESSION_KEY = 'vantixgc_core_session_v1';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) return;

  const MAX_BYTES = 5 * 1024 * 1024;
  let currentFileName = '';
  let currentItems = [];
  let busy = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const money = (value) => new Intl.NumberFormat('es-CO', { style:'currency', currency:session.tenant?.moneda || 'COP', maximumFractionDigits:0 }).format(Number(value || 0));

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        'x-tenant-subdomain': session.subdomain,
        ...(options.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
      error.code = body?.error?.code || null;
      throw error;
    }
    return body.data;
  }

  function ensureStyles() {
    if (document.querySelector('#restaurantMenuOcrStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantMenuOcrStyles';
    style.textContent = `
      .cc-ocr-button{display:inline-flex;align-items:center;gap:7px;min-height:40px;padding:0 14px;border:0;border-radius:10px;background:#137a53;color:#fff;font-weight:800;text-decoration:none;cursor:pointer;box-shadow:0 5px 12px rgba(19,122,83,.18)}
      .cc-ocr-button:hover{background:#0f6846}.cc-ocr-button:disabled{opacity:.55;cursor:not-allowed}
      .cc-ocr-groups{display:grid;gap:18px}.cc-ocr-group{display:grid;gap:9px}.cc-ocr-group-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 2px 7px;border-bottom:1px solid #d9dfe3}.cc-ocr-group-head h2{margin:0;font-size:19px}.cc-ocr-group-head span{font-size:11px;color:#64748b;font-weight:700}
      .cc-ocr-overlay[hidden]{display:none}.cc-ocr-overlay{position:fixed;inset:0;z-index:220;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.60);backdrop-filter:blur(5px)}
      .cc-ocr-modal{width:min(980px,100%);max-height:min(90dvh,860px);display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:#fff;color:#17212b;box-shadow:0 28px 80px rgba(0,0,0,.30)}
      .cc-ocr-head{display:flex;align-items:flex-start;gap:14px;padding:18px 20px;border-bottom:1px solid #e2e8f0}.cc-ocr-head h2{margin:0;font-size:23px}.cc-ocr-head p{margin:5px 0 0;color:#64748b;font-size:13px}.cc-ocr-close{margin-left:auto;width:42px;height:42px;border:1px solid #d7dee4;border-radius:10px;background:#fff;font-size:22px;cursor:pointer}
      .cc-ocr-body{overflow:auto;padding:18px 20px}.cc-ocr-state{padding:24px;border:1px dashed #cbd5e1;border-radius:14px;background:#f8fafc;text-align:center}.cc-ocr-state b{display:block;font-size:18px}.cc-ocr-state span{display:block;margin-top:6px;color:#64748b;line-height:1.45}
      .cc-ocr-note{margin-bottom:14px;padding:10px 12px;border-radius:10px;background:#ecfdf5;color:#166534;font-size:12px;font-weight:700}.cc-ocr-error{margin-bottom:14px;padding:11px 13px;border-radius:10px;background:#fff1f2;color:#9f1239;font-size:13px;font-weight:700}
      .cc-ocr-table{width:100%;border-collapse:collapse}.cc-ocr-table th{padding:8px 6px;text-align:left;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.cc-ocr-table td{padding:7px 6px;border-top:1px solid #eef2f5;vertical-align:middle}.cc-ocr-table input{width:100%;min-height:42px;padding:8px 10px;border:1px solid #cfd8df;border-radius:9px;background:#fff;font-size:14px}.cc-ocr-table input:focus{outline:2px solid rgba(19,122,83,.16);border-color:#137a53}.cc-ocr-price{max-width:150px}.cc-ocr-confidence{white-space:nowrap;font-size:11px;font-weight:800;color:#64748b}.cc-ocr-remove{width:38px;height:38px;border:1px solid #fecdd3;border-radius:9px;background:#fff;color:#be123c;font-size:18px;cursor:pointer}
      .cc-ocr-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid #e2e8f0;background:#f8fafc}.cc-ocr-secondary{min-height:42px;padding:0 14px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font-weight:800;cursor:pointer}.cc-ocr-primary{min-height:44px;padding:0 18px;border:0;border-radius:10px;background:#137a53;color:#fff;font-weight:850;cursor:pointer}.cc-ocr-primary:disabled{opacity:.55;cursor:not-allowed}
      @media(max-width:700px){.cc-ocr-overlay{padding:0;place-items:end center}.cc-ocr-modal{width:100%;max-height:94dvh;border-radius:18px 18px 0 0}.cc-ocr-head,.cc-ocr-body,.cc-ocr-foot{padding-left:14px;padding-right:14px}.cc-ocr-table{display:block;min-width:700px}.cc-ocr-body{overflow:auto}.cc-ocr-foot{position:sticky;bottom:0}.cc-ocr-button{width:100%;justify-content:center}}
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    ensureStyles();
    let overlay = document.querySelector('#ccMenuOcrOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'ccMenuOcrOverlay';
    overlay.className = 'cc-ocr-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `<section class="cc-ocr-modal" role="dialog" aria-modal="true" aria-labelledby="ccOcrTitle">
      <header class="cc-ocr-head"><div><h2 id="ccOcrTitle">Importar carta con OCR</h2><p>Sube una foto o PDF. VantixGC detecta categoría, producto/sabor y precio antes de guardar.</p></div><button type="button" class="cc-ocr-close" aria-label="Cerrar">×</button></header>
      <div id="ccOcrBody" class="cc-ocr-body"></div>
      <footer id="ccOcrFoot" class="cc-ocr-foot" hidden></footer>
    </section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.cc-ocr-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (event) => { if (event.target === overlay && !busy) closeModal(); });
    return overlay;
  }

  function openModal() {
    const overlay = ensureModal();
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (busy) return;
    const overlay = document.querySelector('#ccMenuOcrOverlay');
    if (overlay) overlay.hidden = true;
    document.body.style.overflow = '';
  }

  function renderState(title, text, error = false) {
    openModal();
    const body = document.querySelector('#ccOcrBody');
    const foot = document.querySelector('#ccOcrFoot');
    if (foot) foot.hidden = true;
    body.innerHTML = `${error ? `<div class="cc-ocr-error">${esc(text)}</div>` : ''}<div class="cc-ocr-state"><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('No fue posible leer el archivo'));
      reader.readAsDataURL(file);
    });
  }

  async function imageToJpeg(file, maxSide = 2200, quality = .88) {
    if (!String(file.type || '').startsWith('image/')) return file;
    let source = null;
    let width = 0;
    let height = 0;
    let release = () => {};
    try {
      if ('createImageBitmap' in window) {
        source = await createImageBitmap(file);
        width = source.width; height = source.height;
        release = () => source.close?.();
      } else {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.src = url;
        await img.decode();
        source = img; width = img.naturalWidth; height = img.naturalHeight;
        release = () => URL.revokeObjectURL(url);
      }
      const scale = Math.min(1, maxSide / Math.max(width || 1, height || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d', { alpha:false });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) throw new Error('No fue posible preparar la imagen');
      const base = String(file.name || 'carta').replace(/\.[^.]+$/, '') || 'carta';
      return new File([blob], `${base}.jpg`, { type:'image/jpeg' });
    } finally { release(); }
  }

  function confidenceLabel(value) {
    const pct = Math.round(Math.max(0, Math.min(1, Number(value || 0))) * 100);
    return `${pct}%`;
  }

  function collectRows() {
    return [...document.querySelectorAll('#ccOcrTable tbody tr')].map((row) => ({
      category: row.querySelector('[data-field="category"]').value.trim(),
      subcategory: row.querySelector('[data-field="subcategory"]').value.trim(),
      price: Number(row.querySelector('[data-field="price"]').value || 0),
      operationalCategory: row.dataset.operationalCategory,
      station: row.dataset.station,
      confidence: Number(row.dataset.confidence || 1)
    })).filter((row) => row.category && row.subcategory && row.price > 0);
  }

  function renderPreview(items) {
    currentItems = Array.isArray(items) ? items : [];
    openModal();
    const body = document.querySelector('#ccOcrBody');
    const foot = document.querySelector('#ccOcrFoot');
    body.innerHTML = `<div class="cc-ocr-note">No se importan las fotos de la carta. Revisa estos datos antes de crear productos.</div>
      <div style="overflow:auto"><table id="ccOcrTable" class="cc-ocr-table"><thead><tr><th>Categoría</th><th>Producto / sabor</th><th>Precio</th><th>Confianza</th><th></th></tr></thead><tbody>${currentItems.map((item, index) => `<tr data-operational-category="${esc(item.operationalCategory)}" data-station="${esc(item.station)}" data-confidence="${Number(item.confidence || 0)}"><td><input data-field="category" value="${esc(item.category)}" maxlength="80"></td><td><input data-field="subcategory" value="${esc(item.subcategory)}" maxlength="180"></td><td><input class="cc-ocr-price" data-field="price" type="number" min="1" step="1" value="${Number(item.price || 0)}"></td><td class="cc-ocr-confidence">${confidenceLabel(item.confidence)}</td><td><button type="button" class="cc-ocr-remove" data-remove-row="${index}" aria-label="Quitar">×</button></td></tr>`).join('')}</tbody></table></div>`;
    foot.hidden = false;
    foot.innerHTML = `<button type="button" class="cc-ocr-secondary" id="ccOcrChooseAgain">Elegir otro archivo</button><button type="button" class="cc-ocr-primary" id="ccOcrConfirm">Importar ${currentItems.length} producto${currentItems.length === 1 ? '' : 's'}</button>`;
    body.querySelectorAll('[data-remove-row]').forEach((button) => button.addEventListener('click', () => {
      button.closest('tr')?.remove();
      const rows = collectRows();
      const confirm = document.querySelector('#ccOcrConfirm');
      if (confirm) { confirm.disabled = !rows.length; confirm.textContent = `Importar ${rows.length} producto${rows.length === 1 ? '' : 's'}`; }
    }));
    document.querySelector('#ccOcrChooseAgain').addEventListener('click', () => document.querySelector('#ccMenuOcrFile')?.click());
    document.querySelector('#ccOcrConfirm').addEventListener('click', confirmImport);
  }

  async function confirmImport() {
    if (busy) return;
    const rows = collectRows();
    if (!rows.length) return renderState('No hay productos para importar', 'Deja al menos una fila con categoría, nombre y precio.', true);
    busy = true;
    const button = document.querySelector('#ccOcrConfirm');
    if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
    try {
      const result = await api('/api/v1/restaurante/carta-importacion/confirmar', { method:'POST', body:JSON.stringify({ fileName:currentFileName, items:rows }) });
      const body = document.querySelector('#ccOcrBody');
      const foot = document.querySelector('#ccOcrFoot');
      body.innerHTML = `<div class="cc-ocr-state"><b>Carta importada</b><span>${result.created} producto(s) creado(s), ${result.updated} actualizado(s). Total: ${result.total}.</span></div>`;
      foot.hidden = false;
      foot.innerHTML = '<button type="button" class="cc-ocr-primary" id="ccOcrDone">Ver carta actualizada</button>';
      document.querySelector('#ccOcrDone').addEventListener('click', async () => { busy = false; closeModal(); await refreshGroupedMenu(); });
    } catch (error) {
      busy = false;
      renderState('No se pudo guardar la carta', error.message, true);
    }
  }

  async function processFile(file) {
    if (!file || busy) return;
    busy = true;
    renderState('Reconociendo carta…', 'VantixGC está comparando varias lecturas para escoger la más limpia. Puede tardar un poco más, pero evita importar nombres deformados.');
    try {
      const status = await api('/api/v1/restaurante/carta-importacion/status');
      if (!status.configured) throw new Error('El importador OCR no está disponible en este momento.');
      const maxBytes = Number(status.maxBytes || MAX_BYTES);
      let prepared = file;
      if (String(file.type || '').startsWith('image/')) {
        const nativeType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
        if (!(status.preserveOriginalImage && nativeType && file.size <= maxBytes)) {
          prepared = await imageToJpeg(file, status.preserveOriginalImage ? 3600 : 2200, status.preserveOriginalImage ? .94 : .88);
        }
      }
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(prepared.type)) throw new Error('Usa una foto JPG/PNG/WEBP o un archivo PDF.');
      if (prepared.size > maxBytes) throw new Error(`El archivo es muy grande. Máximo ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
      currentFileName = prepared.name || file.name || 'carta';
      const dataUrl = await fileToDataUrl(prepared);
      const dataBase64 = dataUrl.split(',')[1] || '';
      const result = await api('/api/v1/restaurante/carta-importacion/analizar', {
        method:'POST',
        body:JSON.stringify({ fileName:currentFileName, mimeType:prepared.type, dataBase64 })
      });
      busy = false;
      renderPreview(result.items || []);
    } catch (error) {
      busy = false;
      renderState('No fue posible reconocer la carta', error.message, true);
    }
  }

  async function refreshGroupedMenu() {
    const custom = document.querySelector('#ccCustomView');
    if (!custom || custom.hidden || !/Carta y productos/i.test(custom.querySelector('h1')?.textContent || '')) return;
    try {
      const rows = await api('/api/v1/restaurante/carta-importacion/lista');
      const grid = custom.querySelector('.cc-menu-grid');
      if (!grid || !Array.isArray(rows)) return;
      const groups = new Map();
      for (const row of rows) {
        const key = String(row.category || 'Otros').trim() || 'Otros';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }
      grid.className = 'cc-ocr-groups';
      grid.innerHTML = [...groups.entries()].map(([category, items]) => `<section class="cc-ocr-group"><header class="cc-ocr-group-head"><h2>${esc(category)}</h2><span>${items.length} producto${items.length === 1 ? '' : 's'}</span></header><div class="cc-menu-grid">${items.map((item) => `<article class="cc-menu-card"><small>${esc(item.station || item.operationalCategory || '')}${item.importedByOcr ? ' · OCR' : ''}</small><b>${esc(item.subcategory || 'Producto')}</b><strong>${money(item.price)}</strong></article>`).join('')}</div></section>`).join('') || '<div class="ri-card">No hay productos visibles en la carta.</div>';
    } catch {}
  }

  function installButton() {
    ensureStyles();
    const custom = document.querySelector('#ccCustomView');
    if (!custom || custom.hidden || !/Carta y productos/i.test(custom.querySelector('h1')?.textContent || '')) return;
    const actions = custom.querySelector('.cc-view-actions');
    if (!actions || actions.querySelector('[data-menu-ocr-import]')) return;
    const input = document.createElement('input');
    input.id = 'ccMenuOcrFile';
    input.type = 'file';
    input.accept = 'image/*,application/pdf,.pdf';
    input.hidden = true;
    input.addEventListener('change', () => { const file = input.files?.[0]; input.value = ''; if (file) processFile(file); });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cc-ocr-button';
    button.dataset.menuOcrImport = 'true';
    button.innerHTML = '<span aria-hidden="true">▣</span> Importar carta (foto/PDF)';
    button.addEventListener('click', () => input.click());
    actions.prepend(button);
    actions.appendChild(input);
    refreshGroupedMenu();
  }

  let scheduled = false;
  const scheduleInstall = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; installButton(); });
  };
  const observer = new MutationObserver(scheduleInstall);
  observer.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleInstall, { once:true });
  else scheduleInstall();
})();