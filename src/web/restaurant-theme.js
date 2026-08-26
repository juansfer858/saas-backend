(() => {
  const TOKEN_MAP = {
    char: '--char', bone: '--bone', ember: '--ember', verdigris: '--verdigris', brass: '--brass',
    paper: '--paper', ink: '--ink', muted: '--muted', line: '--line', success: '--success', danger: '--danger'
  };
  const FONT_MAP = { display: '--font-display', body: '--font-body', mono: '--font-mono' };
  const PANEL_FONT = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const HEX = /^#[0-9a-fA-F]{6}$/;

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
})();
