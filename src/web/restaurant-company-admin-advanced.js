(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_COMPANY_ADMIN_ADVANCED_V3';
  const RESET_MARKER = 'VANTIX_RESTAURANT_TEST_DATA_RESET_V66';
  const RESET_CONFIRMATION = 'ELIMINAR PRUEBAS';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const PAGE_PATH = '/app/configuracion-avanzada';
  if (window[MARKER] || location.pathname !== PAGE_PATH) return;
  window[MARKER] = Object.freeze({ version:'3.0.0', surface:'ADMIN_ADVANCED', source:'TRIAL_COMPANY_AND_POS_RECEIPT' });
  window[RESET_MARKER] = Object.freeze({ version:'66.0.0', surface:'ADMIN_ADVANCED', scope:'DEMO_TRANSACTION_RESET' });

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[char]));

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function isRestaurantTenant() {
    const niche = String(session()?.tenant?.nicho || '').toUpperCase();
    return ['RESTAURANTE','RESTAURANT'].includes(niche)
      || document.documentElement.dataset.coreRestaurantAccess === '1';
  }

  function isDemoTenant() {
    return String(session()?.subdomain || '').trim().toLowerCase() === 'demo-restaurante';
  }

  async function api(path, options = {}) {
    const current = session();
    if (!current?.token || !current?.subdomain) throw new Error('Sesión no disponible');
    const response = await fetch(path, {
      ...options,
      cache:'no-store',
      headers:{
        Authorization:`Bearer ${current.token}`,
        'x-tenant-subdomain':current.subdomain,
        ...(options.body ? { 'Content-Type':'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (response.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      location.replace('/app');
      throw new Error('Sesión vencida');
    }
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function ensureStyles() {
    if (document.getElementById('restaurantCompanyAdminAdvancedStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantCompanyAdminAdvancedStyles';
    style.textContent = `
      .rca-company-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .rca-company-grid .wide{grid-column:1/-1}
      .rca-company-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px}
      .rca-company-source{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;margin-bottom:14px;border:1px solid #b7dfc8;border-radius:10px;background:#f0f9f4;color:#365d49;font-size:12px;line-height:1.45}
      .rca-company-source strong{color:#166534}
      .rca-company-status{font-size:12px;font-weight:750}
      .rca-company-status.ok{color:#027a48}.rca-company-status.bad{color:#b42318}
      .rca-pos-title-help{font-size:11px;color:#64748b;line-height:1.4;margin-top:4px}
      .rca-reset-warning{padding:13px 14px;border:1px solid #f5b8b1;border-radius:12px;background:#fff5f4;color:#7a271a;font-size:12px;line-height:1.5;margin-bottom:14px}
      .rca-reset-warning strong{color:#912018}
      .rca-reset-safe{padding:13px 14px;border:1px solid #b7dfc8;border-radius:12px;background:#f0f9f4;color:#365d49;font-size:12px;line-height:1.5;margin-bottom:14px}
      .rca-reset-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0 16px}
      .rca-reset-count{padding:12px;border:1px solid #d7dde1;border-radius:10px;background:#fff}
      .rca-reset-count b{display:block;font-size:20px;line-height:1;color:#18221d;margin-bottom:5px}.rca-reset-count span{font-size:10px;color:#667085;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
      .rca-reset-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .rca-reset-button{background:#b42318!important;border-color:#b42318!important;color:#fff!important}
      .rca-reset-button:disabled{opacity:.5!important;cursor:not-allowed!important}
      .rca-reset-result{font-size:12px;font-weight:750}.rca-reset-result.ok{color:#027a48}.rca-reset-result.bad{color:#b42318}
      @media(max-width:850px){.rca-reset-counts{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:700px){.rca-company-grid{grid-template-columns:1fr}.rca-company-grid .wide{grid-column:auto}}
      @media(max-width:430px){.rca-reset-counts{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function companyMarkup(company = {}, message = '') {
    return `<div class="panel" data-restaurant-company-admin="true">
      <div class="ph">
        <div><strong>Información de la empresa</strong><div class="muted" style="font-size:12px;margin-top:4px">Identidad administrativa del restaurante y encabezado de los comprobantes POS internos.</div></div>
        <span class="badge ok">Empresa · Restaurante</span>
      </div>
      <div class="pb">
        <div class="rca-company-source"><span>↔</span><div><strong>Sin volver a llenar lo mismo.</strong> Nombre del restaurante, celular, ciudad, departamento y correo se precargan automáticamente con la información entregada al crear la prueba de 14 días cuando esos datos existen. NIT y dirección se completan aquí si no fueron informados durante el alta/onboarding.</div></div>
        <form id="restaurantCompanyAdminForm">
          <div class="rca-company-grid">
            <div class="field"><label>Nombre del restaurante / empresa</label><input class="input" id="rcaCompanyName" maxlength="160" value="${esc(company.nombreEmpresa || '')}" required></div>
            <div class="field"><label>NIT</label><input class="input" id="rcaCompanyNit" maxlength="40" value="${esc(company.nit || '')}" placeholder="Ej. 900123456-7"></div>
            <div class="field wide"><label>Dirección</label><input class="input" id="rcaCompanyAddress" maxlength="220" value="${esc(company.address || '')}" placeholder="Ej. Calle 10 # 20-30"></div>
            <div class="field"><label>Ciudad / municipio</label><input class="input" id="rcaCompanyCity" maxlength="120" value="${esc(company.city || '')}" placeholder="Ej. Yarumal"></div>
            <div class="field"><label>Departamento</label><input class="input" id="rcaCompanyDepartment" maxlength="120" value="${esc(company.department || '')}" placeholder="Ej. Antioquia"></div>
            <div class="field"><label>Teléfono</label><input class="input" id="rcaCompanyPhone" maxlength="80" value="${esc(company.phone || '')}" autocomplete="tel"></div>
            <div class="field"><label>Correo electrónico</label><input class="input" id="rcaCompanyEmail" type="email" maxlength="160" value="${esc(company.email || '')}" autocomplete="email"></div>
            <div class="field wide"><label>Nombre del documento POS</label><input class="input" id="rcaReceiptTitle" maxlength="80" value="${esc(company.receiptTitle || 'COMPROBANTE DE VENTA')}" placeholder="Ej. COMPROBANTE DE VENTA"><div class="rca-pos-title-help">Este texto reemplaza “TIRILLA POS” en los próximos cobros. Es un documento interno del POS y no activa facturación electrónica ni DIAN.</div></div>
          </div>
          <div class="rca-company-actions"><button class="btn primary" type="submit" id="rcaCompanySave">Guardar información de empresa</button><span class="rca-company-status ${message ? 'ok' : ''}" id="rcaCompanyStatus">${esc(message)}</span></div>
          <div class="muted" style="font-size:11px;margin-top:12px">Esta ficha pertenece a Administración. No modifica el flujo operativo del Centro de control y no activa facturación electrónica ni bloqueos de DIAN.</div>
        </form>
      </div>
    </div>`;
  }

  function n(value) {
    return Number(value || 0).toLocaleString('es-CO');
  }

  function cleanupMarkup(data = {}, message = '') {
    const counts = data.counts || {};
    const blocked = Number(data.productionDianDocuments || 0) > 0 || data.allowed === false;
    return `<div class="panel" data-restaurant-test-reset="${RESET_MARKER}">
      <div class="ph">
        <div><strong>Limpieza de datos de prueba</strong><div class="muted" style="font-size:12px;margin-top:4px">Deja la operación, la contabilidad y la administración transaccional listas para comenzar desde cero.</div></div>
        <span class="badge ${blocked ? '' : 'ok'}">${blocked ? 'BLOQUEADO' : 'DEMO · V66'}</span>
      </div>
      <div class="pb">
        <div class="rca-reset-warning"><strong>Esta acción es destructiva.</strong> Elimina facturas y documentos internos de prueba, pedidos, comandas, sesiones de mesa, cobros, cartera, movimientos de tesorería e inventario, asientos contables, turnos de caja, domicilios de prueba y registros de notificación generados por esas pruebas.</div>
        <div class="rca-reset-safe"><strong>No toca los maestros.</strong> Se conservan productos y sus existencias actuales, carta, recetas, categorías, mesas, zonas, usuarios, empleados, terceros, impresoras, configuración del restaurante, configuración de notificaciones, dispositivos Push y configuración fiscal. Las mesas quedan LIBRES y los saldos de cajas/bancos quedan en $0.</div>
        <div class="rca-reset-counts">
          <div class="rca-reset-count"><b>${n(counts.documents)}</b><span>Facturas / documentos</span></div>
          <div class="rca-reset-count"><b>${n(counts.commands)}</b><span>Comandas</span></div>
          <div class="rca-reset-count"><b>${n(counts.orders)}</b><span>Pedidos</span></div>
          <div class="rca-reset-count"><b>${n(counts.sessions)}</b><span>Sesiones de mesa</span></div>
          <div class="rca-reset-count"><b>${n(counts.payments)}</b><span>Pagos</span></div>
          <div class="rca-reset-count"><b>${n(counts.receivables)}</b><span>Cartera</span></div>
          <div class="rca-reset-count"><b>${n(counts.journals)}</b><span>Asientos contables</span></div>
          <div class="rca-reset-count"><b>${n(counts.transactions)}</b><span>Transacciones</span></div>
        </div>
        ${blocked ? `<div class="error" style="margin-bottom:12px">La limpieza está bloqueada porque existen ${n(data.productionDianDocuments)} documentos en ambiente fiscal de PRODUCCIÓN. No se borrará nada.</div>` : ''}
        <div class="rca-reset-actions">
          <button class="btn rca-reset-button" type="button" id="rcaResetButton" ${blocked ? 'disabled' : ''}>Eliminar facturas, comandas y transacciones de prueba</button>
          <span class="rca-reset-result ${message ? 'ok' : ''}" id="rcaResetStatus">${esc(message)}</span>
        </div>
        <div class="muted" style="font-size:11px;margin-top:12px">Protección adicional: esta herramienta sólo funciona en <strong>demo-restaurante</strong>, exige permiso de Administración y requiere escribir “${RESET_CONFIRMATION}”.</div>
      </div>
    </div>`;
  }

  async function loadCompany(message = '') {
    const view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = '<div class="panel"><div class="pb">Cargando información de la empresa…</div></div>';
    try {
      const company = await api('/api/v1/impresion/empresa');
      view.innerHTML = companyMarkup(company || {}, message);
      document.getElementById('restaurantCompanyAdminForm')?.addEventListener('submit', saveCompany);
    } catch (error) {
      view.innerHTML = `<div class="error">${esc(error.message)}</div>`;
    }
  }

  async function loadCleanup(message = '') {
    const view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = '<div class="panel"><div class="pb">Revisando documentos y transacciones de prueba…</div></div>';
    try {
      const data = await api('/api/v1/restaurante/limpieza-pruebas/v66/resumen');
      view.innerHTML = cleanupMarkup(data || {}, message);
      document.getElementById('rcaResetButton')?.addEventListener('click', executeCleanup);
    } catch (error) {
      view.innerHTML = `<div class="error">${esc(error.message)}</div>`;
    }
  }

  async function saveCompany(event) {
    event.preventDefault();
    const button = document.getElementById('rcaCompanySave');
    const status = document.getElementById('rcaCompanyStatus');
    const payload = {
      nombreEmpresa:String(document.getElementById('rcaCompanyName')?.value || '').trim(),
      nit:String(document.getElementById('rcaCompanyNit')?.value || '').trim() || null,
      address:String(document.getElementById('rcaCompanyAddress')?.value || '').trim() || null,
      city:String(document.getElementById('rcaCompanyCity')?.value || '').trim() || null,
      department:String(document.getElementById('rcaCompanyDepartment')?.value || '').trim() || null,
      phone:String(document.getElementById('rcaCompanyPhone')?.value || '').trim() || null,
      email:String(document.getElementById('rcaCompanyEmail')?.value || '').trim() || null,
      receiptTitle:String(document.getElementById('rcaReceiptTitle')?.value || '').trim() || 'COMPROBANTE DE VENTA'
    };
    if (!payload.nombreEmpresa) {
      if (status) { status.className = 'rca-company-status bad'; status.textContent = 'El nombre de la empresa es obligatorio.'; }
      return;
    }
    if (button) button.disabled = true;
    if (status) { status.className = 'rca-company-status'; status.textContent = 'Guardando…'; }
    try {
      const saved = await api('/api/v1/impresion/empresa', { method:'PUT', body:JSON.stringify(payload) });
      const current = session();
      if (current?.tenant && saved?.nombreEmpresa) {
        current.tenant.nombreEmpresa = saved.nombreEmpresa;
        localStorage.setItem(SESSION_KEY, JSON.stringify(current));
      }
      await loadCompany('Información guardada. Los próximos comprobantes POS usarán estos datos y este nombre de documento.');
    } catch (error) {
      if (status) { status.className = 'rca-company-status bad'; status.textContent = error.message; }
      if (button) button.disabled = false;
    }
  }

  async function executeCleanup() {
    const button = document.getElementById('rcaResetButton');
    const status = document.getElementById('rcaResetStatus');
    if (!window.confirm('Se eliminarán definitivamente las facturas, comandas y transacciones de prueba de demo-restaurante. Los productos y demás maestros se conservarán. ¿Continuar?')) return;
    const typed = window.prompt(`Para confirmar, escribe exactamente: ${RESET_CONFIRMATION}`) || '';
    if (typed.trim().toUpperCase() !== RESET_CONFIRMATION) {
      if (status) { status.className = 'rca-reset-result bad'; status.textContent = `No se borró nada. Debes escribir ${RESET_CONFIRMATION}.`; }
      return;
    }
    if (button) button.disabled = true;
    if (status) { status.className = 'rca-reset-result'; status.textContent = 'Limpiando datos de prueba…'; }
    try {
      const result = await api('/api/v1/restaurante/limpieza-pruebas/v66/ejecutar', {
        method:'POST',
        body:JSON.stringify({ confirmation:RESET_CONFIRMATION })
      });
      const removed = Object.values(result?.removed || {}).reduce((sum, value) => sum + Number(value || 0), 0);
      await loadCleanup(`Limpieza completada: ${n(removed)} registros transaccionales eliminados. Productos y configuración conservados.`);
    } catch (error) {
      if (status) { status.className = 'rca-reset-result bad'; status.textContent = error.message; }
      if (button) button.disabled = false;
    }
  }

  function activateCompanyTab(button) {
    document.querySelectorAll('.tabs .tab').forEach((tab) => tab.classList.remove('active'));
    button.classList.add('active');
    loadCompany();
  }

  function activateCleanupTab(button) {
    document.querySelectorAll('.tabs .tab').forEach((tab) => tab.classList.remove('active'));
    button.classList.add('active');
    loadCleanup();
  }

  function installTab(attempt = 0) {
    if (!isRestaurantTenant()) {
      if (attempt < 20 && !document.documentElement.dataset.coreRestaurantAccess) setTimeout(() => installTab(attempt + 1), 100);
      return;
    }
    ensureStyles();
    const tabs = document.querySelector('.tabs');
    if (!tabs) {
      if (attempt < 30) setTimeout(() => installTab(attempt + 1), 80);
      return;
    }

    let button = tabs.querySelector('[data-restaurant-company-tab]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab';
      button.dataset.restaurantCompanyTab = 'empresa';
      button.textContent = 'Empresa';
      button.addEventListener('click', () => activateCompanyTab(button));
      tabs.prepend(button);
    }

    if (isDemoTenant() && !tabs.querySelector('[data-restaurant-test-reset-tab]')) {
      const cleanupButton = document.createElement('button');
      cleanupButton.type = 'button';
      cleanupButton.className = 'tab';
      cleanupButton.dataset.restaurantTestResetTab = 'v66';
      cleanupButton.textContent = 'Limpieza de pruebas';
      cleanupButton.addEventListener('click', () => activateCleanupTab(cleanupButton));
      button.insertAdjacentElement('afterend', cleanupButton);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => installTab(), { once:true });
  else installTab();
})();
