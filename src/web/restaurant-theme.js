(() => {
  const TOKEN_MAP = {
    char: '--char', bone: '--bone', ember: '--ember', verdigris: '--verdigris', brass: '--brass',
    paper: '--paper', ink: '--ink', muted: '--muted', line: '--line', success: '--success', danger: '--danger'
  };
  const FONT_MAP = { display: '--font-display', body: '--font-body', mono: '--font-mono' };
  const PANEL_FONT = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const HEX = /^#[0-9a-fA-F]{6}$/;

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
    if (location.pathname !== '/app/centro-de-control') return;
    appendControlAddon('/app/restaurant-menu-import-ui.js?v=ocr-v1', 'restaurant-menu-import');
    appendControlAddon('/app/restaurant-waiter-device-admin.js?v=waiter-pwa-v1', 'restaurant-waiter-device-admin');
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
    FONT_MAP: { ...FONT_MAP }
  };

  loadControlCenterAddons();
})();
