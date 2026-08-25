const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const APPROVED_INSTALL_SOURCE = '40634cc4f6812686644ccb7109be283806f74e66';

const service = read('src/modules/self-service/restaurant-self-service.service.js');
const installClarity = read('src/modules/self-service/restaurant-install-clarity.service.js');
const routes = read('src/modules/self-service/restaurant-self-service.routes.js');
const publicRoutes = read('src/modules/public-installer/public-installer.routes.js');
const coreRoutes = read('src/routes/core.routes.js');
const schema = read('prisma/saas-self-service-v1.prisma');
const installer = read('edge/supervisor/install-windows.ps1');
const server = read('server.js');
const landing = read('src/web/restaurant-public.html');
const demo = read('src/web/restaurant-public-demo.html');
const signup = read('src/web/restaurant-signup.html');
const onboarding = read('src/web/restaurant-onboarding.html');
const restaurant = read('src/web/restaurant.html');

for (const file of [
  'src/modules/self-service/restaurant-self-service.service.js',
  'src/modules/self-service/restaurant-install-clarity.service.js',
  'src/modules/self-service/restaurant-self-service.routes.js',
  'src/modules/public-installer/public-installer.routes.js',
  'scripts/ensure-self-service-runtime-schema.js'
]) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

assert.match(schema, /model SaasSubscription/);
assert.match(schema, /model TenantOnboarding/);
assert.match(schema, /model EdgeInstallClaim/);
assert.match(service, /RESTAURANT_TRIAL_DAYS/);
assert.match(service, /PUBLIC_SELF_SERVICE/);
assert.match(service, /activateWithClient\(tx, tenant\.id, 'RESTAURANT'/);
assert.match(service, /createInstallClaim/);
assert.match(service, /consumeInstallClaim/);
assert.match(service, /installerPowerShell/);
assert.ok(service.includes(`const INSTALL_SOURCE_COMMIT = '${APPROVED_INSTALL_SOURCE}';`));
assert.ok(!service.includes('__PIN_AFTER_IMPLEMENTATION__'));
assert.match(installClarity, /EDGE_ONLINE/);
assert.match(installClarity, /CLOUD_ONLY_DEFERRED/);
assert.match(installClarity, /ONBOARDING_REQUIRED_STEPS_PENDING/);
assert.match(routes, /\/register/);
assert.match(routes, /install-claims\/consume/);
assert.match(routes, /onboarding\/install-claim/);
assert.match(routes, /onboarding\/site\/defer/);
assert.doesNotMatch(routes, /install-claim[\s\S]{0,500}completeStep:\s*'SITE'/);
assert.match(publicRoutes, /\/restaurantes\/demo/);
assert.match(publicRoutes, /\/restaurantes\/crear/);
assert.match(publicRoutes, /\/app\/onboarding/);
assert.match(publicRoutes, /\/api\/public\/restaurantes/);
assert.match(coreRoutes, /\/autoservicio/);
assert.match(installer, /InstallClaimToken/);
assert.match(installer, /install-claims\/consume/);
assert.match(server, /ensureSelfServiceRuntimeSchema/);
assert.match(server, /SELF_SERVICE_SCHEMA_RUNTIME_READY/);
assert.match(landing, /Probar 14 días/);
assert.match(landing, /Edge local/);
assert.match(landing, /Del pedido al cierre de caja/);
assert.match(landing, /LAN \+ Cloud/);
assert.match(landing, /Preguntas frecuentes/);
assert.match(landing, /#f97316/i);
assert.match(landing, /#ea580c/i);
assert.doesNotMatch(landing, /#0d6b43/i);
assert.doesNotMatch(landing, /#118a57/i);
assert.doesNotMatch(landing, /--green/i);
assert.match(demo, /DEMO INTERACTIVO/);
assert.match(demo, /Enviar a cocina/);
assert.match(signup, /Crear restaurante y comenzar/);
assert.match(signup, /NO instala nada en este computador/);
assert.match(signup, /\/api\/public\/restaurantes\/register/);
assert.match(onboarding, /todavía no se ha instalado nada en este PC/i);
assert.match(onboarding, /Generar instalador de esta sede/);
assert.match(onboarding, /Descargarlo no es suficiente/);
assert.match(onboarding, /Seguir sólo en la nube por ahora/);
assert.match(onboarding, /\/onboarding\/site\/defer/);
assert.match(onboarding, /\/api\/v1\/autoservicio\/onboarding/);
assert.doesNotMatch(onboarding, /EDGE_AGENT_KEY/);
assert.doesNotMatch(onboarding, /EDGE_AGENT_ID/);
assert.match(restaurant, /Estás trabajando en VantixGC Cloud/);
assert.match(restaurant, /Instalar esta sede/);
assert.match(restaurant, /Sede instalada y ONLINE/);

console.log('RESTAURANT SELF SERVICE V1 STATIC SMOKE OK');
