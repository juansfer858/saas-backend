(() => {
  const TOKEN_MAP = {
    char: '--char', bone: '--bone', ember: '--ember', verdigris: '--verdigris', brass: '--brass',
    paper: '--paper', ink: '--ink', muted: '--muted', line: '--line', success: '--success', danger: '--danger'
  };
  const FONT_MAP = { display: '--font-display', body: '--font-body', mono: '--font-mono' };
  const HEX = /^#[0-9a-fA-F]{6}$/;
  function safeFont(value) {
    const text = String(value || '').trim();
    return text && text.length <= 180 && !/[;{}<>]/.test(text) ? text : null;
  }
  function apply(theme) {
    const root = document.documentElement;
    const tokens = theme?.tokens || {};
    const typography = theme?.typography || {};
    for (const [key, cssVar] of Object.entries(TOKEN_MAP)) {
      const value = tokens[key];
      if (HEX.test(String(value || ''))) root.style.setProperty(cssVar, value);
    }
    for (const [key, cssVar] of Object.entries(FONT_MAP)) {
      const value = safeFont(typography[key]);
      if (value) root.style.setProperty(cssVar, value);
    }
    root.dataset.restaurantTheme = theme?.preset || 'LA_RIEL_V1';
    const name = theme?.restaurantName;
    if (name) {
      document.querySelectorAll('[data-restaurant-name]').forEach((node) => { node.textContent = name; });
      document.title = `${name} · VantixGC Restaurante`;
    }
    return theme;
  }
  window.RestaurantTheme = { apply, TOKEN_MAP: { ...TOKEN_MAP }, FONT_MAP: { ...FONT_MAP } };
})();
