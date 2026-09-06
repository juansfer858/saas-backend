(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_COMPANY_ADMIN_ADVANCED_V2';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const PAGE_PATH = '/app/configuracion-avanzada';
  if (window[MARKER] || location.pathname !== PAGE_PATH) return;
  window[MARKER] = Object.freeze({ version:'2.0.0', surface:'ADMIN_ADVANCED', source:'TRIAL_AND_COMPANY_PROFILE' });

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
      @media(max-width:700px){.rca-company-grid{grid-template-columns:1fr}.rca-company-grid .wide{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  function companyMarkup(company = {}, message = '') {
    return `<div class="panel" data-restaurant-company-admin="true">
      <div class="ph">
        <div><strong>Información de la empresa</strong><div class="muted" style="font-size:12px;margin-top:4px">Identidad administrativa del restaurante y encabezado de las tirillas POS internas.</div></div>
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
          </div>
          <div class="rca-company-actions"><button class="btn primary" type="submit" id="rcaCompanySave">Guardar información de empresa</button><span class="rca-company-status ${message ? 'ok' : ''}" id="rcaCompanyStatus">${esc(message)}</span></div>
          <div class="muted" style="font-size:11px;margin-top:12px">Esta ficha pertenece a Administración. No modifica el flujo operativo del Centro de control y no activa facturación electrónica ni bloqueos de DIAN.</div>
        </form>
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
      email:String(document.getElementById('rcaCompanyEmail')?.value || '').trim() || null
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
      await loadCompany('Información guardada. También quedó sincronizada con el perfil administrativo del restaurante.');
    } catch (error) {
      if (status) { status.className = 'rca-company-status bad'; status.textContent = error.message; }
      if (button) button.disabled = false;
    }
  }

  function activateCompanyTab(button) {
    document.querySelectorAll('.tabs .tab').forEach((tab) => tab.classList.remove('active'));
    button.classList.add('active');
    loadCompany();
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
    if (tabs.querySelector('[data-restaurant-company-tab]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.dataset.restaurantCompanyTab = 'empresa';
    button.textContent = 'Empresa';
    button.addEventListener('click', () => activateCompanyTab(button));
    tabs.prepend(button);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => installTab(), { once:true });
  else installTab();
})();
