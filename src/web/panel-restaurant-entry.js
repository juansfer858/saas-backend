(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const ACCESS_CACHE_PREFIX = 'vantixgc_core_restaurant_access_v2';
  const NAV_VERSION = 'core-nav-v7';
  const CONTROL_CENTER_PATH = '/app/centro-de-control';
  const SUPER_CORE_VISUAL_THEME = 'super-core-v5-silver-server';

  let accessChecked = false;
  let hasRestaurantAccess = false;
  let localEntryBusy = false;

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

  async function tenantApi(path, opts = {}) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) throw new Error('Sesión VantixGC requerida');
    const response = await fetch(path, {
      ...opts,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        'x-tenant-subdomain': session.subdomain,
        ...(opts.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
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

  function showLocalEntryError(message) {
    const target = document.querySelector('#message, .content .pagehead, .content');
    if (!target) return;
    const box = document.createElement('span');
    box.className = 'ri-error';
    box.style.cssText = 'display:block;margin:10px 0';
    box.textContent = message;
    target.prepend(box);
    setTimeout(() => box.remove(), 7000);
  }

  async function openLocalEdge(agentId, button = null) {
    if (localEntryBusy) return;
    localEntryBusy = true;
    const previous = button?.textContent;
    try {
      if (button) { button.disabled = true; button.textContent = 'Abriendo sede…'; }
      const data = await tenantApi(`/api/v1/edge/agents/${encodeURIComponent(agentId)}/local-access-grant`, { method: 'POST', body: '{}' });
      window.location.href = data.localUrl;
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = previous || 'Trabajar en sede'; }
      localEntryBusy = false;
      showLocalEntryError(error.message);
    }
  }

  async function installLocalWorkspaceEntry() {
    if (!hasRestaurantAccess || currentPath() !== CONTROL_CENTER_PATH) return;
    let rows;
    try { rows = await tenantApi('/api/v1/edge/installations'); }
    catch { return; }
    const online = (rows || []).filter((row) => row.agent?.state === 'ACTIVE' && row.installation?.online && row.installation?.lanHost && row.installation?.lanPort);
    if (!online.length) return;

    const requested = new URLSearchParams(location.search).get('edge');
    const chosen = online.find((row) => row.agent.id === requested) || online[0];
    let actions = document.querySelector('.pagehead .actions, .cc-head .cc-view-actions, .cc-head');
    if (!actions) actions = document.querySelector('.content, main');
    let button = document.querySelector('[data-edge-workspace-entry]');
    if (!button && actions) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn cc-core-link';
      button.dataset.edgeWorkspaceEntry = 'true';
      button.textContent = 'Trabajar en sede';
      button.title = `Abrir ${chosen.agent.pointCode} por LAN · ${chosen.installation.lanHost}:${chosen.installation.lanPort}`;
      button.addEventListener('click', () => openLocalEdge(chosen.agent.id, button));
      actions.appendChild(button);
    }

    if (requested && chosen.agent.id === requested) {
      const url = new URL(location.href);
      url.searchParams.delete('edge');
      url.searchParams.delete('return');
      history.replaceState(history.state, '', url.pathname + (url.search ? url.search : ''));
      setTimeout(() => openLocalEdge(chosen.agent.id, button), 120);
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
    await installLocalWorkspaceEntry();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.VantixGCRestaurantNavigation = Object.freeze({
    controlCenterPath: CONTROL_CENTER_PATH,
    openControlCenter: openRestaurantControlCenter,
    openLocalEdge
  });
  window.VantixGCCoreNavigationVersion = NAV_VERSION;
  window.VantixGCCoreSidebarRuntime = 'off';
  window.VantixGCCoreSidebarShellSource = 'server';
  window.VantixGCCoreSidebarVisualTheme = SUPER_CORE_VISUAL_THEME;
})();