'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const servicePath = 'src/modules/restaurant/restaurant-production-device-v63.service.js';
const routesPath = 'src/modules/restaurant/restaurant-production-device-v63.routes.js';
const authPath = 'src/middleware/auth-middleware.js';
const waiterRoutesPath = 'src/modules/restaurant/restaurant-waiter-device.routes.js';
const publicPath = 'src/modules/restaurant/restaurant-employees.public.routes.js';
const adminPath = 'src/web/restaurant-production-device-admin-v63.js';
const pairPath = 'src/web/restaurant-production-pair-v63.html';
const kdsPath = 'src/web/restaurant-production-kds-v63.html';
const rbacPath = 'src/modules/restaurant/restaurant.rbac.js';
const restaurantServicePath = 'src/modules/restaurant/restaurant.service.js';

for (const file of [servicePath, routesPath, authPath, waiterRoutesPath, publicPath, adminPath]) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding:'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

const service = read(servicePath);
const routes = read(routesPath);
const auth = read(authPath);
const waiterRoutes = read(waiterRoutesPath);
const publicRoutes = read(publicPath);
const admin = read(adminPath);
const pair = read(pairPath);
const kds = read(kdsPath);
const rbac = read(rbacPath);
const restaurantService = read(restaurantServicePath);

assert.match(service, /RESTAURANT_PRODUCTION_DEVICE_V63/);
assert.match(service, /PRODUCTION_ROLES = Object\.freeze\(\['COCINA', 'BARRA', 'POSTRES'\]\)/);
assert.match(service, /authType: 'PRODUCTION_DEVICE'/);
assert.match(service, /permanent: true/);
assert.match(service, /\/app\/produccion\/conectar\?t=/);
assert.match(service, /RESTAURANT_PRODUCTION_DEVICE_ROLE_CHANGED/);
assert.match(service, /currentStatus: 'ACTIVE'/);

assert.match(routes, /\/dispositivos-produccion\/vinculo/);
assert.match(routes, /\/dispositivos-produccion\/:id/);
assert.match(waiterRoutes, /restaurantProductionDeviceV63Router/);
assert.match(waiterRoutes, /router\.use\(restaurantProductionDeviceV63Router\)/);

assert.match(auth, /payload\.authType === 'PRODUCTION_DEVICE'/);
assert.match(auth, /restaurant-production-device-v63\.service/);
assert.match(auth, /assertActiveDevice\(payload\.deviceId, req\.tenantId, user\.id, user\.rol\)/);

assert.match(publicRoutes, /\/api\/public\/restaurante\/produccion-dispositivo\/vinculo/);
assert.match(publicRoutes, /\/api\/public\/restaurante\/produccion-dispositivo\/vincular/);
assert.match(publicRoutes, /\/app\/produccion\/conectar/);
assert.match(publicRoutes, /router\.get\('\/app\/produccion'/);
assert.match(publicRoutes, /restaurant-production-device-admin-v63\.js/);
assert.match(publicRoutes, /X-VantixGC-Production-Device/);

assert.match(admin, /VANTIX_RESTAURANT_PRODUCTION_DEVICE_ADMIN_V63/);
assert.match(admin, /data\.productionConnect/);
assert.match(admin, /dispositivos-produccion\/vinculo/);
assert.match(admin, /Conectar tablet/);

assert.match(pair, /VANTIX_RESTAURANT_PRODUCTION_PAIR_V63/);
assert.match(pair, /vantixgc_restaurant_production_device_v63/);
assert.match(pair, /VINCULAR ESTA TABLET/);
assert.match(pair, /location\.replace\('\/app\/produccion'\)/);

assert.match(kds, /VANTIX_RESTAURANT_PRODUCTION_TABLET_V63/);
assert.match(kds, /vantixgc_restaurant_production_device_v63/);
assert.match(kds, /\/api\/v1\/restaurante\/comandas\?limit=200/);
assert.match(kds, /data-state=\"EN_PREPARACION\"/);
assert.match(kds, /MARCAR LISTO/);
assert.match(kds, /data-state=\"ENTREGADA\"/);
assert.match(kds, /item\.notes/);
assert.match(kds, /Pantalla completa/);
assert.doesNotMatch(kds, />Caja</);
assert.doesNotMatch(kds, />Mesas</);
assert.doesNotMatch(kds, />Mesero</);

assert.match(rbac, /COCINA: \['RESTAURANTE\.VER', 'COMANDAS\.VER', 'COMANDAS\.EDITAR'\]/);
assert.match(rbac, /BARRA: \['RESTAURANTE\.VER', 'COMANDAS\.VER', 'COMANDAS\.EDITAR'\]/);
assert.match(rbac, /POSTRES: \['RESTAURANTE\.VER', 'COMANDAS\.VER', 'COMANDAS\.EDITAR'\]/);
assert.match(restaurantService, /if \(user\?\.rol === 'COCINA'\) return 'COCINA'/);
assert.match(restaurantService, /if \(user\?\.rol === 'BARRA'\) return 'BARRA'/);
assert.match(restaurantService, /if \(user\?\.rol === 'POSTRES'\) return 'POSTRES'/);

console.log('RESTAURANT PRODUCTION TABLET V63 OK', JSON.stringify({
  persistentPairing:true,
  stationBound:true,
  kitchenOnly:true,
  barOnly:true,
  dessertOnly:true,
  noAdminShell:true,
  notesVisible:true,
  revokeSupported:true
}));
