(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V2_NATIVE_CONTROL_P11';
  const MODULE_CHROME_MARKER = 'VANTIX_RESTAURANT_V2_MODULE_CHROME_CLEAN_P11';
  const OPERATION_NAV_MARKER = 'VANTIX_RESTAURANT_V2_OPERATION_NAV_NO_DASHBOARD_P11';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const MODULES = Object.freeze({
    mesas:{ label:'Mesas', hint:'Salón y estado de mesas', route:'/app/restaurante-v2/mesas', roles:['ADMIN','SUPER_ADMIN','MESERO','CAJERO'] },
    pedidos:{ label:'Pedidos', hint:'Tomar y revisar pedidos', route:'/app/restaurante-v2/pedidos', roles:['ADMIN','SUPER_ADMIN','MESERO'] },
    kds:{ label:'Producción', hint:'Cocina · Barra · Postres', route:'/app/restaurante-v2/kds', roles:['ADMIN','SUPER_ADMIN','COCINA','BARRA','POSTRES','MESERO'] },
    division:{ label:'División', hint:'Cuenta conjunta o individual', route:'/app/restaurante-v2/division', roles:['ADMIN','SUPER_ADMIN','CAJERO','MESERO'] },
    caja:{ label:'Caja', hint:'Cobro y cierre real', route:'/app/restaurante-v2/caja', roles:['ADMIN','SUPER_ADMIN','CAJERO'] },
    domicilios:{ label:'Domicilios', hint:'Pedidos para entrega', route:'/app/restaurante-v2/domicilios', roles:['ADMIN','SUPER_ADMIN','MESERO','CAJERO'] },
    inventario:{ label:'Carta / inventario', hint:'Productos, existencias y precios', route:'/app/inventario', roles:['ADMIN','SUPER_ADMIN'], external:true },
    empleados:{ label:'Empleados', hint:'Usuarios, roles y asignaciones', route:'/app/restaurante-v2/empleados', roles:['ADMIN','SUPER_ADMIN'] },
    qrs:{ label:'QR de mesas', hint:'Ver e imprimir QR físicos', route:'/app/restaurante-v2/qrs', roles:['ADMIN','SUPER_ADMIN'] },
    devices:{ label:'Dispositivos', hint:'Meseros y producción', route:'/app/restaurante-v2/dispositivos', roles:['ADMIN','SUPER_ADMIN'] },
    retiro:{ label:'Retiro V1', hint:'Control técnico P11', route:'/app/restaurante-v2/retiro-v1', roles:['ADMIN','SUPER_ADMIN'], technical:true }
  });
  const ALIASES = Object.freeze({ salon:'mesas', mesero:'pedidos', migration:'retiro', pilot:'retiro' });

  document.documentElement.dataset.restaurantV2NativeControl = MARKER;
  document.documentElement.dataset.restaurantV2ModuleChrome = MODULE_CHROME_MARKER;
  document.documentElement.dataset.restaurantV2OperationNav = OPERATION_NAV_MARKER;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }
  const session = readSession();
  if (!session?.token || !session?.subdomain) { location.replace('/app'); return; }
  const role = String(session.user?.rol || '').toUpperCase();
  const $ = (q, root = document) => root.querySelector(q);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache:'no-store',
      headers:{ Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain, ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.headers || {}) }
    });
    let body = {}; try { body = await response.json(); } catch {}
    if (response.status === 401) { localStorage.removeItem(SESSION_KEY); location.replace('/app'); throw new Error('Sesión vencida'); }
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body.data;
  }
  function allowed(module) { return module.roles.includes(role); }
  function visibleModules() { return Object.entries(MODULES).filter(([, module]) => allowed(module)); }
  function defaultModuleKey() {
    return visibleModules().find(([, module]) => !module.technical && !module.external)?.[0]
      || visibleModules().find(([, module]) => !module.technical)?.[0]
      || visibleModules()[0]?.[0]
      || null;
  }
  function setMessage(text) {
    const box = $('#p11Message');
    if (!box) return;
    box.hidden = !text;
    box.textContent = text || '';
  }
  function moduleKey(value) {
    const raw = String(value || '').trim();
    return ALIASES[raw] || raw;
  }

  async function assertRetirement() {
    const state = await api('/api/v1/restaurante/v2/retiro-v1/launch');
    if (!state?.enabled) {
      location.replace('/app/centro-de-control');
      return false;
    }
    return true;
  }

  function renderIdentity() {
    const tenant = session.tenant?.nombreEmpresa || session.tenant?.nombre || session.subdomain || 'Restaurante';
    $('#p11Tenant').textContent = tenant;
    $('#p11TenantMeta').textContent = session.subdomain;
  }

  function navItem(key, module) {
    if (module.external) {
      return `<a href="${esc(module.route)}" data-module-link="${esc(key)}"><b>${esc(module.label)}</b><small>${esc(module.hint)}</small></a>`;
    }
    return `<button type="button" data-module="${esc(key)}"><b>${esc(module.label)}</b><small>${esc(module.hint)}</small></button>`;
  }
  function renderNav() {
    const nav = $('#p11Nav');
    const ops = visibleModules().filter(([, module]) => !module.technical);
    const tech = visibleModules().filter(([, module]) => module.technical);
    nav.innerHTML = `<div class="p11-nav-label">Operación</div>${ops.map(([key,module]) => navItem(key,module)).join('')}${tech.length ? `<div class="p11-nav-label">Técnico</div>${tech.map(([key,module]) => navItem(key,module)).join('')}` : ''}`;
    nav.addEventListener('click', (event) => {
      const button = event.target.closest('[data-module]');
      if (button) openModule(button.dataset.module);
    });
  }
  function setActive(key) {
    document.querySelectorAll('#p11Nav [data-module], #p11Nav [data-module-link]').forEach((item) => {
      item.classList.toggle('active', item.dataset.module === key || item.dataset.moduleLink === key);
    });
  }
  function openModule(rawKey, updateHistory = true) {
    const key = moduleKey(rawKey);
    const module = MODULES[key];
    if (!module || !allowed(module)) { setMessage('Tu usuario no tiene permiso para abrir este módulo.'); return; }
    if (module.external) { location.assign(module.route); return; }
    setMessage('');
    $('#p11Main').classList.add('module-open');
    $('#p11Workspace').hidden = false;
    const frame = $('#p11Frame');
    if (frame.getAttribute('src') !== module.route) frame.setAttribute('src', module.route);
    setActive(key);
    if (updateHistory) history.replaceState({ ...(history.state || {}), p11Module:key }, '', `/app/centro-de-control-v2?module=${encodeURIComponent(key)}`);
  }
  function openDefault(updateHistory = true) {
    const key = defaultModuleKey();
    if (!key) {
      $('#p11Workspace').hidden = true;
      $('#p11Main').classList.remove('module-open');
      setMessage('Tu usuario no tiene módulos operativos disponibles.');
      return;
    }
    openModule(key, updateHistory);
  }

  function bindStatic() {
    window.addEventListener('popstate', () => {
      const key = moduleKey(new URLSearchParams(location.search).get('module'));
      if (key && MODULES[key] && allowed(MODULES[key])) openModule(key, false);
      else openDefault(false);
    });
  }

  async function boot() {
    try {
      if (!await assertRetirement()) return;
      renderIdentity();
      renderNav();
      bindStatic();
      const initial = moduleKey(new URLSearchParams(location.search).get('module'));
      if (initial && MODULES[initial] && allowed(MODULES[initial])) openModule(initial, false);
      else openDefault(true);
    } catch (error) {
      setMessage(error.message || 'No fue posible abrir la operación V2.');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
