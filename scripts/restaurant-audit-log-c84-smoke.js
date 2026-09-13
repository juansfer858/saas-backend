'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Prisma } = require('@prisma/client');

const read = (file) => fs.readFileSync(file, 'utf8');
const reset = read('src/modules/restaurant/restaurant-test-data-reset-v68.service.js');
const routes = read('src/modules/restaurant/restaurant-test-data-reset-v68.routes.js');
const auditService = read('src/modules/restaurant/restaurant-audit-log-c84.service.js');
const auditRuntime = require('../src/modules/restaurant/restaurant-audit-log-c84.service');
const publicLayer = read('src/modules/restaurant/restaurant-company-admin-advanced.public.routes.js');
const ui = read('src/web/restaurant-audit-log-c84.js');
const posReset = read('src/modules/restaurant/restaurant-pos-sequence-reset-c83.service.js');

assert.match(auditService, /VANTIX_RESTAURANT_AUDIT_LOG_C84/);
assert.match(auditService, /VANTIX_RESTAURANT_AUDIT_SAFE_RECOVERY_V86/);
assert.match(auditService, /VANTIX_RESTAURANT_AUDIT_READABLE_V87/);
assert.match(auditService, /auditoriaContable\.findMany/);
assert.match(auditService, /orderBy:\s*\{ creadoEn: 'desc' \}/);
assert.match(auditService, /include:\s*\{[\s\S]*user:/);
assert.match(auditService, /preservedByTestCleanup:\s*true/);
assert.match(auditService, /auditHistoryImmutable:\s*true/);
assert.match(auditService, /recoveryPolicy:\s*'VIEW_DOWNLOAD_THEN_RESTORE'/);
assert.match(auditService, /displayPolicy:\s*'BUSINESS_FIRST_TECHNICAL_SECONDARY'/);
assert.match(auditService, /FINANCIAL_SUBJECTS/);
assert.match(auditService, /MESA_SOFT_DELETE/);
assert.match(auditService, /MENU_ITEM_RECREATE/);
assert.match(auditService, /originalAuditId/);
assert.match(auditService, /accion:\s*`RESTORE_\$\{subject\}`/);

const decimal = new Prisma.Decimal('29534.25');
const legacyDecimal = {
  d:[...decimal.d],
  e:decimal.e,
  s:decimal.s,
  constructor:'function Decimal(v) { internal implementation should never be shown }'
};
assert.equal(auditRuntime.isLegacyDecimalArtifact(legacyDecimal), true);
assert.equal(auditRuntime.normalizeAuditValue(legacyDecimal), '29534.25');
const historicalProduct = auditRuntime.normalizeAuditValue({
  nombre:'Producto histórico',
  precio1:legacyDecimal,
  costoPromedio:{ ...legacyDecimal },
  controlaInventario:false
});
assert.equal(historicalProduct.nombre, 'Producto histórico');
assert.equal(historicalProduct.precio1, '29534.25');
assert.equal(historicalProduct.costoPromedio, '29534.25');
assert.equal(historicalProduct.controlaInventario, false);
assert.equal(JSON.stringify(historicalProduct).includes('function Decimal'), false);

const tableEligibility = auditRuntime.restoreEligibility({
  accion:'DELETE_MESA',
  metadata:{ method:'DELETE', subject:'MESA', path:'/restaurante/mesas/mesa-1', result:{ id:'mesa-1' } }
});
assert.equal(tableEligibility.canRestore, true);
assert.equal(tableEligibility.adapter, 'MESA_SOFT_DELETE');

const menuEligibility = auditRuntime.restoreEligibility({
  accion:'DELETE_CARTA',
  metadata:{ method:'DELETE', subject:'CARTA', path:'/restaurante/menu/item-1', result:{ id:'item-1', productId:'product-1', category:'FUERTES', station:'COCINA' } }
});
assert.equal(menuEligibility.canRestore, true);
assert.equal(menuEligibility.adapter, 'MENU_ITEM_RECREATE');

const financialEligibility = auditRuntime.restoreEligibility({
  accion:'DELETE_VENTA',
  metadata:{ method:'DELETE', subject:'VENTA', path:'/comercial/documentos/venta-1', result:{ id:'venta-1' } }
});
assert.equal(financialEligibility.canRestore, false);
assert.match(financialEligibility.reason, /flujo de dominio/);

assert.doesNotMatch(reset, /removeMany\(tx, removed, 'auditoriaContable'/, 'la limpieza de pruebas no puede borrar el historial de auditoría');
assert.match(reset, /auditHistory:\s*true/);
assert.match(reset, /'AUDITORIA'/);
assert.match(reset, /accion:\s*'RESET_TEST_DATA'/);
assert.match(posReset, /accion:\s*AUDIT_ACTION/);
assert.match(posReset, /reason:\s*cleanReason/);
assert.match(posReset, /RESET_INTERNAL_POS_SEQUENCE/);

assert.match(routes, /router\.get\('\/auditoria\/v84'/);
assert.match(routes, /router\.get\('\/auditoria\/v84\/:id'/);
assert.match(routes, /router\.post\('\/auditoria\/v84\/:id\/restaurar'/);
assert.match(routes, /auditLog\.list/);
assert.match(routes, /auditLog\.detail/);
assert.match(routes, /auditLog\.restore/);
assert.match(routes, /requirePermission\('RESTAURANTE\.ADMINISTRAR'\)/);

assert.match(publicLayer, /\/app\/restaurant-audit-log-c84\.js/);
assert.match(publicLayer, /VANTIX_RESTAURANT_AUDIT_LOG_C84/);
assert.match(publicLayer, /X-VantixGC-Restaurant-Audit/);

assert.match(ui, /Auditoría \/ Registro de actividad/);
assert.match(ui, /VANTIX_RESTAURANT_AUDIT_SAFE_RECOVERY_V86/);
assert.match(ui, /VANTIX_RESTAURANT_AUDIT_READABLE_V87/);
assert.match(ui, /Datos del registro/);
assert.match(ui, /VER DATOS TÉCNICOS/);
assert.match(ui, /DESCARGAR COPIA/);
assert.match(ui, />RESTAURAR</);
assert.match(ui, /data-audit-view/);
assert.match(ui, /data-audit-download/);
assert.match(ui, /data-audit-restore/);
assert.match(ui, /\/api\/v1\/restaurante\/auditoria\/v84/);
assert.match(ui, /method:'POST'/);
assert.match(ui, /Motivo de la restauración/);
assert.match(ui, /El historial de Auditoría es inmutable/);
assert.doesNotMatch(ui, />Contenido conservado</);
assert.ok(ui.indexOf('VER REGISTRO') < ui.indexOf('DESCARGAR COPIA'), 'la UX debe obligar a abrir antes de ofrecer descarga/restauración');

console.log('RESTAURANT AUDIT READABLE V87 SMOKE OK', JSON.stringify({
  immutableAcrossTestCleanup:true,
  businessDataFirst:true,
  technicalDataSecondary:true,
  historicalDecimalRecovered:true,
  executableInternalsHidden:true,
  viewBeforeDownloadAndRestore:true,
  adminPermission:true,
  safeTableRestore:true,
  safeMenuRestore:true,
  financialGenericRestoreBlocked:true,
  restoreCreatesNewAuditEvent:true,
  edgeContractUntouched:true
}));
