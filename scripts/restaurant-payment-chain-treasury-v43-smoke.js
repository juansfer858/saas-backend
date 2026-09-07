'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const treasury = require('../src/modules/treasury/treasury.service');
const recent = require('../src/modules/treasury/treasury-recent-receipts.routes');
const paymentChain = require('../src/modules/restaurant/restaurant-payment-chain-v43.public.routes');

async function main() {
  assert.equal(paymentChain.MARKER, 'VANTIX_RESTAURANT_PAYMENT_CHAIN_V43');
  new Function(paymentChain.runtime);
  assert.match(paymentChain.runtime, /cashOnlyToCashAccount:true/);
  assert.match(paymentChain.runtime, /bankOnlyToBankAccount:true/);
  assert.match(paymentChain.runtime, /creditRequiresCustomer:true/);
  assert.match(paymentChain.runtime, /row\.tipo===wanted/);
  assert.match(paymentChain.runtime, /\[data-cash-method="CREDITO"\]/);
  assert.match(paymentChain.runtime, /El crédito requiere seleccionar un cliente/);
  assert.match(paymentChain.runtime, /Selecciona una cuenta tipo CAJA para efectivo/);
  assert.match(paymentChain.runtime, /Selecciona una cuenta tipo BANCO para Tarjeta \/ QR/);

  const panelRuntime = fs.readFileSync('src/modules/commercial/commercial.routes.js', 'utf8');
  assert.match(panelRuntime, /VANTIX_TREASURY_RECENT_RECEIPTS_V43/);
  assert.match(panelRuntime, /\/api\/v1\/tesoreria\/recaudos-recientes/);
  assert.doesNotMatch(panelRuntime, /source\.replace\([\s\S]*?recaudos-recientes[\s\S]*?recaudos-recientes[\s\S]*?\/tesoreria\/pagos/);

  const coreRoutes = fs.readFileSync('src/routes/core.routes.js', 'utf8');
  assert.match(coreRoutes, /\/tesoreria\/recaudos-recientes/);

  const suffix = crypto.randomBytes(5).toString('hex');
  const tenant = await prisma.tenant.create({
    data:{ nombreEmpresa:`Cadena Pago ${suffix}`, subdomain:`pay-chain-${suffix}`, nicho:'RESTAURANTE' }
  });
  const user = await prisma.user.create({
    data:{ tenantId:tenant.id, nombre:'Cajero QA', email:`cash-${suffix}@test.local`, password:'test', rol:'CAJERO', activo:true }
  });
  const cash = await prisma.cajaBanco.create({
    data:{ tenantId:tenant.id, tipo:'CAJA', nombre:'Caja General', saldoActual:0, activo:true }
  });
  const bank = await prisma.cajaBanco.create({
    data:{ tenantId:tenant.id, tipo:'BANCO', nombre:'Bancolombia QR', banco:'Bancolombia', numeroCuenta:'10697134511', saldoActual:0, activo:true }
  });
  const cashSale = await prisma.comprobanteComercial.create({
    data:{ tenantId:tenant.id, tipo:'FACTURA_VENTA', numero:'000001', estado:'EMITIDO', formaPago:'EFECTIVO', creadoPorId:user.id, subtotal:26000, total:26000, saldo:0 }
  });
  const bankSale = await prisma.comprobanteComercial.create({
    data:{ tenantId:tenant.id, tipo:'FACTURA_VENTA', numero:'000002', estado:'EMITIDO', formaPago:'BANCO', creadoPorId:user.id, subtotal:31000, total:31000, saldo:0 }
  });

  await prisma.$transaction(async (tx) => {
    await treasury.recordTreasuryMovementInTx(tx, {
      tenantId:tenant.id, userId:user.id, cajaBancoId:cash.id, comprobanteId:cashSale.id,
      tipo:'INGRESO', monto:26000, sign:1, referencia:cashSale.numero, concepto:'Venta contado 000001'
    });
    await treasury.recordTreasuryMovementInTx(tx, {
      tenantId:tenant.id, userId:user.id, cajaBancoId:bank.id, comprobanteId:bankSale.id,
      tipo:'INGRESO', monto:31000, sign:1, referencia:bankSale.numero, concepto:'Venta contado 000002'
    });
  });

  const [cashAfter, bankAfter, legacyPayments, receipts] = await Promise.all([
    prisma.cajaBanco.findUnique({ where:{ id:cash.id } }),
    prisma.cajaBanco.findUnique({ where:{ id:bank.id } }),
    prisma.pago.findMany({ where:{ tenantId:tenant.id } }),
    recent.listRecentReceipts(tenant.id, { limit:20 })
  ]);

  assert.equal(Number(cashAfter.saldoActual), 26000, 'efectivo debe aumentar únicamente la caja');
  assert.equal(Number(bankAfter.saldoActual), 31000, 'Tarjeta/QR debe aumentar únicamente el banco');
  assert.equal(legacyPayments.length, 0, 'un cobro POS inmediato no necesita fila Pago de cartera');
  assert.equal(receipts.length, 2, 'Tesorería debe mostrar los dos recaudos aunque Pago esté vacío');

  const cashReceipt = receipts.find((row) => row.documento?.numero === '000001');
  const bankReceipt = receipts.find((row) => row.documento?.numero === '000002');
  assert.equal(cashReceipt.metodoPago, 'EFECTIVO');
  assert.equal(cashReceipt.cajaBanco.tipo, 'CAJA');
  assert.match(cashReceipt.referencia, /Caja General/);
  assert.equal(bankReceipt.metodoPago, 'TARJETA / QR');
  assert.equal(bankReceipt.cajaBanco.tipo, 'BANCO');
  assert.match(bankReceipt.referencia, /Bancolombia QR/);

  assert.equal(recent.paymentLabel({ cajaBanco:{ tipo:'CAJA' } }), 'EFECTIVO');
  assert.equal(recent.paymentLabel({ cajaBanco:{ tipo:'BANCO' } }), 'TARJETA / QR');

  console.log('RESTAURANT PAYMENT CHAIN + TREASURY V43 SMOKE OK');
  console.log(JSON.stringify({
    cashToCashAccountOnly:true,
    bankToBankAccountOnly:true,
    creditRequiresCustomer:true,
    posMovementCanonicalSource:true,
    legacyPagoTableNotRequiredForImmediatePos:true,
    treasuryRecentShowsCash:true,
    treasuryRecentShowsCardQr:true,
    cashBalance:Number(cashAfter.saldoActual),
    bankBalance:Number(bankAfter.saldoActual)
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
