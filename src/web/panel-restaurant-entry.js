(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const ACCESS_CACHE_PREFIX = 'vantixgc_core_restaurant_access_v2';
  const NAV_VERSION = 'core-nav-v7';
  const CONTROL_CENTER_PATH = '/app/centro-de-control';
  const SUPER_CORE_VISUAL_THEME = 'super-core-v5-silver-server';
  const WORKSPACE_THEME = 'super-core-workspace-v6';
  const SIDEBAR_TEXT_COLOR = '#17212b';
  const SIDEBAR_META_COLOR = '#46515a';

  let accessChecked = false;
  let hasRestaurantAccess = false;

  function installWorkspaceTheme() {
    if (document.getElementById('super-core-workspace-v6-style')) return;
    document.head.insertAdjacentHTML('beforeend', `<style id="super-core-workspace-v6-style" data-super-core-workspace="${WORKSPACE_THEME}">
:root{--core-v6-blue:#3b82f6;--core-v6-blue-strong:#2563eb;--core-v6-orange:#f97316;--core-v6-orange-strong:#ea580c;--core-v6-green:#22c55e;--core-v6-green-strong:#16a34a;--core-v6-bg:#f6f8fb;--core-v6-card:#fff;--core-v6-line:#e5eaf0;--core-v6-ink:#1f2937;--core-v6-muted:#667085;--bg:#f6f8fb;--card:#fff;--border:#e5eaf0;--text:#1f2937;--muted:#667085;--green:#3b82f6;--green2:#2563eb;--soft:#eff6ff;--gold:#f97316;--blue:#3b82f6}
body{background:var(--core-v6-bg)!important;color:var(--core-v6-ink)!important;font-family:"Segoe UI Variable","Segoe UI",Arial,sans-serif!important}
.main{min-height:100vh!important;background:linear-gradient(180deg,#f9fbfd 0%,#f6f8fb 100%)!important}
.topbar{height:72px!important;background:#fff!important;border-bottom:1px solid #e9edf2!important;box-shadow:0 1px 0 rgba(15,23,42,.02)!important}
.content{padding:30px!important;max-width:1520px!important}
.pagehead{margin-bottom:24px!important;align-items:center!important}.pagehead h1{font-size:28px!important;line-height:1.1!important;letter-spacing:-.025em!important;color:#111827!important;font-weight:750!important}.pagehead p{color:#667085!important;line-height:1.5!important}
.tenant{color:#111827!important;font-weight:700!important}.tenant small{color:#7b8794!important}.userbox strong{color:#1f2937!important}.avatar{background:#eff6ff!important;color:#2563eb!important;border:1px solid #dbeafe!important}
.card,.panel,.login,.modal{background:#fff!important;border:1px solid var(--core-v6-line)!important;border-radius:18px!important;box-shadow:0 8px 24px rgba(15,23,42,.045)!important}
.card{position:relative!important;overflow:hidden!important}.cards{gap:16px!important;margin-bottom:22px!important}.cards>.card:before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--core-v6-blue)}.cards>.card:nth-child(3n+2):before{background:var(--core-v6-orange)}.cards>.card:nth-child(3n+3):before{background:var(--core-v6-green)}
.metric .label{color:#667085!important;font-size:12px!important;font-weight:650!important;letter-spacing:.025em!important;text-transform:uppercase}.metric .value{color:#111827!important;font-size:27px!important;font-weight:750!important;letter-spacing:-.035em!important}.metric .hint{color:#7b8794!important}
.panel-head{padding:17px 19px!important;border-bottom:1px solid #edf0f3!important}.panel-head h2{font-size:16px!important;font-weight:750!important;color:#1f2937!important}
.btn{border:1px solid #dfe5eb!important;background:#fff!important;color:#27323a!important;border-radius:11px!important;padding:9px 14px!important;min-height:38px!important;font-weight:650!important;box-shadow:none!important;transition:background .15s ease,border-color .15s ease,transform .15s ease!important}.btn:hover{background:#f8fafc!important;border-color:#cfd8e2!important;transform:translateY(-1px)}.btn.primary{background:var(--core-v6-orange)!important;border-color:var(--core-v6-orange)!important;color:#fff!important}.btn.primary:hover{background:var(--core-v6-orange-strong)!important;border-color:var(--core-v6-orange-strong)!important}.btn.danger{background:#fff5f5!important;color:#b42318!important;border-color:#fecaca!important}.btn.small{min-height:32px!important;padding:6px 10px!important}
.input,.select,textarea,input,select,textarea{border-color:#d7dee7!important;border-radius:11px!important;color:#1f2937!important;background:#fff!important}.input:focus,.select:focus,textarea:focus,input:focus,select:focus{outline:none!important;border-color:var(--core-v6-blue)!important;box-shadow:0 0 0 3px rgba(59,130,246,.12)!important}
.table th{background:#f8fafc!important;color:#52606d!important;border-bottom:1px solid #e9edf2!important;font-size:12px!important;font-weight:750!important;letter-spacing:.02em!important}.table td{border-bottom:1px solid #f0f2f5!important;color:#344054!important}.table tr:hover td{background:#f8fbff!important}
.badge{font-weight:750!important;border:1px solid transparent}.b-issued{background:#eff6ff!important;color:#2563eb!important;border-color:#dbeafe!important}.b-partial{background:#fff7ed!important;color:#c2410c!important;border-color:#fed7aa!important}.b-paid{background:#f0fdf4!important;color:#15803d!important;border-color:#bbf7d0!important}.b-draft{background:#f8fafc!important;color:#475467!important;border-color:#e5e7eb!important}
.tabs{border-bottom-color:#edf0f3!important}.tab{color:#667085!important;border-radius:10px!important}.tab.active{background:#eff6ff!important;color:#2563eb!important}.audit-tab.active{color:#2563eb!important;border-color:#3b82f6!important}
.notice{background:#f0fdf4!important;color:#166534!important;border-color:#bbf7d0!important}.error{background:#fff1f0!important;color:#b42318!important;border-color:#fecaca!important}
.login-wrap{background:linear-gradient(135deg,#eff6ff 0%,#fff 52%,#fff7ed 100%)!important}.login{padding:30px!important}.login h1{font-size:27px!important;letter-spacing:-.025em!important;color:#111827!important}.field label{color:#475467!important;font-weight:650!important}
.modal-back{background:rgba(15,23,42,.48)!important}.modal{padding:24px!important}.empty,.loading,.muted{color:#7b8794!important}
.total-row.final{color:#111827!important}.kv div:nth-child(odd){color:#7b8794!important}

/* Canonical Super Core sidebar appearance. Persistent CSS, never per-element JS patches. */
.core-tenant-sidebar .core-v5-tenant{background:linear-gradient(180deg,rgba(252,253,254,.68),rgba(235,240,243,.58))!important;border-color:rgba(255,255,255,.38)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.30),0 8px 18px rgba(20,24,27,.12)!important}
.core-tenant-sidebar .core-v5-tenant b{color:${SIDEBAR_TEXT_COLOR}!important}.core-tenant-sidebar .core-v5-tenant span{color:${SIDEBAR_META_COLOR}!important}
.core-tenant-sidebar .nav a{background:rgba(250,252,253,.66)!important;color:${SIDEBAR_TEXT_COLOR}!important;border-color:rgba(255,255,255,.34)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.24)!important}
.core-tenant-sidebar .nav a:hover{background:rgba(255,255,255,.80)!important;color:${SIDEBAR_TEXT_COLOR}!important;border-color:rgba(255,255,255,.48)!important}
.core-tenant-sidebar .nav a.active{background:linear-gradient(90deg,rgba(210,237,229,.90),rgba(250,252,253,.78))!important;color:${SIDEBAR_TEXT_COLOR}!important;border-color:rgba(255,255,255,.50)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.36),0 7px 16px rgba(20,24,27,.12)!important}
.core-tenant-sidebar .nav a .icon{color:${SIDEBAR_TEXT_COLOR}!important}
.core-tenant-sidebar .nav a.core-v5-primary-vertical{background:linear-gradient(135deg,rgba(252,253,254,.80),rgba(235,240,243,.70))!important;color:${SIDEBAR_TEXT_COLOR}!important;border-color:rgba(255,255,255,.48)!important}
.core-tenant-sidebar .nav a.core-v5-primary-vertical.active{background:linear-gradient(90deg,rgba(210,237,229,.94),rgba(250,252,253,.82))!important;color:${SIDEBAR_TEXT_COLOR}!important}
.core-tenant-sidebar .nav a.core-v5-primary-vertical .icon{color:${SIDEBAR_TEXT_COLOR}!important;background:rgba(19,122,83,.14)!important}
.core-tenant-sidebar .core-v5-primary-copy strong{color:${SIDEBAR_TEXT_COLOR}!important}.core-tenant-sidebar .core-v5-primary-copy small{color:${SIDEBAR_META_COLOR}!important}
.core-tenant-sidebar .brand,.core-tenant-sidebar .brand small,.core-tenant-sidebar .nav-title,.core-tenant-sidebar .core-v5-group-label{color:#f7f9fa!important}

@media(max-width:760px){.content{padding:20px 13px!important}.topbar{height:64px!important}.pagehead{align-items:flex-start!important}.pagehead h1{font-size:24px!important}.cards{gap:12px!important}}
</style>`);
    document.documentElement.dataset.superCoreWorkspace = WORKSPACE_THEME;
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function accessCacheKey(session = readSession()) {
    if (!session?.subdomain) return null;
    const userKey = session.user?.id || session.user?.email || session.user?.rol || 'user';
    return `${ACCESS_CACHE_PREFIX}:${session.subdomain}:${userKey}`;
  }

  function readCachedRestaurantAccess() {
    const key = accessCacheKey();
    if (!key) return null;
    try {
      const value = sessionStorage.getItem(key);
      if (value === '1') return true;
      if (value === '0') return false;
    } catch {}
    return null;
  }

  function writeCachedRestaurantAccess(value) {
    const key = accessCacheKey();
    if (!key) return;
    try { sessionStorage.setItem(key, value ? '1' : '0'); }
    catch {}
  }

  function applyRestaurantVisibility(value) {
    document.documentElement.dataset.coreRestaurantAccess = value ? '1' : '0';
  }

  function bootstrapRestaurantAccessCache() {
    const cached = readCachedRestaurantAccess();
    if (cached === null) return false;
    hasRestaurantAccess = cached;
    accessChecked = true;
    applyRestaurantVisibility(cached);
    return true;
  }

  function currentPath() {
    return String(window.location.pathname || '/app/dashboard').replace(/\/$/, '') || '/app';
  }

  async function checkRestaurantAccess() {
    if (accessChecked) return hasRestaurantAccess;
    const session = readSession();
    if (!session?.token || !session?.subdomain) {
      accessChecked = true;
      hasRestaurantAccess = false;
      applyRestaurantVisibility(false);
      return false;
    }

    try {
      const response = await fetch('/api/v1/restaurante/ui-context', {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'x-tenant-subdomain': session.subdomain
        }
      });

      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          hasRestaurantAccess = false;
          accessChecked = true;
          writeCachedRestaurantAccess(false);
          applyRestaurantVisibility(false);
        }
        return false;
      }

      const body = await response.json();
      hasRestaurantAccess = Boolean(body?.ok && body?.data?.permissions);
      accessChecked = true;
      writeCachedRestaurantAccess(hasRestaurantAccess);
      applyRestaurantVisibility(hasRestaurantAccess);
      return hasRestaurantAccess;
    } catch {
      return hasRestaurantAccess;
    }
  }

  function hydrateTenantCard() {
    const session = readSession();
    if (!session?.subdomain) return;
    const name = document.querySelector('[data-core-tenant-name]');
    const meta = document.querySelector('[data-core-tenant-meta]');
    if (name) name.textContent = session.tenant?.nombreEmpresa || session.subdomain;
    if (meta) meta.textContent = `${session.subdomain}${session.tenant?.pais ? ` · ${session.tenant.pais}` : ''}`;
  }

  function openRestaurantControlCenter() {
    window.location.href = CONTROL_CENTER_PATH;
  }

  function installRestaurantDashboardEntry() {
    const actions = document.querySelector('.pagehead .actions');
    const existing = actions?.querySelector('[data-restaurant-dashboard-entry]');

    if (!hasRestaurantAccess || currentPath() !== '/app/dashboard') {
      existing?.remove();
      return;
    }

    if (actions && !existing) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.dataset.restaurantDashboardEntry = 'true';
      button.textContent = 'Abrir Restaurante';
      button.title = 'Abrir el Centro de Control operativo conectado al restaurante real';
      button.addEventListener('click', openRestaurantControlCenter);
      actions.prepend(button);
    }
  }

  function renameAccountingConfigurationHeading() {
    if (currentPath() !== '/app/configuracion') return;
    const heading = document.querySelector('.content .pagehead h1, .content .head h1');
    if (heading && heading.textContent.trim() !== 'Parametrización Contable') {
      heading.textContent = 'Parametrización Contable';
    }
  }

  function installCurrentUi() {
    hydrateTenantCard();
    renameAccountingConfigurationHeading();
    installRestaurantDashboardEntry();
  }

  async function start() {
    bootstrapRestaurantAccessCache();
    installCurrentUi();

    if (!accessChecked) {
      await checkRestaurantAccess();
      installCurrentUi();
    }
  }

  installWorkspaceTheme();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.VantixGCRestaurantNavigation = Object.freeze({
    controlCenterPath: CONTROL_CENTER_PATH,
    openControlCenter: openRestaurantControlCenter
  });
  window.VantixGCCoreNavigationVersion = NAV_VERSION;
  window.VantixGCCoreSidebarRuntime = 'off';
  window.VantixGCCoreSidebarShellSource = 'server';
  window.VantixGCCoreSidebarVisualTheme = SUPER_CORE_VISUAL_THEME;
  window.VantixGCCoreSidebarTextColor = SIDEBAR_TEXT_COLOR;
  window.VantixGCCoreWorkspaceTheme = WORKSPACE_THEME;
})();