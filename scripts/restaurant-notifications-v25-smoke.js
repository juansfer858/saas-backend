'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const files = {
  pushService:'src/modules/notifications/push-v65.service.js',
  pushPublic:'src/modules/restaurant/restaurant-push-v65.public.routes.js',
  operational:'src/modules/restaurant/restaurant-operational-push-v25.service.js',
  kds:'src/modules/restaurant/restaurant-v2-kds.service.js',
  kdsPush:'src/modules/restaurant/restaurant-v2-kds-push.service.js',
  waiter:'src/web/restaurant-v2-waiter-p8.html',
  production:'src/web/restaurant-v2-production-p8.html',
  pwa:'src/web/restaurant-v2-device-pwa-p8.js',
  waiterSw:'src/web/restaurant-v2-waiter-sw-p8.js',
  p3:'src/modules/restaurant/restaurant-v2-orders.routes.js'
};

for (const file of [files.pushService, files.pushPublic, files.operational, files.kds, files.kdsPush, files.pwa, files.waiterSw, files.p3]) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding:'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

const pushService = read(files.pushService);
const pushPublic = read(files.pushPublic);
const operational = read(files.operational);
const kds = read(files.kds);
const kdsPush = read(files.kdsPush);
const waiter = read(files.waiter);
const production = read(files.production);
const pwa = read(files.pwa);
const waiterSw = read(files.waiterSw);
const p3 = read(files.p3);

// Mesero y Producción deben poder registrar Push V65 en sus superficies V2 reales.
assert.match(waiter, /restaurant-push-v65\.js\?v=v25/);
assert.match(waiter, /data-vantix-push-v65="1"/);
assert.match(production, /restaurant-push-v65\.js/);

// El Service Worker de Push sigue aislado y no reemplaza los SW PWA de dispositivos.
assert.match(pushPublic, /Service-Worker-Allowed', '\/app\/push-v65\//);
assert.match(pwa, /scope:'\/app\/centro-de-control\/mesero-v2\/'/);
assert.match(pwa, /scope:'\/app\/produccion-v2\/'/);
assert.doesNotMatch(pwa, /push-v65/);
assert.doesNotMatch(waiterSw, /push-v65-sw/);

// V25 observa exclusivamente eventos públicos operativos, nunca cobros/inventario/DIAN.
assert.match(pushPublic, /VANTIX_RESTAURANT_OPERATIONAL_PUSH_V25/);
for (const action of ['llamar-mesero','pedir-cuenta','pedidos','solicitar-apertura']) {
  assert.match(pushPublic, new RegExp(action.replace('-', '\\-')));
}
assert.doesNotMatch(pushPublic, /cerrar-con-metodo|inventario|dian/i);
assert.match(pushPublic, /res\.statusCode < 200 \|\| res\.statusCode >= 300/);
assert.match(pushPublic, /void operationalPush\.notifyWaiterCallFromQr/);
assert.match(pushPublic, /void operationalPush\.notifyAccountRequestFromQr/);
assert.match(pushPublic, /void operationalPush\.notifyTableOpenRequestFromQr/);
assert.match(pushPublic, /operationalPush\.notifyQrOrderFromOrder/);
assert.match(pushPublic, /kdsPush\.notifyLatestRound/);
assert.match(pushPublic, /Promise\.allSettled/);
assert.match(pushPublic, /\.catch\(\(\)=>\{\}\)/);

// Audiencias y códigos operativos quedan explícitos y trazables.
for (const code of [
  'RESTAURANT_WAITER_CALL_V25',
  'RESTAURANT_ACCOUNT_REQUEST_V25',
  'RESTAURANT_QR_ORDER_V25',
  'RESTAURANT_ORDER_READY_V25',
  'RESTAURANT_TABLE_OPEN_REQUEST_V25'
]) assert.match(operational, new RegExp(code));
assert.match(operational, /primaryWaiterId/);
assert.match(operational, /roles\.push\('MESERO'\)/);
assert.match(operational, /ADMINISTRADOR/);
assert.match(operational, /eventSuffix/);

// Fanout genérico sólo usa dispositivos activos con permiso y deduplica entregas exitosas.
assert.match(pushService, /sendOperationalEvent/);
assert.match(pushService, /state:'ACTIVE', permission:'granted'/);
assert.match(pushService, /state:\{ in:\['SENDING','SENT'\] \}/);
assert.match(pushService, /deduplicated/);
assert.match(pushService, /FCM_NOT_CONFIGURED/);

// Comanda nueva ya tenía su Push especializado: V25 no debe crear un segundo camino genérico.
assert.match(p3, /void kdsPush\.notifyLatestRound/);
assert.match(kdsPush, /RESTAURANT_COMMAND_NEW_V2/);

// El regreso Producción -> Mesero ocurre sólo cuando la orden completa se vuelve LISTO.
assert.match(kds, /updated\?\.becameReady && updated\?\.order/);
assert.match(kds, /void operationalPush\.notifyOrderReadyFromOrder\(updated\.order\)\.catch\(\(\)=>\{\}\)/);

console.log('RESTAURANT NOTIFICATIONS V25 OK', JSON.stringify({
  waiterPushClient:true,
  productionPushClient:true,
  isolatedPushWorker:true,
  waiterCallPush:true,
  accountRequestPush:true,
  qrOrderWaiterPush:true,
  qrOrderProductionPush:true,
  tableOpenRequestPush:true,
  orderReadyWaiterPush:true,
  bestEffort:true,
  deduplicated:true,
  noCashInventoryDianHooks:true
}));
