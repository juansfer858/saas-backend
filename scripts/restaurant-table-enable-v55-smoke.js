'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const feature = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-table-enable-v55.public.routes.js'), 'utf8');
const publicRoutes = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant.public.routes.js'), 'utf8');

function must(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`V55 smoke: falta ${label}: ${needle}`);
}

must(feature, 'VANTIX_RESTAURANT_TABLE_ENABLE_V55', 'marker QR');
must(feature, 'VANTIX_RESTAURANT_TABLE_ENABLE_STAFF_V55', 'marker staff');
must(feature, "ORIGIN_TYPE = 'RESTAURANT_TABLE_ENABLE_REQUEST'", 'persistencia durable');
must(feature, '/api/public/restaurante/qr/:token/habilitacion-mesa', 'solicitud pública por QR');
must(feature, '/api/public/restaurante/habilitaciones-mesa', 'bandeja staff');
must(feature, '/habilitar', 'acción de habilitar');
must(feature, "staffActor(req, 'MESAS.CREAR')", 'permiso de apertura');
must(feature, 'verifyAccessToken', 'JWT staff');
must(feature, 'waiterDevices.assertActiveDevice', 'dispositivo Mesero activo');
must(feature, 'rbac.hasPermission', 'RBAC');
must(feature, 'restaurant.openTable', 'apertura canónica de mesa');
must(feature, 'HABILITAR '+"'", 'mensaje grande de habilitación');
must(feature, 'autoSendAfterApproval:true', 'envío automático posterior');
must(feature, "previousFetch(input,init)", 'continuación al flujo V54');
must(feature, "guestCount:1, billingMode:'CONJUNTA'", 'habilitación de un toque');

must(publicRoutes, "require('./restaurant-table-enable-v55.public.routes')", 'montaje V55');
must(publicRoutes, 'router.use(installRestaurantTableEnableV55);', 'runtime V55');
must(publicRoutes, 'router.use(restaurantTableEnableV55PublicRouter);', 'API V55');
must(publicRoutes, 'router.use(installRestaurantQrDirectTestV54);', 'V54 conservado');

const v55Mount = publicRoutes.indexOf('router.use(installRestaurantTableEnableV55);');
const v54Mount = publicRoutes.indexOf('router.use(installRestaurantQrDirectTestV54);');
if (v55Mount < 0 || v54Mount < 0 || v55Mount >= v54Mount) {
  throw new Error('V55 smoke: V55 debe envolver el asset antes de V54 para que la habilitación sea el gate exterior');
}

if (/code\s*:\s*['"]?\d{4}/.test(feature) || feature.includes('Código de 4 dígitos')) {
  throw new Error('V55 smoke: la nueva habilitación no debe reintroducir el PIN de cuatro dígitos');
}

console.log('RESTAURANT_TABLE_ENABLE_V55_SMOKE_OK');
