'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const files = {
  schema:'prisma/notifications-push-v65.prisma',
  provider:'src/modules/notifications/push-v65.provider.js',
  service:'src/modules/notifications/push-v65.service.js',
  routes:'src/modules/notifications/push-v65.routes.js',
  public:'src/modules/restaurant/restaurant-push-v65.public.routes.js',
  client:'src/web/restaurant-push-v65.js',
  core:'src/routes/core.routes.js',
  composition:'src/modules/restaurant/restaurant.public.routes.js',
  runtimeSchema:'scripts/ensure-restaurant-runtime-schema.js',
  env:'.env.example'
};

for (const file of [files.provider, files.service, files.routes, files.public, files.client, files.core, files.composition, files.runtimeSchema]) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding:'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

const schema = read(files.schema);
const provider = read(files.provider);
const service = read(files.service);
const routes = read(files.routes);
const pub = read(files.public);
const client = read(files.client);
const core = read(files.core);
const composition = read(files.composition);
const runtimeSchema = read(files.runtimeSchema);
const env = read(files.env);

assert.match(schema, /model NotificationPushDevice/);
assert.match(schema, /tokenHash\s+String\s+@unique/);
assert.match(schema, /tokenCiphertext\s+String/);
assert.match(schema, /model NotificationPushDelivery/);
assert.match(schema, /@@index\(\[tenantId, role, state\]\)/);

// Endpoint oficial de Firebase Cloud Messaging HTTP v1.
assert.match(provider, /fcm\.googleapis\.com\/v1\/projects/);
assert.match(provider, /firebase\.messaging/);
assert.match(provider, /oauth2\.googleapis\.com\/token/);
assert.match(provider, /RS256/);
assert.doesNotMatch(provider, /firebase-admin/);

assert.match(service, /aes-256-gcm/);
assert.match(service, /tenantId, userId, state:'ACTIVE'/);
assert.match(service, /eventCode:'PUSH_TEST'/);
assert.match(service, /state:'INVALID'/);
assert.doesNotMatch(service, /recipientPhoneE164/);

assert.match(routes, /\/dispositivos/);
assert.match(routes, /\/prueba/);
assert.match(routes, /requirePermission\('RESTAURANTE\.VER'\)/);
assert.match(core, /\/notificaciones\/push-v65/);
assert.ok(core.indexOf("router.use('/notificaciones/push-v65'") < core.indexOf("router.use('/notificaciones', notificationsRouter)"));

assert.match(pub, /\/api\/public\/restaurante\/push-v65\/config/);
assert.match(pub, /\/app\/push-v65-sw\.js/);
assert.match(pub, /onBackgroundMessage/);
assert.match(pub, /notificationclick/);
assert.match(pub, /restaurant-waiter-runtime-v7\.js/);
assert.match(pub, /\/app\/produccion/);
assert.doesNotMatch(pub, /restaurant-qr-ui\.js/);
const pushMount = composition.indexOf('router.use(restaurantPushV65PublicRouter);');
const pushWrapper = composition.indexOf('router.use(installRestaurantPushV65);');
const cashMount = composition.indexOf('router.use(installRestaurantCashCloseMethodsV62);');
assert.ok(pushMount >= 0 && pushWrapper >= 0 && cashMount >= 0, 'Los montajes V65/V62 deben existir');
assert.ok(pushMount < pushWrapper && pushWrapper < cashMount, 'V65 debe montar router + wrapper antes de V62');

assert.match(client, /Notification\.requestPermission\(\)/);
assert.match(client, /messaging\.getToken/);
assert.match(client, /serviceWorkerRegistration:registration/);
assert.match(client, /vantixgc_core_session_v1/);
assert.match(client, /vantixgc_restaurant_production_device_v63/);
assert.match(client, /Push activo/);
assert.match(client, /push-v65\/prueba/);

// V65.1: las tablas Push deben formar parte del gate de esquema de runtime.
// Si faltan en una instalación existente, el arranque debe ejecutar prisma db push
// antes de publicar HTTP; de lo contrario el primer registro real cae en HTTP 500.
assert.match(runtimeSchema, /NotificationPushDevice/);
assert.match(runtimeSchema, /NotificationPushDelivery/);
assert.match(runtimeSchema, /notificationPushDevice/);
assert.match(runtimeSchema, /notificationPushDelivery/);
assert.match(runtimeSchema, /runPrismaDbPush\(\)/);

for (const key of ['FCM_SERVICE_ACCOUNT_JSON','FCM_WEB_API_KEY','FCM_WEB_PROJECT_ID','FCM_WEB_MESSAGING_SENDER_ID','FCM_WEB_APP_ID','FCM_WEB_VAPID_KEY']) {
  assert.match(env, new RegExp(`${key}=`));
}

console.log('RESTAURANT PUSH CORE V65 OK', JSON.stringify({
  provider:'FCM_HTTP_V1',
  encryptedTokens:true,
  tenantScoped:true,
  runtimeSchemaGate:true,
  selfTest:true,
  surfaces:['CENTRO_CONTROL','MESERO','PRODUCCION'],
  qrClientDeferredToV68:true
}));
