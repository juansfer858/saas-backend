'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const layout = require('../src/modules/restaurant/restaurant-pos-receipt-layout.service');

const salesHtml = fs.readFileSync('src/web/sales.html', 'utf8');
const salesController = fs.readFileSync('src/modules/commercial/sales.controller.js', 'utf8');
const posPrint = fs.readFileSync('src/modules/restaurant/restaurant-pos-receipt-print.service.js', 'utf8');
const posLayout = fs.readFileSync('src/modules/restaurant/restaurant-pos-receipt-layout.service.js', 'utf8');

assert.match(salesHtml, /VANTIX_SALES_FULL_PARTIES_V129/);
assert.match(salesHtml, /tercero\?\.direccion/);
assert.match(salesHtml, /tercero\?\.telefono/);
assert.match(salesHtml, /company\.nit/);
assert.match(salesHtml, /company\.phone/);
assert.match(salesHtml, /COPIA \/ REIMPRESIÓN/);
assert.match(salesHtml, /Reimprimir usa los datos completos de la empresa y del cliente/);

const inline = salesHtml.match(/<script>\s*([\s\S]*?)<\/script>/);
assert.ok(inline?.[1], 'No se encontró el script principal de Ventas');
assert.doesNotThrow(() => new Function(inline[1]), 'El JavaScript embebido de Ventas debe compilar');

assert.match(salesController, /restaurant-company-profile\.service/);
assert.match(salesController, /companyService\.getCompanyProfile\(req\.tenantId\)/);
assert.match(salesController, /data: \{ \.\.\.sale, company \}/);
assert.match(posPrint, /include: \{ tercero: true, detalles:/);
assert.match(posLayout, /customerDetailLines/);
assert.match(posLayout, /company\?\.nombreEmpresa/);

const lines = layout.receiptLinesFullWidth({
  company: {
    nombreEmpresa: 'Restaurante Prueba SAS',
    nit: '900123456-7',
    address: 'Calle 10 # 20-30',
    city: 'Yarumal',
    department: 'Antioquia',
    phone: '6048870000',
    email: 'empresa@example.com',
    receiptTitle: 'COMPROBANTE DE VENTA'
  },
  sale: {
    id: 'sale-v129',
    numero: 'POS-000129',
    fecha: new Date('2026-09-17T12:00:00-05:00'),
    observaciones: '',
    subtotal: 25000,
    total: 25000,
    saldo: 0,
    formaPago: 'EFECTIVO',
    tercero: {
      tipoDocumento: 'NIT',
      identificacion: '901234567-8',
      nombre: 'Cliente Prueba',
      razonSocial: 'Cliente Prueba SAS',
      direccion: 'Carrera 20 # 10-15',
      telefono: '3001234567',
      email: 'cliente@example.com'
    },
    detalles: [{ descripcion: 'Almuerzo', cantidad: 1, precioUnitario: 25000, totalLinea: 25000 }]
  },
  session: { paymentMethodLabel: 'Efectivo', tipAmount: 0 },
  table: { name: 'Mesa 1' },
  paperFormat: 'TERMICA_80',
  companyLines: (company) => [
    `NIT: ${company.nit}`,
    `Dirección: ${company.address}`,
    `${company.city} · ${company.department}`,
    `Tel: ${company.phone}`,
    company.email
  ],
  money: (value) => `$${Number(value || 0)}`,
  qty: (value) => String(value),
  dateTime: () => '17/09/2026 12:00 PM',
  number: (value) => Number(value || 0),
  defaultTitle: 'COMPROBANTE DE VENTA'
});

const text = lines.join('\n');
for (const expected of [
  'Restaurante Prueba SAS',
  'NIT: 900123456-7',
  'Dirección: Calle 10 # 20-30',
  'Tel: 6048870000',
  'Cliente Prueba SAS',
  '901234567-8',
  'Carrera 20 # 10-15',
  '3001234567'
]) assert.ok(text.includes(expected), `Falta en la tirilla V129: ${expected}`);

console.log('Restaurant sales document full parties V129 smoke: OK');
