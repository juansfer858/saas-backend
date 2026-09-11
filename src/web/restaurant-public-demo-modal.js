(() => {
  'use strict';

  const DEMO_PATH = '/restaurantes/demo?embedded=1';
  const HERO_IMAGE_PATH = '/restaurantes/hero-cliente-pedido-v1.webp';
  const STYLE_ID = 'vantixgc-restaurant-demo-modal-style-v1';
  const ROOT_ID = 'vantixgcRestaurantDemoModalV1';
  let previousOverflow = '';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .vr-hero-customer-order{min-height:0!important;display:block!important;position:relative!important}
      .vr-hero-customer-order img{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:26px;border:1px solid rgba(23,23,23,.08);box-shadow:0 28px 70px rgba(23,23,23,.16)}
      .vr-demo-modal{position:fixed;inset:0;z-index:99999;background:rgba(23,23,23,.78);display:grid;place-items:center;padding:18px}
      .vr-demo-shell{width:min(1480px,100%);height:min(920px,calc(100vh - 36px));background:#fff;border-radius:22px;overflow:hidden;display:grid;grid-template-rows:54px 1fr;box-shadow:0 35px 120px rgba(0,0,0,.35)}
      .vr-demo-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 13px 0 16px;background:#171717;color:#fff;border-bottom:2px solid #f97316}
      .vr-demo-title{display:flex;align-items:center;gap:10px;min-width:0}.vr-demo-mark{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:#f97316;font-weight:950}.vr-demo-title b{display:block;font-size:12px}.vr-demo-title small{display:block;color:#a8a29e;font-size:9px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .vr-demo-actions{display:flex;align-items:center;gap:7px}.vr-demo-actions a,.vr-demo-actions button{border:1px solid #454545;background:#292929;color:#fff;border-radius:9px;padding:8px 10px;font:800 11px/1 Inter,ui-sans-serif,system-ui,sans-serif;text-decoration:none;cursor:pointer}.vr-demo-actions a{background:#f97316;border-color:#f97316}.vr-demo-frame{width:100%;height:100%;border:0;background:#f5f5f4}
      @media(max-width:700px){.vr-hero-customer-order img{border-radius:20px}.vr-demo-modal{padding:0}.vr-demo-shell{width:100%;height:100dvh;border-radius:0}.vr-demo-head{height:58px}.vr-demo-title small{max-width:170px}.vr-demo-actions a{display:none}}
    `;
    document.head.appendChild(style);
  }

  function enhanceLandingHero() {
    const product = document.querySelector('.product');
    if (!product || product.dataset.vrHeroCustomerOrder === '1') return;
    ensureStyle();
    product.dataset.vrHeroCustomerOrder = '1';
    product.classList.add('vr-hero-customer-order');
    product.setAttribute('aria-label', 'Cliente haciendo su pedido con VantixGC Restaurantes');
    product.replaceChildren();
    const image = document.createElement('img');
    image.src = HERO_IMAGE_PATH;
    image.alt = 'Cliente haciendo su pedido desde la mesa con VantixGC Restaurantes';
    image.loading = 'eager';
    image.decoding = 'async';
    image.fetchPriority = 'high';
    product.appendChild(image);
  }

  function closeDemo() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.remove();
    document.body.style.overflow = previousOverflow;
  }

  function openDemo(event) {
    if (event) event.preventDefault();
    if (document.getElementById(ROOT_ID)) return;
    ensureStyle();
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'vr-demo-modal';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Demo interactivo VantixGC Restaurantes');
    root.innerHTML = `
      <div class="vr-demo-shell">
        <div class="vr-demo-head">
          <div class="vr-demo-title"><span class="vr-demo-mark">V</span><div><b>Demo interactivo · VantixGC Restaurantes</b><small>Showcase autónomo · datos ficticios · sin sesión del Core</small></div></div>
          <div class="vr-demo-actions"><a href="/restaurantes/crear">Crear mi restaurante</a><button type="button" data-close-demo>✕ Cerrar</button></div>
        </div>
        <iframe class="vr-demo-frame" title="Demo autónomo de VantixGC Restaurantes" src="${DEMO_PATH}" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
      </div>`;
    root.addEventListener('click', (e) => {
      if (e.target === root || e.target.closest('[data-close-demo]')) closeDemo();
    });
    document.body.appendChild(root);
  }

  enhanceLandingHero();

  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[href]');
    if (!anchor) return;
    let url;
    try { url = new URL(anchor.href, location.origin); } catch { return; }
    if (url.origin === location.origin && (url.pathname === '/restaurantes/demo' || url.pathname === '/demo-restaurantes')) openDemo(event);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById(ROOT_ID)) closeDemo();
  });
})();
