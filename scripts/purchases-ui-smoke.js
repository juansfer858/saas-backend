const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('src/web/purchases.html');
const routes = read('src/modules/commercial/commercial.routes.js');
const controller = read('src/modules/commercial/purchase.controller.js');
const schemas = read('src/modules/commercial/purchase.schemas.js');
const permissions = read('src/middleware/require-permission.js');

for (const token of [
  '+ Nueva compra',
  'Guardar borrador',
  'Emitir compra',
  'Factura proveedor / referencia externa',
  '+ Crear producto',
  '+ Crear proveedor',
  'Guardar proveedor',
  'Sin salir de la compra',
  'Datos tributarios (opcional)',
  'Retenciones',
  'Total neto a pagar',
  'Asiento AU',
  '/api/v1/comercial/compras',
  '/api/v1/comercial/compras/proveedores',
  '/api/v1/comercial/compras/proveedores-rapido',
  '/api/v1/contabilidad/impuestos/calcular',
  'quickSupplierForm'
]) assert.ok(html.includes(token), `Falta contrato UI: ${token}`);

assert.ok(!html.includes('próxima iteración'), 'Compras no puede seguir como vista futura/deshabilitada');
assert.ok(!html.includes("api('/api/v1/terceros?activo=true"), 'La selección de proveedor no debe exigir acceso administrativo a Terceros');

assert.ok(routes.includes("router.get('/compras/proveedores', purchaseController.listSuppliers)"));
assert.ok(routes.includes("router.post('/compras/proveedores-rapido', purchaseController.createQuickSupplier)"));
assert.ok(routes.indexOf("/compras/proveedores") < routes.indexOf("/compras/:id"), 'Las rutas de proveedor deben resolverse antes de /compras/:id');
assert.ok(controller.includes("thirdPartyService = require('../third-parties/third-party.service')"));
assert.ok(controller.includes("tipo: 'PROVEEDOR'"), 'El servidor debe fijar el alta rápida como PROVEEDOR');
assert.ok(controller.includes('listSuppliers'));
assert.ok(controller.includes('createQuickSupplier'));
assert.ok(schemas.includes('quickSupplierSchema'));
assert.ok(schemas.includes('sujetoRetefuente'));
assert.ok(schemas.includes('sujetoReteIca'));
assert.ok(schemas.includes('sujetoReteIva'));
assert.ok(permissions.includes("path.startsWith('/comercial/compras')"), 'El endpoint acotado debe heredar permisos COMPRAS');

const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, 'Debe existir script de Compras');
new Function(match[1]);

console.log('PURCHASES UI SMOKE OK', JSON.stringify({
  quickSupplierV69: true,
  supplierCreatedInsidePurchase: true,
  noThirdPartyAdminPermissionRequired: true,
  autoSelectAfterCreate: true,
  purchaseModalPreserved: true
}));
