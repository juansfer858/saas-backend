(() => {
  'use strict';

  const previousViewConfig = window.viewConfig;
  if (typeof previousViewConfig !== 'function' || window.__vantixRestaurantPrinterConfigLoaded) return;
  window.__vantixRestaurantPrinterConfigLoaded = true;

  const state = { printers: [], stations: [], config: null };
  const GENERAL_OUTPUTS = [
    ['CAJA', 'Caja'],
    ['DOCUMENTOS', 'Documentos generales']
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
  const FORMAT_OPTIONS = [
    ['TERMICA_58', 'Térmica 58 mm'],
    ['TERMICA_80', 'Térmica 80 mm'],
    ['CARTA', 'Carta'],
    ['MEDIA_CARTA', 'Media carta']
  ];

  function h(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function callApi(path, options) {
    if (typeof window.api !== 'function') return Promise.reject(new Error('API del panel no disponible'));
    return window.api(path, options);
  }

  function optionList(options, selected, placeholder = '') {
    const first = placeholder ? `<option value="">${h(placeholder)}</option>` : '';
    return first + options.map(([value, label]) => `<option value="${h(value)}" ${value === selected ? 'selected' : ''}>${h(label)}</option>`).join('');
  }

  function queueLabel(value) { return QUEUE_OPTIONS.find(([key]) => key === value)?.[1] || value || '—'; }
  function modeLabel(value) { return MODE_OPTIONS.find(([key]) => key === value)?.[1] || value || '—'; }
  function formatLabel(value) { return FORMAT_OPTIONS.find(([key]) => key === value)?.[1] || value || 'Formato general'; }
  function stationByRole(role) { return state.stations.find((station) => station.printerRole === role) || null; }
  function roleLabel(role) {
    const station = stationByRole(role);
    if (station) return station.name;
    return GENERAL_OUTPUTS.find(([key]) => key === role)?.[1] || role || '—';
  }

  window.viewConfig = function viewConfigWithRestaurantPrinters() {
    const base = previousViewConfig();
    setTimeout(() => window.hydrateRestaurantPrinterConfig?.(), 0);
    return `${base}
      <div class="panel" id="restaurantStationsPanel">
        <div class="panel-head">
          <div>
            <h2 style="margin:0">Áreas de preparación / KDS</h2>
            <span class="muted">Créelas manualmente según el restaurante. VantixGC no crea cocinas ni KDS por defecto.</span>
          </div>
          <button class="btn primary" type="button" onclick="openRestaurantStation()">+ Nueva estación</button>
        </div>
        <div id="restaurantStationsBody"><div class="loading">Cargando estaciones…</div></div>
      </div>
      <div class="panel" id="restaurantPrinterConfigPanel">
        <div class="panel-head">
          <div>
            <h2 style="margin:0">Impresoras del restaurante</h2>
            <span class="muted">Asocia impresoras sólo a estaciones que hayas creado, o a Caja / Documentos.</span>
          </div>
          <button class="btn primary" type="button" onclick="openRestaurantPrinter()">+ Nueva impresora</button>
        </div>
        <div id="restaurantPrinterConfigBody"><div class="loading">Cargando impresoras…</div></div>
      </div>`;
  };

  window.hydrateRestaurantPrinterConfig = async function hydrateRestaurantPrinterConfig() {
    const stationRoot = document.getElementById('restaurantStationsBody');
    const printerRoot = document.getElementById('restaurantPrinterConfigBody');
    if (!stationRoot && !printerRoot) return;
    if (stationRoot) stationRoot.innerHTML = '<div class="loading">Cargando estaciones…</div>';
    if (printerRoot) printerRoot.innerHTML = '<div class="loading">Cargando impresoras…</div>';
    try {
      const [configResponse, printersResponse, stationsResponse] = await Promise.all([
        callApi('/api/v1/impresion/configuracion'),
        callApi('/api/v1/impresion/impresoras'),
        callApi('/api/v1/impresion/estaciones')
      ]);
      state.config = configResponse?.data || {};
      state.printers = Array.isArray(printersResponse?.data) ? printersResponse.data : [];
      state.stations = Array.isArray(stationsResponse?.data) ? stationsResponse.data : [];
      renderRestaurantStations();
      renderRestaurantPrinters();
    } catch (error) {
      if (stationRoot) stationRoot.innerHTML = `<div class="error">${h(error.message)}</div>`;
      if (printerRoot) printerRoot.innerHTML = `<div class="error">${h(error.message)}</div>`;
    }
  };

  function renderRestaurantStations() {
    const root = document.getElementById('restaurantStationsBody');
    if (!root) return;
    const rows = state.stations;
    if (!rows.length) {
      root.innerHTML = '<div class="empty"><strong>No hay cocinas ni KDS creados.</strong><br>Usa “+ Nueva estación” cuando quieras crear la primera, igual que haces con una mesa o una zona.</div>';
      return;
    }
    root.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Nombre</th><th>Recibe</th><th>Salida</th><th>Impresoras</th><th>Estado</th><th></th></tr></thead><tbody>${rows.map((station) => `
      <tr>
        <td><strong>${h(station.name)}</strong></td>
        <td>${h(queueLabel(station.queue))}</td>
        <td>${h(modeLabel(station.mode))}</td>
        <td>${(station.printers || []).length ? (station.printers || []).map((printer) => h(printer.name)).join('<br>') : '<span class="muted">Ninguna</span>'}</td>
        <td>${station.active ? '<span class="badge b-paid">Activa</span>' : '<span class="badge b-partial">Inactiva</span>'}</td>
        <td><div class="actions" style="justify-content:flex-end;margin:0;gap:6px">
          ${station.active && ['IMPRESORA','AMBOS'].includes(station.mode) ? `<button class="btn small" type="button" onclick="openRestaurantPrinter('', '${h(station.printerRole)}')">+ Impresora</button>` : ''}
          <button class="btn small" type="button" onclick="openRestaurantStation('${h(station.id)}')">Editar</button>
          ${station.active ? `<button class="btn small" type="button" onclick="removeRestaurantStation('${h(station.id)}')">Desactivar</button>` : ''}
        </div></td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function renderRestaurantPrinters() {
    const root = document.getElementById('restaurantPrinterConfigBody');
    if (!root) return;
    const printers = state.printers;
    root.innerHTML = `
      <div class="audit-body">
        <div class="grid2" style="align-items:end">
          <div class="field" style="margin:0"><label>Formato general de comprobantes</label><select class="select" id="restaurantDefaultPrintFormat">${optionList(FORMAT_OPTIONS, state.config?.defaultFormat || 'TERMICA_80')}</select></div>
          <div class="actions" style="justify-content:flex-start;margin:0"><button class="btn" type="button" onclick="saveRestaurantDefaultPrintFormat()">Guardar formato</button></div>
        </div>
        <p class="muted" style="margin:10px 0 0">Las térmicas LAN usan el spooler local ESC/POS; el puerto habitual es 9100.</p>
      </div>
      ${printers.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Nombre</th><th>Destino</th><th>Conexión</th><th>Formato</th><th>Estado</th><th></th></tr></thead><tbody>${printers.map((printer) => `
        <tr><td><strong>${h(printer.name)}</strong></td><td>${h(roleLabel(printer.role))}</td><td>${printer.transport === 'LAN' ? `${h(printer.host || '—')}:${h(printer.port || '—')}` : 'Navegador'}</td><td>${h(formatLabel(printer.format || state.config?.defaultFormat))}</td><td>${printer.active ? '<span class="badge b-paid">Activa</span>' : '<span class="badge b-partial">Inactiva</span>'}</td><td><div class="actions" style="justify-content:flex-end;margin:0;gap:6px"><button class="btn small" type="button" onclick="openRestaurantPrinter('${h(printer.id)}')">Editar</button><button class="btn small" type="button" onclick="toggleRestaurantPrinter('${h(printer.id)}')">${printer.active ? 'Desactivar' : 'Activar'}</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No hay impresoras configuradas.</div>'}`;
  }

  window.openRestaurantStation = function openRestaurantStation(id = '') {
    document.getElementById('restaurantStationModal')?.remove();
    const current = id ? state.stations.find((row) => row.id === id) : null;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-back" id="restaurantStationModal"><form class="modal" id="restaurantStationForm"><h2>${current ? 'Editar estación' : 'Nueva estación'}</h2>
      <div class="field"><label>Nombre de la estación</label><input class="input" id="restaurantStationName" maxlength="80" value="${h(current?.name || '')}" placeholder="Ej. Cocina caliente, Barra terraza, KDS principal" required></div>
      <div class="grid2"><div class="field"><label>Qué pedidos recibe</label><select class="select" id="restaurantStationQueue" required>${optionList(QUEUE_OPTIONS, current?.queue || '', 'Selecciona…')}</select></div><div class="field"><label>Cómo trabaja</label><select class="select" id="restaurantStationMode" required>${optionList(MODE_OPTIONS, current?.mode || '', 'Selecciona…')}</select></div></div>
      <div class="notice">Crear una estación no crea una impresora. Si eliges “Sólo impresora” o “KDS + impresora”, la impresora se configura después.</div>
      <div id="restaurantStationError"></div><div class="actions" style="justify-content:flex-end;margin-top:16px"><button class="btn" type="button" onclick="document.getElementById('restaurantStationModal')?.remove()">Cancelar</button><button class="btn primary" type="submit">Guardar estación</button></div></form></div>`);
    document.getElementById('restaurantStationForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = document.getElementById('restaurantStationError');
      if (errorBox) errorBox.innerHTML = '';
      const payload = { name: document.getElementById('restaurantStationName').value.trim(), queue: document.getElementById('restaurantStationQueue').value, mode: document.getElementById('restaurantStationMode').value, active: current ? current.active !== false : true };
      try {
        await callApi(current ? `/api/v1/impresion/estaciones/${current.id}` : '/api/v1/impresion/estaciones', { method: current ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
        document.getElementById('restaurantStationModal')?.remove();
        await window.hydrateRestaurantPrinterConfig();
      } catch (error) { if (errorBox) errorBox.innerHTML = `<div class="error">${h(error.message)}</div>`; }
    });
  };

  window.removeRestaurantStation = async function removeRestaurantStation(id) {
    if (!confirm('¿Desactivar esta estación? Dejará de ser un destino operativo nuevo.')) return;
    try { await callApi(`/api/v1/impresion/estaciones/${id}`, { method:'DELETE' }); await window.hydrateRestaurantPrinterConfig(); }
    catch (error) { alert(error.message); }
  };

  window.saveRestaurantDefaultPrintFormat = async function saveRestaurantDefaultPrintFormat() {
    const field = document.getElementById('restaurantDefaultPrintFormat');
    if (!field) return;
    try { await callApi('/api/v1/impresion/configuracion', { method:'PUT', body:JSON.stringify({ defaultFormat:field.value }) }); await window.hydrateRestaurantPrinterConfig(); }
    catch (error) { alert(error.message); }
  };

  function printerPayload(printer, active) {
    return { id:printer.id, name:printer.name, transport:printer.transport, role:printer.role || 'DOCUMENTOS', host:printer.transport === 'LAN' ? printer.host : null, port:printer.transport === 'LAN' ? Number(printer.port || 9100) : null, format:printer.format || null, active };
  }

  window.toggleRestaurantPrinter = async function toggleRestaurantPrinter(id) {
    const printer = state.printers.find((item) => item.id === id);
    if (!printer) return;
    try { await callApi('/api/v1/impresion/impresoras', { method:'POST', body:JSON.stringify(printerPayload(printer, !printer.active)) }); await window.hydrateRestaurantPrinterConfig(); }
    catch (error) { alert(error.message); }
  };

  function destinationOptions(selected) {
    const printableStations = state.stations.filter((station) => station.active && ['IMPRESORA','AMBOS'].includes(station.mode));
    const options = [['', 'Selecciona un destino…'], ...GENERAL_OUTPUTS, ...printableStations.map((station) => [station.printerRole, station.name])];
    if (selected && !options.some(([value]) => value === selected)) options.push([selected, `Destino anterior · ${selected}`]);
    return options.map(([value, label]) => `<option value="${h(value)}" ${value === selected ? 'selected' : ''}>${h(label)}</option>`).join('');
  }

  window.openRestaurantPrinter = function openRestaurantPrinter(id = '', initialRole = '') {
    document.getElementById('restaurantPrinterModal')?.remove();
    const current = id ? state.printers.find((item) => item.id === id) : null;
    const role = current?.role || initialRole || '';
    const transport = current?.transport || 'LAN';
    const active = current ? current.active !== false : true;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-back" id="restaurantPrinterModal"><form class="modal" id="restaurantPrinterForm"><h2>${current ? 'Editar impresora' : 'Nueva impresora'}</h2>
      <div class="field"><label>Nombre</label><input class="input" id="restaurantPrinterName" maxlength="100" value="${h(current?.name || '')}" placeholder="Ej. Térmica cocina caliente" required></div>
      <div class="grid2"><div class="field"><label>Destino</label><select class="select" id="restaurantPrinterRole" required>${destinationOptions(role)}</select></div><div class="field"><label>Conexión</label><select class="select" id="restaurantPrinterTransport"><option value="LAN" ${transport === 'LAN' ? 'selected' : ''}>LAN / Red local</option><option value="NAVEGADOR" ${transport === 'NAVEGADOR' ? 'selected' : ''}>Navegador</option></select></div></div>
      <div class="grid2" id="restaurantPrinterLanFields"><div class="field"><label>IP o host</label><input class="input" id="restaurantPrinterHost" maxlength="200" value="${h(current?.host || '')}" placeholder="Ej. 192.168.1.80"></div><div class="field"><label>Puerto</label><input class="input" id="restaurantPrinterPort" type="number" min="1" max="65535" value="${h(current?.port || 9100)}"></div></div>
      <div class="grid2"><div class="field"><label>Formato</label><select class="select" id="restaurantPrinterFormat">${optionList([['','Usar formato general'], ...FORMAT_OPTIONS], current?.format || '')}</select></div><div class="field"><label>Estado</label><label style="display:flex;align-items:center;gap:10px;min-height:42px"><input id="restaurantPrinterActive" type="checkbox" ${active ? 'checked' : ''}> Impresora activa</label></div></div>
      <div class="notice">Las cocinas y KDS no aparecen aquí por defecto. Primero debes crearlos arriba como estación.</div><div id="restaurantPrinterError"></div><div class="actions" style="justify-content:flex-end;margin-top:16px"><button class="btn" type="button" onclick="document.getElementById('restaurantPrinterModal')?.remove()">Cancelar</button><button class="btn primary" type="submit">Guardar impresora</button></div></form></div>`);

    const transportField = document.getElementById('restaurantPrinterTransport');
    const syncLanFields = () => {
      const isLan = transportField.value === 'LAN';
      const lan = document.getElementById('restaurantPrinterLanFields');
      if (lan) lan.style.display = isLan ? '' : 'none';
      document.getElementById('restaurantPrinterHost').required = isLan;
      document.getElementById('restaurantPrinterPort').required = isLan;
    };
    transportField.addEventListener('change', syncLanFields);
    syncLanFields();

    document.getElementById('restaurantPrinterForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = document.getElementById('restaurantPrinterError');
      if (errorBox) errorBox.innerHTML = '';
      const transportValue = document.getElementById('restaurantPrinterTransport').value;
      const payload = { ...(current?.id ? { id:current.id } : {}), name:document.getElementById('restaurantPrinterName').value.trim(), role:document.getElementById('restaurantPrinterRole').value, transport:transportValue, host:transportValue === 'LAN' ? document.getElementById('restaurantPrinterHost').value.trim() : null, port:transportValue === 'LAN' ? Number(document.getElementById('restaurantPrinterPort').value || 9100) : null, format:document.getElementById('restaurantPrinterFormat').value || null, active:document.getElementById('restaurantPrinterActive').checked };
      try { await callApi('/api/v1/impresion/impresoras', { method:'POST', body:JSON.stringify(payload) }); document.getElementById('restaurantPrinterModal')?.remove(); await window.hydrateRestaurantPrinterConfig(); }
      catch (error) { if (errorBox) errorBox.innerHTML = `<div class="error">${h(error.message)}</div>`; }
    });
  };
})();
