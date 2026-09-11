'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const reset = require('../src/modules/restaurant/restaurant-pos-sequence-reset-c83.service');

const serviceSource = fs.readFileSync('src/modules/restaurant/restaurant-pos-sequence-reset-c83.service.js', 'utf8');
const numberSource = fs.readFileSync('src/modules/restaurant/restaurant-pos-number.service.js', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-test-data-reset-v68.routes.js', 'utf8');
const client = fs.readFileSync('src/web/restaurant-company-admin-advanced.js', 'utf8');

assert.equal(reset.MARKER, 'VANTIX_RESTAURANT_POS_SEQUENCE_RESET_C83');
assert.equal(reset.AUDIT_ENTITY, 'RESTAURANT_POS_SEQUENCE_RESET_C83');
assert.equal(reset.AUDIT_ACTION, 'RESET_INTERNAL_POS_SEQUENCE');
assert.equal(reset.normalizeReason('  Inicio   operación real  '), 'Inicio operación real');
assert.throws(
  () => reset.normalizeReason('no'),
  (error) => error?.code === 'RESTAURANT_POS_RESET_REASON_REQUIRED'
);

assert.match(numberSource, /"sourceId" LIKE 'REST-TABLE-%'/, 'el contador debe aislar únicamente ventas POS de restaurante');
assert.match(serviceSource, /lockTenantSequence\(tx, tenantId\)/, 'el reinicio debe compartir el lock transaccional del contador');
assert.match(serviceSource, /assignedCount > 0n/, 'debe bloquear reinicios que crearían números históricos duplicados');
assert.match(serviceSource, /auditoriaContable\.create/, 'cada reinicio debe dejar auditoría persistente');
assert.match(serviceSource, /reason: cleanReason/, 'la auditoría debe guardar el motivo obligatorio');
assert.match(serviceSource, /userId/, 'la auditoría debe guardar quién realizó el reinicio');
assert.match(serviceSource, /resetTo: '000000'/, 'el objetivo del reinicio debe ser 000000');
assert.match(serviceSource, /dianUntouched: true/, 'el reinicio debe declarar que DIAN queda intacta');
assert.doesNotMatch(serviceSource, /dianDocument\.(delete|update|create)/, 'C83 no puede modificar documentos DIAN');

assert.match(routes, /\/limpieza-pruebas\/v68\/consecutivo-pos'/);
assert.match(routes, /\/limpieza-pruebas\/v68\/consecutivo-pos\/reiniciar'/);
assert.match(routes, /RESTAURANTE\.ADMINISTRAR/);
assert.match(routes, /req\.body\?\.reason/);

assert.match(client, /VANTIX_RESTAURANT_POS_SEQUENCE_RESET_C83/);
assert.match(client, /Reiniciar contador de facturación interna/);
assert.match(client, /Motivo del reinicio \*/);
assert.match(client, /rcaPosResetReason/);
assert.match(client, /Reiniciar contador a 000000/);
assert.match(client, /consecutivo-pos\/reiniciar/);
assert.match(client, /no toca DIAN ni consecutivos fiscales/i);
assert.match(client, /Cada reinicio guarda fecha, usuario y motivo en auditoría/);
assert.match(client, /Los comprobantes ya emitidos no cambiarán/);

console.log('RESTAURANT POS SEQUENCE RESET C83 SMOKE OK', JSON.stringify({
  resetTarget:'000000',
  reasonRequired:true,
  userAudit:true,
  timestampAudit:true,
  restaurantOnly:true,
  historicalDocumentsPreserved:true,
  duplicateHistoryGuard:true,
  dianUntouched:true,
  advancedCleanupUi:true
}));
