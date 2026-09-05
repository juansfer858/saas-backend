'use strict';

const MARKER = 'VANTIX_RESTAURANT_PRINT_TEMPLATE_EDITOR_V2';

function browserInstaller() {
  'use strict';
  const MARKER = 'VANTIX_RESTAURANT_PRINT_TEMPLATE_EDITOR_V2';
  if (window[MARKER]) return;
  window[MARKER] = true;

  const SESSION_KEY = 'vantixgc_core_session_v1';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) return;
  if (!['ADMIN', 'SUPER_ADMIN'].includes(String(session.user?.rol || '').toUpperCase())) return;

  const $ = (q, root = document) => root.querySelector(q);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));

  async function api(path, options = {}) {
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

  function ensureStyles() {
    if ($('#restaurantPrintTemplateEditorStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantPrintTemplateEditorStyles';
    style.textContent = `
      .rpt-overlay[hidden]{display:none!important}.rpt-overlay{position:fixed;inset:0;z-index:2200;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:18px;backdrop-filter:blur(3px)}
      .rpt-panel{width:min(1080px,100%);max-height:calc(100dvh - 36px);overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 80px rgba(15,23,42,.28);color:#0f172a}
      .rpt-head{position:sticky;top:0;z-index:4;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid #e2e8f0;background:#fff}.rpt-head h2{margin:0;font-size:21px}.rpt-head p{margin:3px 0 0;color:#64748b;font-size:12px}.rpt-close{width:40px;height:40px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font-size:23px;cursor:pointer}
      .rpt-body{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(300px,.95fr);gap:16px;padding:18px}.rpt-card{border:1px solid #e2e8f0;border-radius:14px;padding:14px;background:#fff}.rpt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.rpt-field{display:grid;gap:5px;font-size:12px;font-weight:800;color:#334155}.rpt-field select{min-height:40px;border:1px solid #cbd5e1;border-radius:9px;padding:0 10px;background:#fff;color:#0f172a}.rpt-checks{display:grid;gap:8px;margin-top:12px}.rpt-check{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:750;color:#334155}.rpt-check input{width:18px;height:18px}
      .rpt-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}.rpt-btn{min-height:40px;border:0;border-radius:9px;padding:0 14px;font-weight:850;cursor:pointer}.rpt-btn.primary{background:#ea580c;color:#fff}.rpt-btn.secondary{background:#f1f5f9;color:#334155;border:1px solid #cbd5e1}.rpt-message{min-height:20px;margin-top:10px;font-size:12px;font-weight:750}.rpt-ok{color:#166534}.rpt-error{color:#b91c1c}
      .rpt-preview-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.rpt-preview-head b{font-size:13px}.rpt-preview-head select{min-height:36px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:0 9px}.rpt-paper{margin:0 auto;padding:16px 10px;box-sizing:border-box;max-width:100%;background:#fffdf7;border:1px solid #cbd5e1;box-shadow:0 7px 20px rgba(15,23,42,.08);font:700 13px/1.38 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;color:#111827;overflow:auto}.rpt-paper[data-paper="58"]{width:calc(32ch + 22px)}.rpt-paper[data-paper="80"]{width:calc(48ch + 22px)}.rpt-note{margin-top:10px;color:#64748b;font-size:11px;line-height:1.45}
      @media(max-width:760px){.rpt-overlay{padding:0}.rpt-panel{width:100%;max-height:100dvh;height:100dvh;border-radius:0}.rpt-body{grid-template-columns:1fr;padding:12px}.rpt-grid{grid-template-columns:1fr 1fr}.rpt-head{padding:12px}.rpt-paper{font-size:12px}}
      @media(max-width:420px){.rpt-grid{grid-template-columns:1fr}.rpt-body{gap:10px}.rpt-card{padding:11px}}
    `;
    document.head.appendChild(style);
  }

  function alignText(value, width, alignment) {
    const label = String(value || '');
    if (alignment !== 'CENTER' || label.length >= width) return label;
    return ' '.repeat(Math.max(0, Math.floor((width - label.length) / 2))) + label;
  }

  function separator(width, style) {
    if (style === 'NONE') return '';
    return (style === 'SINGLE' ? '-' : '=').repeat(width);
  }

  function previewText(config, paper) {
    const width = paper === '58' ? 32 : 48;
    const lines = [];
    const sep = separator(width, config.separatorStyle);
    lines.push(alignText('MESA 1', width, 'CENTER'));
    lines.push(alignText('COCINA', width, 'CENTER'));
    if (sep) lines.push(sep);
    if (config.showTopTime) {
      lines.push(alignText('12:04 p. m.', width, 'CENTER'));
      if (sep) lines.push(sep);
    }
    lines.push('');
    lines.push(alignText('2 x HAMBURGUESA ESPECIAL', width, config.itemAlign));
    lines.push(alignText('*** SIN CEBOLLA ***', width, config.noteAlign));
    if (config.showSeat) lines.push(alignText('>>> PERSONA 1 <<<', width, config.seatAlign));
    for (let i = 0; i < Number(config.blankLinesBetweenItems || 0); i += 1) lines.push('');
    lines.push(alignText('1 x PAPAS GRANDES', width, config.itemAlign));
    if (sep) { lines.push(''); lines.push(sep); }
    if (config.showTrace) lines.push(alignText('COMANDA A1B2C3D4', width, 'CENTER'));
    if (config.showBottomDateTime) lines.push(alignText('05/09/2026 · 12:04 p. m.', width, 'CENTER'));
    return lines.join('\n');
  }

  function formValue(panel) {
    return {
      itemAlign: $('#rptItemAlign', panel).value,
      noteAlign: $('#rptNoteAlign', panel).value,
      seatAlign: $('#rptSeatAlign', panel).value,
      headerSize: $('#rptHeaderSize', panel).value,
      itemSize: $('#rptItemSize', panel).value,
      noteSize: $('#rptNoteSize', panel).value,
      separatorStyle: $('#rptSeparator', panel).value,
      blankLinesBetweenItems: Number($('#rptSpacing', panel).value || 0),
      showTopTime: $('#rptTopTime', panel).checked,
      showBottomDateTime: $('#rptBottomTime', panel).checked,
      showTrace: $('#rptTrace', panel).checked,
      showSeat: $('#rptSeat', panel).checked
    };
  }

  function fillForm(panel, config) {
    const set = (id, value) => { const node = $(id, panel); if (node) node.value = value; };
    set('#rptItemAlign', config.itemAlign); set('#rptNoteAlign', config.noteAlign); set('#rptSeatAlign', config.seatAlign);
    set('#rptHeaderSize', config.headerSize); set('#rptItemSize', config.itemSize); set('#rptNoteSize', config.noteSize);
    set('#rptSeparator', config.separatorStyle); set('#rptSpacing', config.blankLinesBetweenItems);
    $('#rptTopTime', panel).checked = Boolean(config.showTopTime);
    $('#rptBottomTime', panel).checked = Boolean(config.showBottomDateTime);
    $('#rptTrace', panel).checked = Boolean(config.showTrace);
    $('#rptSeat', panel).checked = Boolean(config.showSeat);
  }

  function renderPreview(panel) {
    const paper = $('#rptPaperSize', panel)?.value || '80';
    const preview = $('#rptPreview', panel);
    if (!preview) return;
    preview.dataset.paper = paper;
    preview.textContent = previewText(formValue(panel), paper);
  }

  function ensureOverlay() {
    ensureStyles();
    let overlay = $('#restaurantPrintTemplateOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'restaurantPrintTemplateOverlay';
    overlay.className = 'rpt-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `<section class="rpt-panel" role="dialog" aria-modal="true" aria-labelledby="rptTitle">
      <header class="rpt-head"><div><h2 id="rptTitle">Plantillas de impresión</h2><p>Comandas de Cocina · Barra · Postres. Caja y documentos fiscales no cambian aquí.</p></div><button class="rpt-close" type="button" data-rpt-close aria-label="Cerrar">×</button></header>
      <div class="rpt-body"><section class="rpt-card"><div class="rpt-grid">
        <label class="rpt-field">Alineación del producto<select id="rptItemAlign"><option value="CENTER">Centrado</option><option value="LEFT">Izquierda</option></select></label>
        <label class="rpt-field">Alineación de notas<select id="rptNoteAlign"><option value="CENTER">Centradas</option><option value="LEFT">Izquierda</option></select></label>
        <label class="rpt-field">Alineación de persona<select id="rptSeatAlign"><option value="CENTER">Centrada</option><option value="LEFT">Izquierda</option></select></label>
        <label class="rpt-field">Tamaño encabezado<select id="rptHeaderSize"><option value="DOUBLE">Grande</option><option value="NORMAL">Normal</option></select></label>
        <label class="rpt-field">Tamaño productos<select id="rptItemSize"><option value="TALL">Alto</option><option value="DOUBLE">Muy grande</option><option value="NORMAL">Normal</option></select></label>
        <label class="rpt-field">Tamaño notas<select id="rptNoteSize"><option value="TALL">Alto</option><option value="DOUBLE">Muy grande</option><option value="NORMAL">Normal</option></select></label>
        <label class="rpt-field">Separadores<select id="rptSeparator"><option value="DOUBLE">Doble =====</option><option value="SINGLE">Simple -----</option><option value="NONE">Sin separador</option></select></label>
        <label class="rpt-field">Espacio entre productos<select id="rptSpacing"><option value="0">Sin línea extra</option><option value="1">1 línea</option><option value="2">2 líneas</option></select></label>
      </div><div class="rpt-checks">
        <label class="rpt-check"><input id="rptTopTime" type="checkbox"> Mostrar hora debajo del encabezado</label>
        <label class="rpt-check"><input id="rptBottomTime" type="checkbox"> Mostrar fecha y hora al final</label>
        <label class="rpt-check"><input id="rptTrace" type="checkbox"> Mostrar código de comanda</label>
        <label class="rpt-check"><input id="rptSeat" type="checkbox"> Mostrar persona / puesto</label>
      </div><div class="rpt-actions"><button id="rptSave" class="rpt-btn primary" type="button">Guardar plantilla</button><button id="rptReset" class="rpt-btn secondary" type="button">Restaurar diseño recomendado</button></div><div id="rptMessage" class="rpt-message"></div></section>
      <aside class="rpt-card"><div class="rpt-preview-head"><b>Vista previa térmica</b><select id="rptPaperSize"><option value="80">80 mm</option><option value="58">58 mm</option></select></div><pre id="rptPreview" class="rpt-paper" data-paper="80"></pre><div id="rptSource" class="rpt-note"></div><div class="rpt-note">La vista previa usa 48 columnas para 80 mm y 32 columnas para 58 mm. La impresora física conserva su centrado ESC/POS real.</div></aside></div>
    </section>`;
    document.body.appendChild(overlay);
    $('[data-rpt-close]', overlay).addEventListener('click', () => { overlay.hidden = true; });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.hidden = true; });
    overlay.addEventListener('input', () => renderPreview(overlay));
    overlay.addEventListener('change', () => renderPreview(overlay));
    $('#rptSave', overlay).addEventListener('click', async () => {
      const button = $('#rptSave', overlay); const message = $('#rptMessage', overlay); button.disabled = true;
      try {
        const saved = await api('/api/v1/restaurante/plantilla-impresion', { method:'PUT', body:JSON.stringify(formValue(overlay)) });
        fillForm(overlay, saved); renderPreview(overlay); $('#rptSource', overlay).textContent = 'Plantilla propia de este restaurante · se aplicará a las próximas comandas.'; message.innerHTML = '<span class="rpt-ok">✓ Plantilla guardada.</span>';
      } catch (error) { message.innerHTML = `<span class="rpt-error">${esc(error.message)}</span>`; }
      finally { button.disabled = false; }
    });
    $('#rptReset', overlay).addEventListener('click', async () => {
      const button = $('#rptReset', overlay); const message = $('#rptMessage', overlay); button.disabled = true;
      try {
        const restored = await api('/api/v1/restaurante/plantilla-impresion/restaurar', { method:'POST', body:JSON.stringify({}) });
        fillForm(overlay, restored); renderPreview(overlay); $('#rptSource', overlay).textContent = 'Diseño recomendado de VantixGC.'; message.innerHTML = '<span class="rpt-ok">✓ Diseño recomendado restaurado.</span>';
      } catch (error) { message.innerHTML = `<span class="rpt-error">${esc(error.message)}</span>`; }
      finally { button.disabled = false; }
    });
    return overlay;
  }

  async function openEditor() {
    const overlay = ensureOverlay(); overlay.hidden = false; const message = $('#rptMessage', overlay); message.textContent = 'Cargando plantilla…';
    try {
      const config = await api('/api/v1/restaurante/plantilla-impresion');
      fillForm(overlay, config); renderPreview(overlay); $('#rptSource', overlay).textContent = config.source === 'TENANT_OVERRIDE' ? 'Plantilla propia de este restaurante.' : 'Diseño recomendado de VantixGC.'; message.textContent = '';
    } catch (error) { message.innerHTML = `<span class="rpt-error">${esc(error.message)}</span>`; }
  }

  function injectAction() {
    const actions = document.querySelector('#ccDashboard .cc-actions');
    if (!actions || actions.querySelector('[data-cc-print-template]')) return false;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'cc-action'; button.dataset.ccPrintTemplate = 'true'; button.textContent = '🧾 Plantillas de impresión'; button.addEventListener('click', openEditor); actions.appendChild(button); return true;
  }

  function scheduleInjection(frames = 90) {
    let left = frames;
    const tick = () => { if (injectAction()) return; left -= 1; if (left > 0) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  document.addEventListener('click', () => requestAnimationFrame(() => scheduleInjection(8)), true);
  window.addEventListener('popstate', () => scheduleInjection(30));
  window.addEventListener('pageshow', () => scheduleInjection(60));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scheduleInjection(120), { once:true });
  else scheduleInjection(120);
}

const browserRuntime = `(${browserInstaller.toString()})();`;

function installPrintTemplateEditorRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-control-center.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n;${browserRuntime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Print-Template-Editor', 'v2-centering');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, browserRuntime, installPrintTemplateEditorRuntime };
