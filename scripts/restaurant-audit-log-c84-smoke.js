'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const reset = read('src/modules/restaurant/restaurant-test-data-reset-v68.service.js');
const routes = read('src/modules/restaurant/restaurant-test-data-reset-v68.routes.js');
const auditService = read('src/modules/restaurant/restaurant-audit-log-c84.service.js');
const publicLayer = read('src/modules/restaurant/restaurant-company-admin-advanced.public.routes.js');
const ui = read('src/web/restaurant-audit-log-c84.js');
const posReset = read('src/modules/restaurant/restaurant-pos-sequence-reset-c83.service.js');

assert.match(auditService, /VANTIX_RESTAURANT_AUDIT_LOG_C84/);
assert.match(auditService, /auditoriaContable\.findMany/);
assert.match(auditService, /orderBy:\s*\{ creadoEn: 'desc' \}/);
assert.match(auditService, /include:\s*\{[\s\S]*user:/);
assert.match(auditService, /preservedByTestCleanup:\s*true/);
assert.match(auditService, /readOnly:\s*true/);

assert.doesNotMatch(
  reset,
  /removeMany\(tx, removed, 'auditoriaContable'/,
  'la limpieza de pruebas no puede borrar el historial de auditoría'
);
assert.match(reset, /auditHistory:\s*true/);
assert.match(reset, /'AUDITORIA'/);
assert.match(reset, /accion:\s*'RESET_TEST_DATA'/);

assert.match(posReset, /accion:\s*AUDIT_ACTION/);
assert.match(posReset, /reason:\s*cleanReason/);
assert.match(posReset, /RESET_INTERNAL_POS_SEQUENCE/);

assert.match(routes, /\/auditoria\/v84/);
assert.match(routes, /auditLog\.list/);
assert.match(routes, /requirePermission\('RESTAURANTE\.ADMINISTRAR'\)/);

assert.match(publicLayer, /\/app\/restaurant-audit-log-c84\.js/);
assert.match(publicLayer, /VANTIX_RESTAURANT_AUDIT_LOG_C84/);
assert.match(publicLayer, /X-VantixGC-Restaurant-Audit/);

assert.match(ui, /Auditoría \/ Registro de actividad/);
assert.match(ui, /Historial administrativo del restaurante/);
assert.match(ui, /Esta vista es sólo lectura/);
assert.match(ui, /Este historial no se elimina con Limpieza de pruebas/);
assert.match(ui, /\/api\/v1\/restaurante\/auditoria\/v84\?limit=200/);
assert.match(ui, /data-restaurant-audit-tab/);
assert.doesNotMatch(ui, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);

console.log('RESTAURANT AUDIT LOG C84 SMOKE OK', JSON.stringify({
  immutableAcrossTestCleanup:true,
  readOnlyUi:true,
  adminPermission:true,
  userTimestampAction:true,
  posResetReasonVisible:true,
  cleanupEventVisible:true,
  noOperationalMutation:true
}));
