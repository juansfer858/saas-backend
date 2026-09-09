(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V2_CONTROL_CENTER_BRIDGE_P6_5';
  const ROUTES = Object.freeze({
    salon: '/app/restaurante-v2/mesas',
    mesero: '/app/restaurante-v2/pedidos',
    pedidos: '/app/restaurante-v2/pedidos',
    kds: '/app/restaurante-v2/kds',
    caja: '/app/restaurante-v2/caja',
    division: '/app/restaurante-v2/division',
    pilot: '/app/restaurante-v2/piloto'
  });
  const LABELS = Object.freeze({
    salon: 'Mesas',
    mesero: 'Mesero / Pedidos',
    pedidos: 'Mesero / Pedidos',
    kds: 'Cocina / Barra / Postres',
    caja: 'Caja',
    division: 'División de cuenta',
    pilot: 'Piloto V2'
  });

  document.documentElement.dataset.restaurantV2ControlCenter = MARKER;

  function coreRole() {
    try { return String(JSON.parse(localStorage.getItem('vantixgc_core_session_v1') || 'null')?.user?.rol || '').toUpperCase(); }
    catch { return ''; }
  }
  function canSeePilot(){ return ['ADMIN','SUPER_ADMIN'].includes(coreRole()); }

  function installStyles() {
    if (document.getElementById('restaurantV2ControlCenterBridgeStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantV2ControlCenterBridgeStyles';
    style.textContent = `
      #rail [data-tab="salon"],#rail [data-tab="mesero"],#rail [data-tab="pedidos"],#rail [data-tab="kds"],#rail [data-tab="caja"]{display:none!important}
      .cc-v2-nav{display:grid;gap:8px;margin:0 0 12px;padding:10px;border:1px solid #dbe3ea;border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.06)}
      .cc-v2-title{font-size:11px;font-weight:950;letter-spacing:.08em;text-transform:uppercase;color:#64748b;padding:2px 4px 6px}
      .cc-v2-nav button{width:100%;min-height:46px;border:1px solid #dbe3ea;border-radius:12px;background:#f8fafc;color:#17212b;text-align:left;padding:10px 12px;font:inherit;font-weight:850;cursor:pointer}
      .cc-v2-nav button:hover,.cc-v2-nav button.active{border-color:#f97316;background:#fff7ed;color:#9a3412}
      .cc-v2-nav button[data-v2="division"]{border-style:dashed}
      .cc-v2-nav button[data-v2="pilot"]{border-color:#b7d7c7;background:#f3faf6;color:#0d6b43}
      .cc-v2-badge{display:inline-flex;margin-left:6px;padding:2px 7px;border-radius:999px;background:#111827;color:#fff;font-size:9px;font-weight:900;vertical-align:middle}
      .cc-v2-workspace{display:grid;grid-template-rows:auto minmax(0,1fr);height:calc(100dvh - 24px);min-height:640px;background:#fff;border:1px solid #dbe3ea;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,.08)}
      .cc-v2-workspace[hidden]{display:none!important}
      .cc-v2-workspace-bar{display:flex;align-items:center;gap:10px;min-height:58px;padding:8px 12px;border-bottom:1px solid #e2e8f0;background:#f8fafc}
      .cc-v2-workspace-bar button{min-height:40px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#17212b;padding:0 12px;font:inherit;font-weight:850;cursor:pointer}
      .cc-v2-workspace-bar strong{font-size:14px;color:#17212b}
      .cc-v2-workspace-bar span{margin-left:auto;font-size:11px;font-weight:850;color:#64748b}
      .cc-v2-frame{width:100%;height:100%;border:0;background:#f8fafc}
      @media(max-width:760px){.cc-v2-workspace{height:calc(100dvh - 12px);min-height:520px;border-radius:12px}.cc-v2-workspace-bar span{display:none}}
    `;
    document.head.appendChild(style);
  }

  function installWorkspace() {
    const main = document.querySelector('.ri-main');
    if (!main) return null;
    let workspace = document.querySelector('[data-v2-workspace]');
    if (workspace) return workspace;
    workspace = document.createElement('section');
    workspace.className = 'cc-v2-workspace';
    workspace.dataset.v2Workspace = 'true';
    workspace.hidden = true;
    workspace.innerHTML = '<div class="cc-v2-workspace-bar"><button type="button" data-v2-close="true">← Centro de control</button><strong data-v2-workspace-title>Operación V2</strong><span>Módulo independiente · misma sesión · mismo tenant</span></div><iframe class="cc-v2-frame" data-v2-frame title="Operación Restaurante V2"></iframe>';
    main.prepend(workspace);
    workspace.querySelector('[data-v2-close]')?.addEventListener('click', closeV2);
    return workspace;
  }

  function setLegacyVisible(visible) {
    const main = document.querySelector('.ri-main');
    if (!main) return;
    [...main.children].forEach((node) => {
      if (node.matches?.('[data-v2-workspace]')) return;
      node.hidden = !visible;
    });
  }

  function setActive(key) {
    document.querySelectorAll('[data-restaurant-v2-nav] [data-v2]').forEach((button) => button.classList.toggle('active', button.dataset.v2 === key));
  }

  function openV2(key) {
    const route = ROUTES[key];
    if (!route) return;
    if (key === 'pilot' && !canSeePilot()) return;
    const workspace = installWorkspace();
    if (!workspace) return;
    const frame = workspace.querySelector('[data-v2-frame]');
    const title = workspace.querySelector('[data-v2-workspace-title]');
    if (title) title.textContent = LABELS[key] || 'Operación V2';
    if (frame && frame.getAttribute('src') !== route) frame.setAttribute('src', route);
    setLegacyVisible(false);
    workspace.hidden = false;
    setActive(key);
    history.replaceState({ ...(history.state || {}), restaurantV2Module:key }, '', `/app/centro-de-control?module=${encodeURIComponent(key)}`);
  }

  function closeV2() {
    const workspace = document.querySelector('[data-v2-workspace]');
    if (workspace) workspace.hidden = true;
    setLegacyVisible(true);
    setActive('');
    history.replaceState({ ...(history.state || {}), restaurantV2Module:null }, '', '/app/centro-de-control');
  }

  function installNav() {
    const railWrap = document.querySelector('.rail-wrap');
    const rail = document.querySelector('#rail');
    if (!railWrap || !rail || document.querySelector('[data-restaurant-v2-nav]')) return false;
    const entries = [
      ['salon', LABELS.salon],
      ['mesero', LABELS.mesero],
      ['kds', LABELS.kds],
      ['caja', LABELS.caja],
      ['division', LABELS.division]
    ];
    if (canSeePilot()) entries.push(['pilot', LABELS.pilot]);
    const nav = document.createElement('section');
    nav.className = 'cc-v2-nav';
    nav.dataset.restaurantV2Nav = 'true';
    nav.innerHTML = `<div class="cc-v2-title">Operación Restaurante <span class="cc-v2-badge">V2</span></div>${entries.map(([key,label]) => `<button type="button" data-v2="${key}">${label}</button>`).join('')}`;
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
    installWorkspace();
    installNav();
    document.addEventListener('click', interceptLegacyNav, true);
    const initial = new URLSearchParams(location.search).get('module');
    if (initial && ROUTES[initial]) openV2(initial);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
