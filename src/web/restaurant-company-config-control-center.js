(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_COMPANY_CONFIG_CONTROL_CENTER_V1';
  if (window[MARKER]) return;
  window[MARKER] = Object.freeze({ version:'1.0.0', companyProfile:true, controlCenter:true });

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const CONTROL_PATH = '/app/centro-de-control';
  const STYLE_ID = 'restaurant-company-config-control-center-style-v1';
  let loading = false;
  let loadedCompany = null;

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  function canManage() {
    return ['ADMIN','SUPER_ADMIN','ADMINISTRADOR'].includes(String(session()?.user?.rol || '').toUpperCase());
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  }

  function currentView() {
    return new URLSearchParams(location.search).get('view') || 'dashboard';
  }

  function configUrl() {
    return `${CONTROL_PATH}?view=config`;
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
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .cc-company-config{display:grid;gap:16px;max-width:1100px;margin:0 auto;padding-bottom:28px}
      .cc-company-config .ccc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
      .cc-company-config .ccc-head h1{margin:0 0 5px;font-size:27px;letter-spacing:-.03em;color:#0f172a}
      .cc-company-config .ccc-head p{margin:0;color:#64748b;max-width:720px;line-height:1.45}
      .cc-company-config .ccc-pill{padding:8px 11px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:11px;font-weight:900;border:1px solid #a7f3d0}
      .cc-company-config .ccc-card{background:#fff;border:1px solid #e2e8f0;border-radius:17px;padding:18px;box-shadow:0 6px 18px rgba(15,23,42,.05);display:grid;gap:15px}
      .cc-company-config .ccc-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;border-bottom:1px solid #edf2f7;padding-bottom:12px}
      .cc-company-config .ccc-card-head h2{margin:0 0 4px;font-size:18px;color:#0f172a}
      .cc-company-config .ccc-card-head p{margin:0;color:#64748b;font-size:12px;line-height:1.4}
      .cc-company-config .ccc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
      .cc-company-config label{display:grid;gap:6px;font-size:12px;font-weight:900;color:#334155}
      .cc-company-config input{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:10px 11px;font:inherit;color:#0f172a;outline:none}
      .cc-company-config input:focus{border-color:#0f766e;box-shadow:0 0 0 3px rgba(13,148,136,.12)}
      .cc-company-config .ccc-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .cc-company-config .ccc-save{border:0;border-radius:10px;background:#0f766e;color:#fff;padding:10px 15px;font-weight:900;cursor:pointer}
      .cc-company-config .ccc-save:disabled{opacity:.55;cursor:wait}
      .cc-company-config .ccc-note{border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;padding:12px 14px;color:#475569;font-size:12px;line-height:1.45}
      .cc-company-config .ccc-ok{border-radius:10px;background:#dcfce7;color:#166534;padding:10px 12px;font-weight:800;font-size:12px}
      .cc-company-config .ccc-error{border-radius:10px;background:#fee2e2;color:#991b1b;padding:10px 12px;font-weight:800;font-size:12px}
      .cc-company-config .ccc-loading{padding:18px;color:#64748b}
      @media(max-width:720px){.cc-company-config .ccc-grid{grid-template-columns:1fr}.cc-company-config .ccc-head h1{font-size:23px}.cc-company-config .ccc-card{padding:14px}}
    `;
    document.head.appendChild(style);
  }

  function ensureConfigButton() {
    if (!canManage() || currentView() !== 'dashboard') return false;
    const actions = document.querySelector('#ccDashboard .cc-actions');
    if (!actions) return false;
    if (actions.querySelector('[data-cc-company-config]')) return true;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cc-action';
    button.dataset.ccCompanyConfig = 'true';
    button.textContent = '⚙ Configuración avanzada';
    actions.appendChild(button);
    return true;
  }

  function scheduleConfigButton() {
    [0,80,180,350,650,1100,1800,3000,4500].forEach((delay) => setTimeout(ensureConfigButton, delay));
  }

  function showOnlyConfig() {
    const dashboard = document.getElementById('ccDashboard');
    const custom = document.getElementById('ccCustomView');
    const message = document.getElementById('message');
    const view = document.getElementById('view');
    if (dashboard) dashboard.hidden = true;
    if (custom) custom.hidden = false;
    if (message) message.hidden = true;
    if (view) view.hidden = true;
    document.querySelector('[data-cc-home]')?.classList.remove('active');
    document.querySelectorAll('.rail-ticket.active').forEach((button) => button.classList.remove('active'));
  }

  function renderBack() {
    const bar = document.getElementById('ccBackBar');
    if (!bar) return;
    bar.hidden = false;
    bar.innerHTML = '<button type="button" class="cc-mini-button" data-cc-company-config-back="true">← Atrás <span>Centro de control</span></button>';
  }

  function goDashboard() {
    history.replaceState({ ...(history.state || {}), ccView:'dashboard', ccTrail:[] }, '', CONTROL_PATH);
    const control = window.VantixGCRestaurantControlCenter;
    if (control?.showDashboard) control.showDashboard();
    else location.assign(CONTROL_PATH);
    scheduleConfigButton();
  }

  function companyMarkup(company = {}) {
    return `<div class="cc-company-config" data-company-config-root="true">
      <div class="ccc-head"><div><h1>Configuración avanzada</h1><p>Configura la identidad y los datos de contacto del restaurante que se usarán en la operación interna y en las tirillas POS nuevas.</p></div><span class="ccc-pill">Empresa · POS interno</span></div>
      <section class="ccc-card">
        <div class="ccc-card-head"><div><h2>Información de la empresa</h2><p>Estos datos pertenecen al restaurante actual y se guardan una sola vez para este tenant.</p></div></div>
        <div class="ccc-grid">
          <label>Nombre del restaurante / empresa<input id="cccNombreEmpresa" maxlength="160" value="${esc(company.nombreEmpresa || '')}" autocomplete="organization"></label>
          <label>NIT<input id="cccNit" maxlength="40" value="${esc(company.nit || '')}" inputmode="text"></label>
          <label>Dirección<input id="cccDireccion" maxlength="220" value="${esc(company.address || '')}" autocomplete="street-address"></label>
          <label>Ciudad / municipio<input id="cccCiudad" maxlength="120" value="${esc(company.city || '')}" autocomplete="address-level2"></label>
          <label>Departamento<input id="cccDepartamento" maxlength="120" value="${esc(company.department || '')}" autocomplete="address-level1"></label>
          <label>Teléfono<input id="cccTelefono" maxlength="60" value="${esc(company.phone || '')}" autocomplete="tel"></label>
          <label>Correo electrónico<input id="cccEmail" maxlength="180" value="${esc(company.email || '')}" type="email" autocomplete="email"></label>
        </div>
        <div class="ccc-note"><b>Tirilla POS:</b> los cobros nuevos toman automáticamente nombre, NIT, dirección, ciudad/departamento, teléfono y correo que estén configurados aquí. Guardar estos datos no activa facturación electrónica ni crea bloqueos de DIAN.</div>
        <div class="ccc-actions"><button type="button" class="ccc-save" id="cccSaveCompany">Guardar empresa</button><div id="cccMessage"></div></div>
      </section>
    </div>`;
  }

  function values() {
    return {
      nombreEmpresa:String(document.getElementById('cccNombreEmpresa')?.value || '').trim(),
      nit:String(document.getElementById('cccNit')?.value || '').trim(),
      address:String(document.getElementById('cccDireccion')?.value || '').trim(),
      city:String(document.getElementById('cccCiudad')?.value || '').trim(),
      department:String(document.getElementById('cccDepartamento')?.value || '').trim(),
      phone:String(document.getElementById('cccTelefono')?.value || '').trim(),
      email:String(document.getElementById('cccEmail')?.value || '').trim()
    };
  }

  async function saveCompany() {
    const button = document.getElementById('cccSaveCompany');
    const message = document.getElementById('cccMessage');
    const payload = values();
    if (!payload.nombreEmpresa) {
      if (message) message.innerHTML = '<div class="ccc-error">El nombre de la empresa es obligatorio.</div>';
      return;
    }
    if (button) button.disabled = true;
    if (message) message.innerHTML = '<div class="ccc-loading">Guardando…</div>';
    try {
      loadedCompany = await api('/api/v1/impresion/empresa', { method:'PUT', body:JSON.stringify(payload) });
      if (message) message.innerHTML = '<div class="ccc-ok">✓ Información de la empresa guardada.</div>';
    } catch (error) {
      if (message) message.innerHTML = `<div class="ccc-error">${esc(error.message)}</div>`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadCompany(custom) {
    if (loading) return;
    loading = true;
    custom.innerHTML = '<div class="ccc-loading">Cargando información de la empresa…</div>';
    try {
      loadedCompany = await api('/api/v1/impresion/empresa');
      if (currentView() !== 'config') return;
      custom.innerHTML = companyMarkup(loadedCompany || {});
      document.getElementById('cccSaveCompany')?.addEventListener('click', saveCompany);
    } catch (error) {
      custom.innerHTML = `<div class="cc-company-config"><div class="ccc-head"><div><h1>Configuración avanzada</h1></div></div><div class="ccc-error">${esc(error.message)}</div></div>`;
    } finally {
      loading = false;
    }
  }

  function openConfig(pushState = true, attempt = 0) {
    if (!canManage()) return;
    const custom = document.getElementById('ccCustomView');
    const back = document.getElementById('ccBackBar');
    if (!custom || !back) {
      if (attempt < 60) requestAnimationFrame(() => openConfig(pushState, attempt + 1));
      return;
    }

    ensureStyles();
    if (pushState && currentView() !== 'config') {
      const origin = currentView();
      const previousTrail = Array.isArray(history.state?.ccTrail) ? history.state.ccTrail : [];
      history.pushState({ ...(history.state || {}), ccView:'config', ccTrail:[...previousTrail, origin] }, '', configUrl());
    } else if (currentView() === 'config' && history.state?.ccView !== 'config') {
      history.replaceState({ ...(history.state || {}), ccView:'config', ccTrail:['dashboard'] }, '', configUrl());
    }

    showOnlyConfig();
    renderBack();
    custom.innerHTML = '<div class="ccc-loading">Cargando información de la empresa…</div>';
    loadCompany(custom);
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-cc-company-config]')) {
      event.preventDefault();
      openConfig(true);
      return;
    }
    if (event.target.closest?.('[data-cc-company-config-back]')) {
      event.preventDefault();
      goDashboard();
      return;
    }
    if (event.target.closest?.('[data-cc-home]')) scheduleConfigButton();
  }, true);

  window.addEventListener('popstate', () => {
    if (currentView() === 'config') setTimeout(() => openConfig(false), 0);
    else scheduleConfigButton();
  });

  const start = () => {
    ensureStyles();
    if (currentView() === 'config') openConfig(false);
    else scheduleConfigButton();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();

  window.VantixGCRestaurantCompanyConfig = Object.freeze({
    open:() => openConfig(true),
    show:() => openConfig(false),
    marker:MARKER
  });
})();
