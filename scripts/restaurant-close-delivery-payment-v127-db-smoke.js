'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const deliveryService = require('../src/modules/restaurant/restaurant-delivery.service');
const deliveryFees = require('../src/modules/restaurant/restaurant-close-delivery-fees-v123.service');
const treasury = require('../src/modules/treasury/treasury.service');
const cashV2 = require('../src/modules/restaurant/restaurant-v2-cash.service');

let cleanupShift = null;
let cleanupDelivery = null;

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const cashier = await prisma.user.findUnique({ where:{ id:demo.users.CAJERO } });
  assert.ok(cashier, 'demo debe tener cajero');

  const suffix = crypto.randomBytes(4).toString('hex');
  const cashAccount = await treasury.createCajaBanco(demo.tenantId, {
    tipo:'CAJA', nombre:`Caja V127 ${suffix}`, banco:null, numeroCuenta:null,
    cuentaContableId:null, saldoActual:0, activo:true
  });
  const bankAccount = await treasury.createCajaBanco(demo.tenantId, {
    tipo:'BANCO', nombre:`Banco V127 ${suffix}`, banco:'CI', numeroCuenta:`V127-${suffix}`,
    cuentaContableId:null, saldoActual:0, activo:true
  });
  const opened = await cashV2.openShift(demo.tenantId, cashier, {
    cajaBancoId:cashAccount.id,
    saldoInicial:0
  });
  cleanupShift = { tenantId:demo.tenantId, userId:cashier.id, shiftId:opened.shift.id };

  const menu = (await restaurant.listMenu(demo.tenantId)).filter((row) => !row.warning && row.product);
  assert.ok(menu.length, 'demo debe tener carta operativa');
  const item = menu.find((row) => row.station === 'COCINA') || menu[0];

  const created = await deliveryService.createDelivery(demo.tenantId, cashier, {
    channel:'MANUAL',
    customerName:'Cliente V127',
    customerPhone:`300${Date.now().toString().slice(-7)}`,
    address:'Dirección prueba V127',
    deliveryFee:3500,
    items:[{ menuItemId:item.id, quantity:1 }]
  });
  cleanupDelivery = { tenantId:demo.tenantId, user:cashier, id:created.id };

  const paid = await deliveryService.registerDeliveryPayment(demo.tenantId, cashier, created.id, {
    cajaBancoId:bankAccount.id,
    metodoPago:'TRANSFERENCIA',
    referencia:'V127 DB SMOKE'
  });
  assert.equal(paid.paymentStatus, 'PAGADO');
  assert.equal(paid.paymentMethod, 'TRANSFERENCIA');
  assert.ok(paid.treasuryPaymentId, 'domicilio debe quedar ligado al Pago real');

  // Simula un dato histórico duplicado/desactualizado. El Pago real no se altera.
  await prisma.restaurantDeliveryOrder.update({
    where:{ id:paid.id },
    data:{ paymentMethod:'EFECTIVO' }
  });

  const reconciliation = await deliveryFees.reconcileForShift(demo.tenantId, opened.shift, prisma);
  assert.equal(Number(reconciliation.summary.cash), 0);
  assert.equal(Number(reconciliation.summary.transfer), 3500, 'cargo externo debe seguir el Pago TRANSFERENCIA');
  assert.equal(reconciliation.canonicalMethods[paid.id], 'TRANSFERENCIA');

  const total = Number(paid.total);
  assert.ok(total > 3500, 'la venta debe incluir productos + cargo de domicilio');
  assert.equal(reconciliation.corrections.cash, -total);
  assert.equal(reconciliation.corrections.transfer, total);

  const corrected = deliveryFees.applyPaymentCorrections({
    cash:String(total), transfer:'0', card:'0', credit:'0', other:'0'
  }, reconciliation.corrections);
  assert.equal(Number(corrected.cash), 0);
  assert.equal(Number(corrected.transfer), total, 'recaudo bruto debe coincidir con el Pago real');
  assert.equal(Number(corrected.total), total);

  console.log(JSON.stringify({
    ok:true,
    module:'RESTAURANT_CLOSE_DELIVERY_PAYMENT_V127',
    postgresReal:true,
    saleTotal:total,
    deliveryFee:3500,
    staleDeliveryMethod:'EFECTIVO',
    canonicalPaymentMethod:'TRANSFERENCIA',
    treasuryPaymentId:paid.treasuryPaymentId
  }));
}

async function completeTemporaryDelivery() {
  if (!cleanupDelivery) return;
  let current = await deliveryService.loadDelivery(cleanupDelivery.tenantId, cleanupDelivery.id);
  if (current.state === 'ENTREGADO' || current.state === 'CANCELADO') return;

  if (current.state === 'NUEVO') {
    await deliveryService.acceptDelivery(cleanupDelivery.tenantId, cleanupDelivery.user, cleanupDelivery.id);
    current = await deliveryService.loadDelivery(cleanupDelivery.tenantId, cleanupDelivery.id);
  }

  for (const command of current.commands || []) {
    if (['ENTREGADA','CANCELADA'].includes(command.state)) continue;
    await deliveryService.updateDeliveryCommandState(
      cleanupDelivery.tenantId,
      cleanupDelivery.user,
      command.id,
      'ENTREGADA'
    );
  }

  current = await deliveryService.loadDelivery(cleanupDelivery.tenantId, cleanupDelivery.id);
  if (!['ENTREGADO','CANCELADO'].includes(current.state)) {
    await deliveryService.markDelivered(cleanupDelivery.tenantId, cleanupDelivery.user, cleanupDelivery.id);
  }
}

async function closeTemporaryShift() {
  if (!cleanupShift) return;
  const current = await prisma.aperturaCierreCaja.findFirst({
    where:{ id:cleanupShift.shiftId, tenantId:cleanupShift.tenantId, estado:'ABIERTA' }
  });
  if (!current) return;
  await treasury.closeCashSession(
    cleanupShift.tenantId,
    cleanupShift.userId,
    cleanupShift.shiftId,
    { saldoFinal:0 }
  );
}

async function cleanup() {
  await completeTemporaryDelivery();
  await closeTemporaryShift();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  try {
    await cleanup();
  } catch (error) {
    console.error('V127 smoke cleanup failed', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
});
