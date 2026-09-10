(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_MENU_IMPORT_INVENTORY_V1';
  const SOURCE_PATH = '/app/restaurant-menu-import-ui.js?v=inventory-workspace-v1';
  const LEGACY_GUARD = "if (!location.pathname.startsWith('/app/centro-de-control')) return;";
  const INVENTORY_GUARD = "if (!location.pathname.startsWith('/app/centro-de-control') && location.pathname !== '/app/inventario') return;";
  let loading = false;
  let loaded = false;
  let scheduled = false;

  function onInventoryPage() {
    return String(location.pathname || '').replace(/\/$/, '') === '/app/inventario';
  }

  function readRole() {
    try {
      const session = JSON.parse(localStorage.getItem('vantixgc_core_session_v1') || 'null');
      return String(session?.user?.rol || '').toUpperCase();
    } catch { return ''; }
  }

  function allowedRole() {
    return readRole() === 'ADMIN' || readRole() === 'SUPER_ADMIN';
  }

  function execute(source) {
    const script = document.createElement('script');
    script.textContent = `${source}\n//# sourceURL=restaurant-menu-import-ui-inventory-v1.js`;
    document.head.appendChild(script);
    script.remove();
  }

  async function loadImporter() {
    if (loaded || loading || !onInventoryPage() || !allowedRole()) return;
    loading = true;
    try {
      const response = await fetch(SOURCE_PATH, { cache: 'no-store' });
      if (!response.ok) throw new Error(`No fue posible cargar el importador de carta (${response.status})`);
      const original = await response.text();
      if (!original.includes(LEGACY_GUARD)) throw new Error('No se encontró el contrato de montaje del importador OCR');
      const source = original.replace(LEGACY_GUARD, `${INVENTORY_GUARD} // ${MARKER}`);
      if (!source.includes(MARKER)) throw new Error('No fue posible adaptar el importador OCR a Inventarios / Kardex');
      execute(source);
      loaded = true;
      window.VantixGCRestaurantInventoryMenuImportV1 = Object.freeze({
        marker: MARKER,
        version: '1.0.0',
        source: SOURCE_PATH,
        reusesCanonicalOcrAsset: true
      });
    } catch (error) {
      console.error('RESTAURANT_INVENTORY_MENU_IMPORT_V1_ERROR', error);
    } finally {
      loading = false;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      loadImporter();
    });
  }

  document.addEventListener('click', (event) => {
    if (!onInventoryPage()) return;
    if (event.target.closest?.('#ccOcrDone')) {
      setTimeout(() => window.VantixGCRestaurantInventoryWorkspaceV1?.refresh?.(), 60);
    }
    const nav = event.target.closest?.('[data-nav]');
    if (nav) setTimeout(schedule, 0);
  });
  window.addEventListener('popstate', schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
})();
