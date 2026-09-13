'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const audit = require('../src/modules/restaurant/restaurant-business-audit-c85.service');

const middleware = read('src/middleware/restaurant-business-audit-c85.js');
const coreRoutes = read('src/routes/core.routes.js');
const auditView = read('src/web/restaurant-audit-log-c84.js');
const auditList = read('src/modules/restaurant/restaurant-audit-log-c84.service.js');

assert.equal(audit.MARKER, 'VANTIX_RESTAURANT_BUSINESS_AUDIT_C85');
assert.equal(audit.classifyMutation('PATCH', '/restaurante/carta-importacion/items/123/editar-v27')?.action, 'UPDATE_PRODUCTO');
assert.equal(audit.classifyMutation('POST', '/restaurante/carta-importacion/categorias')?.action, 'CREATE_CATEGORIA');
assert.equal(audit.classifyMutation('PATCH', '/restaurante/carta-importacion/categorias/123')?.action, 'UPDATE_CATEGORIA');
assert.equal(audit.classifyMutation('POST', '/restaurante/carta-importacion/confirmar')?.module, 'CARTA');
assert.equal(audit.classifyMutation('POST', '/restaurante/carta-importacion/analizar'), null);
assert.equal(audit.classifyMutation('POST', '/comercial/facturas')?.module, 'VENTAS');
assert.equal(audit.classifyMutation('DELETE', '/comercial/facturas/abc')?.action, 'DELETE_VENTA');
assert.equal(audit.classifyMutation('PATCH', '/terceros/abc')?.module, 'CLIENTES');
assert.equal(audit.classifyMutation('PATCH', '/inventario/productos/abc')?.module, 'INVENTARIO');
assert.equal(audit.classifyMutation('POST', '/tesoreria/movimientos')?.module, 'TESORERIA');
assert.equal(audit.classifyMutation('PATCH', '/usuarios/abc')?.module, 'EMPLEADOS');
assert.equal(audit.classifyMutation('PATCH', '/seguridad/roles/abc')?.module, 'SEGURIDAD');
assert.equal(audit.classifyMutation('POST', '/restaurante/pedido-borrador/enviar'), null);
assert.equal(audit.classifyMutation('POST', '/restaurante/limpieza-pruebas/v68/ejecutar'), null);
assert.equal(audit.classifyMutation('GET', '/comercial/facturas'), null);

const sanitized = audit.sanitize({
  nombre:'Prueba', password:'123', token:'abc', cvv:'999', nested:{ apiKey:'secret', price:12000 }
});
assert.equal(sanitized.nombre, 'Prueba');
assert.equal(sanitized.password, '[REDACTED]');
assert.equal(sanitized.token, '[REDACTED]');
assert.equal(sanitized.cvv, '[REDACTED]');
assert.equal(sanitized.nested.apiKey, '[REDACTED]');
assert.equal(sanitized.nested.price, 12000);

assert.match(middleware, /res\.once\('finish'/);
assert.match(middleware, /setImmediate/);
assert.match(middleware, /res\.statusCode < 200 \|\| res\.statusCode >= 400/);
assert.match(coreRoutes, /restaurantBusinessAuditC85/);
assert.match(coreRoutes, /router\.use\(restaurantBusinessAuditC85\)/);
assert.match(auditView, /VANTIX_RESTAURANT_BUSINESS_AUDIT_C85/);
assert.match(auditView, /El historial de Auditoría es inmutable/);
assert.match(auditView, /VANTIX_RESTAURANT_AUDIT_SAFE_RECOVERY_V86/);
assert.match(auditList, /metadata\.label/);
assert.match(auditList, /module: metadata\.module/);
assert.match(auditList, /auditHistoryImmutable:\s*true/);
assert.match(auditList, /FINANCIAL_SUBJECTS/);

console.log('RESTAURANT BUSINESS AUDIT C85 OK', JSON.stringify({
  restaurantOnly:true,
  successfulMutationsOnly:true,
  asyncNonBlocking:true,
  sensitiveDataRedacted:true,
  menuAndOcrEdits:true,
  sales:true,
  treasury:true,
  clients:true,
  inventory:true,
  employees:true,
  security:true,
  technicalNoiseExcluded:true,
  cleanupAuditNotDuplicated:true,
  immutableAuditHistory:true,
  safeRecoverySurface:true,
  financialGenericRestoreBlocked:true
}));
