(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const ACCESS_CACHE_PREFIX = 'vantixgc_core_restaurant_access_v2';
  const NAV_VERSION = 'core-nav-v6';
  const SHELL_STYLE_ID = 'vantixgc-core-sidebar-shell-v1';

  let accessChecked = false;
  let hasRestaurantAccess = false;
  let refreshTimer = null;

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

  function ensureCanonicalSidebarStyles() {
    if (document.getElementById(SHELL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SHELL_STYLE_ID;
    style.textContent = `
      .core-tenant-sidebar{background:#10241b!important;color:#fff!important;padding:20px 14px!important;position:sticky!important;top:0!important;height:100vh!important;overflow:auto!important;width:auto!important}
      .core-tenant-sidebar .brand{display:flex!important;align-items:center!important;gap:11px!important;padding:4px 8px 22px!important;font-weight:800!important;font-size:18px!important;color:#fff!important}
      .core-tenant-sidebar .core-brandmark,.core-tenant-sidebar .mark,.core-tenant-sidebar .brandmark{width:34px!important;height:34px!important;min-width:34px!important;border-radius:11px!important;background:linear-gradient(145deg,#fff,#dff2e8)!important;color:#0d6b43!important;display:grid!important;place-items:center!important;font-weight:900!important;font-size:16px!important}
      .core-tenant-sidebar .brand small{display:block!important;color:#9db3a8!important;font-weight:500!important;font-size:12px!important;margin-top:2px!important}
      .core-tenant-sidebar .nav-title{display:block!important;font-size:11px!important;text-transform:uppercase!important;letter-spacing:.12em!important;color:#92aa9f!important;padding:14px 10px 8px!important}
      .core-tenant-sidebar .nav a{display:flex!important;align-items:center!important;gap:10px!important;text-decoration:none!important;color:#d9e6e0!important;padding:10px 11px!important;margin:3px 0!important;border-radius:10px!important;font-size:14px!important;line-height:20px!important}
      .core-tenant-sidebar .nav a:hover,.core-tenant-sidebar .nav a.active{background:#173429!important;color:#fff!important}
      .core-tenant-sidebar .nav .icon{display:inline-block!important;width:22px!important;min-width:22px!important;text-align:center!important}
      @media(max-width:900px){.core-tenant-sidebar{display:none!important}}
    `;
    document.head.appendChild(style);
  }

  function normalizeSidebarChrome() {
    const sidebar = document.querySelector('aside.sidebar, aside.side');
    if (!sidebar) return;

    sidebar.classList.add('core-tenant-sidebar');

    let brand = sidebar.querySelector('.brand');
    if (!brand) {
      brand = document.createElement('div');
      brand.className = 'brand';
      sidebar.prepend(brand);
    }

    const existingMark = brand.querySelector('.mark, .brandmark, .core-brandmark');
    if (!existingMark) {
      brand.replaceChildren();
      const mark = document.createElement('div');
      mark.className = 'core-brandmark';
      mark.textContent = 'V';
      const text = document.createElement('div');
      text.innerHTML = 'VantixGC<br><small>Super Core</small>';
      brand.append(mark, text);
    } else {
      existingMark.classList.add('core-brandmark');
      existingMark.textContent = 'V';
    }

    const nav = sidebar.querySelector('.nav');
    if (nav && !sidebar.querySelector('.nav-title')) {
      const title = document.createElement('div');
      title.className = 'nav-title';
      title.textContent = 'Navegación';
      sidebar.insertBefore(title, nav);
    }
  }

  function currentPath() {
    return String(window.location.pathname || '/app/dashboard').replace(/\/$/, '') || '/app';
  }

  function updateActiveNavigation() {
    const path = currentPath();
    document.querySelectorAll('.sidebar .nav a[data-core-full-route="true"], .side .nav a[data-core-full-route="true"]').forEach((link) => {
      const href = link.getAttribute('href') || '';
      link.classList.toggle('active', path === href || path.startsWith(`${href}/`));
    });
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

  function openRestaurant() {
    window.location.href = '/app/restaurante';
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
      button.textContent = '🍽 Abrir Restaurante';
      button.addEventListener('click', openRestaurant);
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
    ensureCanonicalSidebarStyles();
    normalizeSidebarChrome();
    updateActiveNavigation();
    renameAccountingConfigurationHeading();
    installRestaurantDashboardEntry();
  }

  function scheduleRefresh() {
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      installCurrentUi();
    }, 0);
  }

  const observer = new MutationObserver(scheduleRefresh);

  async function start() {
    bootstrapRestaurantAccessCache();
    installCurrentUi();
    observer.observe(document.body, { childList: true, subtree: true });

    if (!accessChecked) {
      await checkRestaurantAccess();
      installCurrentUi();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.VantixGCCoreNavigationVersion = NAV_VERSION;
  window.VantixGCCoreSidebarShellVersion = 'core-sidebar-v1';
})();