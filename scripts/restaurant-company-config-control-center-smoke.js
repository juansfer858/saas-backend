'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const publicRoutes = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant.public.routes.js'), 'utf8');
const layer = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-company-config-control-center.public.routes.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'src/web/restaurant-company-config-control-center.js'), 'utf8');
const companyProfile = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-company-profile.service.js'), 'utf8');

assert.match(layer, /VANTIX_RESTAURANT_COMPANY_CONFIG_CONTROL_CENTER_V1/);
assert.match(layer, /\/app\/centro-de-control/);
assert.match(layer, /\/app\/restaurant-company-config-control-center\.js/);
assert.match(layer, /SCRIPT_TAG/);
assert.match(layer, /Cache-Control/);
assert.match(layer, /X-VantixGC-Restaurant-Company-Config/);

assert.match(publicRoutes, /installCompanyConfigControlCenterAsset/);
assert.match(publicRoutes, /restaurantCompanyConfigControlCenterPublicRouter/);
const configMount = publicRoutes.indexOf('router.use(installCompanyConfigControlCenterAsset)');
const realtimeMount = publicRoutes.indexOf('router.use(restaurantTenantRealtimePublicRouter)');
const resilienceMount = publicRoutes.indexOf('router.use(restaurantControlCenterResiliencePublicRouter)');
assert.ok(configMount >= 0 && realtimeMount >= 0 && resilienceMount >= 0, 'expected all control-center layers to be mounted');
assert.ok(configMount < realtimeMount, 'company config wrapper must run before Restaurant Realtime');
assert.ok(configMount < resilienceMount, 'company config wrapper must run before control-center resilience');

assert.match(client, /VANTIX_RESTAURANT_COMPANY_CONFIG_CONTROL_CENTER_V1/);
assert.match(client, /Configuración avanzada/);
assert.match(client, /Información de la empresa/);
assert.match(client, /data-cc-company-config/);
assert.match(client, /view=config/);
assert.match(client, /\/api\/v1\/impresion\/empresa/);
assert.match(client, /Nombre del restaurante \/ empresa/);
assert.match(client, /NIT/);
assert.match(client, /Dirección/);
assert.match(client, /Ciudad \/ municipio/);
assert.match(client, /Departamento/);
assert.match(client, /Teléfono/);
assert.match(client, /Correo electrónico/);
assert.match(client, /Guardar empresa/);
assert.match(client, /method:'PUT'/);
assert.match(client, /no activa facturación electrónica ni crea bloqueos de DIAN/);
assert.doesNotMatch(client, /\/api\/[^"]*dian/i, 'company configuration must not call DIAN APIs');

assert.match(companyProfile, /RestaurantCompanyProfile/);
assert.match(companyProfile, /nombreEmpresa/);
assert.match(companyProfile, /nit/);
assert.match(companyProfile, /direccion/);

console.log('RESTAURANT COMPANY CONFIG CONTROL CENTER SMOKE OK', JSON.stringify({
  visibleEntrypoint:true,
  directConfigRoute:true,
  companyProfileApi:true,
  realtimeCompositionProtected:true,
  dianDecoupled:true
}));
