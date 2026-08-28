const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (p) => fs.readFileSync(p, 'utf8');
const css = read('src/web/restaurant-theme.css');
const provider = read('src/web/restaurant-theme.js');
const ui = read('src/web/restaurant-ui.js');
const qr = read('src/web/restaurant-qr-ui.js');
const html = read('src/web/restaurant.html');
const qrHtml = read('src/web/restaurant-qr.html');
const routes = read('src/modules/restaurant/restaurant.routes.js');
const publicRoutes = `${read('src/modules/restaurant/restaurant.public.routes.js')}\n${read('src/modules/restaurant/restaurant.public.routes.base.js')}\n${read('src/modules/restaurant/restaurant-visit.public.routes.js')}`;
const visitUi = read('src/web/restaurant-qr-visit-ui.js');
const paymentsUi = read('src/web/restaurant-visit-payments-ui.js');
const themeService = read('src/modules/restaurant/restaurant-theme.service.js');
const rbac = read('src/modules/restaurant/restaurant.rbac.js');
const docs = read('docs/RESTAURANT_IDENTITY_CONNECTED_V1.md');

for (const token of ['--char','--bone','--ember','--verdigris','--brass','--font-display','--font-body','--font-mono']) {
  assert.ok(css.includes(token), `Shared theme must define ${token}`);
}
assert.ok(css.includes('.rail-ticket'));
assert.ok(css.includes('.command-ticket'));
assert.ok(css.includes('.origin-qr'));
assert.ok(css.includes('.receipt'));
assert.ok(provider.includes("char: '--char'"));
assert.ok(provider.includes('RestaurantTheme'));

// Restaurante uses the exact Super Core panel font family everywhere.
const panelFont = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
assert.ok(provider.includes(`const PANEL_FONT = \"${panelFont}\"`));
assert.ok(themeService.includes(`const PANEL_FONT = \"${panelFont}\"`));
assert.ok(themeService.includes('display: PANEL_FONT'));
assert.ok(themeService.includes('body: PANEL_FONT'));
assert.ok(themeService.includes('mono: PANEL_FONT'));
assert.ok(themeService.includes('typographyLockedToPanel: true'));
assert.ok(provider.includes("root.dataset.restaurantTypography = 'SUPER_CORE_PANEL'"));
assert.ok(provider.includes("style.id = 'restaurantPanelAlignment'"));
assert.ok(provider.includes('.cash-shell{max-width:1280px!important'));
assert.ok(provider.includes('grid-template-columns:minmax(0,1.35fr) minmax(360px,.85fr)!important'));
assert.ok(provider.includes('@media(max-width:1120px){.cash-workspace,.cash-lower-grid{grid-template-columns:1fr!important}'));

assert.ok(html.includes('/app/restaurant-theme.css'));
assert.ok(html.includes('/app/restaurant-theme.js?v=panel-font-v1'));
assert.ok(html.includes('/app/restaurant-ui.js'));
assert.ok(!html.includes('<style>'), 'Operator shell must not embed design tokens');
assert.ok(!html.includes('font-family:Lora,Georgia,serif'), 'Restaurant shell must not retain the old serif Edge banner');
assert.ok(qrHtml.includes('/app/restaurant-theme.css'));
assert.ok(qrHtml.includes('/app/restaurant-theme.js?v=panel-font-v1'));
assert.ok(qrHtml.includes('/app/restaurant-qr-ui.js'));
assert.ok(!qrHtml.includes('<style>'), 'QR shell must share the same theme file');

for (const path of [
  '/api/v1/restaurante/ui-context',
  '/api/v1/restaurante/mesas',
  '/api/v1/restaurante/menu',
  'pedido-borrador',
  '/api/v1/restaurante/comandas',
  '/api/v1/restaurante/caja/turnos/',
  '/api/v1/tesoreria/cajas-bancos'
]) assert.ok(ui.includes(path), `Connected UI must consume ${path}`);
assert.ok(ui.includes("S.context.polling.kdsMs || 2000"));
assert.ok(ui.includes("String(command.order?.source || '').toUpperCase() === 'QR'"));
assert.ok(ui.includes('📱 vía autopedido QR'));
assert.ok(ui.includes("can('MESAS.VER') && can('PEDIDOS.CREAR')"));
assert.ok(ui.includes("can('COMANDAS.EDITAR')"));
assert.ok(ui.includes("can('RESTAURANTE.CERRAR') && can('TESORERIA.CERRAR')"));
assert.match(ui, /const diff = number\(raw\) - number\(summary\?\.systemCashExpected\)/);
assert.ok(ui.includes('restaurantClosedTablesTotal'));
assert.ok(ui.includes('restaurantCashRecorded'));
assert.ok(!ui.includes('summary?.paymentBreakdown'), 'Connected Caja must not depend on a non-existent summary field');
assert.doesNotMatch(ui, /#[0-9a-fA-F]{6}/, 'Data/UI logic must not hardcode theme colors');
assert.doesNotMatch(qr, /#[0-9a-fA-F]{6}/, 'QR logic must not hardcode theme colors');

assert.ok(qr.includes('/api/public/restaurante/qr/'));
assert.ok(qr.includes('RestaurantTheme?.apply(ctx.theme)'));
assert.ok(qr.includes('confirmedTotal:total()'));
assert.ok(publicRoutes.includes('identity.publicQrContext'));
assert.ok(publicRoutes.includes("restaurant-theme.css"));
assert.ok(publicRoutes.includes('/autorizar'));
assert.ok(publicRoutes.includes('x-vantix-restaurant-visit'));
assert.ok(visitUi.includes('Confirma que estás en esta mesa'));
assert.ok(visitUi.includes('Persona ${seat}'));
assert.ok(paymentsUi.includes('CUENTA SEPARADA / PAGOS POR PERSONA'));
assert.ok(paymentsUi.includes('EFECTIVO'));
assert.ok(paymentsUi.includes('TRANSFERENCIA'));
assert.ok(paymentsUi.includes('TARJETA'));

assert.ok(routes.includes("router.get('/ui-context'"));
assert.ok(routes.includes("router.patch('/theme'"));
assert.ok(routes.includes("pedido-borrador/enviar"));
assert.ok(routes.includes('liveTables.listTablesLive'));
assert.ok(themeService.includes("preset: 'LA_RIEL_V1'"));
assert.ok(themeService.includes('themeData'));
assert.ok(themeService.includes("entidad: 'RESTAURANT_THEME'"));
assert.ok(rbac.includes("'RESTAURANTE.VER'"));
assert.ok(docs.includes('ID-AC01'));
assert.ok(docs.includes('No existe un segundo mapa de roles de frontend'));

new Function(visitUi);
new Function(paymentsUi);

console.log('RESTAURANT IDENTITY + PANEL TYPOGRAPHY + BALANCED CAJA + SECURE VISIT UI SMOKE OK');
console.log(JSON.stringify({
  sharedTheme: true,
  panelTypographyEverywhere: true,
  balancedCashWorkspace: true,
  fiveRealSurfacesWired: true,
  kdsPolling: true,
  qrOriginMarker: true,
  qrVisitAuthorizationUi: true,
  splitPaymentsUi: true,
  rbacDrivenRail: true,
  liveCashDifference: true,
  cajaV2RealSummaryFields: true,
  noBrandColorsInDataLogic: true
}, null, 2));