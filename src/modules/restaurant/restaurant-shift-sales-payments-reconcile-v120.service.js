'use strict';

const { decimal, money } = require('../../utils/decimal');
const { resolveShiftRestaurantOperations } = require('./restaurant-shift-reconcile-scope.service');

const MARKER = 'VANTIX_RESTAURANT_SHIFT_SALES_PAYMENTS_RECONCILE_V120';

function amount(value) { return money(value || 0); }
function method(value) { return String(value || '').trim().toUpperCase(); }
function issue(code, message, extra = {}) { return { code, message, ...extra }; }
function sum(rows, field) {
  return amount((rows || []).reduce((acc, row) => decimal(acc).plus(row?.[field] || 0), decimal(0)));
}
function expectedAccountType(paymentMethod) {
  const value = method(paymentMethod);
  if (value === 'EFECTIVO') return 'CAJA';
  if (value === 'TRANSFERENCIA' || value === 'TARJETA') return 'BANCO';
  return null;
}

function movementAccountType(row) {
  return row?.cajaBanco?.tipo || row?.accountType || null;
}

function reconcilePaymentEvidence(payment, receiptMovements, issues) {
  const receipt = payment?.comprobanteTesoreria || payment?.receipt || null;
  if (!payment?.comprobanteTesoreriaId || !receipt) {
    issues.push(issue('PAYMENT_RECEIPT_MISSING', 'El abono no conserva su RECIBO_CAJA.', { paymentId:payment?.id || null }));
    return amount(0);
  }
  if (receipt.estado === 'ANULADO') {
    issues.push(issue('PAYMENT_RECEIPT_VOIDED', 'El abono apunta a un RECIBO_CAJA anulado.', { paymentId:payment.id, receiptId:receipt.id }));
  }
  const movements = (receiptMovements || []).filter((row) => row.comprobanteId === payment.comprobanteTesoreriaId);
  const actual = sum(movements, 'monto');
  const expected = amount(payment.monto);
  if (!actual.eq(expected)) {
    issues.push(issue(
      'PAYMENT_TREASURY_AMOUNT_MISMATCH',
      'El valor del Pago no coincide con el movimiento real de Tesorería.',
      { paymentId:payment.id, receiptId:payment.comprobanteTesoreriaId, paymentAmount:expected.toString(), treasuryAmount:actual.toString(), difference:amount(actual.minus(expected)).toString() }
    ));
  }
  if (receipt.total != null && !amount(receipt.total).eq(expected)) {
    issues.push(issue(
      'PAYMENT_RECEIPT_AMOUNT_MISMATCH',
      'El RECIBO_CAJA no coincide con el valor del Pago.',
      { paymentId:payment.id, receiptId:receipt.id, paymentAmount:expected.toString(), receiptAmount:amount(receipt.total).toString() }
    ));
  }
  for (const movement of movements) {
    if (payment.cajaBancoId && movement.cajaBancoId !== payment.cajaBancoId) {
      issues.push(issue('PAYMENT_TREASURY_ACCOUNT_MISMATCH', 'El Pago y Tesorería usan cuentas diferentes.', {
        paymentId:payment.id, paymentAccountId:payment.cajaBancoId, treasuryAccountId:movement.cajaBancoId
      }));
    }
  }
  const expectedType = expectedAccountType(payment.metodoPago);
  const actualType = payment?.cajaBanco?.tipo || movementAccountType(movements[0]);
  if (expectedType && actualType && expectedType !== actualType) {
    issues.push(issue('PAYMENT_ACCOUNT_TYPE_MISMATCH', 'El método de pago no corresponde al tipo de cuenta financiera.', {
      paymentId:payment.id, paymentMethod:payment.metodoPago, expectedAccountType:expectedType, actualAccountType:actualType
    }));
  }
  return actual;
}

function reconcileSessionPaymentLinks(record, paymentById, issues) {
  const rows = Array.isArray(record.sessionPayments) ? record.sessionPayments : [];
  if (!record.session?.splitMode) return;
  const linked = new Set();
  for (const row of rows) {
    const payment = paymentById.get(row.treasuryPaymentId);
    if (!payment) {
      issues.push(issue('SPLIT_PAYMENT_LINK_MISSING', 'Una parte pagada no conserva su Pago financiero.', {
        sessionPaymentId:row.id || null, partKey:row.partKey || null, paymentId:row.treasuryPaymentId || null
      }));
      continue;
    }
    linked.add(payment.id);
    if (!amount(row.saleAmount).eq(amount(payment.monto))) {
      issues.push(issue('SPLIT_PAYMENT_AMOUNT_MISMATCH', 'La parte pagada no coincide con el Pago registrado.', {
        partKey:row.partKey || null, sessionAmount:amount(row.saleAmount).toString(), paymentAmount:amount(payment.monto).toString()
      }));
    }
    if (method(row.metodoPago) && method(row.metodoPago) !== method(payment.metodoPago)) {
      issues.push(issue('SPLIT_PAYMENT_METHOD_MISMATCH', 'La parte y el Pago tienen métodos diferentes.', {
        partKey:row.partKey || null, sessionMethod:row.metodoPago, paymentMethod:payment.metodoPago
      }));
    }
    if (row.cajaBancoId && payment.cajaBancoId && row.cajaBancoId !== payment.cajaBancoId) {
      issues.push(issue('SPLIT_PAYMENT_ACCOUNT_MISMATCH', 'La parte y el Pago apuntan a cuentas distintas.', {
        partKey:row.partKey || null, sessionAccountId:row.cajaBancoId, paymentAccountId:payment.cajaBancoId
      }));
    }
  }
  for (const payment of record.payments || []) {
    if (!linked.has(payment.id)) {
      issues.push(issue('SPLIT_FINANCIAL_PAYMENT_UNLINKED', 'Existe un Pago de la venta que no corresponde a una parte de la división.', { paymentId:payment.id }));
    }
  }
}

function reconcileDeliveryPaymentLink(record, paymentById, issues) {
  const delivery = record.delivery;
  if (!delivery) return;
  const payment = paymentById.get(delivery.treasuryPaymentId);
  if (!delivery.treasuryPaymentId || !payment) {
    issues.push(issue('DELIVERY_PAYMENT_LINK_MISSING', 'El domicilio pagado no conserva su Pago financiero.', {
      deliveryId:delivery.id || null, paymentId:delivery.treasuryPaymentId || null
    }));
    return;
  }
  if (!amount(delivery.total).eq(amount(payment.monto))) {
    issues.push(issue('DELIVERY_PAYMENT_AMOUNT_MISMATCH', 'El valor cobrado del domicilio no coincide con el Pago.', {
      deliveryId:delivery.id, deliveryAmount:amount(delivery.total).toString(), paymentAmount:amount(payment.monto).toString()
    }));
  }
  if (method(delivery.paymentMethod) && method(delivery.paymentMethod) !== method(payment.metodoPago)) {
    issues.push(issue('DELIVERY_PAYMENT_METHOD_MISMATCH', 'El domicilio y el Pago tienen métodos diferentes.', {
      deliveryId:delivery.id, deliveryMethod:delivery.paymentMethod, paymentMethod:payment.metodoPago
    }));
  }
  if (delivery.cajaBancoId && payment.cajaBancoId && delivery.cajaBancoId !== payment.cajaBancoId) {
    issues.push(issue('DELIVERY_PAYMENT_ACCOUNT_MISMATCH', 'El domicilio y el Pago apuntan a cuentas distintas.', {
      deliveryId:delivery.id, deliveryAccountId:delivery.cajaBancoId, paymentAccountId:payment.cajaBancoId
    }));
  }
}

function reconcileSaleSettlement(record = {}) {
  const sale = record.sale || null;
  const reference = record.reference || sale?.numero || sale?.id || 'Sin referencia';
  const channel = record.channel || 'MESAS';
  const issues = [];
  if (!sale) {
    return {
      marker:MARKER, channel, reference, saleId:record.saleId || null, saleNumber:null,
      saleTotal:'0', paidTotal:'0', receivableBalance:'0', financialCoverage:'0', difference:'0',
      balanced:false, issues:[issue('SALE_NOT_FOUND', 'No existe la venta asociada a la operación.')]
    };
  }

  const directMovements = Array.isArray(record.directMovements) ? record.directMovements : [];
  const payments = Array.isArray(record.payments) ? record.payments : [];
  const receivables = Array.isArray(record.receivables) ? record.receivables : [];
  const receiptMovements = Array.isArray(record.receiptMovements) ? record.receiptMovements : [];
  const paymentById = new Map(payments.map((row) => [row.id, row]));
  const saleTotal = amount(sale.total);
  const directPaid = sum(directMovements, 'monto');
  const creditPaid = sum(payments, 'monto');
  let receivableBalance = decimal(0);

  if (sale.formaPago === 'CREDITO') {
    if (directMovements.length) {
      issues.push(issue('CREDIT_SALE_HAS_DIRECT_SETTLEMENT', 'Una venta a crédito no debe tener un movimiento directo de Venta contado.', {
        movementIds:directMovements.map((row) => row.id)
      }));
    }
    if (receivables.length !== 1) {
      issues.push(issue('CREDIT_RECEIVABLE_COUNT_MISMATCH', 'La venta a crédito debe conservar una única cuenta por cobrar.', {
        count:receivables.length
      }));
    }
    const receivable = receivables[0] || null;
    if (receivable) {
      receivableBalance = decimal(receivable.saldo || 0);
      if (!amount(receivable.valorOriginal).eq(saleTotal)) {
        issues.push(issue('CREDIT_RECEIVABLE_ORIGINAL_MISMATCH', 'La cuenta por cobrar no coincide con el total original de la venta.', {
          saleTotal:saleTotal.toString(), receivableOriginal:amount(receivable.valorOriginal).toString()
        }));
      }
      if (!amount(sale.saldo).eq(amount(receivable.saldo))) {
        issues.push(issue('CREDIT_SALE_BALANCE_MISMATCH', 'El saldo de la venta no coincide con Cartera.', {
          saleBalance:amount(sale.saldo).toString(), receivableBalance:amount(receivable.saldo).toString()
        }));
      }
    }
  } else {
    if (directMovements.length !== 1) {
      issues.push(issue('DIRECT_SETTLEMENT_COUNT_MISMATCH', 'La venta de contado debe conservar un único movimiento Venta contado.', {
        count:directMovements.length, movementIds:directMovements.map((row) => row.id)
      }));
    }
    if (payments.length) {
      issues.push(issue('DIRECT_SALE_HAS_CREDIT_PAYMENTS', 'Una venta de contado no debe tener abonos de Cartera.', { paymentIds:payments.map((row) => row.id) }));
    }
    if (receivables.length) {
      issues.push(issue('DIRECT_SALE_HAS_RECEIVABLE', 'Una venta de contado no debe conservar cuenta por cobrar.', { receivableIds:receivables.map((row) => row.id) }));
    }
    if (!amount(sale.saldo).eq(0)) {
      issues.push(issue('DIRECT_SALE_BALANCE_NONZERO', 'Una venta de contado conserva saldo pendiente.', { saleBalance:amount(sale.saldo).toString() }));
    }
    const movement = directMovements[0];
    if (movement && sale.cajaBancoId && movement.cajaBancoId !== sale.cajaBancoId) {
      issues.push(issue('DIRECT_SETTLEMENT_ACCOUNT_MISMATCH', 'La venta y Tesorería apuntan a cuentas distintas.', {
        saleAccountId:sale.cajaBancoId, treasuryAccountId:movement.cajaBancoId
      }));
    }
    if (record.session?.paymentAccountId && movement && record.session.paymentAccountId !== movement.cajaBancoId) {
      issues.push(issue('SESSION_PAYMENT_ACCOUNT_MISMATCH', 'La mesa y Tesorería apuntan a cuentas distintas.', {
        sessionAccountId:record.session.paymentAccountId, treasuryAccountId:movement.cajaBancoId
      }));
    }
    const expectedType = expectedAccountType(record.session?.paymentMethodKind);
    const actualType = movementAccountType(movement);
    if (expectedType && actualType && expectedType !== actualType) {
      issues.push(issue('SESSION_PAYMENT_METHOD_ACCOUNT_MISMATCH', 'El método elegido en Caja no corresponde a la cuenta financiera real.', {
        paymentMethod:record.session.paymentMethodKind, expectedAccountType:expectedType, actualAccountType:actualType
      }));
    }
  }

  let treasuryBackedPayments = decimal(0);
  for (const payment of payments) {
    treasuryBackedPayments = treasuryBackedPayments.plus(reconcilePaymentEvidence(payment, receiptMovements, issues));
  }
  if (!amount(treasuryBackedPayments).eq(creditPaid)) {
    issues.push(issue('PAYMENTS_TREASURY_TOTAL_MISMATCH', 'Los Pagos no están totalmente respaldados por Tesorería.', {
      paymentsTotal:creditPaid.toString(), treasuryTotal:amount(treasuryBackedPayments).toString(), difference:amount(treasuryBackedPayments.minus(creditPaid)).toString()
    }));
  }

  reconcileSessionPaymentLinks(record, paymentById, issues);
  reconcileDeliveryPaymentLink(record, paymentById, issues);

  const paidTotal = amount(decimal(directPaid).plus(creditPaid));
  const coverage = amount(decimal(paidTotal).plus(receivableBalance));
  const difference = amount(coverage.minus(saleTotal));
  if (!difference.eq(0)) {
    issues.push(issue('SALE_FINANCIAL_COVERAGE_MISMATCH', 'La venta no coincide con Pagos reales más Cartera pendiente.', {
      saleTotal:saleTotal.toString(), paidTotal:paidTotal.toString(), receivableBalance:amount(receivableBalance).toString(), financialCoverage:coverage.toString(), difference:difference.toString()
    }));
  }

  return {
    marker:MARKER,
    channel,
    reference,
    saleId:sale.id,
    saleNumber:sale.numero || null,
    saleTotal:saleTotal.toString(),
    directPaid:directPaid.toString(),
    creditPaid:creditPaid.toString(),
    paidTotal:paidTotal.toString(),
    receivableBalance:amount(receivableBalance).toString(),
    financialCoverage:coverage.toString(),
    difference:difference.toString(),
    paymentCount:payments.length,
    balanced:issues.length === 0,
    issues
  };
}

async function reconcileShiftSalesPayments(tx, tenantId, shift) {
  const scope = await resolveShiftRestaurantOperations(tx, tenantId, shift);
  const saleIds = scope.saleIds;
  if (!saleIds.length) {
    return {
      marker:MARKER, shiftId:shift.id, saleTotal:'0', paidTotal:'0', receivableBalance:'0', financialCoverage:'0', difference:'0',
      balanced:true, checkedOperations:0, failedOperations:0, entries:[], failures:[]
    };
  }

  const sessionIds = scope.sessions.map((row) => row.id);
  const [sales, directMovements, payments, receivables, sessionPayments] = await Promise.all([
    tx.comprobanteComercial.findMany({
      where:{ tenantId, id:{ in:saleIds }, tipo:'FACTURA_VENTA', estado:{ not:'ANULADO' } },
      select:{ id:true, numero:true, estado:true, total:true, saldo:true, formaPago:true, cajaBancoId:true }
    }),
    tx.movimientoTesoreria.findMany({
      where:{ tenantId, comprobanteId:{ in:saleIds }, tipo:'INGRESO', concepto:{ startsWith:'Venta contado' } },
      include:{ cajaBanco:{ select:{ id:true, tipo:true, nombre:true } } },
      orderBy:{ creadoEn:'asc' }
    }),
    tx.pago.findMany({
      where:{ tenantId, documentoId:{ in:saleIds } },
      include:{
        cajaBanco:{ select:{ id:true, tipo:true, nombre:true } },
        comprobanteTesoreria:{ select:{ id:true, estado:true, total:true, cajaBancoId:true } }
      },
      orderBy:{ creadoEn:'asc' }
    }),
    tx.cartera.findMany({
      where:{ tenantId, comprobanteId:{ in:saleIds }, tipo:'CXC' },
      select:{ id:true, comprobanteId:true, valorOriginal:true, saldo:true, estado:true }
    }),
    sessionIds.length ? tx.restaurantSessionPayment.findMany({
      where:{ tenantId, sessionId:{ in:sessionIds } },
      select:{ id:true, sessionId:true, partKey:true, treasuryPaymentId:true, cashShiftId:true, metodoPago:true, cajaBancoId:true, saleAmount:true, reference:true, paidAt:true },
      orderBy:{ paidAt:'asc' }
    }) : []
  ]);

  const receiptIds = payments.map((row) => row.comprobanteTesoreriaId).filter(Boolean);
  const receiptMovements = receiptIds.length ? await tx.movimientoTesoreria.findMany({
    where:{ tenantId, comprobanteId:{ in:receiptIds }, tipo:'INGRESO' },
    include:{ cajaBanco:{ select:{ id:true, tipo:true, nombre:true } } },
    orderBy:{ creadoEn:'asc' }
  }) : [];

  const saleById = new Map(sales.map((row) => [row.id, row]));
  const directBySale = new Map();
  for (const row of directMovements) {
    if (!directBySale.has(row.comprobanteId)) directBySale.set(row.comprobanteId, []);
    directBySale.get(row.comprobanteId).push(row);
  }
  const paymentsBySale = new Map();
  for (const row of payments) {
    if (!paymentsBySale.has(row.documentoId)) paymentsBySale.set(row.documentoId, []);
    paymentsBySale.get(row.documentoId).push(row);
  }
  const receivableBySale = new Map();
  for (const row of receivables) {
    if (!receivableBySale.has(row.comprobanteId)) receivableBySale.set(row.comprobanteId, []);
    receivableBySale.get(row.comprobanteId).push(row);
  }
  const sessionPaymentsBySession = new Map();
  for (const row of sessionPayments) {
    if (!sessionPaymentsBySession.has(row.sessionId)) sessionPaymentsBySession.set(row.sessionId, []);
    sessionPaymentsBySession.get(row.sessionId).push(row);
  }

  const records = [];
  for (const session of scope.sessions) {
    records.push({
      channel:'MESAS',
      reference:session.table?.name || session.id,
      saleId:session.saleId,
      sale:saleById.get(session.saleId) || null,
      session,
      directMovements:directBySale.get(session.saleId) || [],
      payments:paymentsBySale.get(session.saleId) || [],
      receivables:receivableBySale.get(session.saleId) || [],
      receiptMovements,
      sessionPayments:sessionPaymentsBySession.get(session.id) || []
    });
  }
  for (const delivery of scope.deliveries) {
    records.push({
      channel:'DOMICILIO',
      reference:delivery.code || delivery.id,
      saleId:delivery.saleId,
      sale:saleById.get(delivery.saleId) || null,
      delivery,
      directMovements:directBySale.get(delivery.saleId) || [],
      payments:paymentsBySale.get(delivery.saleId) || [],
      receivables:receivableBySale.get(delivery.saleId) || [],
      receiptMovements,
      sessionPayments:[]
    });
  }

  const entries = records.map(reconcileSaleSettlement);
  let saleTotal = decimal(0);
  let paidTotal = decimal(0);
  let receivableBalance = decimal(0);
  for (const entry of entries) {
    saleTotal = saleTotal.plus(entry.saleTotal || 0);
    paidTotal = paidTotal.plus(entry.paidTotal || 0);
    receivableBalance = receivableBalance.plus(entry.receivableBalance || 0);
  }
  const coverage = amount(decimal(paidTotal).plus(receivableBalance));
  const difference = amount(coverage.minus(saleTotal));
  const failed = entries.filter((entry) => !entry.balanced);

  return {
    marker:MARKER,
    shiftId:shift.id,
    saleTotal:amount(saleTotal).toString(),
    paidTotal:amount(paidTotal).toString(),
    receivableBalance:amount(receivableBalance).toString(),
    financialCoverage:coverage.toString(),
    difference:difference.toString(),
    balanced:difference.eq(0) && failed.length === 0,
    checkedOperations:entries.length,
    failedOperations:failed.length,
    entries,
    failures:failed
  };
}

module.exports = {
  MARKER,
  expectedAccountType,
  reconcileSaleSettlement,
  reconcileShiftSalesPayments
};
