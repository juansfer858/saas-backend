(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const NAV_VERSION = 'core-nav-v2';
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
  let refreshScheduled = false;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
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
    accessChecked = true;
    const session = readSession();
    if (!session?.token || !session?.subdomain) return false;
    try {
      const response = await fetch('/api/v1/restaurante/ui-context', {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'x-tenant-subdomain': session.subdomain
        }
      });
      if (!response.ok) return false;
      const body = await response.json();
      hasRestaurantAccess = Boolean(body?.ok && body?.data?.permissions);
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

  function installCurrentUi() {
    installCoreNavigationParity();
    installRestaurantDashboardEntry();
  }

  async function refreshEntry() {
    installCoreNavigationParity();
    await checkRestaurantAccess();
    installCurrentUi();
  }

  function scheduleRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    queueMicrotask(() => {
      refreshScheduled = false;
      installCurrentUi();
    });
  }

  const observer = new MutationObserver(scheduleRefresh);

  function start() {
    observer.observe(document.body, { childList: true, subtree: true });
    installCoreNavigationParity();
    refreshEntry();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();