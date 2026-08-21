(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const ACCESS_CACHE_PREFIX = 'vantixgc_core_restaurant_access_v2';
  const NAV_VERSION = 'core-nav-v6';

  let accessChecked = false;
  let hasRestaurantAccess = false;

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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.VantixGCCoreNavigationVersion = NAV_VERSION;
  window.VantixGCCoreSidebarRuntime = 'off';
})();