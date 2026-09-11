(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V2_NATIVE_CONTROL_P11';
  const P12_MARKER = 'VANTIX_RESTAURANT_V2_ONLY_CONTROL_P12';
  const MODULE_CHROME_MARKER = 'VANTIX_RESTAURANT_V2_MODULE_CHROME_CLEAN_P11';
  const OPERATION_NAV_MARKER = 'VANTIX_RESTAURANT_V2_OPERATION_NAV_NO_DASHBOARD_P11';
  const HYBRID_STATUS_MARKER = 'VANTIX_RESTAURANT_V2_HYBRID_STATUS_V84';
  const HYBRID_SECTION = 'estado-local-nube';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const MODULES = Object.freeze({
    mesas:{ label:'Mesas', hint:'Salón y estado de mesas', route:'/app/restaurante-v2/mesas', roles:['ADMIN','SUPER_ADMIN','MESERO','CAJERO'] },
    pedidos:{ label:'Pedidos', hint:'Tomar y revisar pedidos', route:'/app/restaurante-v2/pedidos', roles:['ADMIN','SUPER_ADMIN','MESERO'] },
    kds:{ label:'Producción', hint:'Cocina · Barra · Postres', route:'/app/restaurante-v2/kds', roles:['ADMIN','SUPER_ADMIN','COCINA','BARRA','POSTRES','MESERO'] },
    division:{ label:'División', hint:'Cuenta conjunta o individual', route:'/app/restaurante-v2/division', roles:['ADMIN','SUPER_ADMIN','CAJERO','MESERO'] },
    caja:{ label:'Caja', hint:'Cobro y cierre real', route:'/app/restaurante-v2/caja', roles:['ADMIN','SUPER_ADMIN','CAJERO'] },
    domicilios:{ label:'Domicilios', hint:'Pedidos para entrega', route:'/app/restaurante-v2/domicilios', roles:['ADMIN','SUPER_ADMIN','MESERO','CAJERO'] },
    carta:{ label:'Carta', hint:'Productos que vende el restaurante', route:'/app/restaurante-v2/carta', roles:['ADMIN','SUPER_ADMIN'] },
    empleados:{ label:'Empleados', hint:'Usuarios, roles y asignaciones', route:'/app/restaurante-v2/empleados', roles:['ADMIN','SUPER_ADMIN'] },
    qrs:{ label:'QR de mesas', hint:'Ver e imprimir QR físicos', route:'/app/restaurante-v2/qrs', roles:['ADMIN','SUPER_ADMIN'] },
    devices:{ label:'Dispositivos', hint:'Meseros y producción', route:'/app/restaurante-v2/dispositivos', roles:['ADMIN','SUPER_ADMIN'] }
  });
  const ALIASES = Object.freeze({ salon:'mesas', mesero:'pedidos' });

  document.documentElement.dataset.restaurantV2NativeControl = MARKER;
  document.documentElement.dataset.restaurantV2OnlyControl = P12_MARKER;
  document.documentElement.dataset.restaurantV2ModuleChrome = MODULE_CHROME_MARKER;
  document.documentElement.dataset.restaurantV2OperationNav = OPERATION_NAV_MARKER;
  document.documentElement.dataset.restaurantV2HybridStatus = HYBRID_STATUS_MARKER;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }
  const session = readSession();
  if (!session?.token || !session?.subdomain) { location.replace('/app'); return; }
  const role = String(session.user?.rol || '').toUpperCase();
  const $ = (q, root = document) => root.querySelector(q);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));

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
  function sectionKey(value) {
    return String(value || '').trim() === HYBRID_SECTION ? HYBRID_SECTION : '';
  }

  function renderIdentity() {
    const tenant = session.tenant?.nombreEmpresa || session.tenant?.nombre || session.subdomain || 'Restaurante';
    $('#p11Tenant').textContent = tenant;
    $('#p11TenantMeta').textContent = session.subdomain;
  }

  function navItem(key, module) {
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
    document.querySelectorAll('#p11Nav [data-module]').forEach((item) => {
      item.classList.toggle('active', item.dataset.module === key);
    });
  }
  function openModule(rawKey, updateHistory = true, rawSection = '') {
    const key = moduleKey(rawKey);
    const module = MODULES[key];
    if (!module || !allowed(module)) { setMessage('Tu usuario no tiene permiso para abrir este módulo.'); return; }
    if (module.external) { location.assign(module.route); return; }
    const section = key === 'devices' ? sectionKey(rawSection) : '';
    const targetRoute = `${module.route}${section ? `#${section}` : ''}`;
    setMessage('');
    $('#p11Main').classList.add('module-open');
    $('#p11Workspace').hidden = false;
    const frame = $('#p11Frame');
    if (frame.getAttribute('src') !== targetRoute) frame.setAttribute('src', targetRoute);
    setActive(key);
    if (updateHistory) {
      const url = new URL('/app/centro-de-control-v2', location.origin);
      url.searchParams.set('module', key);
      if (section) url.searchParams.set('section', section);
      history.replaceState({ ...(history.state || {}), p11Module:key, p11Section:section || null }, '', `${url.pathname}${url.search}`);
    }
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

  function hybridInstallations(payload) {
    return Array.isArray(payload) ? payload : [];
  }
  function setHybridStatus(kind, label, detail) {
    const button = $('#p11HybridStatus');
    if (!button) return;
    button.classList.remove('is-checking','is-online','is-offline','is-cloud','is-unknown');
    button.classList.add(`is-${kind}`);
    $('#p11HybridLabel').textContent = label;
    $('#p11HybridDetail').textContent = detail;
  }
  function renderHybridStatus(rows) {
    const installations = hybridInstallations(rows);
    const online = installations.find((item) => String(item?.heartbeat || item?.agent?.heartbeat || '').toUpperCase() === 'ONLINE');
    if (online) {
      const version = online.agent?.version || online.version || null;
      setHybridStatus('online', 'HÍBRIDO · Edge en línea', `Nube y Edge local disponibles${version ? ` · Edge ${version}` : ''}`);
      return;
    }
    if (installations.length) {
      setHybridStatus('offline', 'HÍBRIDO · Edge sin conexión', 'Nube activa · la operación sigue por Internet');
      return;
    }
    setHybridStatus('cloud', 'HÍBRIDO · Edge no instalado', 'Nube activa · este restaurante depende de Internet');
  }
  async function refreshHybridStatus() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('/api/v1/edge/installations', {
        method:'GET',
        cache:'no-store',
        signal:controller.signal,
        headers:{
          Accept:'application/json',
          Authorization:`Bearer ${session.token}`,
          'x-tenant-subdomain':session.subdomain
        }
      });
      let body = {};
      try { body = await response.json(); } catch {}
      if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
      renderHybridStatus(body?.data);
    } catch (_error) {
      setHybridStatus('unknown', 'HÍBRIDO · Estado Edge no disponible', 'Nube activa · no se pudo consultar el acceso local');
    } finally {
      clearTimeout(timeout);
    }
  }
  function openHybridDevices() {
    const devices = MODULES.devices;
    if (!allowed(devices)) {
      setMessage('El estado es informativo. Sólo Administración puede abrir Dispositivos.');
      return;
    }
    openModule('devices', true, HYBRID_SECTION);
  }

  function bindStatic() {
    $('#p11HybridStatus')?.addEventListener('click', openHybridDevices);
    window.addEventListener('popstate', () => {
      const params = new URLSearchParams(location.search);
      const key = moduleKey(params.get('module'));
      const section = sectionKey(params.get('section'));
      if (key && MODULES[key] && allowed(MODULES[key])) openModule(key, false, section);
      else openDefault(false);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshHybridStatus();
    });
    window.setInterval(refreshHybridStatus, 30000);
  }

  function boot() {
    try {
      // P12 is global V2 ONLY. Do not consult the old per-tenant P11 retirement gate:
      // tenants that never toggled P11 individually must still enter V2 directly.
      renderIdentity();
      renderNav();
      bindStatic();
      const params = new URLSearchParams(location.search);
      const initial = moduleKey(params.get('module'));
      const section = sectionKey(params.get('section'));
      if (initial && MODULES[initial] && allowed(MODULES[initial])) openModule(initial, false, section);
      else openDefault(true);
      refreshHybridStatus();
    } catch (error) {
      setMessage(error.message || 'No fue posible abrir la operación V2.');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
