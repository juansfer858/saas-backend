'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const must = (condition, message) => { if (!condition) throw new Error(message); };

const p12 = read('src/modules/restaurant/restaurant-v2-only-p12.public.routes.js');
const aggregator = read('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js');
const retirementRoutes = read('src/modules/restaurant/restaurant-v1-retirement-p11.routes.js');
const devicePwa = read('src/web/restaurant-v2-device-pwa-p8.js');
const nativeControl = read('src/web/restaurant-v2-native-control-p11.js');

must(p12.includes("HEADER_VALUE = 'p12-v2-only-runtime'"), 'P12 runtime marker missing');
must(p12.includes("controlCenter: '/app/centro-de-control-v2'"), 'Native V2 Control Center target missing');
must(p12.includes("waiter: '/app/centro-de-control/mesero-v2/'"), 'Waiter V2 target missing');
must(p12.includes("production: '/app/produccion-v2/'"), 'Production V2 target missing');

for (const route of [
  '/app/centro-de-control',
  '/app/restaurante',
  '/app/centro-de-control/mesero',
  '/app/produccion',
  '/app/restaurante-v1',
  '/app/centro-de-control-p10',
  '/app/centro-de-control/mesero-v1',
  '/app/produccion-v1',
  '/app/centro-de-control-preview',
  '/app/restaurante-v2/migracion',
  '/app/restaurante-v2/retiro-v1'
]) {
  must(p12.includes(`router.get('${route}'`), `P12 does not own ${route}`);
}

must(p12.includes("router.get('/app/centro-de-control/sw.js'"), 'Legacy waiter worker retirement missing');
must(p12.includes("router.get('/app/produccion/sw.js'"), 'Legacy production worker retirement missing');
must(p12.includes('VANTIX_RESTAURANT_V1_SW_RETIREMENT_P12'), 'Legacy worker retirement marker missing');
must(p12.includes("res.redirect(307"), 'P12 redirects must remain reversible 307 redirects');

const p12Mount = aggregator.indexOf('restaurantOperationalV2PreviewPublicRouter.use(restaurantV2OnlyP12PublicRouter)');
const p11Mount = aggregator.indexOf('restaurantOperationalV2PreviewPublicRouter.use(restaurantV1RetirementP11PublicRouter)');
const v2BridgeMount = aggregator.indexOf('restaurantOperationalV2PreviewPublicRouter.use(restaurantV2ControlCenterPublicRouter)');
must(p12Mount >= 0, 'P12 is not mounted');
must(p11Mount > p12Mount, 'P12 must run before P11');
must(v2BridgeMount > p12Mount, 'P12 must run before P10 compatibility bridge');

must(retirementRoutes.includes("'/v2/retiro-v1', '/v2/cutover', '/v2/piloto'"), 'Rollback API paths are not locked');
must(retirementRoutes.includes('RESTAURANT_V2_ONLY_P12_ROLLBACK_DISABLED'), 'P12 rollback API error code missing');
must(retirementRoutes.includes('v1Runtime:false, v2Only:true'), 'P12 API runtime contract missing');

must(nativeControl.includes('VANTIX_RESTAURANT_V2_ONLY_CONTROL_P12'), 'Native Control Center does not expose P12 global marker');
must(!nativeControl.includes('/api/v1/restaurante/v2/retiro-v1/launch'), 'Native Control Center still depends on per-tenant P11 retirement gate');
must(!nativeControl.includes('assertRetirement'), 'Native Control Center still has P11 retirement bootstrap gate');
must(!nativeControl.includes("retiro:{ label:'Retiro V1'"), 'Retiro V1 must not be exposed in P12 navigation');
must(nativeControl.includes('renderIdentity();\n      renderNav();'), 'Tenant identity must render directly under P12');

must(devicePwa.includes("legacyScope:'/app/centro-de-control'"), 'Waiter legacy worker scope cleanup missing');
must(devicePwa.includes("legacyScope:'/app/produccion'"), 'Production legacy worker scope cleanup missing');
must(devicePwa.includes('retireLegacyRuntime()'), 'V2 device PWA does not retire legacy workers');
must(devicePwa.includes("version:'12.0.0'"), 'V2 device PWA runtime version was not advanced to P12');
must(devicePwa.includes('v1Runtime:false,v2Only:true,legacyWorkerRetired:true'), 'V2 device PWA final runtime flags missing');

for (const file of [
  'src/web/restaurant-v2-waiter-p8.html',
  'src/web/restaurant-v2-production-p8.html',
  'src/web/restaurant-v2-native-control-p11.html',
  'src/web/restaurant.html',
  'src/web/restaurant-waiter-pwa-v7.html',
  'src/web/restaurant-production-kds-v63.html'
]) {
  must(fs.existsSync(path.join(root, file)), `Expected frozen rollback/V2 source missing: ${file}`);
}

console.log('Restaurant V2 ONLY P12 smoke: OK');
