(() => {
  const TOKEN_MAP = {
    char: '--char', bone: '--bone', ember: '--ember', verdigris: '--verdigris', brass: '--brass',
    paper: '--paper', ink: '--ink', muted: '--muted', line: '--line', success: '--success', danger: '--danger'
  };
  const FONT_MAP = { display: '--font-display', body: '--font-body', mono: '--font-mono' };
  const PANEL_FONT = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const stationRuntime = { loaded:false, rows:[], observer:null, scheduled:false };

  function ensurePanelAlignment() {
    if (document.querySelector('#restaurantPanelAlignment')) return;
    const style = document.createElement('style');
    style.id = 'restaurantPanelAlignment';
    style.textContent = `
      .cash-shell{max-width:1280px!important;gap:14px!important}
      .cash-shift-item{min-height:76px!important;padding:12px 14px!important}
      .cash-kpi{min-height:92px!important;padding:14px!important}
      .cash-workspace,.cash-lower-grid{grid-template-columns:minmax(0,1.35fr) minmax(360px,.85fr)!important;gap:12px!important}
      .cash-due-row{min-height:70px!important}
      .cash-method{min-height:62px!important}
      .cash-selected-summary{padding-top:12px!important;padding-bottom:12px!important}
      @media(max-width:1120px){.cash-workspace,.cash-lower-grid{grid-template-columns:1fr!important}.cash-shell{max-width:100%!important}}
    `;
    document.head.appendChild(style);
  }

  function appendControlAddon(src, dataKey) {
    if (document.querySelector(`script[data-${dataKey}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.setAttribute(`data-${dataKey}`, 'true');
    document.head.appendChild(script);
  }

  function loadControlCenterAddons() {
    const inControlCenterFamily = location.pathname.startsWith('/app/centro-de-control');
    if (!inControlCenterFamily || location.pathname !== '/app/centro-de-control') return;
    appendControlAddon('/app/restaurant-menu-import-ui.js?v=ocr-v1', 'restaurant-menu-import');
    appendControlAddon('/app/restaurant-waiter-device-admin.js?v=waiter-pwa-v1', 'restaurant-waiter-device-admin');
    appendControlAddon('/app/restaurant-employees-ui.js?v=employees-v1', 'restaurant-employees-ui');
    appendControlAddon('/app/restaurant-delivery-ui.js?v=delivery-v1', 'restaurant-delivery-ui');
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function setNodeVisible(node, visible) {
    if (!node) return;
    if (visible) {
      if (node.dataset.stationRuntimeHidden === '1') {
        node.style.removeProperty('display');
        delete node.dataset.stationRuntimeHidden;
      }
    } else if (node.dataset.stationRuntimeHidden !== '1') {
      node.style.setProperty('display', 'none', 'important');
      node.dataset.stationRuntimeHidden = '1';
    }
  }

  function stationNamesForQueue(queue) {
    return stationRuntime.rows
      .filter((station) => station.active !== false && ['KDS','AMBOS'].includes(String(station.mode || '').toUpperCase()) && String(station.queue || '').toUpperCase() === queue)
      .map((station) => String(station.name || '').trim())
      .filter(Boolean);
  }

  function applyProductionStations() {
    if (!stationRuntime.loaded) return;
    const kdsStations = stationRuntime.rows.filter((station) => station.active !== false && ['KDS','AMBOS'].includes(String(station.mode || '').toUpperCase()));
    const hasKds = kdsStations.length > 0;

    document.querySelectorAll('[data-tab="kds"], [data-cc-tab="kds"], [data-cc-order-kds]').forEach((node) => setNodeVisible(node, hasKds));

    document.querySelectorAll('.kds-v2-lane[data-station]').forEach((lane) => {
      const queue = String(lane.dataset.station || '').toUpperCase();
      const names = stationNamesForQueue(queue);
      setNodeVisible(lane, names.length > 0);
      if (names.length) {
        const heading = lane.querySelector('header h2');
        const label = names.join(' / ');
        if (heading && heading.textContent !== label) heading.textContent = label;
        const empty = lane.querySelector('.kds-empty span');
        if (empty) {
          const next = `Los nuevos pedidos asignados a ${label} aparecerán aquí automáticamente.`;
          if (empty.textContent !== next) empty.textContent = next;
        }
      }
    });

    const currentKds = new URLSearchParams(location.search).get('view') === 'kds'
      || Boolean(document.querySelector('[data-tab="kds"].active'));
    const view = document.querySelector('#view');
    if (!hasKds && currentKds && view && !view.querySelector('[data-no-kds-configured]')) {
      view.innerHTML = '<div class="empty-ticket" data-no-kds-configured="true"><b>No hay estaciones KDS configuradas.</b><br>El administrador debe crear la primera estación desde Configuración → Áreas de preparación / KDS.</div>';
    }
  }

  function scheduleProductionStationsApply() {
    if (stationRuntime.scheduled) return;
    stationRuntime.scheduled = true;
    requestAnimationFrame(() => {
      stationRuntime.scheduled = false;
      applyProductionStations();
    });
  }

  async function loadProductionStations() {
    if (!location.pathname.startsWith('/app/centro-de-control')) return;
    const session = readSession();
    if (!session?.token || !session?.subdomain) return;
    try {
      const response = await fetch('/api/v1/comercial/ui-runtime/restaurant-production-stations', {
        cache:'no-store',
        headers:{ Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
      stationRuntime.rows = Array.isArray(body?.data) ? body.data : [];
      stationRuntime.loaded = true;
      scheduleProductionStationsApply();
      if (!stationRuntime.observer && document.body) {
        stationRuntime.observer = new MutationObserver(scheduleProductionStationsApply);
        stationRuntime.observer.observe(document.body, { childList:true, subtree:true });
      }
    } catch (error) {
      console.warn('RESTAURANT_PRODUCTION_STATIONS_RUNTIME_UNAVAILABLE', error);
    }
  }

  function apply(theme) {
    const root = document.documentElement;
    const tokens = theme?.tokens || {};
    for (const [key, cssVar] of Object.entries(TOKEN_MAP)) {
      const value = tokens[key];
      if (HEX.test(String(value || ''))) root.style.setProperty(cssVar, value);
    }
    for (const cssVar of Object.values(FONT_MAP)) root.style.setProperty(cssVar, PANEL_FONT);
    root.dataset.restaurantTheme = theme?.preset || 'LA_RIEL_V1';
    root.dataset.restaurantTypography = 'SUPER_CORE_PANEL';
    ensurePanelAlignment();
    const name = theme?.restaurantName;
    if (name) {
      document.querySelectorAll('[data-restaurant-name]').forEach((node) => { node.textContent = name; });
      document.title = `${name} · VantixGC Restaurante`;
    }
    return theme;
  }

  window.RestaurantTheme = {
    apply,
    PANEL_FONT,
    TOKEN_MAP: { ...TOKEN_MAP },
    FONT_MAP: { ...FONT_MAP },
    refreshProductionStations: loadProductionStations
  };

  loadControlCenterAddons();
  loadProductionStations();
})();
