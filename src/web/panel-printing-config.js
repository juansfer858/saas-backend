(() => {
  'use strict';

  const previousViewConfig = window.viewConfig;
  if (typeof previousViewConfig !== 'function' || window.__vantixRestaurantPrinterConfigLoaded) return;
  window.__vantixRestaurantPrinterConfigLoaded = true;

  const printerState = { printers: [], config: null };
  const ROLE_OPTIONS = [
    ['COCINA', 'Cocina'],
    ['BARRA', 'Barra'],
    ['CAJA', 'Caja'],
    ['DOCUMENTOS', 'Documentos']
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

  function formatLabel(value) {
    return FORMAT_OPTIONS.find(([key]) => key === value)?.[1] || value || 'Formato general';
  }

  function roleLabel(value) {
    return ROLE_OPTIONS.find(([key]) => key === value)?.[1] || value || 'Documentos';
  }

  function optionList(options, selected, includeDefault = false) {
    const base = includeDefault ? '<option value="">Usar formato general</option>' : '';
    return base + options.map(([value, label]) => `<option value="${h(value)}" ${value === selected ? 'selected' : ''}>${h(label)}</option>`).join('');
  }

  window.viewConfig = function viewConfigWithRestaurantPrinters() {
    const base = previousViewConfig();
    setTimeout(() => window.hydrateRestaurantPrinterConfig?.(), 0);
    return `${base}
      <div class="panel" id="restaurantPrinterConfigPanel">
        <div class="panel-head">
          <div>
            <h2 style="margin:0">Impresoras del restaurante</h2>
            <span class="muted">Configura Cocina, Barra, Caja y documentos sin depender de facturación electrónica.</span>
          </div>
          <button class="btn primary" type="button" onclick="openRestaurantPrinter()">+ Nueva impresora</button>
        </div>
        <div id="restaurantPrinterConfigBody"><div class="loading">Cargando impresoras…</div></div>
      </div>`;
  };

  window.hydrateRestaurantPrinterConfig = async function hydrateRestaurantPrinterConfig() {
    const root = document.getElementById('restaurantPrinterConfigBody');
    if (!root) return;
    root.innerHTML = '<div class="loading">Cargando impresoras…</div>';
    try {
      const [configResponse, printersResponse] = await Promise.all([
        callApi('/api/v1/impresion/configuracion'),
        callApi('/api/v1/impresion/impresoras')
      ]);
      printerState.config = configResponse?.data || {};
      printerState.printers = Array.isArray(printersResponse?.data) ? printersResponse.data : [];
      renderRestaurantPrinterConfig();
    } catch (error) {
      root.innerHTML = `<div class="error"><strong>No fue posible cargar las impresoras.</strong><br>${h(error.message)}</div>`;
    }
  };

  function renderRestaurantPrinterConfig() {
    const root = document.getElementById('restaurantPrinterConfigBody');
    if (!root) return;
    const printers = printerState.printers;
    root.innerHTML = `
      <div class="audit-body">
        <div class="grid2" style="align-items:end">
          <div class="field" style="margin:0">
            <label>Formato general de comprobantes</label>
            <select class="select" id="restaurantDefaultPrintFormat">
              ${optionList(FORMAT_OPTIONS, printerState.config?.defaultFormat || 'TERMICA_80')}
            </select>
          </div>
          <div class="actions" style="justify-content:flex-start;margin:0">
            <button class="btn" type="button" onclick="saveRestaurantDefaultPrintFormat()">Guardar formato</button>
          </div>
        </div>
        <p class="muted" style="margin:10px 0 0">Las impresoras LAN trabajan con el spooler local ESC/POS. Para impresoras térmicas de red se sugiere el puerto 9100.</p>
      </div>
      ${printers.length ? `
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Nombre</th><th>Destino</th><th>Conexión</th><th>Formato</th><th>Estado</th><th></th></tr></thead>
            <tbody>${printers.map((printer) => `
              <tr>
                <td><strong>${h(printer.name)}</strong></td>
                <td>${h(roleLabel(printer.role))}</td>
                <td>${printer.transport === 'LAN' ? `${h(printer.host || '—')}:${h(printer.port || '—')}` : 'Navegador'}</td>
                <td>${h(formatLabel(printer.format || printerState.config?.defaultFormat))}</td>
                <td>${printer.active ? '<span class="badge b-paid">Activa</span>' : '<span class="badge b-partial">Inactiva</span>'}</td>
                <td>
                  <div class="actions" style="justify-content:flex-end;margin:0;gap:6px">
                    <button class="btn small" type="button" onclick="openRestaurantPrinter('${h(printer.id)}')">Editar</button>
                    <button class="btn small" type="button" onclick="toggleRestaurantPrinter('${h(printer.id)}')">${printer.active ? 'Desactivar' : 'Activar'}</button>
                  </div>
                </td>
              </tr>`).join('')}</tbody>
          </table>
        </div>` : '<div class="empty">No hay impresoras configuradas. Agrega Cocina, Barra, Caja o Documentos según la operación del restaurante.</div>'}`;
  }

  window.saveRestaurantDefaultPrintFormat = async function saveRestaurantDefaultPrintFormat() {
    const field = document.getElementById('restaurantDefaultPrintFormat');
    if (!field) return;
    try {
      await callApi('/api/v1/impresion/configuracion', {
        method: 'PUT',
        body: JSON.stringify({ defaultFormat: field.value })
      });
      await window.hydrateRestaurantPrinterConfig();
    } catch (error) {
      alert(error.message);
    }
  };

  function printerPayload(printer, active) {
    return {
      id: printer.id,
      name: printer.name,
      transport: printer.transport,
      role: printer.role || 'DOCUMENTOS',
      host: printer.transport === 'LAN' ? printer.host : null,
      port: printer.transport === 'LAN' ? Number(printer.port || 9100) : null,
      format: printer.format || null,
      active
    };
  }

  window.toggleRestaurantPrinter = async function toggleRestaurantPrinter(id) {
    const printer = printerState.printers.find((item) => item.id === id);
    if (!printer) return;
    try {
      await callApi('/api/v1/impresion/impresoras', {
        method: 'POST',
        body: JSON.stringify(printerPayload(printer, !printer.active))
      });
      await window.hydrateRestaurantPrinterConfig();
    } catch (error) {
      alert(error.message);
    }
  };

  window.openRestaurantPrinter = function openRestaurantPrinter(id = '') {
    document.getElementById('restaurantPrinterModal')?.remove();
    const current = id ? printerState.printers.find((item) => item.id === id) : null;
    const role = current?.role || 'COCINA';
    const roleOptions = [...ROLE_OPTIONS];
    if (current?.role && !ROLE_OPTIONS.some(([key]) => key === current.role)) roleOptions.push([current.role, current.role]);
    const transport = current?.transport || 'LAN';
    const active = current ? current.active !== false : true;

    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-back" id="restaurantPrinterModal">
        <form class="modal" id="restaurantPrinterForm">
          <h2>${current ? 'Editar impresora' : 'Nueva impresora'}</h2>
          <div class="field"><label>Nombre</label><input class="input" id="restaurantPrinterName" maxlength="100" value="${h(current?.name || '')}" placeholder="Ej. Cocina principal" required></div>
          <div class="grid2">
            <div class="field"><label>Destino</label><select class="select" id="restaurantPrinterRole">${optionList(roleOptions, role)}</select></div>
            <div class="field"><label>Conexión</label><select class="select" id="restaurantPrinterTransport"><option value="LAN" ${transport === 'LAN' ? 'selected' : ''}>LAN / Red local</option><option value="NAVEGADOR" ${transport === 'NAVEGADOR' ? 'selected' : ''}>Navegador</option></select></div>
          </div>
          <div class="grid2" id="restaurantPrinterLanFields">
            <div class="field"><label>IP o host</label><input class="input" id="restaurantPrinterHost" maxlength="200" value="${h(current?.host || '')}" placeholder="Ej. 192.168.1.80"></div>
            <div class="field"><label>Puerto</label><input class="input" id="restaurantPrinterPort" type="number" min="1" max="65535" value="${h(current?.port || 9100)}"></div>
          </div>
          <div class="grid2">
            <div class="field"><label>Formato</label><select class="select" id="restaurantPrinterFormat">${optionList(FORMAT_OPTIONS, current?.format || '', true)}</select></div>
            <div class="field"><label>Estado</label><label style="display:flex;align-items:center;gap:10px;min-height:42px"><input id="restaurantPrinterActive" type="checkbox" ${active ? 'checked' : ''}> Impresora activa</label></div>
          </div>
          <div class="notice" style="margin-top:4px">La configuración de impresoras es operativa. No requiere resolución, CUFE, certificado ni conexión DIAN.</div>
          <div id="restaurantPrinterError"></div>
          <div class="actions" style="justify-content:flex-end;margin-top:16px">
            <button class="btn" type="button" onclick="document.getElementById('restaurantPrinterModal')?.remove()">Cancelar</button>
            <button class="btn primary" type="submit">Guardar impresora</button>
          </div>
        </form>
      </div>`);

    const transportField = document.getElementById('restaurantPrinterTransport');
    const syncLanFields = () => {
      const isLan = transportField.value === 'LAN';
      const lan = document.getElementById('restaurantPrinterLanFields');
      if (lan) lan.style.display = isLan ? '' : 'none';
      const host = document.getElementById('restaurantPrinterHost');
      const port = document.getElementById('restaurantPrinterPort');
      if (host) host.required = isLan;
      if (port) port.required = isLan;
    };
    transportField.addEventListener('change', syncLanFields);
    syncLanFields();

    document.getElementById('restaurantPrinterForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = document.getElementById('restaurantPrinterError');
      if (errorBox) errorBox.innerHTML = '';
      const transportValue = document.getElementById('restaurantPrinterTransport').value;
      const payload = {
        ...(current?.id ? { id: current.id } : {}),
        name: document.getElementById('restaurantPrinterName').value.trim(),
        role: document.getElementById('restaurantPrinterRole').value,
        transport: transportValue,
        host: transportValue === 'LAN' ? document.getElementById('restaurantPrinterHost').value.trim() : null,
        port: transportValue === 'LAN' ? Number(document.getElementById('restaurantPrinterPort').value || 9100) : null,
        format: document.getElementById('restaurantPrinterFormat').value || null,
        active: document.getElementById('restaurantPrinterActive').checked
      };
      try {
        await callApi('/api/v1/impresion/impresoras', { method: 'POST', body: JSON.stringify(payload) });
        document.getElementById('restaurantPrinterModal')?.remove();
        await window.hydrateRestaurantPrinterConfig();
      } catch (error) {
        if (errorBox) errorBox.innerHTML = `<div class="error">${h(error.message)}</div>`;
      }
    });
  };
})();
