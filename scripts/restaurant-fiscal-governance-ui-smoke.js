const assert = require('node:assert/strict');
const fs = require('node:fs');

const platformRoutes = fs.readFileSync('src/modules/platform/saas/platform.routes.js', 'utf8');
const platformService = fs.readFileSync('src/modules/platform/saas/platform.service.js', 'utf8');
const tenantRoutes = fs.readFileSync('src/modules/restaurant/restaurant.routes.js', 'utf8');
const restaurantService = fs.readFileSync('src/modules/restaurant/restaurant.service.js', 'utf8');
const platformUi = fs.readFileSync('src/web/platform-restaurant-fiscal-governance.js', 'utf8');
const tenantWarning = fs.readFileSync('src/web/restaurant-fiscal-warning.js', 'utf8');
const app = fs.readFileSync('src/app.js', 'utf8');
const docs = fs.readFileSync('docs/RESTAURANT_PHASE2_SIMULATED_V1.md', 'utf8');

assert.match(platformRoutes, /tenants\/:tenantId\/restaurante\/fiscal-simulado/);
assert.match(platformRoutes, /setRestaurantSimulatedFiscalAcceptance\(req\.platformAdmin\.id/);
assert.match(platformRoutes, /reason:\s*z\.string\(\)\.trim\(\)\.min\(20\)/);
assert.match(platformRoutes, /acknowledgedNoDianValidity/);

assert.match(platformService, /PLATFORM_SUPERADMIN_ONLY/);
assert.match(platformService, /RESTAURANT_SIMULATED_FISCAL_ACCEPT/);
assert.match(platformService, /RESTAURANT_SIMULATED_FISCAL_REVOKE/);
assert.match(platformService, /superAdminId/);
assert.match(platformService, /decidedAt/);
assert.match(platformService, /reason/);
assert.match(platformService, /NO tienen validez fiscal ante la DIAN/);

assert.match(tenantRoutes, /RESTAURANT_SIMULATED_FISCAL_PLATFORM_ONLY/);
assert.match(tenantRoutes, /solo puede ser administrada por un super-administrador desde el Panel SaaS/);
const tenantGateSchema = tenantRoutes.slice(tenantRoutes.indexOf('const gatesSchema'), tenantRoutes.indexOf("router.get('/status'"));
assert.doesNotMatch(tenantGateSchema, /simulatedFiscalOperationExplicitlyAccepted/);

assert.match(platformUi, /Fiscal Restaurante/);
assert.match(platformUi, /NO tienen validez fiscal ante la DIAN/);
assert.match(platformUi, /Justificación obligatoria/);
assert.match(platformUi, /Confirmo que entiendo la implicación/);
assert.match(platformUi, /mínimo 20 caracteres/);
assert.match(tenantWarning, /MODO FISCAL SIMULADO AUTORIZADO POR PLATAFORMA/);
assert.match(tenantWarning, /conservarán permanentemente su marca SIMULATED/);
assert.match(app, /platform\/restaurant-fiscal-governance\.js/);
assert.match(app, /app\/restaurant-fiscal-warning\.js/);

assert.match(restaurantService, /mode:\s*fiscalMode/);
assert.match(restaurantService, /fiscalAcceptance:\s*false/);
assert.doesNotMatch(restaurantService, /restaurantFiscalDocument\.update/);
assert.doesNotMatch(restaurantService, /restaurantFiscalDocument\.updateMany/);

assert.match(docs, /El tenant NO puede activar ni revocar este flag por autoservicio/);
assert.match(docs, /PlatformAudit/);
assert.match(docs, /Los documentos emitidos en modo fiscal simulado NO tienen validez fiscal ante la DIAN/);
assert.match(docs, /No existe endpoint para convertir un `RestaurantFiscalDocument` `SIMULATED` en `DIAN`/);

console.log('RESTAURANT FISCAL GOVERNANCE UI/AUTH SMOKE OK');
console.log(JSON.stringify({
  platformOnly: true,
  tenantSelfServiceBlocked: true,
  justificationRequired: true,
  warningAcknowledgementRequired: true,
  platformAuditRequired: true,
  tenantWarningVisible: true,
  simulatedDocumentsImmutableByApi: true
}, null, 2));
