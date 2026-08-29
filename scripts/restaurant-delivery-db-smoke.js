'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { money } = require('../src/utils/decimal');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const delivery = require('../src/modules/restaurant/restaurant-delivery.service');
const treasury = require('../src/modules/treasury/treasury.service');

async function main() {
  assert.notEqual(String(process.env.NODE_ENV || '').toLowerCase(), 'production', 'Este smoke no puede ejecutarse en producción');
  const demo = await ensureRestaurantDemoTenant();
  const admin = await prisma.user.findUnique({ where: { id: demo.users.ADMIN } });
  assert.ok(admin, 'ADMIN demo faltante');

  const menu = await prisma.restaurantMenuItem.findMany({
    where: { tenantId: demo.tenantId, active: true },
    include: { product: true },
    orderBy: { sortOrder: 'asc' },
    take: 2
  });
  assert.equal(menu.length, 2, 'Se requieren al menos dos productos de carta');

  const box = await prisma.cajaBanco.create({
    data: { tenantId: demo.tenantId, tipo: 'CAJA', nombre: `Caja Domicilios ${Date.now()}`, saldoActual: 0 }
  });
  await treasury.openCashSession(demo.tenantId, admin.id, box.id, { saldoInicial: 0 });

  const sessionsBefore = await prisma.restaurantTableSession.count({ where: { tenantId: demo.tenantId } });
  const tablesBefore = await prisma.restaurantTable.count({ where: { tenantId: demo.tenantId } });
  const stockBefore = new Map((await prisma.producto.findMany({
    where: { tenantId: demo.tenantId, id: { in: menu.map((row) => row.productId) } },
    select: { id: true, stockActual: true }
  })).map((row) => [row.id, money(row.stockActual)]));

  let row = await delivery.createDelivery(demo.tenantId, admin, {
    customerName: 'Cliente Domicilio QA',
    customerPhone: '3005550199',
    address: 'Carrera 20 #14-22',
    neighborhood: 'Centro',
    deliveryReference: 'Casa de prueba',
    deliveryFee: 5000,
    promisedAt: new Date(Date.now() + 45 * 60000).toISOString(),
    channel: 'MANUAL',
    items: [
      { menuItemId: menu[0].id, quantity: 2 },
      { menuItemId: menu[1].id, quantity: 1 }
    ]
  });

  assert.equal(row.state, 'NUEVO');
  assert.equal(row.paymentStatus, 'PENDIENTE');
  assert.equal(row.items.length, 2);
  assert.equal(await prisma.restaurantTableSession.count({ where: { tenantId: demo.tenantId } }), sessionsBefore, 'Domicilio no debe crear sesión de mesa');
  assert.equal(await prisma.restaurantTable.count({ where: { tenantId: demo.tenantId } }), tablesBefore, 'Domicilio no debe crear mesa');

  const known = await delivery.recentCustomerByPhone(demo.tenantId, '3005550199');
  assert.equal(known.customerName, 'Cliente Domicilio QA');
  assert.equal(known.address, 'Carrera 20 #14-22');

  row = await delivery.acceptDelivery(demo.tenantId, admin, row.id);
  assert.equal(row.state, 'CONFIRMADO');
  assert.ok(row.commands.length >= 1, 'Aceptar debe crear comandas por estación');

  const kds = await delivery.listKdsCommands(demo.tenantId, admin, {});
  assert.ok(kds.some((command) => command.order?.delivery?.id === row.id && command.order?.source === 'DOMICILIO'), 'KDS debe ver el domicilio');

  for (const command of row.commands) {
    await delivery.updateDeliveryCommandState(demo.tenantId, admin, command.id, 'EN_PREPARACION');
    await delivery.updateDeliveryCommandState(demo.tenantId, admin, command.id, 'LISTA');
  }
  row = await delivery.loadDelivery(demo.tenantId, row.id);
  assert.equal(row.state, 'LISTO', 'Todas las estaciones listas deben dejar domicilio LISTO');

  row = await delivery.markOnRoute(demo.tenantId, admin, row.id, { courierName: 'Domiciliario QA' });
  assert.equal(row.state, 'EN_CAMINO');
  assert.equal(row.courierName, 'Domiciliario QA');

  row = await delivery.markDelivered(demo.tenantId, admin, row.id);
  assert.equal(row.state, 'ENTREGADO');
  assert.equal(row.paymentStatus, 'PENDIENTE', 'Entrega y pago deben ser estados independientes');

  row = await delivery.registerDeliveryPayment(demo.tenantId, admin, row.id, {
    metodoPago: 'EFECTIVO',
    cajaBancoId: box.id,
    referencia: 'QA efectivo domicilio'
  });
  assert.equal(row.paymentStatus, 'PAGADO');
  assert.equal(row.paymentMethod, 'EFECTIVO');

  const [sale, receivable, payment, movement, consumption, journals, boxAfter] = await Promise.all([
    prisma.comprobanteComercial.findUnique({ where: { id: row.saleId } }),
    prisma.cartera.findFirst({ where: { tenantId: demo.tenantId, comprobanteId: row.saleId } }),
    prisma.pago.findFirst({ where: { tenantId: demo.tenantId, documentoId: row.saleId } }),
    prisma.movimientoTesoreria.findFirst({ where: { tenantId: demo.tenantId, comprobanteId: row.saleId }, orderBy: { creadoEn: 'desc' } }),
    prisma.consumptionRun.findFirst({ where: { tenantId: demo.tenantId, sourceType: 'SALE', sourceId: row.saleId }, include: { items: true } }),
    prisma.asientoContable.findMany({ where: { tenantId: demo.tenantId, OR: [{ comprobanteId: row.saleId }, { sourceId: { contains: row.saleId } }] }, include: { detalles: true } }),
    prisma.cajaBanco.findUnique({ where: { id: box.id } })
  ]);

  assert.equal(sale.estado, 'PAGADO_TOTAL');
  assert.ok(money(sale.saldo).eq(0));
  assert.equal(receivable.estado, 'PAGADA');
  assert.ok(money(receivable.saldo).eq(0));
  assert.ok(payment, 'Pago de domicilio faltante');
  assert.ok(movement, 'Movimiento de Tesorería faltante');
  assert.ok(consumption, 'Consumo/receta de la venta faltante');
  assert.ok(journals.length >= 1, 'Asiento contable de la venta/pago faltante');
  for (const journal of journals) {
    const debit = journal.detalles.reduce((sum, detail) => money(sum.plus(detail.debito || 0)), money(0));
    const credit = journal.detalles.reduce((sum, detail) => money(sum.plus(detail.credito || 0)), money(0));
    assert.ok(debit.eq(credit), `Asiento ${journal.id} descuadrado`);
  }
  assert.ok(money(boxAfter.saldoActual).eq(row.total), 'Caja debe recibir exactamente el total del domicilio');

  const stockAfter = await prisma.producto.findMany({
    where: { tenantId: demo.tenantId, id: { in: menu.map((item) => item.productId) } },
    select: { id: true, stockActual: true }
  });
  assert.ok(stockAfter.some((product) => money(product.stockActual).lt(stockBefore.get(product.id))), 'Al menos un insumo/producto controlado debe reflejar consumo de la venta');

  console.log(JSON.stringify({
    ok: true,
    deliveryId: row.id,
    code: row.code,
    state: row.state,
    paymentStatus: row.paymentStatus,
    fakeTablesCreated: 0,
    saleState: sale.estado,
    receivableState: receivable.estado,
    treasury: money(movement.monto).toString(),
    accountingJournals: journals.length,
    consumptionItems: consumption.items.length
  }));
}

main().finally(() => prisma.$disconnect());
