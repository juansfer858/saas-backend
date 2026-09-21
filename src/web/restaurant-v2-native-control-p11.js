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
    gastos:{ label:'Gastos', hint:'Egresos de caja y banco', route:'/app/restaurante-v2/gastos', roles:['ADMIN','SUPER_ADMIN','CAJERO'] },
    cierres:{ label:'Historial de cierres', hint:'Turnos anteriores · informes y reimpresión', route:'/app/cierres', roles:['ADMIN','SUPER_ADMIN','CAJERO'] },
    domicilios:{ label:'Domicilios', hint:'Pedidos para entrega', route:'/app/restaurante-v2/domicilios', roles:['ADMIN','SUPER_ADMIN','MESERO','CAJERO'] },
    carta:{ label:'Carta', hint:'Productos que vende el restaurante', route:'/app/restaurante-v2/carta', roles:['ADMIN','SUPER_ADMIN'] },
    inventario:{ label:'Inventario', hint:'Existencias · compras · movimientos', route:'/app/restaurante-v2/inventario', roles:['ADMIN','SUPER_ADMIN'] },
    gestion:{ label:'Gestión', hint:'Ventas · clientes · proveedores', route:'/app/restaurante-v2/gestion', roles:['ADMIN','SUPER_ADMIN'] },
    empleados:{ label:'Empleados', hint:'Usuarios, roles y asignaciones', route:'/app/restaurante-v2/empleados', roles:['ADMIN','SUPER_ADMIN'] },
    qrs:{ label:'QR de mesas', hint:'Ver e imprimir QR físicos', route:'/app/restaurante-v2/qrs', roles:['ADMIN','SUPER_ADMIN'] },
    devices:{ label:'Dispositivos', hint:'Meseros y producción', route:'/app/restaurante-v2/dispositivos', roles:['ADMIN','SUPER_ADMIN'] },
    contabilidad:{ label:'Contabilidad', hint:'PUC · asientos · libros · reportes', route:'/app/restaurante-v2/contabilidad', roles:['ADMIN','SUPER_ADMIN'], group:'finance' },
    configuracionAvanzada:{ label:'Configuración avanzada', hint:'DIAN · permisos · impresión · empresa', route:'/app/restaurante-v2/configuracion-avanzada', roles:['ADMIN','SUPER_ADMIN'], group:'finance' },
    auditoria:{ label:'Auditoría', hint:'Registro de actividad y cambios', route:'/app/restaurante-v2/configuracion-avanzada?tab=auditoria', roles:['ADMIN','SUPER_ADMIN'], group:'finance' }
  });
  const ALIASES = Object.freeze({ salon:'mesas', mesero:'pedidos' });

  const EMBEDDED_SURFACE_MARKER = 'VANTIX_RESTAURANT_EMBEDDED_SURFACE_V1';
  let expectedFrameRoute = '';
  let expectedFrameKey = '';
  let frameNavigationSeq = 0;

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

  const DEMO_RESTAURANTE = 'demo-restaurante';
  const IS_DEMO_RESTAURANTE = session.subdomain === DEMO_RESTAURANTE;
  const DEMO_HIDDEN_MODULES = new Set(['mesas','division','caja','cierres','qrs']);

  function installDemoModuleShell() {
    if (!IS_DEMO_RESTAURANTE) return;
    document.documentElement.dataset.demoRestaurante = 'true';
    const workspace = $('#p11Workspace');
    const frame = $('#p11Frame');
    if (!workspace || !frame) return;
    workspace.setAttribute('aria-live', 'polite');
    frame.referrerPolicy = 'same-origin';
    if ($('#p11ModuleLoading')) return;
    const loader = document.createElement('div');
    loader.id = 'p11ModuleLoading';
    loader.className = 'p11-module-loading';
    loader.hidden = true;
    loader.innerHTML = '<span class="p11-module-spinner" aria-hidden="true"></span><div><strong id="p11ModuleLoadingTitle">Cargando módulo…</strong><small>Preparando la misma ventana de trabajo</small></div>';
    workspace.prepend(loader);
  }
  function allowed(module) { return module.roles.includes(role); }
  function visibleModules() {
    return Object.entries(MODULES).flatMap(([key, module]) => {
      if (!allowed(module)) return [];
      if (key === 'inventario' && session.subdomain !== DEMO_RESTAURANTE) return [];
      if (key === 'gestion' && session.subdomain !== DEMO_RESTAURANTE) return [];
      if (['contabilidad','configuracionAvanzada'].includes(key) && session.subdomain !== DEMO_RESTAURANTE) return [];
      if (key === 'auditoria' && session.subdomain !== DEMO_RESTAURANTE) return [];
      if (session.subdomain === DEMO_RESTAURANTE && DEMO_HIDDEN_MODULES.has(key)) return [];
      if (session.subdomain === DEMO_RESTAURANTE && key === 'gastos') {
        return [[key, { ...module, label:'Turno y gastos', hint:'Cierre de turno · gastos · historial' }]];
      }
      return [[key, module]];
    });
  }
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

  function routeIdentity(value) {
    try {
      const url = new URL(String(value || ''), location.origin);
      const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
      return `${path}${url.search}`;
    } catch {
      return String(value || '').split('#')[0];
    }
  }

  function setFrameLoading(loading, key = expectedFrameKey) {
    const workspace = $('#p11Workspace');
    const loader = $('#p11ModuleLoading');
    const title = $('#p11ModuleLoadingTitle');
    const frame = $('#p11Frame');
    if (!workspace || !frame || !IS_DEMO_RESTAURANTE) return;
    workspace.classList.toggle('is-module-loading', Boolean(loading));
    workspace.classList.toggle('is-module-ready', !loading);
    if (loader) loader.hidden = !loading;
    if (title && loading) title.textContent = `Cargando ${MODULES[key]?.label || 'módulo'}…`;
    frame.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  function installUniformEmbeddedSurface(frame) {
    if (!IS_DEMO_RESTAURANTE) return;
    let doc;
    try { doc = frame.contentDocument; } catch { return; }
    if (!doc?.documentElement || !doc.body) return;
    doc.documentElement.dataset.vantixRestaurantEmbeddedSurface = EMBEDDED_SURFACE_MARKER;
    if (doc.getElementById('vantixRestaurantEmbeddedSurfaceV1')) return;
    const style = doc.createElement('style');
    style.id = 'vantixRestaurantEmbeddedSurfaceV1';
    style.textContent = `
      html[data-vantix-restaurant-embedded-surface]{
        width:100%!important;max-width:100%!important;min-width:0!important;min-height:100%!important;overflow-x:hidden!important
      }
      html[data-vantix-restaurant-embedded-surface] body{
        width:100%!important;max-width:100%!important;min-width:0!important;min-height:100%!important;
        margin-left:0!important;margin-right:0!important;overflow-x:hidden!important
      }
      html[data-vantix-restaurant-embedded-surface] body>main,
      html[data-vantix-restaurant-embedded-surface] body>.mg-main,
      html[data-vantix-restaurant-embedded-surface] body>.inv-main,
      html[data-vantix-restaurant-embedded-surface] body>.menu-main,
      html[data-vantix-restaurant-embedded-surface] body>.employees-main,
      html[data-vantix-restaurant-embedded-surface] body>.admin-main,
      html[data-vantix-restaurant-embedded-surface] body>.delivery-main,
      html[data-vantix-restaurant-embedded-surface] body>.kds-main,
      html[data-vantix-restaurant-embedded-surface] #root>.app>.main>.content,
      html[data-vantix-restaurant-embedded-surface] .app>.main>.content{
        width:100%!important;max-width:none!important;min-width:0!important;margin:0!important;padding:0!important
      }
      html[data-vantix-restaurant-embedded-surface] body,
      html[data-vantix-restaurant-embedded-surface] button,
      html[data-vantix-restaurant-embedded-surface] input,
      html[data-vantix-restaurant-embedded-surface] select,
      html[data-vantix-restaurant-embedded-surface] textarea{
        font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important
      }
      html[data-vantix-restaurant-embedded-surface] body{font-size:13px!important;line-height:1.4!important}
      html[data-vantix-restaurant-embedded-surface] h1{font-size:24px!important;line-height:1.15!important}
      html[data-vantix-restaurant-embedded-surface] h2{font-size:17px!important;line-height:1.2!important}
      html[data-vantix-restaurant-embedded-surface] h3{font-size:14px!important;line-height:1.25!important}
      html[data-vantix-restaurant-embedded-surface] :where(p,label,td,th,button,input,select,textarea,.btn,.rv2-btn,.tab){font-size:12px!important}
      html[data-vantix-restaurant-embedded-surface] small{font-size:10px!important}
      html[data-vantix-restaurant-embedded-surface] body>.app{display:block!important;min-height:100%!important}
      html[data-vantix-restaurant-embedded-surface] body>.app>:where(.sidebar,.side),
      html[data-vantix-restaurant-embedded-surface] body>.app>.main>:where(.topbar,.top){display:none!important}
      html[data-vantix-restaurant-embedded-surface] body>.app>.main{width:100%!important;min-height:100%!important}
      html[data-vantix-restaurant-embedded-surface] body[data-rv2-module-header="true"]>header.rv2-module-top,
      html[data-vantix-restaurant-embedded-surface] .content>.pagehead,
      html[data-vantix-restaurant-embedded-surface] .content>.head{
        width:100%!important;height:86px!important;min-height:86px!important;margin:0!important;padding:14px 18px!important;
        display:flex!important;align-items:center!important;justify-content:space-between!important;gap:16px!important;
        border:0!important;border-bottom:1px solid #cbd5e1!important;border-radius:0!important;background:#f8fafc!important;box-shadow:none!important
      }
      html[data-vantix-restaurant-embedded-surface] body[data-rv2-module-header="true"]>header.rv2-module-top>div:first-child>span{display:none!important}
      html[data-vantix-restaurant-embedded-surface] :where(.mg-main,.inv-main,.menu-main,.employees-main,.admin-main,.delivery-main,.kds-main,#ccCustomView){
        width:100%!important;max-width:none!important;min-width:0!important;margin:0!important;padding:14px!important
      }
      html[data-vantix-restaurant-embedded-surface] .content>.tabs{margin:14px!important}
      html[data-vantix-restaurant-embedded-surface] .content>#flash{margin-left:14px!important;margin-right:14px!important}
      html[data-vantix-restaurant-embedded-surface] .content>#view{padding:0 14px 14px!important}
      html[data-vantix-restaurant-embedded-surface] :where(.rv2-panel,.panel,.ri-card){border-radius:14px!important}
      @media(max-width:760px){
        html[data-vantix-restaurant-embedded-surface] body[data-rv2-module-header="true"]>header.rv2-module-top,
        html[data-vantix-restaurant-embedded-surface] .content>.pagehead,
        html[data-vantix-restaurant-embedded-surface] .content>.head{height:auto!important;min-height:76px!important;padding:12px 14px!important}
      }
    `;
    doc.head?.appendChild(style);

    if (!doc.documentElement.dataset.vantixRestaurantEmbeddedNavBridge) {
      doc.documentElement.dataset.vantixRestaurantEmbeddedNavBridge = 'VANTIX_RESTAURANT_EMBEDDED_NAV_BRIDGE_V1';
      doc.addEventListener('click', (event) => {
        const anchor = event.target?.closest?.('a[href]');
        if (!anchor || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (anchor.target && anchor.target !== '_self') return;
        let nextUrl;
        try { nextUrl = new URL(anchor.href, frame.contentWindow?.location?.href || location.origin); } catch { return; }
        if (nextUrl.origin !== location.origin) return;
        const nextIdentity = routeIdentity(nextUrl.href);
        const nextModule = Object.entries(MODULES).find(([, module]) => routeIdentity(module.route) === nextIdentity)?.[0];
        if (!nextModule || nextModule === expectedFrameKey || !allowed(MODULES[nextModule])) return;
        event.preventDefault();
        openModule(nextModule, true);
      }, true);
    }
  }

  function settleFrameNavigation() {
    const frame = $('#p11Frame');
    if (!frame || !expectedFrameRoute || !IS_DEMO_RESTAURANTE) return;
    let actual = '';
    try { actual = frame.contentWindow?.location?.href || frame.src || ''; }
    catch { actual = frame.src || ''; }

    let actualUrl = null;
    try { actualUrl = new URL(actual, location.origin); } catch {}
    if (actualUrl && /^\/app\/centro-de-control(?:-v2|-p10)?\/?$/.test(actualUrl.pathname)) {
      // Never allow the shell to render inside its own iframe.
      frame.setAttribute('src', expectedFrameRoute);
      return;
    }
    if (actualUrl && ['/app','/app/login'].includes(actualUrl.pathname)) {
      location.assign(actualUrl.pathname);
      return;
    }

    const expectedIdentity = routeIdentity(expectedFrameRoute);
    const actualIdentity = routeIdentity(actual);
    if (actualIdentity && expectedIdentity && actualIdentity !== expectedIdentity) {
      const actualModule = Object.entries(MODULES).find(([, module]) => routeIdentity(module.route) === actualIdentity)?.[0];
      if (actualModule && actualModule !== expectedFrameKey && allowed(MODULES[actualModule])) {
        // A previous iframe navigation must never reactivate an older module.
        // Legitimate module-to-module links are intercepted by the embedded bridge below.
        setFrameLoading(true, expectedFrameKey);
        if (String(frame.getAttribute('src') || '') !== expectedFrameRoute) frame.setAttribute('src', expectedFrameRoute);
        return;
      }
    }

    installUniformEmbeddedSurface(frame);
    setFrameLoading(false, expectedFrameKey);
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
    const visible = visibleModules();
    const ops = visible.filter(([, module]) => !module.technical && module.group !== 'finance');
    const finance = visible.filter(([, module]) => !module.technical && module.group === 'finance');
    const tech = visible.filter(([, module]) => module.technical);
    nav.innerHTML = `<div class="p11-nav-label">Operación</div>${ops.map(([key,module]) => navItem(key,module)).join('')}${finance.length ? `<div class="p11-nav-label">Finanzas y sistema</div>${finance.map(([key,module]) => navItem(key,module)).join('')}` : ''}${tech.length ? `<div class="p11-nav-label">Técnico</div>${tech.map(([key,module]) => navItem(key,module)).join('')}` : ''}`;
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
    const targetChanged = String(frame.getAttribute('src') || '') !== targetRoute;
    expectedFrameRoute = targetRoute;
    expectedFrameKey = key;
    frameNavigationSeq += 1;
    setActive(key);
    if (targetChanged) {
      // Hide the previous module before navigation so it never flashes below the next one.
      setFrameLoading(true, key);
      frame.dataset.navigationSeq = String(frameNavigationSeq);
      frame.setAttribute('src', targetRoute);
    } else {
      installUniformEmbeddedSurface(frame);
      setFrameLoading(false, key);
    }
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
  function hybridOnline(item) {
    if (item?.installation?.online === true || item?.online === true) return true;
    return String(item?.heartbeat || item?.agent?.heartbeat || '').toUpperCase() === 'ONLINE';
  }
  function hybridVersion(item) {
    return item?.installation?.softwareVersion || item?.agent?.softwareVersion || item?.agent?.version || item?.version || null;
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
    const online = installations.find(hybridOnline);
    if (online) {
      const version = hybridVersion(online);
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
    $('#p11Frame')?.addEventListener('load', () => {
      settleFrameNavigation();
      refreshHybridStatus();
    });
    window.addEventListener('focus', refreshHybridStatus);
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
  }

  function boot() {
    try {
      // P12 is global V2 ONLY. Do not consult the old per-tenant P11 retirement gate:
      // tenants that never toggled P11 individually must still enter V2 directly.
      installDemoModuleShell();
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
