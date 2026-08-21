(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const ACCESS_CACHE_PREFIX = 'vantixgc_core_restaurant_access_v2';
  const NAV_VERSION = 'core-nav-v5';
  const CORE_NAV_ITEMS = Object.freeze([
    Object.freeze({ href: '/app/dashboard', icon: '▦', label: 'Dashboard' }),
    Object.freeze({ href: '/app/restaurante', icon: '🍽', label: 'Restaurante', restaurantOnly: true }),
    Object.freeze({ href: '/app/ventas', icon: '🛒', label: 'Ventas' }),
    Object.freeze({ href: '/app/compras', icon: '🛍', label: 'Compras' }),
    Object.freeze({ href: '/app/inventario', icon: '▣', label: 'Inventarios / Kardex' }),
    Object.freeze({ href: '/app/tesoreria', icon: '🏦', label: 'Tesorería & Bancos' }),
    Object.freeze({ href: '/app/cartera', icon: '📑', label: 'Cartera' }),
    Object.freeze({ href: '/app/terceros', icon: '👥', label: 'Terceros' }),
    Object.freeze({ href: '/app/contabilidad', icon: '📒', label: 'Contabilidad' }),
    Object.freeze({ href: '/app/configuracion', icon: '⚙', label: 'Parametrización Contable' }),
    Object.freeze({ href: '/app/configuracion-avanzada', icon: '🧩', label: 'Configuración avanzada' })
  ]);

  window.VantixGCCoreNavigation = CORE_NAV_ITEMS;

  let accessChecked = false;
  let hasRestaurantAccess = false;
  let observerStarted = false;
  let installing = false;
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

  function bootstrapRestaurantAccessCache() {
    const cached = readCachedRestaurantAccess();
    if (cached === null) return false;
    hasRestaurantAccess = cached;
    accessChecked = true;
    return true;
  }

  function openFullCoreRoute(path, event) {
    event?.preventDefault?.();
    window.location.href = path;
  }

  function currentPath() {
    return String(window.location.pathname || '/app/dashboard').replace(/\/$/, '') || '/app';
  }

  function isActive(href) {
    const path = currentPath();
    return path === href || path.startsWith(`${href}/`);
  }

  function visibleItems() {
    return CORE_NAV_ITEMS.filter((item) => !item.restaurantOnly || hasRestaurantAccess);
  }

  function navigationSignature(items) {
    return items.map((item) => `${item.href}|${item.label}|${isActive(item.href) ? '1' : '0'}`).join('||');
  }

  function canonicalNavigationHtml(items) {
    return items.map((item) => {
      const active = isActive(item.href) ? ' active' : '';
      const restaurantAttr = item.restaurantOnly ? ' data-restaurant-entry="true"' : '';
      return `<a href="${item.href}" class="${active.trim()}" data-core-full-route="true"${restaurantAttr}><span class="icon">${item.icon}</span><span>${item.label}</span></a>`;
    }).join('');
  }

  function installCoreNavigationParity() {
    const items = visibleItems();
    const signature = navigationSignature(items);
    const navs = document.querySelectorAll('.sidebar .nav, .side .nav');

    navs.forEach((nav) => {
      if (nav.dataset.coreNavigationVersion === NAV_VERSION && nav.dataset.coreNavigationSignature === signature) return;
      nav.innerHTML = canonicalNavigationHtml(items);
      nav.dataset.coreNavigationVersion = NAV_VERSION;
      nav.dataset.coreNavigationSignature = signature;
      nav.querySelectorAll('a[data-core-full-route="true"]').forEach((link) => {
        link.addEventListener('click', (event) => openFullCoreRoute(link.getAttribute('href'), event));
      });
    });

    if (currentPath() === '/app/configuracion') {
      const heading = document.querySelector('.content .pagehead h1, .content .head h1');
      if (heading && heading.textContent.trim() !== 'Parametrización Contable') {
        heading.textContent = 'Parametrización Contable';
      }
    }
  }

  async function checkRestaurantAccess() {
    if (accessChecked) return hasRestaurantAccess;
    const session = readSession();
    if (!session?.token || !session?.subdomain) {
      accessChecked = true;
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
        }
        return false;
      }
      const body = await response.json();
      hasRestaurantAccess = Boolean(body?.ok && body?.data?.permissions);
      accessChecked = true;
      writeCachedRestaurantAccess(hasRestaurantAccess);
      return hasRestaurantAccess;
    } catch {
      return false;
    }
  }

  function openRestaurant(event) {
    openFullCoreRoute('/app/restaurante', event);
  }

  function installRestaurantDashboardEntry() {
    if (!hasRestaurantAccess || currentPath() !== '/app/dashboard') return;
    const actions = document.querySelector('.pagehead .actions');
    if (actions && !actions.querySelector('[data-restaurant-dashboard-entry]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.dataset.restaurantDashboardEntry = 'true';
      button.textContent = '🍽 Abrir Restaurante';
      button.addEventListener('click', openRestaurant);
      actions.prepend(button);
    }
  }

  function observeUi() {
    if (!observerStarted) return;
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function installCurrentUi() {
    if (installing) return;
    installing = true;
    if (observerStarted) observer.disconnect();
    try {
      installCoreNavigationParity();
      installRestaurantDashboardEntry();
    } finally {
      installing = false;
      if (observerStarted) observeUi();
    }
  }

  async function refreshEntry() {
    await checkRestaurantAccess();
    installCurrentUi();
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
    const accessWasCached = bootstrapRestaurantAccessCache();
    if (accessWasCached) installCurrentUi();
    else await refreshEntry();

    observerStarted = true;
    observeUi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();