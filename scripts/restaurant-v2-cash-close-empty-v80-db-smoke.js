'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const live = require('../src/modules/restaurant/restaurant-table-live-detail-v67.service');
const cashCloseEmpty = require('../src/modules/restaurant/restaurant-v2-cash-close-empty-v80.service');

const V2_OPTIONS = Object.freeze({ sharedFloor:true, optionalSeat:true });

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const admin = await prisma.user.findUnique({ where:{ id:demo.users.ADMIN } });
  const cashier = await prisma.user.findUnique({ where:{ id:demo.users.CAJERO } });
  assert.ok(admin, 'el tenant demo debe tener ADMIN');
  assert.ok(cashier, 'el tenant demo debe tener CAJERO');
  assert.equal(cashier.rol, 'CAJERO');

  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const table = await restaurant.createTable(demo.tenantId, {
    code:`V80-${suffix}`,
    name:`Mesa Caja V80 ${suffix}`,
    seats:4,
    posX:30,
    posY:30
  });

  const opened = await restaurant.openTable(demo.tenantId, admin, table.id, { guestCount:1 }, V2_OPTIONS);
  await restaurant.requestAccount(demo.tenantId, admin, table.id, V2_OPTIONS);

  const detailForCashier = await live.liveDetail(demo.tenantId, cashier, table.id);
  assert.equal(detailForCashier.open, true);
  assert.equal(detailForCashier.session.state, 'CUENTA_PEDIDA');
  assert.equal(Number(detailForCashier.sale.total), 0);
  assert.equal(detailForCashier.items.length, 0);
  assert.equal(detailForCashier.canCloseEmptyFromControlCenter, false, 'CAJERO no recibe privilegios de Centro de control');

  const [paymentsBefore, fiscalBefore, movementsBefore, detailsBefore, ordersBefore] = await Promise.all([
    prisma.restaurantSessionPayment.count({ where:{ tenantId:demo.tenantId, sessionId:opened.session.id } }),
    prisma.restaurantFiscalDocument.count({ where:{ tenantId:demo.tenantId, sessionId:opened.session.id } }),
    prisma.movimientoTesoreria.count({ where:{ tenantId:demo.tenantId, comprobanteId:opened.sale.id } }),
    prisma.detalleComprobante.count({ where:{ tenantId:demo.tenantId, comprobanteId:opened.sale.id } }),
    prisma.restaurantOrder.count({ where:{ tenantId:demo.tenantId, sessionId:opened.session.id } })
  ]);
  assert.deepEqual([paymentsBefore,fiscalBefore,movementsBefore,detailsBefore,ordersBefore],[0,0,0,0,0]);

  const closed = await cashCloseEmpty.closeEmptyFromCash(demo.tenantId, cashier, table.id);
  assert.equal(closed.closed, true);
  assert.equal(closed.closedFrom, 'CAJA_V2');
  assert.equal(closed.actorUserId, cashier.id);
  assert.equal(closed.actorRole, 'CAJERO');
  assert.equal(closed.discardedSaleId, opened.sale.id);
  assert.equal(closed.sessionId, opened.session.id);

  const [tableAfter, sessionAfter, saleAfter, paymentsAfter, fiscalAfter, movementsAfter] = await Promise.all([
    prisma.restaurantTable.findUnique({ where:{ id:table.id } }),
    prisma.restaurantTableSession.findUnique({ where:{ id:opened.session.id } }),
    prisma.comprobanteComercial.findUnique({ where:{ id:opened.sale.id } }),
    prisma.restaurantSessionPayment.count({ where:{ tenantId:demo.tenantId, sessionId:opened.session.id } }),
    prisma.restaurantFiscalDocument.count({ where:{ tenantId:demo.tenantId, sessionId:opened.session.id } }),
    prisma.movimientoTesoreria.count({ where:{ tenantId:demo.tenantId, comprobanteId:opened.sale.id } })
  ]);

  assert.equal(tableAfter.state, 'LIBRE', 'la mesa debe volver a LIBRE');
  assert.equal(sessionAfter, null, 'la visita vacía debe desaparecer');
  assert.equal(saleAfter, null, 'la venta BORRADOR $0 debe descartarse, no finalizarse');
  assert.equal(paymentsAfter, 0, 'cerrar sin consumo no crea pagos');
  assert.equal(fiscalAfter, 0, 'cerrar sin consumo no crea documento fiscal');
  assert.equal(movementsAfter, 0, 'cerrar sin consumo no crea movimiento de Tesorería');

  console.log(JSON.stringify({
    ok:true,
    module:'RESTAURANT_V2_CASH_CLOSE_EMPTY_V80_1_DB',
    cashierRole:true,
    accountRequestedAtZero:true,
    tableFreed:true,
    draftSaleDiscarded:true,
    paymentsCreated:0,
    treasuryMovementsCreated:0,
    fiscalDocumentsCreated:0
  }));
}

main().catch((error)=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
