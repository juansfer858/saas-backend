const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }

const tenantUi = read('src/web/platform-core-config.html');
const platformUi = read('src/web/platform-admin.html');
const printingService = read('src/modules/platform/printing/printing.service.js');
const app = read('src/app.js');
const docs = read('docs/PLATFORM_CORE_DIAN_RBAC_PRINT_SAAS_V1.md');

for (const token of [
  'DIAN',
  'Roles y permisos',
  'Impresión',
  'Nómina electrónica',
  'DOCUMENTO_EQUIVALENTE_POS',
  'NOMINA_ELECTRONICA',
  'TERMICA_58',
  'TERMICA_80',
  'anexo técnico vigente'
]) assert.ok(tenantUi.includes(token), `Tenant UI debe contener ${token}`);

// Los cuatro cuadros de estado DIAN son controles funcionales del mismo archivo
// propietario: abren detalle filtrado y permiten volver al resumen sin capas UI.
for (const token of [
  'core-dian-metric',
  'data-dian-metric="invoice"',
  'data-dian-metric="support"',
  'data-dian-metric="payroll"',
  'data-dian-metric="provider"',
  'function openDianMetric(',
  'function closeDianMetric(',
  'id="dianMetricBack"',
  '← Atrás',
  'Volver al resumen DIAN',
  'dianRangeTypes',
  'dianDocumentMatches',
  'openPayrollFromDian',
  'loadDian(state.dianMetric)'
]) assert.ok(tenantUi.includes(token), `Core transversal debe contener ${token}`);

const tenantScript = tenantUi.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(tenantScript, 'Configuración avanzada debe conservar controlador inline');
new Function(tenantScript);

for (const token of [
  'Panel SaaS VantixGC',
  'Acceso de plataforma independiente',
  '/platform/api/auth/login',
  '/platform/api/tenants',
  'PILOTO',
  'Suspender',
  'Usuarios',
  'Auditoría plataforma'
]) assert.ok(platformUi.includes(token), `Platform UI debe contener ${token}`);

assert.ok(printingService.includes('PENDING_OFFICIAL_ANNEX_SIZE_VERIFICATION'));
assert.ok(app.includes("app.get('/app/configuracion-avanzada'"));
assert.ok(app.includes("app.get('/platform'"));
assert.ok(app.includes("app.use('/platform/api/auth'"));
assert.ok(app.includes("app.use('/platform/api'"));
assert.ok(docs.includes('PT real'));
assert.ok(docs.includes('20 mm'));
assert.ok(docs.includes('no se etiqueta como mínimo legal DIAN verificado'));

console.log('PLATFORM CORE UI + ACTIONABLE DIAN METRICS SMOKE OK');
console.log(JSON.stringify({ tenantAdvancedConfig: true, dianMetricDrilldowns: true, independentPlatformPanel: true, legalBoundaryDocumented: true }, null, 2));
