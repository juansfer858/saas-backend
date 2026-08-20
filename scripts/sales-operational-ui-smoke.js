const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('src/web/sales.html','utf8');
const app = fs.readFileSync('src/app.js','utf8');
for (const token of ['+ Nueva venta','Guardar borrador','Emitir venta','Documento Equivalente POS','Factura Electrónica','DIAN','Kardex/recetas','/api/v1/comercial/ventas']) {
  assert.ok(html.includes(token), `Ventas UI debe contener ${token}`);
}
assert.ok(app.includes("app.get('/app/ventas'"));
assert.ok(app.includes("salesHtmlPath"));
console.log('SALES OPERATIONAL UI SMOKE OK');
