(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const CONTROL_PATH = '/app/centro-de-control';
  const CONFIG_VIEW = 'config';
  const FORMAT_OPTIONS = [
    ['TERMICA_58', 'Térmica 58 mm'],
    ['TERMICA_80', 'Térmica 80 mm'],
    ['CARTA', 'Carta'],
    ['MEDIA_CARTA', 'Media carta']
  ];
  const QUEUE_OPTIONS = [
    ['COCINA', 'Pedidos de cocina'],
    ['BARRA', 'Bebidas / barra'],
    ['POSTRES', 'Postres']
  ];
  const MODE_OPTIONS = [
    ['KDS', 'Pantalla KDS'],
    ['IMPRESORA', 'Sólo impresora'],
    ['AMBOS', 'KDS + impresora']
  ];
  const GENERAL_OUTPUTS = [
    ['CAJA', 'Caja'],
    ['DOCUMENTOS', 'Documentos generales']
  ];

  const state = { loaded:false, loading:false, stations:[], printers:[], config:null, observer:null };

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function isConfigView() {
    return location.pathname === CONTROL_PATH && new URLSearchParams(location.search).get('view') === CONFIG_VIEW;
  }

  function canManage() {
    const role = String(session()?.user?.rol || '').toUpperCase();
    return ['ADMIN','SUPER_ADMIN','ADMINISTRADOR'].includes(role);
  }

  function h(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function api(path, options = {}) {
    const s = session();
    if (!s?.token || !s?.subdomain) throw new Error('Sesión no disponible');
    const response = await fetch(path, {
      ...options,
      cache:'no-store',
      headers:{
        Authorization:`Bearer ${s.token}`,
        'x-tenant-subdomain':s.subdomain,
        ...(options.body ? { 'Content-Type':'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function ensureStyles() {
    if (document.querySelector('#restaurantNativeConfigStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantNativeConfigStyles';
    style.textContent = `
      #restaurantNativeConfig{display:grid;gap:16px;max-width:1280px;margin:0 auto;padding:2px 0 28px}
      #restaurantNativeConfig .rnc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:4px 0 2px}
      #restaurantNativeConfig .rnc-head h1{margin:4px 0 5px;font-size:30px;line-height:1.05}
      #restaurantNativeConfig .rnc-head p{margin:0;color:var(--muted,#64748b);font-size:13px}
      #restaurantNativeConfig .rnc-back{border:1px solid #d7dee6;background:#fff;border-radius:12px;min-height:42px;padding:0 14px;font-weight:800;cursor:pointer}
      #restaurantNativeConfig .rnc-panel{background:#fff;border:1px solid #dfe5eb;border-radius:18px;box-shadow:0 8px 24px rgba(15,23,42,.05);overflow:hidden}
      #restaurantNativeConfig .rnc-panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:18px 18px 14px;border-bottom:1px solid #edf1f4}
      #restaurantNativeConfig .rnc-panel-head h2{margin:0;font-size:19px}
      #restaurantNativeConfig .rnc-panel-head p{margin:5px 0 0;color:#66727d;font-size:12px;line-height:1.45}
      #restaurantNativeConfig .rnc-btn{border:1px solid #cfd7df;background:#fff;border-radius:10px;min-height:38px;padding:0 12px;font-weight:800;cursor:pointer}
      #restaurantNativeConfig .rnc-btn.primary{background:#137a53;border-color:#137a53;color:#fff}
      #restaurantNativeConfig .rnc-btn.danger{color:#a12d2d;border-color:#efc5c5}
      #restaurantNativeConfig .rnc-body{padding:14px 18px 18px}
      #restaurantNativeConfig .rnc-empty{padding:18px;border:1px dashed #cfd8df;border-radius:14px;color:#66727d;background:#fafcfd}
      #restaurantNativeConfig table{width:100%;border-collapse:collapse;font-size:12px}
      #restaurantNativeConfig th{text-align:left;padding:10px 8px;color:#66727d;border-bottom:1px solid #e8edf1}
      #restaurantNativeConfig td{padding:11px 8px;border-bottom:1px solid #eef2f5;vertical-align:middle}
      #restaurantNativeConfig .rnc-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
      #restaurantNativeConfig .rnc-pill{display:inline-flex;padding:4px 8px;border-radius:999px;background:#edf7f2;color:#176246;font-weight:800;font-size:10px}
      #restaurantNativeConfig .rnc-pill.off{background:#f2f4f6;color:#6d7780}
      #restaurantNativeConfig .rnc-format{display:grid;grid-template-columns:minmax(240px,420px) auto;gap:10px;align-items:end;margin-bottom:14px}
      #restaurantNativeConfig label{display:grid;gap:6px;font-size:12px;font-weight:800}
      #restaurantNativeConfig select,#restaurantNativeConfig input{min-height:40px;border:1px solid #cfd7df;border-radius:10px;padding:0 10px;background:#fff;color:#17212b}
      .rnc-dialog{border:0;border-radius:18px;padding:0;width:min(560px,calc(100vw - 24px));box-shadow:0 28px 80px rgba(15,23,42,.3)}
      .rnc-dialog::backdrop{background:rgba(15,23,42,.45)}
      .rnc-dialog form{display:grid;gap:14px;padding:20px}
      .rnc-dialog h2{margin:0}
      .rnc-dialog .rnc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .rnc-dialog .rnc-note{padding:11px 12px;border-radius:10px;background:#f4f8f6;color:#466055;font-size:11px;line-height:1.4}
      .rnc-dialog .rnc-error{color:#a12d2d;font-size:12px;font-weight:700}
      .rnc-dialog .rnc-dialog-actions{display:flex;justify-content:flex-end;gap:8px}
      @media(max-width:720px){#restaurantNativeConfig .rnc-head,#restaurantNativeConfig .rnc-panel-head{display:grid}#restaurantNativeConfig .rnc-format,.rnc-dialog .rnc-grid{grid-template-columns:1fr}#restaurantNativeConfig .rnc-actions{justify-content:flex-start}#restaurantNativeConfig table{min-width:720px}#restaurantNativeConfig .rnc-table-wrap{overflow:auto}}
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    const main = document.querySelector('.ri-main');
    if (!main) return null;
    let root = document.querySelector('#restaurantNativeConfig');
    if (!root) {
      root = document.createElement('section');
      root.id = 'restaurantNativeConfig';
      main.prepend(root);
    }
    for (const child of [...main.children]) {
      if (child === root) continue;
      if (!child.hidden) child.hidden = true;
    }
    root.hidden = false;
    return root;
  }

  function queueLabel(value) { return QUEUE_OPTIONS.find(([key]) => key === value)?.[1] || value || '—'; }
  function modeLabel(value) { return MODE_OPTIONS.find(([key]) => key === value)?.[1] || value || '—'; }
  function formatLabel(value) { return FORMAT_OPTIONS.find(([key]) => key === value)?.[1] || value || 'Formato general'; }
  function stationByRole(role) { return state.stations.find((station) => station.printerRole === role) || null; }
  function roleLabel(role) {
    return stationByRole(role)?.name || GENERAL_OUTPUTS.find(([key]) => key === role)?.[1] || role || '—';
  }

  function optionList(options, selected, placeholder = '') {
    const first = placeholder ? `<option value="">${h(placeholder)}</option>` : '';
    return first + options.map(([value,label]) => `<option value="${h(value)}" ${value === selected ? 'selected' : ''}>${h(label)}</option>`).join('');
  }

  function destinationOptions(selected) {
    const stationOptions = state.stations
      .filter((station) => station.active && ['IMPRESORA','AMBOS'].includes(station.mode))
      .map((station) => [station.printerRole, station.name]);
    const options = [['', 'Selecciona un destino…'], ...GENERAL_OUTPUTS, ...stationOptions];
    if (selected && !options.some(([value]) => value === selected)) options.push([selected, `Destino anterior · ${selected}`]);
    return options.map(([value,label]) => `<option value="${h(value)}" ${value === selected ? 'selected' : ''}>${h(label)}</option>`).join('');
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    const root = ensureRoot();
    if (!root) { state.loading = false; return; }
    root.innerHTML = '<div class="rnc-empty">Cargando configuración del restaurante…</div>';
    try {
      const [stations, printers, config] = await Promise.all([
        api('/api/v1/impresion/estaciones'),
        api('/api/v1/impresion/impresoras'),
        api('/api/v1/impresion/configuracion')
      ]);
      state.stations = Array.isArray(stations) ? stations : [];
      state.printers = Array.isArray(printers) ? printers : [];
      state.config = config || {};
      state.loaded = true;
      render();
    } catch (error) {
      root.innerHTML = `<div class="rnc-head"><div><div class="ri-eyebrow">RESTAURANTE</div><h1>Configuración</h1></div><button class="rnc-back" data-rnc-back>← Centro de control</button></div><div class="rnc-empty"><b>No fue posible abrir la configuración.</b><br>${h(error.message)}</div>`;
      bindRoot();
    } finally { state.loading = false; }
  }

  function stationRows() {
    if (!state.stations.length) return '<div class="rnc-empty"><b>No hay cocinas ni KDS creados.</b><br>Crea la primera estación sólo cuando el restaurante la necesite.</div>';
    return `<div class="rnc-table-wrap"><table><thead><tr><th>Nombre</th><th>Recibe</th><th>Salida</th><th>Impresoras</th><th>Estado</th><th></th></tr></thead><tbody>${state.stations.map((station) => `<tr><td><b>${h(station.name)}</b></td><td>${h(queueLabel(station.queue))}</td><td>${h(modeLabel(station.mode))}</td><td>${(station.printers || []).length ? (station.printers || []).map((p) => h(p.name)).join('<br>') : '<span style="color:#7a858e">Ninguna</span>'}</td><td><span class="rnc-pill ${station.active ? '' : 'off'}">${station.active ? 'Activa' : 'Inactiva'}</span></td><td><div class="rnc-actions">${station.active && ['IMPRESORA','AMBOS'].includes(station.mode) ? `<button class="rnc-btn" data-rnc-printer-new="${h(station.printerRole)}">+ Impresora</button>` : ''}<button class="rnc-btn" data-rnc-station-edit="${h(station.id)}">Editar</button>${station.active ? `<button class="rnc-btn danger" data-rnc-station-off="${h(station.id)}">Desactivar</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
  }

  function printerRows() {
    if (!state.printers.length) return '<div class="rnc-empty">No hay impresoras configuradas.</div>';
    return `<div class="rnc-table-wrap"><table><thead><tr><th>Nombre</th><th>Destino</th><th>Conexión</th><th>Formato</th><th>Estado</th><th></th></tr></thead><tbody>${state.printers.map((printer) => `<tr><td><b>${h(printer.name)}</b></td><td>${h(roleLabel(printer.role))}</td><td>${printer.transport === 'LAN' ? `${h(printer.host || '—')}:${h(printer.port || '—')}` : 'Navegador'}</td><td>${h(formatLabel(printer.format || state.config?.defaultFormat))}</td><td><span class="rnc-pill ${printer.active ? '' : 'off'}">${printer.active ? 'Activa' : 'Inactiva'}</span></td><td><div class="rnc-actions"><button class="rnc-btn" data-rnc-printer-edit="${h(printer.id)}">Editar</button><button class="rnc-btn" data-rnc-printer-toggle="${h(printer.id)}">${printer.active ? 'Desactivar' : 'Activar'}</button></div></td></tr>`).join('')}</tbody></table></div>`;
  }

  function render() {
    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = `
      <div class="rnc-head"><div><div class="ri-eyebrow">ADMINISTRACIÓN DEL RESTAURANTE</div><h1>Configuración</h1><p>Cocinas, KDS e impresoras. Esta pantalla es independiente de Parametrización Contable.</p></div><button class="rnc-back" data-rnc-back>← Centro de control</button></div>
      <section class="rnc-panel"><div class="rnc-panel-head"><div><h2>Áreas de preparación / KDS</h2><p>No se crea ninguna por defecto. Tú defines las estaciones reales del restaurante.</p></div><button class="rnc-btn primary" data-rnc-station-new>+ Nueva estación</button></div><div class="rnc-body">${stationRows()}</div></section>
      <section class="rnc-panel"><div class="rnc-panel-head"><div><h2>Impresoras del restaurante</h2><p>Las impresoras pueden ir a una estación creada, a Caja o a Documentos.</p></div><button class="rnc-btn primary" data-rnc-printer-new="">+ Nueva impresora</button></div><div class="rnc-body"><div class="rnc-format"><label>Formato general<select id="rncDefaultFormat">${optionList(FORMAT_OPTIONS, state.config?.defaultFormat || 'TERMICA_80')}</select></label><button class="rnc-btn" data-rnc-format-save>Guardar formato</button></div>${printerRows()}</div></section>`;
    bindRoot();
  }

  function bindRoot() {
    const root = document.querySelector('#restaurantNativeConfig');
    if (!root) return;
    root.querySelectorAll('[data-rnc-back]').forEach((button) => button.addEventListener('click', () => { location.href = CONTROL_PATH; }));
    root.querySelector('[data-rnc-station-new]')?.addEventListener('click', () => stationDialog());
    root.querySelectorAll('[data-rnc-station-edit]').forEach((button) => button.addEventListener('click', () => stationDialog(button.dataset.rncStationEdit)));
    root.querySelectorAll('[data-rnc-station-off]').forEach((button) => button.addEventListener('click', () => deactivateStation(button.dataset.rncStationOff)));
    root.querySelectorAll('[data-rnc-printer-new]').forEach((button) => button.addEventListener('click', () => printerDialog('', button.dataset.rncPrinterNew || '')));
    root.querySelectorAll('[data-rnc-printer-edit]').forEach((button) => button.addEventListener('click', () => printerDialog(button.dataset.rncPrinterEdit)));
    root.querySelectorAll('[data-rnc-printer-toggle]').forEach((button) => button.addEventListener('click', () => togglePrinter(button.dataset.rncPrinterToggle)));
    root.querySelector('[data-rnc-format-save]')?.addEventListener('click', saveDefaultFormat);
  }

  function openDialog(markup, id) {
    document.getElementById(id)?.remove();
    document.body.insertAdjacentHTML('beforeend', markup);
    const dialog = document.getElementById(id);
    dialog?.showModal?.();
    return dialog;
  }

  function stationDialog(id = '') {
    const current = id ? state.stations.find((row) => row.id === id) : null;
    const dialog = openDialog(`<dialog class="rnc-dialog" id="rncStationDialog"><form method="dialog" id="rncStationForm"><h2>${current ? 'Editar estación' : 'Nueva estación'}</h2><label>Nombre<input id="rncStationName" maxlength="80" value="${h(current?.name || '')}" placeholder="Ej. Cocina caliente" required></label><div class="rnc-grid"><label>Qué pedidos recibe<select id="rncStationQueue" required>${optionList(QUEUE_OPTIONS, current?.queue || '', 'Selecciona…')}</select></label><label>Cómo trabaja<select id="rncStationMode" required>${optionList(MODE_OPTIONS, current?.mode || '', 'Selecciona…')}</select></label></div><div class="rnc-note">Crear una estación no crea una impresora. La impresora se agrega después si la estación la necesita.</div><div class="rnc-error" id="rncStationError"></div><div class="rnc-dialog-actions"><button class="rnc-btn" value="cancel">Cancelar</button><button class="rnc-btn primary" type="submit" value="default">Guardar estación</button></div></form></dialog>`, 'rncStationDialog');
    const form = dialog?.querySelector('#rncStationForm');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = dialog.querySelector('#rncStationError');
      const payload = {
        name:dialog.querySelector('#rncStationName').value.trim(),
        queue:dialog.querySelector('#rncStationQueue').value,
        mode:dialog.querySelector('#rncStationMode').value,
        active:current ? current.active !== false : true
      };
      try {
        await api(current ? `/api/v1/impresion/estaciones/${current.id}` : '/api/v1/impresion/estaciones', { method:current ? 'PATCH' : 'POST', body:JSON.stringify(payload) });
        dialog.close(); dialog.remove(); state.loaded = false; await load(); window.RestaurantTheme?.refreshProductionStations?.();
      } catch (error) { errorBox.textContent = error.message; }
    });
  }

  async function deactivateStation(id) {
    if (!confirm('¿Desactivar esta estación? Dejará de recibir nuevos destinos operativos.')) return;
    try { await api(`/api/v1/impresion/estaciones/${id}`, { method:'DELETE' }); state.loaded = false; await load(); window.RestaurantTheme?.refreshProductionStations?.(); }
    catch (error) { alert(error.message); }
  }

  function printerDialog(id = '', initialRole = '') {
    const current = id ? state.printers.find((row) => row.id === id) : null;
    const role = current?.role || initialRole || '';
    const transport = current?.transport || 'LAN';
    const dialog = openDialog(`<dialog class="rnc-dialog" id="rncPrinterDialog"><form method="dialog" id="rncPrinterForm"><h2>${current ? 'Editar impresora' : 'Nueva impresora'}</h2><label>Nombre<input id="rncPrinterName" maxlength="100" value="${h(current?.name || '')}" placeholder="Ej. Térmica cocina caliente" required></label><div class="rnc-grid"><label>Destino<select id="rncPrinterRole" required>${destinationOptions(role)}</select></label><label>Conexión<select id="rncPrinterTransport"><option value="LAN" ${transport === 'LAN' ? 'selected' : ''}>LAN / Red local</option><option value="NAVEGADOR" ${transport === 'NAVEGADOR' ? 'selected' : ''}>Navegador</option></select></label></div><div class="rnc-grid" id="rncLanFields"><label>IP o host<input id="rncPrinterHost" maxlength="200" value="${h(current?.host || '')}" placeholder="Ej. 192.168.1.80"></label><label>Puerto<input id="rncPrinterPort" type="number" min="1" max="65535" value="${h(current?.port || 9100)}"></label></div><div class="rnc-grid"><label>Formato<select id="rncPrinterFormat"><option value="">Usar formato general</option>${optionList(FORMAT_OPTIONS, current?.format || '')}</select></label><label style="display:flex;align-items:center;gap:8px;padding-top:24px"><input id="rncPrinterActive" type="checkbox" ${current ? (current.active ? 'checked' : '') : 'checked'} style="min-height:auto"> Impresora activa</label></div><div class="rnc-note">La impresión operativa del restaurante no depende de DIAN.</div><div class="rnc-error" id="rncPrinterError"></div><div class="rnc-dialog-actions"><button class="rnc-btn" value="cancel">Cancelar</button><button class="rnc-btn primary" type="submit" value="default">Guardar impresora</button></div></form></dialog>`, 'rncPrinterDialog');
    const transportField = dialog?.querySelector('#rncPrinterTransport');
    const syncLan = () => {
      const isLan = transportField?.value === 'LAN';
      const fields = dialog?.querySelector('#rncLanFields');
      if (fields) fields.style.display = isLan ? '' : 'none';
    };
    transportField?.addEventListener('change', syncLan); syncLan();
    dialog?.querySelector('#rncPrinterForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = dialog.querySelector('#rncPrinterError');
      const transportValue = dialog.querySelector('#rncPrinterTransport').value;
      const payload = {
        ...(current?.id ? { id:current.id } : {}),
        name:dialog.querySelector('#rncPrinterName').value.trim(),
        role:dialog.querySelector('#rncPrinterRole').value,
        transport:transportValue,
        host:transportValue === 'LAN' ? dialog.querySelector('#rncPrinterHost').value.trim() : null,
        port:transportValue === 'LAN' ? Number(dialog.querySelector('#rncPrinterPort').value || 9100) : null,
        format:dialog.querySelector('#rncPrinterFormat').value || null,
        active:dialog.querySelector('#rncPrinterActive').checked
      };
      try { await api('/api/v1/impresion/impresoras', { method:'POST', body:JSON.stringify(payload) }); dialog.close(); dialog.remove(); state.loaded = false; await load(); }
      catch (error) { errorBox.textContent = error.message; }
    });
  }

  async function togglePrinter(id) {
    const printer = state.printers.find((row) => row.id === id);
    if (!printer) return;
    const payload = {
      id:printer.id,
      name:printer.name,
      transport:printer.transport,
      role:printer.role || 'DOCUMENTOS',
      host:printer.transport === 'LAN' ? printer.host : null,
      port:printer.transport === 'LAN' ? Number(printer.port || 9100) : null,
      format:printer.format || null,
      active:!printer.active
    };
    try { await api('/api/v1/impresion/impresoras', { method:'POST', body:JSON.stringify(payload) }); state.loaded = false; await load(); }
    catch (error) { alert(error.message); }
  }

  async function saveDefaultFormat() {
    const field = document.querySelector('#rncDefaultFormat');
    if (!field) return;
    try { await api('/api/v1/impresion/configuracion', { method:'PUT', body:JSON.stringify({ defaultFormat:field.value }) }); state.loaded = false; await load(); }
    catch (error) { alert(error.message); }
  }

  function apply() {
    if (!isConfigView()) return;
    ensureStyles();
    const root = ensureRoot();
    if (!root) return;
    if (!canManage()) {
      root.innerHTML = '<div class="rnc-empty"><b>Configuración restringida.</b><br>Esta pantalla requiere un usuario Administrador.</div>';
      return;
    }
    if (!state.loaded && !state.loading) load();
  }

  function startObserver() {
    if (state.observer || !document.body) return;
    state.observer = new MutationObserver(() => {
      if (!isConfigView()) return;
      requestAnimationFrame(apply);
    });
    state.observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden'] });
  }

  window.RestaurantAdminConfig = { show:apply, reload:load };
  const start = () => { apply(); startObserver(); setTimeout(apply, 0); setTimeout(apply, 250); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true }); else start();
})();
