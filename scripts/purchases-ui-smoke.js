const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'purchases.html'), 'utf8');

for (const token of [
  '+ Nueva compra',
  'Guardar borrador',
  'Emitir compra',
  'Factura proveedor / referencia externa',
  '+ Crear producto',
  'Retenciones',
  'Total neto a pagar',
  'Asiento AU',
  '/api/v1/comercial/compras',
  '/api/v1/contabilidad/impuestos/calcular'
]) assert.ok(html.includes(token), `Falta contrato UI: ${token}`);

assert.ok(!html.includes('próxima iteración'), 'Compras no puede seguir como vista futura/deshabilitada');

const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, 'Debe existir script de Compras');
new Function(match[1]);

console.log('PURCHASES UI SMOKE OK');
