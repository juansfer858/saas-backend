'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const delivery = fs.readFileSync(path.join(root, 'src', 'modules', 'restaurant', 'restaurant-cash-compact-v30.public.routes.js'), 'utf8');
const publicRouter = fs.readFileSync(path.join(root, 'src', 'modules', 'restaurant', 'restaurant.public.routes.js'), 'utf8');
const realtimeRouter = fs.readFileSync(path.join(root, 'src', 'modules', 'restaurant', 'restaurant-tenant-realtime.public.routes.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'web', 'restaurant-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'web', 'restaurant-control-center.css'), 'utf8');

// Base Caja remains the owner of the business workflow and the controls that close the shift.
assert.match(ui, /cash-lower-grid/);
assert.match(ui, /cash-recent-list/);
assert.match(ui, /cash-recent-row/);
assert.match(ui, /cash-close-panel/);
assert.match(ui, /physicalCount/);
assert.match(ui, /closeShift/);
assert.match(ui, /Últimos cobros/);
assert.match(ui, /Resumen del turno/);
assert.match(css, /cash-lower-grid/);
assert.match(css, /cash-recent-row/);
assert.match(css, /cash-close-button/);

// V23 owns /app/restaurant-ui.js before V30's fallback route. V30 therefore wraps the
// final V23 response instead of replacing it; this is the regression that escaped PR #189.
assert.match(realtimeRouter, /router\.get\('\/app\/restaurant-ui\.js'/);
assert.match(publicRouter, /compactCashRuntime/);
assert.match(publicRouter, /function installCashCompactRuntime/);
assert.match(publicRouter, /req\.path !== '\/app\/restaurant-ui\.js'/);
assert.match(publicRouter, /const originalSend = res\.send\.bind\(res\)/);
assert.match(publicRouter, /source\.includes\('VANTIX_CASH_COMPACT_V30'\)/);
assert.match(publicRouter, /compactCashRuntime/);
assert.match(publicRouter, /X-VantixGC-Cash-Compact/);
assert.ok(
  publicRouter.indexOf('router.use(installCashCompactRuntime)') < publicRouter.indexOf('router.use(restaurantTenantRealtimePublicRouter)'),
  'V30 debe envolver la respuesta antes de que V23 la envíe'
);
assert.ok(
  publicRouter.indexOf('router.use(restaurantTenantRealtimePublicRouter)') < publicRouter.indexOf('router.use(restaurantCashCompactV30PublicRouter)'),
  'V23 conserva la propiedad del asset canónico y V30 mantiene su fallback después'
);
assert.ok(
  publicRouter.indexOf('router.use(restaurantCashCompactV30PublicRouter)') < publicRouter.indexOf('router.use(legacyRestaurantPublicRouter)'),
  'La capa compacta debe ejecutarse antes del router legado'
);

// Fallback delivery still owns the presentation CSS and can serve the compact JS if the
// canonical realtime owner ever delegates instead of responding.
assert.match(delivery, /get\('\/app\/restaurant-ui\.js'/);
assert.match(delivery, /get\('\/app\/restaurant-control-center\.css'/);
assert.match(delivery, /X-VantixGC-Cash-Compact/);
assert.match(delivery, /v30-dialogs/);

// Presentation contract: two compact launchers and two modal dialogs.
assert.match(delivery, /VANTIX_CASH_COMPACT_V30/);
assert.match(delivery, /cash-compact-tools-v30/);
assert.match(delivery, /cash-compact-dialog-v30/);
assert.match(delivery, /cash-recent-list/);
assert.match(delivery, /closest\('\.cash-panel'\)/);
assert.match(delivery, /Últimos cobros/);
assert.match(delivery, /Resumen del turno/);
assert.match(delivery, /Historial del turno/);
assert.match(delivery, /Arqueo y cierre de caja/);
assert.match(delivery, /showModal/);
assert.match(delivery, /MutationObserver/);
assert.match(delivery, /queueMicrotask/);
assert.match(delivery, /body\.appendChild\(panel\)/, 'Los paneles existentes deben moverse, no recrearse, para conservar listeners');
assert.match(delivery, /clearDialogs/);

// Visual contract: compact row, official navy/orange/turquoise palette and responsive modal.
assert.match(delivery, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(delivery, /min-height:68px/);
assert.match(delivery, /#122b4a/i);
assert.match(delivery, /#ff6b2c/i);
assert.match(delivery, /#10867f/i);
assert.match(delivery, /#fff/i);
assert.match(delivery, /88dvh/);
assert.match(delivery, /max-width:699px/);
assert.match(delivery, /::backdrop/);
assert.doesNotMatch(delivery, /#7a4d34|#5b3726|#a56f4f/i, 'No se debe introducir la paleta café descartada');

// This layer cannot know or mutate Restaurant business APIs.
assert.doesNotMatch(delivery, /fetch\s*\(/);
assert.doesNotMatch(delivery, /\/api\//);
assert.doesNotMatch(delivery, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
assert.doesNotMatch(delivery, /localStorage|sessionStorage/);
assert.doesNotMatch(publicRouter, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);

// The exact close-shift controls are still present only in the base UI; V30 merely moves their DOM nodes.
assert.doesNotMatch(delivery, /id=["']physicalCount["']/);
assert.doesNotMatch(delivery, /id=["']closeShift["']/);

console.log(JSON.stringify({
  ok: true,
  version: 'V30.1',
  cashPrimaryWorkspace: ['Mesas por cobrar', 'Cobro rápido'],
  compactLaunchers: ['Últimos cobros', 'Resumen del turno'],
  realtimeCompositionPreserved: true,
  existingCloseShiftControlsPreserved: true,
  businessApiCallsAdded: 0
}));
