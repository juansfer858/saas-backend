(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V2_NATIVE_CONTROL_P11';
  const MODULE_CHROME_MARKER = 'VANTIX_RESTAURANT_V2_MODULE_CHROME_CLEAN_P11';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const MODULES = Object.freeze({
    mesas:{ label:'Mesas', hint:'Salón y estado de mesas', route:'/app/restaurante-v2/mesas', roles:['ADMIN','SUPER_ADMIN','MESERO','CAJERO'] },
    pedidos:{ label:'Pedidos', hint:'Tomar y revisar pedidos', route:'/app/restaurante-v2/pedidos', roles:['ADMIN','SUPER_ADMIN','MESERO'] },
    kds:{ label:'Producción', hint:'Cocina · Barra · Postres', route:'/app/restaurante-v2/kds', roles:['ADMIN','SUPER_ADMIN','COCINA','BARRA','POSTRES','MESERO'] },
    division:{ label:'División', hint:'Cuenta conjunta o individual', route:'/app/restaurante-v2/division', roles:['ADMIN','SUPER_ADMIN','CAJERO','MESERO'] },
    caja:{ label:'Caja', hint:'Cobro y cierre real', route:'/app/restaurante-v2/caja', roles:['ADMIN','SUPER_ADMIN','CAJERO'] },
    domicilios:{ label:'Domicilios', hint:'Pedidos para entrega', route:'/app/restaurante-v2/domicilios', roles:['ADMIN','SUPER_ADMIN','MESERO','CAJERO'] },
    empleados:{ label:'Empleados', hint:'Usuarios, roles y asignaciones', route:'/app/restaurante-v2/empleados', roles:['ADMIN','SUPER_ADMIN'] },
    qrs:{ label:'QR de mesas', hint:'Ver e imprimir QR físicos', route:'/app/restaurante-v2/qrs', roles:['ADMIN','SUPER_ADMIN'] },
    devices:{ label:'Dispositivos', hint:'Meseros y producción', route:'/app/restaurante-v2/dispositivos', roles:['ADMIN','SUPER_ADMIN'] },
    retiro:{ label:'Retiro V1', hint:'Control técnico P11', route:'/app/restaurante-v2/retiro-v1', roles:['ADMIN','SUPER_ADMIN'], technical:true }
  });
  const ALIASES = Object.freeze({ salon:'mesas', mesero:'pedidos', migration:'retiro', pilot:'retiro' });

  document.documentElement.dataset.restaurantV2NativeControl = MARKER;
  document.documentElement.dataset.restaurantV2ModuleChrome = MODULE_CHROME_MARKER;

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
    $('#p11RestaurantName').textContent = tenant;
    $('#p11User').textContent = session.user?.nombre || session.user?.email || 'Usuario';
    $('#p11Role').textContent = role || 'ROL';
  }

  function navButton(key, module) {
    return `<button type="button" data-module="${esc(key)}"><b>${esc(module.label)}</b><small>${esc(module.hint)}</small></button>`;
  }
  function renderNav() {
    const nav = $('#p11Nav');
    const ops = visibleModules().filter(([, module]) => !module.technical);
    const tech = visibleModules().filter(([, module]) => module.technical);
    nav.innerHTML = `<div class="p11-nav-label">Operación</div><button type="button" data-home="true" class="active"><b>Centro de control</b><small>Resumen operativo V2</small></button>${ops.map(([key,module]) => navButton(key,module)).join('')}${tech.length ? `<div class="p11-nav-label">Técnico</div>${tech.map(([key,module]) => navButton(key,module)).join('')}` : ''}`;
    nav.addEventListener('click', (event) => {
      const home = event.target.closest('[data-home]');
      if (home) { closeModule(); return; }
      const button = event.target.closest('[data-module]');
      if (button) openModule(button.dataset.module);
    });
  }
  function setActive(key) {
    document.querySelectorAll('#p11Nav button').forEach((button) => {
      const active = key ? button.dataset.module === key : button.hasAttribute('data-home');
      button.classList.toggle('active', active);
    });
  }
  function openModule(rawKey, updateHistory = true) {
    const key = moduleKey(rawKey);
    const module = MODULES[key];
    if (!module || !allowed(module)) { setMessage('Tu usuario no tiene permiso para abrir este módulo.'); return; }
    setMessage('');
    $('#p11Dashboard').hidden = true;
    $('#p11Top').hidden = true;
    $('#p11Main').classList.add('module-open');
    $('#p11Workspace').hidden = false;
    $('#p11Title').textContent = module.label;
    const frame = $('#p11Frame');
    if (frame.getAttribute('src') !== module.route) frame.setAttribute('src', module.route);
    setActive(key);
    if (updateHistory) history.replaceState({ ...(history.state || {}), p11Module:key }, '', `/app/centro-de-control-v2?module=${encodeURIComponent(key)}`);
  }
  function closeModule(updateHistory = true) {
    $('#p11Workspace').hidden = true;
    $('#p11Main').classList.remove('module-open');
    $('#p11Top').hidden = false;
    $('#p11Dashboard').hidden = false;
    $('#p11Title').textContent = 'Centro de control';
    setActive('');
    setMessage('');
    if (updateHistory) history.replaceState({ ...(history.state || {}), p11Module:null }, '', '/app/centro-de-control-v2');
    loadDashboard().catch((error) => setMessage(error.message));
  }

  async function loadDashboard() {
    const metrics = $('#p11Metrics');
    metrics.innerHTML = '<div class="p11-loading">Cargando operación real…</div>';
    const results = await Promise.allSettled([
      api('/api/v1/restaurante/v2/mesas'),
      api('/api/v1/restaurante/menu')
    ]);
    const tables = results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [];
    const menu = results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value : [];
    const occupied = tables.filter((table) => Boolean(table.activeSession)).length;
    const bill = tables.filter((table) => String(table.state || '').toUpperCase() === 'CUENTA_PEDIDA').length;
    metrics.innerHTML = `
      <article class="p11-metric"><small>Mesas</small><strong>${tables.length || '—'}</strong><span>configuradas</span></article>
      <article class="p11-metric"><small>Ocupadas</small><strong>${results[0].status === 'fulfilled' ? occupied : '—'}</strong><span>sesiones activas</span></article>
      <article class="p11-metric"><small>Cuenta pedida</small><strong>${results[0].status === 'fulfilled' ? bill : '—'}</strong><span>listas para caja</span></article>
      <article class="p11-metric"><small>Carta</small><strong>${results[1].status === 'fulfilled' ? menu.length : '—'}</strong><span>productos visibles</span></article>`;

    const quick = $('#p11Quick');
    const priority = ['mesas','pedidos','kds','caja','domicilios','employees'];
    const keys = priority.map((key) => key === 'employees' ? 'empleados' : key).filter((key) => MODULES[key] && allowed(MODULES[key]));
    quick.innerHTML = `${keys.map((key) => `<button type="button" data-quick="${esc(key)}"><b>${esc(MODULES[key].label)}</b><small>${esc(MODULES[key].hint)}</small></button>`).join('')}${['ADMIN','SUPER_ADMIN'].includes(role) ? '<a href="/app/inventario"><b>Carta / inventario</b><small>Productos, existencias y precios</small></a>' : ''}`;
    quick.querySelectorAll('[data-quick]').forEach((button) => button.addEventListener('click', () => openModule(button.dataset.quick)));
  }

  function bindStatic() {
    window.addEventListener('popstate', () => {
      const key = moduleKey(new URLSearchParams(location.search).get('module'));
      if (key && MODULES[key] && allowed(MODULES[key])) openModule(key, false);
      else closeModule(false);
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
      else await loadDashboard();
    } catch (error) {
      setMessage(error.message || 'No fue posible abrir el Centro de Control V2.');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
