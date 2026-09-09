(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V2_MODULE_HOST_P11';
  const routes = Object.freeze({
    salon:'/app/restaurante-v2/mesas',
    mesero:'/app/restaurante-v2/pedidos',
    pedidos:'/app/restaurante-v2/pedidos',
    kds:'/app/restaurante-v2/kds',
    caja:'/app/restaurante-v2/caja',
    division:'/app/restaurante-v2/division'
  });
  document.documentElement.dataset.restaurantV2ModuleHost = document.body?.dataset?.p11ModuleHost || 'p11';
  document.documentElement.dataset.restaurantV2ModuleHostMarker = MARKER;

  function root() { return document.getElementById('ccCustomView'); }
  window.VantixGCRestaurantControlCenter = Object.freeze({
    openCustomView:() => root(),
    navigateBack:() => { if (history.length > 1) history.back(); else location.assign('/app/restaurante-v2/mesas'); },
    showDashboard:() => location.assign('/app/restaurante-v2/mesas'),
    openOperationalTab:(tab) => { const route = routes[String(tab || '')]; if (route) location.assign(route); }
  });

  function openHostedModule() {
    const module = document.body?.dataset?.p11ModuleHost;
    if (module === 'employees') window.VantixGCRestaurantEmployees?.open?.(false);
    if (module === 'delivery') window.VantixGCRestaurantDelivery?.open?.(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openHostedModule, { once:true });
  else queueMicrotask(openHostedModule);
})();
