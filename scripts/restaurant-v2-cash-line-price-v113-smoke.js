'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATABASE_URL ||= 'postgresql://vantix:vantix@127.0.0.1:5432/vantix_test';
const service = require('../src/modules/restaurant/restaurant-v2-cash.service');
const { prisma } = require('../src/config/prisma');
const { money } = require('../src/utils/decimal');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const routes = read('src/modules/restaurant/restaurant-v2-cash.routes.js');
const runtime = read('src/modules/restaurant/restaurant-v2-cash.service.js');
const publicRoutes = read('src/modules/restaurant/restaurant-v2-cash.public.routes.js');
const cash = read('src/web/restaurant-v2-cash.js');
const ui = read('src/web/restaurant-v2-cash-line-price-v113.js');

const taxed = service.calculateAppliedLine({ cantidad: '2', ivaPct: '19', impoconsumoPct: '0' }, 8000);
assert.equal(taxed.subtotal.toString(), '16000');
assert.equal(taxed.iva.toString(), '3040');
assert.equal(taxed.total.toString(), '19040');

const consumption = service.calculateAppliedLine({ cantidad: '1.5', ivaPct: '0', impoconsumoPct: '8' }, 10000);
assert.equal(consumption.subtotal.toString(), '15000');
assert.equal(consumption.impoconsumo.toString(), '1200');
assert.equal(consumption.total.toString(), '16200');
assert.throws(() => service.calculateAppliedLine({ cantidad: '1', ivaPct: 0, impoconsumoPct: 0 }, -1), /no puede ser negativo/i);

assert.match(routes, /linePriceSchema/);
assert.match(routes, /items\/:detailId\/precio/);
assert.match(routes, /requirePermission\('RESTAURANTE\.CERRAR'\)/);
assert.doesNotMatch(routes, /reason:\s*z\.string/);
assert.match(runtime, /lockOperation\(tx, tenantId\)/);
assert.match(runtime, /estado:\s*'BORRADOR'/);
assert.match(runtime, /assertWholeAccountBoundary\(session\)/);
assert.match(runtime, /RESTAURANT_CASH_LINE_PRICE_UPDATED/);
assert.match(runtime, /catalogUnitPrice/);
assert.match(runtime, /restaurantOrderItem\.updateMany/);
assert.match(runtime, /auditoriaContable\.create/);
assert.doesNotMatch(runtime, /producto\.update\([\s\S]{0,300}precio1/);

assert.match(cash, /data-detail-id/);
assert.match(cash, /data-catalog-price/);
assert.match(ui, /Editar precio/);
assert.match(ui, /No modifica el precio de Carta/);
assert.doesNotMatch(ui, /name="reason"/);
assert.match(ui, /method:'PATCH'/);
assert.match(publicRoutes, /restaurant-v2-cash-line-price-v113\.js/);
assert.match(publicRoutes, /v113-sale-only-audited/);

async function transactionSmoke() {
  const session = { id: 'session-a', tableId: 'table-a', saleId: 'sale-a', state: 'CUENTA_PEDIDA', splitMode: 'NONE', billingMode: 'CONJUNTA', splitMetadata: null, table: { id: 'table-a' } };
  const sale = { id: 'sale-a', tenantId: 'tenant-a', tipo: 'FACTURA_VENTA', estado: 'BORRADOR', numero: 'POS-1', subtotal: money(40000), descuentoTotal: money(0), ivaTotal: money(0), impoconsumoTotal: money(3200), total: money(43200), saldo: money(0) };
  const detail = { id: 'detail-a', tenantId: 'tenant-a', comprobanteId: 'sale-a', productoId: 'product-a', descripcion: 'Producto QA', cantidad: '2', precioUnitario: money(20000), descuentoPct: 0, ivaPct: 0, impoconsumoPct: 8, subtotalLinea: money(40000), ivaValor: money(0), impoconsumoValor: money(3200), totalLinea: money(43200), producto: { id: 'product-a', precio1: money(20000) } };
  const orderItem = { id: 'item-a', orderId: 'order-a', saleDetailId: 'detail-a', unitPrice: money(20000), lineTotal: money(43200) };
  let audited = null;
  const tx = {
    $queryRaw: async () => [{ locked: 1 }],
    restaurantTableSession: { findFirst: async ({ where }) => { assert.equal(where.tenantId, 'tenant-a'); assert.equal(where.tableId, 'table-a'); return session; } },
    comprobanteComercial: {
      findFirst: async ({ where }) => { assert.equal(where.tenantId, 'tenant-a'); assert.equal(where.estado, 'BORRADOR'); return sale; },
      update: async ({ data }) => {
        sale.subtotal = money(sale.subtotal.plus(data.subtotal.increment));
        sale.ivaTotal = money(sale.ivaTotal.plus(data.ivaTotal.increment));
        sale.impoconsumoTotal = money(sale.impoconsumoTotal.plus(data.impoconsumoTotal.increment));
        sale.total = money(sale.total.plus(data.total.increment));
        return sale;
      },
      findUnique: async () => ({ ...sale, detalles: [{ ...detail }] })
    },
    detalleComprobante: {
      findFirst: async ({ where }) => { assert.equal(where.tenantId, 'tenant-a'); assert.equal(where.comprobanteId, 'sale-a'); return detail; },
      update: async ({ data }) => { Object.assign(detail, data); return detail; }
    },
    restaurantOrderItem: {
      findMany: async ({ where }) => { assert.equal(where.tenantId, 'tenant-a'); return [orderItem]; },
      updateMany: async ({ data }) => { Object.assign(orderItem, data); return { count: 1 }; },
      aggregate: async () => ({ _sum: { lineTotal: orderItem.lineTotal } })
    },
    restaurantOrder: { update: async ({ data }) => { assert.equal(data.total.toString(), '32400'); return { id: 'order-a', total: data.total }; } },
    auditoriaContable: { create: async ({ data }) => { audited = data; return data; } }
  };
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = async (callback) => callback(tx);
  try {
    const result = await service.updateLinePrice('tenant-a', { id: 'user-a' }, 'table-a', 'detail-a', { unitPrice: 15000 });
    assert.equal(result.sale.total, '32400');
    assert.equal(result.item.unitPrice, '15000');
    assert.equal(sale.total.toString(), '32400');
    assert.equal(orderItem.unitPrice.toString(), '15000');
    assert.equal(orderItem.lineTotal.toString(), '32400');
    assert.equal(audited.tenantId, 'tenant-a');
    assert.equal(audited.userId, 'user-a');
    assert.equal(audited.metadata.before.unitPrice, '20000');
    assert.equal(audited.metadata.after.unitPrice, '15000');
    assert.equal(audited.metadata.catalogUnitPrice, '20000');
  } finally {
    prisma.$transaction = originalTransaction;
  }
}

transactionSmoke()
  .then(() => console.log('restaurant-v2-cash-line-price-v113-smoke: ok'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
