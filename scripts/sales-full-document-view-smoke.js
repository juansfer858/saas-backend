'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'web', 'sales.html');
const html = fs.readFileSync(file, 'utf8');

const required = [
  'Documento de venta',
  'Detalle completo del comprobante registrado',
  'Cant.',
  'Descripción',
  'Precio unit.',
  'Forma de pago',
  'Caja / Banco',
  'Pagado',
  'Saldo',
  'Array.isArray(x.detalles)',
  'line?.producto?.nombre',
  'line?.totalLinea',
  "api('/api/v1/comercial/ventas/'+id)"
];

for (const marker of required) {
  if (!html.includes(marker)) {
    throw new Error(`Falta marcador esperado en Ventas → Ver: ${marker}`);
  }
}

if (!html.includes('no recalcula ni modifica Caja, Inventario, Tesorería o Contabilidad')) {
  throw new Error('La vista debe dejar explícito que es de solo lectura sobre el documento registrado.');
}

console.log('sales-full-document-view-smoke: OK');
