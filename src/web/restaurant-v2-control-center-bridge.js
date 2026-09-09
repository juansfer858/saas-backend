(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V2_CONTROL_CENTER_BRIDGE_P6_5';
  const ROUTES = Object.freeze({
    salon: '/app/restaurante-v2/mesas',
    mesero: '/app/restaurante-v2/pedidos',
    pedidos: '/app/restaurante-v2/pedidos',
    kds: '/app/restaurante-v2/kds',
    caja: '/app/restaurante-v2/caja',
    division: '/app/restaurante-v2/division'
  });
  const LABELS = Object.freeze({
    salon: 'Mesas',
    mesero: 'Mesero / Pedidos',
    kds: 'Cocina / Barra / Postres',
    caja: 'Caja',
    division: 'División de cuenta'
  });

  document.documentElement.dataset.restaurantV2ControlCenter = MARKER;

  function withOrigin(path) {
    const url = new URL(path, location.origin);
    url.searchParams.set('from', 'control-center');
    return `${url.pathname}${url.search}`;
  }

  function openV2(key) {
    const route = ROUTES[key];
    if (!route) return;
    try {
      sessionStorage.setItem('vantixgc_restaurant_v2_origin', JSON.stringify({
        from: '/app/centro-de-control',
        module: key,
        createdAt: Date.now()
      }));
    } catch {}
    location.assign(withOrigin(route));
  }

  function installStyles() {
    if (document.getElementById('restaurantV2ControlCenterBridgeStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantV2ControlCenterBridgeStyles';
    style.textContent = `
      #rail [data-tab="salon"],#rail [data-tab="mesero"],#rail [data-tab="pedidos"],#rail [data-tab="kds"],#rail [data-tab="caja"]{display:none!important}
      .cc-v2-nav{display:grid;gap:8px;margin:0 0 12px;padding:10px;border:1px solid #dbe3ea;border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.06)}
      .cc-v2-title{font-size:11px;font-weight:950;letter-spacing:.08em;text-transform:uppercase;color:#64748b;padding:2px 4px 6px}
      .cc-v2-nav button{width:100%;min-height:46px;border:1px solid #dbe3ea;border-radius:12px;background:#f8fafc;color:#17212b;text-align:left;padding:10px 12px;font:inherit;font-weight:850;cursor:pointer}
      .cc-v2-nav button:hover{border-color:#f97316;background:#fff7ed;color:#9a3412}
      .cc-v2-nav button[data-v2="division"]{border-style:dashed}
      .cc-v2-badge{display:inline-flex;margin-left:6px;padding:2px 7px;border-radius:999px;background:#111827;color:#fff;font-size:9px;font-weight:900;vertical-align:middle}
    `;
    document.head.appendChild(style);
  }

  function installNav() {
    const railWrap = document.querySelector('.rail-wrap');
    const rail = document.querySelector('#rail');
    if (!railWrap || !rail || document.querySelector('[data-restaurant-v2-nav]')) return false;
    const nav = document.createElement('section');
    nav.className = 'cc-v2-nav';
    nav.dataset.restaurantV2Nav = 'true';
    nav.innerHTML = `<div class="cc-v2-title">Operación Restaurante <span class="cc-v2-badge">V2</span></div>${[
      ['salon', LABELS.salon],
      ['mesero', LABELS.mesero],
      ['kds', LABELS.kds],
      ['caja', LABELS.caja],
      ['division', LABELS.division]
    ].map(([key,label]) => `<button type="button" data-v2="${key}">${label}</button>`).join('')}`;
    nav.addEventListener('click', (event) => {
      const button = event.target.closest('[data-v2]');
      if (!button) return;
      openV2(button.dataset.v2);
    });
    railWrap.insertBefore(nav, rail);
    return true;
  }

  function interceptLegacyNav(event) {
    const target = event.target.closest?.('[data-tab]');
    if (!target) return;
    const key = String(target.dataset.tab || '');
    if (!ROUTES[key]) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openV2(key);
  }

  function boot() {
    installStyles();
    installNav();
    document.addEventListener('click', interceptLegacyNav, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
