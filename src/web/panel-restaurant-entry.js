(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const ACCESS_CACHE_PREFIX = 'vantixgc_core_restaurant_access_v2';
  const NAV_VERSION = 'core-nav-v7';
  const CONTROL_CENTER_PATH = '/app/centro-de-control';
  const SUPER_CORE_VISUAL_THEME = 'super-core-v5-silver';

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

  const iconPaths = Object.freeze({
    '/app/dashboard': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    '/app/centro-de-control': '<path d="M6 3v8M9 3v8M6 7h3M7.5 11v10M15 3v8c0 2 1 3 3 3v7M18 3v11"/>',
    '/app/ventas': '<circle cx="9" cy="20" r="1"/><circle cx="19" cy="20" r="1"/><path d="M3 4h2l2.5 11h10.8l2-7H7"/>',
    '/app/compras': '<path d="M4 7h16l-1 13H5L4 7Z"/><path d="M8 7a4 4 0 0 1 8 0"/>',
    '/app/inventario': '<path d="M4 7 12 3l8 4-8 4-8-4Z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z"/>',
    '/app/tesoreria': '<path d="M3 9h18M5 9v9M9 9v9M15 9v9M19 9v9M3 18h18M12 3l9 4H3l9-4Z"/>',
    '/app/cartera': '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    '/app/terceros': '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2-6 6-6s6 2 6 6M16 5c2 0 3 1 3 3s-1 3-3 3"/>',
    '/app/contabilidad': '<path d="M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V3Z"/><path d="M7 3v18M10 8h6M10 12h6M10 16h4"/>',
    '/app/configuracion': '<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/>',
    '/app/configuracion-avanzada': '<circle cx="12" cy="12" r="3"/><path d="M4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4"/>'
  });

  function installSuperCoreV5Styles() {
    if (document.getElementById('vantixgc-super-core-v5-theme')) return;
    const style = document.createElement('style');
    style.id = 'vantixgc-super-core-v5-theme';
    style.textContent = `
      .core-tenant-sidebar{background:linear-gradient(145deg,#a8b0b5 0%,#7f888f 28%,#5f676d 62%,#90989e 100%)!important;color:#eef2f3!important;padding:18px 14px!important;box-shadow:8px 0 28px rgba(37,43,47,.16)!important}
      .core-tenant-sidebar .brand{gap:11px!important;padding:4px 8px 14px!important;color:#fff!important;font-size:18px!important;font-weight:850!important}
      .core-tenant-sidebar .core-brandmark{width:36px!important;height:36px!important;min-width:36px!important;border-radius:10px!important;background:#137a53!important;color:#fff!important;box-shadow:0 8px 20px rgba(19,122,83,.25)!important}
      .core-tenant-sidebar .brand small{color:#d7dde0!important;letter-spacing:.08em!important;font-size:10px!important;font-weight:700!important}
      .core-v5-tenant{margin:0 5px 15px;padding:11px 12px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.07));box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 10px 22px rgba(20,24,27,.18)}
      .core-v5-tenant b{display:block;color:#fff;font-size:12px;line-height:1.25;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.core-v5-tenant span{display:block;margin-top:3px;color:#d0d7da;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .core-tenant-sidebar .nav-title,.core-v5-group-label{display:block!important;padding:8px 11px 5px!important;color:#d2d8db!important;font-size:9px!important;line-height:1.2!important;letter-spacing:.14em!important;text-transform:uppercase!important;font-weight:850!important}
      .core-tenant-sidebar .nav{display:flex!important;flex-direction:column!important;gap:3px!important}
      .core-tenant-sidebar .nav a{position:relative!important;display:flex!important;align-items:center!important;gap:10px!important;min-height:42px!important;margin:0!important;padding:9px 10px!important;border:1px solid rgba(255,255,255,.18)!important;border-radius:9px!important;background:rgba(243,246,248,.34)!important;color:#fff!important;font-size:12px!important;line-height:1.2!important;font-weight:700!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.10)!important;transition:background .15s ease,transform .15s ease,border-color .15s ease!important}
      .core-tenant-sidebar .nav a:hover{background:rgba(247,249,250,.44)!important;color:#fff!important;transform:translateX(1px)!important}
      .core-tenant-sidebar .nav a.active{background:linear-gradient(90deg,rgba(19,122,83,.40),rgba(255,255,255,.28))!important;color:#fff!important;border-color:rgba(255,255,255,.22)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.34),0 10px 22px rgba(20,24,27,.20)!important}
      .core-tenant-sidebar .nav a.active:before{content:'';position:absolute;left:-5px;top:8px;bottom:8px;width:3px;border-radius:3px;background:#3bc88d}
      .core-tenant-sidebar .nav .icon{display:grid!important;place-items:center!important;width:20px!important;min-width:20px!important;height:20px!important;color:inherit!important}.core-tenant-sidebar .nav .icon svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
      .core-tenant-sidebar .nav a.core-v5-primary-vertical{order:-1;min-height:70px!important;margin:0 0 10px!important;padding:12px 11px!important;border-color:rgba(255,255,255,.28)!important;background:linear-gradient(135deg,rgba(247,249,250,.50),rgba(215,222,225,.30))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.32),0 12px 25px rgba(32,38,42,.18)!important}
      .core-tenant-sidebar .nav a.core-v5-primary-vertical .icon{width:30px!important;min-width:30px!important;height:30px!important;border-radius:9px;background:rgba(19,122,83,.18);color:#fff}.core-tenant-sidebar .nav a.core-v5-primary-vertical .icon svg{width:21px;height:21px;stroke-width:1.8}
      .core-v5-primary-copy{display:flex;min-width:0;flex-direction:column;gap:3px}.core-v5-primary-copy strong{font-size:15px;line-height:1.05;color:#fff;font-weight:900}.core-v5-primary-copy small{font-size:9px;color:#eef3f1;font-weight:750;letter-spacing:.04em}
      .core-tenant-sidebar .nav a.core-v5-primary-vertical.active{background:linear-gradient(90deg,rgba(19,122,83,.52),rgba(255,255,255,.30))!important}
      @media(max-width:760px){.core-v5-tenant{display:none}.core-tenant-sidebar .nav a.core-v5-primary-vertical{min-height:58px!important}}
    `;
    document.head.appendChild(style);
  }

  function lineIcon(path) {
    const markup = iconPaths[path];
    if (!markup) return null;
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${markup}</svg>`;
  }

  function installSuperCoreV5Navigation() {
    const sidebar = document.querySelector('.core-tenant-sidebar');
    const nav = sidebar?.querySelector('.nav');
    if (!sidebar || !nav) return;

    const session = readSession();
    const brand = sidebar.querySelector('.brand');
    if (brand && !sidebar.querySelector('.core-v5-tenant') && session?.subdomain) {
      const tenant = document.createElement('div');
      tenant.className = 'core-v5-tenant';
      const name = document.createElement('b');
      name.textContent = session.tenant?.nombreEmpresa || session.subdomain;
      const meta = document.createElement('span');
      meta.textContent = `${session.subdomain}${session.tenant?.pais ? ` · ${session.tenant.pais}` : ''}`;
      tenant.append(name, meta);
      brand.insertAdjacentElement('afterend', tenant);
    }

    const title = sidebar.querySelector('.nav-title');
    if (title) title.textContent = 'Principal';

    nav.querySelectorAll('a[href]').forEach((link) => {
      const href = String(link.getAttribute('href') || '').split('?')[0];
      const icon = link.querySelector('.icon');
      const svg = lineIcon(href);
      if (icon && svg && icon.dataset.v5Icon !== '1') {
        icon.innerHTML = svg;
        icon.dataset.v5Icon = '1';
      }
    });

    const finance = nav.querySelector('a[href="/app/contabilidad"]');
    if (finance && !nav.querySelector('.core-v5-group-label')) {
      const label = document.createElement('div');
      label.className = 'core-v5-group-label';
      label.textContent = 'Finanzas y sistema';
      nav.insertBefore(label, finance);
    }

    const primary = nav.querySelector('[data-restaurant-entry="true"]');
    if (primary) {
      primary.classList.add('core-v5-primary-vertical');
      primary.dataset.coreVerticalPrimary = 'true';
      if (!primary.querySelector('.core-v5-primary-copy')) {
        const oldLabel = [...primary.children].find((node) => node !== primary.querySelector('.icon'));
        if (oldLabel) {
          const copy = document.createElement('span');
          copy.className = 'core-v5-primary-copy';
          const name = document.createElement('strong');
          name.textContent = 'Restaurante';
          const small = document.createElement('small');
          small.textContent = 'Operación principal';
          copy.append(name, small);
          oldLabel.replaceWith(copy);
        }
      }
      nav.prepend(primary);
    }
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
    installSuperCoreV5Styles();
    installSuperCoreV5Navigation();
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

  window.VantixGCRestaurantNavigation = Object.freeze({
    controlCenterPath: CONTROL_CENTER_PATH,
    openControlCenter: openRestaurantControlCenter
  });
  window.VantixGCCoreNavigationVersion = NAV_VERSION;
  window.VantixGCCoreSidebarRuntime = 'off';
  window.VantixGCCoreSidebarShellSource = 'server';
  window.VantixGCCoreSidebarVisualTheme = SUPER_CORE_VISUAL_THEME;
})();