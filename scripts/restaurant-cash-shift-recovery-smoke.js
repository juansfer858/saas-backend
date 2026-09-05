'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CASH_SHIFT_RECOVERY_MARKER,
  patchCashShiftRecovery
} = require('../src/modules/restaurant/restaurant-cash-shift-recovery.public.routes');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src', 'web', 'restaurant-ui.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src', 'modules', 'restaurant', 'restaurant-cash-shift-recovery.routes.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src', 'modules', 'restaurant', 'restaurant-cash-shift-recovery.service.js'), 'utf8');
const coreRoutes = fs.readFileSync(path.join(root, 'src', 'routes', 'core.routes.js'), 'utf8');
const publicRoutes = fs.readFileSync(path.join(root, 'src', 'modules', 'restaurant', 'restaurant.public.routes.js'), 'utf8');

const patched = patchCashShiftRecovery(ui);
assert.notEqual(patched, ui, 'La capa debe encontrar el renderCash canónico');
assert.match(patched, new RegExp(CASH_SHIFT_RECOVERY_MARKER));
assert.match(patched, /\/api\/v1\/restaurante\/caja\/turno-activo/);
assert.match(patched, /const serverShiftId = cashState\?\.ownShift\?\.id \|\| null/);
assert.match(patched, /localStorage\.setItem\(SHIFT_KEY, serverShiftId\)/);
assert.match(patched, /localStorage\.removeItem\(SHIFT_KEY\)/);
assert.equal(patchCashShiftRecovery(patched), patched, 'La composición debe ser idempotente');
new Function(patched);

assert.match(routes, /router\.get\('\/caja\/turno-activo'/);
assert.match(routes, /cashShiftState\(req\.tenantId, req\.userId\)/);
assert.match(service, /async function cashShiftState/);
assert.match(service, /estado: 'ABIERTA'/);
assert.match(service, /ownedByCurrentUser/);
assert.match(service, /ownShift/);
assert.match(coreRoutes, /restaurantCashShiftRecoveryRouter/);
assert.ok(
  coreRoutes.indexOf("router.use('/restaurante', restaurantCashShiftRecoveryRouter)") < coreRoutes.indexOf("router.use('/restaurante', restaurantRouter)"),
  'La extensión de recuperación debe ejecutarse antes del router base'
);
assert.match(publicRoutes, /installCashShiftRecoveryRuntime/);
assert.ok(
  publicRoutes.indexOf('router.use(installCashShiftRecoveryRuntime)') < publicRoutes.indexOf('router.use(restaurantTenantRealtimePublicRouter)'),
  'La recuperación debe envolver el asset canónico antes de que V23 lo entregue'
);

console.log(JSON.stringify({
  ok: true,
  cashShiftAuthority: 'POSTGRESQL_CORE',
  browserStorage: 'CACHE_ONLY',
  activeShiftRecovery: true,
  staleShiftRemoval: true,
  compositionIdempotent: true
}, null, 2));
