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
  const DASHBOARD_ANALYTICS_VERSION = 'core-dashboard-analytics-v2';

  let accessChecked = false;
  let hasRestaurantAccess = false;
  let dashboardSequence = 0;

  document.documentElement.dataset.superCoreWorkspace = WORKSPACE_THEME;

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

  function htmlEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
  }

  function dashboardMoney(value) {
    const session = readSession();
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: session?.tenant?.moneda || 'COP',
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  function dashboardNumber(value, maximumFractionDigits = 0) {
    return new Intl.NumberFormat('es-CO', { maximumFractionDigits }).format(Number(value || 0));
  }

  function trendText(value, comparison) {
    if (value === null || value === undefined) return `<span class="core-dash-trend neutral">Sin base anterior</span>`;
    const n = Number(value || 0);
    const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'neutral';
    const arrow = n > 0 ? '↑' : n < 0 ? '↓' : '→';
    return `<span class="core-dash-trend ${cls}">${arrow} ${n > 0 ? '+' : ''}${dashboardNumber(n, 1)}% <small>${htmlEscape(comparison)}</small></span>`;
  }

  function dashboardIcon(kind) {
    const icons = {
      sales: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h2l2 10h9l2-7H7"/><circle cx="10" cy="19" r="1"/><circle cx="18" cy="19" r="1"/></svg>',
      month: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3M8 17h3"/></svg>',
      ticket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 12 4h7v7l-8 8-7-7Z"/><circle cx="16" cy="8" r="1"/></svg>',
      cartera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h14a2 2 0 0 1 2 2v9H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h12"/><path d="M15 11h6v4h-6a2 2 0 1 1 0-4Z"/></svg>',
      orders: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h4"/></svg>',
      stock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z"/></svg>',
      tables: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14v5H5zM7 13v7M17 13v7M3 11h2M19 11h2"/></svg>',
      products: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v14H4zM8 3h8v3M8 10h8M8 14h5"/></svg>'
    };
    return icons[kind] || icons.sales;
  }

  async function coreGet(path) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) throw new Error('Sesión no disponible');
    const response = await fetch(path, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'x-tenant-subdomain': session.subdomain
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `Error HTTP ${response.status}`);
    return body?.data;
  }

  function dayLabel(dateText) {
    const date = new Date(`${dateText}T12:00:00Z`);
    const label = new Intl.DateTimeFormat('es-CO', { weekday: 'short', timeZone: 'UTC' }).format(date).replace('.', '');
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function buildSalesBars(items) {
    const days = Array.isArray(items) ? items : [];
    const max = Math.max(...days.map((row) => Number(row.total || 0)), 1);
    return days.map((row, index) => {
      const total = Number(row.total || 0);
      const pct = total > 0 ? Math.max((total / max) * 100, 4) : 1.5;
      const tone = index === 4 ? 'orange' : index >= 5 ? 'green' : 'blue';
      return `<div class="core-dash-bar-slot"><div class="core-dash-bar-value">${total ? dashboardMoney(total) : '$ 0'}</div><div class="core-dash-bar-track"><div class="core-dash-bar ${tone}" style="height:${pct.toFixed(1)}%"></div></div><div class="core-dash-day">${htmlEscape(dayLabel(row.date))}</div></div>`;
    }).join('');
  }

  function buildProductMix(products, productSalesTotal) {
    const rows = Array.isArray(products) ? products.slice(0, 4) : [];
    const colors = ['#3b82f6', '#f97316', '#22c55e', '#8b5cf6'];
    const used = rows.reduce((sum, row) => sum + Number(row.participacion || 0), 0);
    const otherShare = Math.max(0, Number((100 - used).toFixed(1)));
    const segments = rows.map((row, index) => ({
      label: row.nombre,
      share: Number(row.participacion || 0),
      sales: Number(row.ventas || 0),
      color: colors[index]
    }));
    if (otherShare > 0.05) {
      const topSales = rows.reduce((sum, row) => sum + Number(row.ventas || 0), 0);
      segments.push({ label: 'Otros', share: otherShare, sales: Math.max(0, Number(productSalesTotal || 0) - topSales), color: '#98a2b3' });
    }
    let cursor = 0;
    const gradient = segments.length ? segments.map((segment) => {
      const start = cursor;
      cursor += segment.share;
      return `${segment.color} ${start.toFixed(1)}% ${Math.min(cursor, 100).toFixed(1)}%`;
    }).join(',') : '#e5e7eb 0 100%';
    const legend = segments.length ? segments.map((segment) => `<div class="core-dash-legend-row"><span class="core-dash-dot" style="background:${segment.color}"></span><span class="core-dash-legend-name">${htmlEscape(segment.label)}</span><strong>${dashboardNumber(segment.share, 1)}%</strong><span>${dashboardMoney(segment.sales)}</span></div>`).join('') : '<div class="core-dash-empty-small">Aún no hay productos vendidos este mes.</div>';
    return `<div class="core-dash-donut-wrap"><div class="core-dash-donut" style="background:conic-gradient(${gradient})"><div class="core-dash-donut-center"><small>Ventas productos</small><strong>${dashboardMoney(productSalesTotal || 0)}</strong></div></div><div class="core-dash-legend">${legend}</div></div>`;
  }

  function buildTopProducts(products) {
    const rows = Array.isArray(products) ? products : [];
    if (!rows.length) return '<div class="core-dash-empty-small">Aún no hay productos vendidos este mes.</div>';
    const maxQty = Math.max(...rows.map((row) => Number(row.cantidad || 0)), 1);
    return rows.map((row, index) => {
      const width = Math.max((Number(row.cantidad || 0) / maxQty) * 100, 3);
      return `<div class="core-dash-ranking-row"><span class="core-dash-rank">${index + 1}.</span><div class="core-dash-product-copy"><strong>${htmlEscape(row.nombre)}</strong><small>${dashboardNumber(row.cantidad, 2)} uds.</small></div><div class="core-dash-rank-track"><span style="width:${width.toFixed(1)}%"></span></div><strong class="core-dash-product-money">${dashboardMoney(row.ventas)}</strong></div>`;
    }).join('');
  }

  async function loadRestaurantOperationalData() {
    if (!hasRestaurantAccess) return null;
    try {
      const [tables, orders] = await Promise.all([
        coreGet('/api/v1/restaurante/mesas'),
        coreGet('/api/v1/restaurante/pedidos?limit=200')
      ]);
      const tableRows = Array.isArray(tables) ? tables : [];
      const orderRows = Array.isArray(orders) ? orders : [];
      const terminal = new Set(['ENTREGADO', 'ENTREGADA', 'CANCELADO', 'CANCELADA', 'CERRADO', 'CERRADA', 'COMPLETADO', 'COMPLETADA']);
      return {
        mesasOcupadas: tableRows.filter((row) => Boolean(row.activeSession)).length,
        mesasTotales: tableRows.length,
        pedidosActivos: orderRows.filter((row) => !terminal.has(String(row.state || row.estado || '').toUpperCase())).length
      };
    } catch {
      return null;
    }
  }

  function buildOperationalIndicators(data, restaurant) {
    const indicators = data?.indicators || {};
    const kpis = data?.kpis || {};
    const rows = restaurant ? [
      { tone: 'blue', icon: 'orders', label: 'Pedidos activos', value: restaurant.pedidosActivos, note: 'En operación' },
      { tone: 'orange', icon: 'stock', label: 'Stock crítico', value: indicators.stockCritico, note: 'Existencia ≤ 5' },
      { tone: 'green', icon: 'tables', label: 'Mesas ocupadas', value: restaurant.mesasOcupadas, note: `De ${restaurant.mesasTotales} disponibles` },
      { tone: 'purple', icon: 'cartera', label: 'Cobros pendientes', value: kpis.carteraDocumentos, note: 'Facturas abiertas' }
    ] : [
      { tone: 'blue', icon: 'sales', label: 'Ventas del mes', value: kpis.ventasMesCantidad, note: 'Documentos emitidos' },
      { tone: 'orange', icon: 'stock', label: 'Stock crítico', value: indicators.stockCritico, note: 'Existencia ≤ 5' },
      { tone: 'green', icon: 'products', label: 'Productos activos', value: indicators.productosActivos, note: 'Catálogo disponible' },
      { tone: 'purple', icon: 'cartera', label: 'Cobros pendientes', value: kpis.carteraDocumentos, note: 'Facturas abiertas' }
    ];
    return rows.map((row) => `<div class="core-dash-op-card ${row.tone}"><div class="core-dash-op-icon">${dashboardIcon(row.icon)}</div><div><span>${htmlEscape(row.label)}</span><strong>${dashboardNumber(row.value)}</strong><small>${htmlEscape(row.note)}</small></div></div>`).join('');
  }

  function renderDashboardAnalyticsMarkup(data, restaurant) {
    const k = data?.kpis || {};
    const updated = data?.updatedAt ? new Date(data.updatedAt) : new Date();
    const updatedLabel = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' }).format(updated);
    return `<div class="core-dash" data-core-dashboard-analytics="${DASHBOARD_ANALYTICS_VERSION}">
      <div class="pagehead core-dash-pagehead"><div><h1>Dashboard</h1><p>Resumen operativo del tenant actual.</p></div></div>
      <div class="core-dash-kpis">
        <div class="core-dash-kpi blue"><div><span>VENTAS HOY</span><strong>${dashboardMoney(k.ventasHoy)}</strong>${trendText(k.tendenciaHoyPct, 'vs ayer')}</div><div class="core-dash-kpi-icon">${dashboardIcon('sales')}</div></div>
        <div class="core-dash-kpi orange"><div><span>VENTAS DEL MES</span><strong>${dashboardMoney(k.ventasMes)}</strong>${trendText(k.tendenciaMesPct, 'vs mes anterior')}</div><div class="core-dash-kpi-icon">${dashboardIcon('month')}</div></div>
        <div class="core-dash-kpi green"><div><span>TICKET PROMEDIO</span><strong>${dashboardMoney(k.ticketPromedio)}</strong><small>${dashboardNumber(k.ventasMesCantidad)} ventas emitidas</small></div><div class="core-dash-kpi-icon">${dashboardIcon('ticket')}</div></div>
        <div class="core-dash-kpi blue"><div><span>CARTERA PENDIENTE</span><strong>${dashboardMoney(k.carteraPendiente)}</strong><small>${dashboardNumber(k.carteraDocumentos)} facturas abiertas</small></div><div class="core-dash-kpi-icon">${dashboardIcon('cartera')}</div></div>
      </div>
      <div class="core-dash-grid core-dash-grid-main">
        <section class="core-dash-panel"><header><div><h2>Ventas últimos 7 días</h2><p>Comportamiento diario</p></div><span class="core-dash-period">Últimos 7 días</span></header><div class="core-dash-bars">${buildSalesBars(data?.salesByDay)}</div></section>
        <section class="core-dash-panel"><header><div><h2>Mix de productos</h2><p>Productos más vendidos este mes</p></div><span class="core-dash-period">Este mes</span></header>${buildProductMix(data?.topProducts, data?.productSalesTotal)}</section>
      </div>
      <div class="core-dash-grid core-dash-grid-bottom">
        <section class="core-dash-panel core-dash-top-products"><header><div><h2>Top productos</h2><p>Por unidades vendidas este mes</p></div></header><div class="core-dash-ranking">${buildTopProducts(data?.topProducts)}</div></section>
        <section class="core-dash-panel core-dash-operational"><header><div><h2>Indicadores operativos</h2><p>Estado actual del negocio</p></div></header><div class="core-dash-op-grid">${buildOperationalIndicators(data, restaurant)}</div></section>
      </div>
      <div class="core-dash-updated">↻ Última actualización: hoy ${htmlEscape(updatedLabel)}</div>
    </div>`;
  }

  async function waitForDashboardContent(maxAttempts = 40) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (currentPath() !== '/app/dashboard') return null;
      const content = document.querySelector('.content');
      const heading = content?.querySelector('.pagehead h1, .head h1');
      if (content && heading?.textContent.trim() === 'Dashboard') return content;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }

  async function installDashboardAnalytics() {
    if (currentPath() !== '/app/dashboard') return;
    const content = await waitForDashboardContent();
    if (!content || content.dataset.coreDashboardAnalytics === DASHBOARD_ANALYTICS_VERSION) return;
    content.dataset.coreDashboardAnalytics = DASHBOARD_ANALYTICS_VERSION;
    const sequence = ++dashboardSequence;
    content.innerHTML = '<div class="pagehead core-dash-pagehead"><div><h1>Dashboard</h1><p>Resumen operativo del tenant actual.</p></div></div><div class="core-dash-loading"><span></span><span></span><span></span><span></span></div>';
    try {
      const offset = new Date().getTimezoneOffset();
      const [analytics, restaurant] = await Promise.all([
        coreGet(`/api/v1/comercial/ventas/dashboard?tzOffsetMinutes=${encodeURIComponent(offset)}`),
        loadRestaurantOperationalData()
      ]);
      if (sequence !== dashboardSequence || currentPath() !== '/app/dashboard') return;
      const activeContent = document.querySelector('.content');
      if (!activeContent || activeContent !== content) return;
      content.innerHTML = renderDashboardAnalyticsMarkup(analytics, restaurant);
    } catch (error) {
      if (sequence !== dashboardSequence || currentPath() !== '/app/dashboard') return;
      content.innerHTML = `<div class="pagehead core-dash-pagehead"><div><h1>Dashboard</h1><p>Resumen operativo del tenant actual.</p></div></div><div class="error"><strong>No fue posible cargar los indicadores del Dashboard.</strong><br>${htmlEscape(error.message)}</div>`;
    }
  }

  async function refreshCurrentUi() {
    installCurrentUi();
    if (currentPath() === '/app/dashboard') await installDashboardAnalytics();
  }

  function installRenderHook() {
    const originalRender = window.render;
    if (typeof originalRender !== 'function' || originalRender.__coreDashboardAnalyticsWrapped) return;
    const wrapped = async function (...args) {
      const result = await originalRender.apply(this, args);
      await refreshCurrentUi();
      return result;
    };
    wrapped.__coreDashboardAnalyticsWrapped = true;
    window.render = wrapped;
  }

  async function start() {
    bootstrapRestaurantAccessCache();
    installRenderHook();
    installCurrentUi();

    if (!accessChecked) {
      await checkRestaurantAccess();
      installCurrentUi();
    }
    await installDashboardAnalytics();
  }

  window.addEventListener('popstate', () => {
    dashboardSequence += 1;
    setTimeout(() => { refreshCurrentUi(); }, 0);
  });
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href="/app/dashboard"]');
    if (!link) return;
    setTimeout(() => { refreshCurrentUi(); }, 0);
  });

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
  window.VantixGCCoreDashboardAnalyticsVersion = DASHBOARD_ANALYTICS_VERSION;
})();

(() => {
  'use strict';
  const ORIGIN_KEY = 'vantixgc_core_origin_v1';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const MAX_AGE_MS = 4 * 60 * 60 * 1000;

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function internalPath(value) {
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/app/')) return null;
      return `${url.pathname}${url.search}${url.hash}`;
    } catch { return null; }
  }

  function readOrigin() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(ORIGIN_KEY) || 'null');
      const active = session();
      if (!raw || !raw.from || !raw.targetPath || !raw.createdAt) return null;
      if (raw.tenant && active?.subdomain && raw.tenant !== active.subdomain) return null;
      if (Date.now() - Number(raw.createdAt) > MAX_AGE_MS) return null;
      const from = internalPath(raw.from);
      const target = internalPath(raw.targetPath);
      if (!from || !target) return null;
      return { ...raw, from, targetPath: new URL(target, window.location.origin).pathname.replace(/\/$/, '') || '/app' };
    } catch { return null; }
  }

  function clearOrigin() {
    try { sessionStorage.removeItem(ORIGIN_KEY); } catch {}
    document.querySelector('[data-core-origin-return]')?.remove();
  }

  function currentPath() {
    return (window.location.pathname || '/app').replace(/\/$/, '') || '/app';
  }

  function matchesTarget(origin) {
    const current = currentPath();
    return current === origin.targetPath || current.startsWith(`${origin.targetPath}/`);
  }

  function installStyle() {
    if (document.getElementById('core-origin-return-style')) return;
    const style = document.createElement('style');
    style.id = 'core-origin-return-style';
    style.textContent = '.core-origin-return{display:flex;align-items:center;gap:9px;margin:0 0 12px!important;min-height:34px}.core-origin-return .btn{min-height:34px!important;height:34px!important;padding:0 11px!important;font-size:12px!important}.core-origin-return span{color:#7b8794;font-size:12px;font-weight:600}@media(max-width:760px){.core-origin-return{margin-bottom:10px!important}.core-origin-return span{display:none}}';
    document.head.appendChild(style);
  }

  function goBack() {
    const origin = readOrigin();
    if (!origin) return;
    const destination = origin.from;
    clearOrigin();
    window.location.assign(destination);
  }

  function mount() {
    installStyle();
    const origin = readOrigin();
    const current = currentPath();
    const existing = document.querySelector('[data-core-origin-return]');
    if (!origin) {
      existing?.remove();
      return;
    }
    const sourcePath = new URL(origin.from, window.location.origin).pathname.replace(/\/$/, '') || '/app';
    if (current === sourcePath) {
      clearOrigin();
      return;
    }
    if (!matchesTarget(origin)) {
      existing?.remove();
      return;
    }
    const host = document.querySelector('.content');
    if (!host) return;
    if (existing && host.contains(existing)) return;
    existing?.remove();
    const row = document.createElement('div');
    row.className = 'core-origin-return';
    row.dataset.coreOriginReturn = 'true';
    const label = String(origin.fromLabel || 'pantalla anterior');
    row.innerHTML = `<button type="button" class="btn small" data-core-origin-back>← Atrás</button><span>Volver a ${label}</span>`;
    row.querySelector('[data-core-origin-back]')?.addEventListener('click', goBack);
    host.prepend(row);
  }

  const schedule = () => setTimeout(mount, 0);
  window.addEventListener('popstate', schedule);
  const originalPush = history.pushState.bind(history);
  history.pushState = function (...args) { const out = originalPush(...args); schedule(); return out; };
  const originalReplace = history.replaceState.bind(history);
  history.replaceState = function (...args) { const out = originalReplace(...args); schedule(); return out; };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 30000);

  window.VantixGCCoreOriginBack = Object.freeze({ mount, clear: clearOrigin, back: goBack });
})();
