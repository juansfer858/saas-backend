const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money } = require('../../utils/decimal');
const treasuryService = require('./treasury.service');
const accountingService = require('../accounting/accounting.service');
const integration = require('../accounting/accounting-integration.service');

function documentNumber(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function accountForCashBank(tx, tenantId, cajaBancoId) {
  const caja = await treasuryService.getCajaBanco(tenantId, cajaBancoId, tx);
  if (caja.cuentaContableId) {
    const account = await tx.cuentaPUC.findFirst({
      where: { id: caja.cuentaContableId, tenantId, activa: true, permiteMovimiento: true }
    });
    if (account) return { caja, account };
  }
  const fallback = await integration.resolveMappingInTx(tx, tenantId, caja.tipo === 'BANCO' ? 'BANCO_GENERAL' : 'CAJA_GENERAL');
  return { caja, account: fallback };
}

async function createTreasuryDocument(tx, params) {
  return tx.comprobanteComercial.create({
    data: {
      tenantId: params.tenantId,
      tipo: 'COMPROBANTE_EGRESO',
      numero: params.numero,
      sourceId: params.sourceId || null,
      estado: 'EMITIDO',
      terceroId: params.terceroId || null,
      cajaBancoId: params.cajaBancoId || null,
      creadoPorId: params.userId,
      formaPago: params.formaPago || null,
      fecha: params.fecha || new Date(),
      emitidoEn: new Date(),
      observaciones: params.observaciones || null,
      subtotal: params.total,
      total: params.total,
      saldo: 0
    }
  });
}

async function transferOwnFunds(tenantId, userId, input) {
  if (input.origenCajaBancoId === input.destinoCajaBancoId) {
    throw new AppError(400, 'La cuenta origen y destino deben ser diferentes', 'TREASURY_TRANSFER_SAME_ACCOUNT');
  }
  const amount = money(input.monto);
  if (amount.lte(0)) throw new AppError(400, 'El monto debe ser mayor que cero', 'TREASURY_AMOUNT_INVALID');

  return prisma.$transaction(async (tx) => {
    if (input.sourceId) {
      const existing = await tx.comprobanteComercial.findFirst({ where: { tenantId, sourceId: `TR-${input.sourceId}` }, include: { asiento: true } });
      if (existing) return { documento: existing, asiento: existing.asiento, idempotente: true };
    }
    const [origin, destination] = await Promise.all([
      accountForCashBank(tx, tenantId, input.origenCajaBancoId),
      accountForCashBank(tx, tenantId, input.destinoCajaBancoId)
    ]);
    const number = documentNumber('TR');
    const document = await createTreasuryDocument(tx, {
      tenantId,
      userId,
      numero: number,
      sourceId: input.sourceId ? `TR-${input.sourceId}` : null,
      cajaBancoId: origin.caja.id,
      formaPago: origin.caja.tipo === 'CAJA' ? 'EFECTIVO' : 'BANCO',
      fecha: input.fecha,
      observaciones: input.concepto || `Transferencia ${origin.caja.nombre} → ${destination.caja.nombre}`,
      total: amount
    });

    await treasuryService.recordTreasuryMovementInTx(tx, {
      tenantId, userId, cajaBancoId: origin.caja.id, comprobanteId: document.id,
      tipo: 'TRASLADO_SALIDA', monto: amount, sign: -1, referencia: number,
      concepto: input.concepto || `Transferencia a ${destination.caja.nombre}`
    });
    await treasuryService.recordTreasuryMovementInTx(tx, {
      tenantId, userId, cajaBancoId: destination.caja.id, comprobanteId: document.id,
      tipo: 'TRASLADO_ENTRADA', monto: amount, sign: 1, referencia: number,
      concepto: input.concepto || `Transferencia desde ${origin.caja.nombre}`
    });

    const journal = await accountingService.createJournalInTx(tx, {
      tenantId, userId, comprobanteId: document.id,
      sourceId: input.sourceId ? `ACC-TR-${input.sourceId}` : `ACC-${document.id}`,
      fecha: document.fecha, concepto: `Transferencia propia ${origin.caja.nombre} → ${destination.caja.nombre}`,
      referencia: number, origen: 'AUTOMATICO', codigoTipo: 'AU',
      detalles: [
        { cuentaId: destination.account.id, debito: amount, credito: 0, concepto: number },
        { cuentaId: origin.account.id, debito: 0, credito: amount, concepto: number }
      ]
    });
    return { documento: document, asiento: journal, origen: origin.caja, destino: destination.caja };
  });
}

async function directExpense(tenantId, userId, input) {
  const amount = money(input.monto);
  if (amount.lte(0)) throw new AppError(400, 'El monto debe ser mayor que cero', 'TREASURY_AMOUNT_INVALID');
  return prisma.$transaction(async (tx) => {
    if (input.sourceId) {
      const existing = await tx.comprobanteComercial.findFirst({ where: { tenantId, sourceId: `GD-${input.sourceId}` }, include: { asiento: true } });
      if (existing) return { documento: existing, asiento: existing.asiento, idempotente: true };
    }
    const cash = await accountForCashBank(tx, tenantId, input.cajaBancoId);
    let expenseAccount;
    if (input.cuentaGastoId) {
      expenseAccount = await tx.cuentaPUC.findFirst({ where: { id: input.cuentaGastoId, tenantId, activa: true, permiteMovimiento: true } });
      if (!expenseAccount) throw new AppError(400, 'Cuenta de gasto inválida', 'TREASURY_EXPENSE_ACCOUNT_INVALID');
    } else {
      expenseAccount = await integration.resolveMappingInTx(tx, tenantId, 'GASTO_DIRECTO');
    }
    let tercero = null;
    if (input.terceroId) {
      tercero = await tx.tercero.findFirst({ where: { id: input.terceroId, tenantId, activo: true } });
      if (!tercero) throw new AppError(400, 'Tercero inválido', 'TREASURY_THIRD_PARTY_INVALID');
    }
    const number = documentNumber('GD');
    const document = await createTreasuryDocument(tx, {
      tenantId, userId, numero: number, sourceId: input.sourceId ? `GD-${input.sourceId}` : null,
      terceroId: tercero?.id || null, cajaBancoId: cash.caja.id,
      formaPago: cash.caja.tipo === 'CAJA' ? 'EFECTIVO' : 'BANCO', fecha: input.fecha,
      observaciones: input.concepto, total: amount
    });
    await treasuryService.recordTreasuryMovementInTx(tx, {
      tenantId, userId, cajaBancoId: cash.caja.id, comprobanteId: document.id,
      tipo: 'EGRESO', monto: amount, sign: -1, referencia: number, concepto: input.concepto
    });
    const journal = await accountingService.createJournalInTx(tx, {
      tenantId, userId, comprobanteId: document.id,
      sourceId: input.sourceId ? `ACC-GD-${input.sourceId}` : `ACC-${document.id}`,
      fecha: document.fecha, concepto: `Gasto directo · ${input.concepto}`, referencia: number,
      origen: 'AUTOMATICO', codigoTipo: 'AU',
      detalles: [
        { cuentaId: expenseAccount.id, terceroId: tercero?.id || null, debito: amount, credito: 0, concepto: input.concepto },
        { cuentaId: cash.account.id, terceroId: tercero?.id || null, debito: 0, credito: amount, concepto: input.concepto }
      ]
    });
    return { documento: document, asiento: journal, cajaBanco: cash.caja, tercero };
  });
}

async function allocatePaymentBatch(tenantId, userId, input) {
  const applications = input.aplicaciones || [];
  if (!applications.length) throw new AppError(400, 'Debe indicar al menos una factura a aplicar', 'PAYMENT_APPLICATIONS_REQUIRED');
  if (new Set(applications.map((x) => x.documentoId)).size !== applications.length) {
    throw new AppError(400, 'Una factura no puede repetirse en la misma aplicación', 'PAYMENT_DUPLICATE_DOCUMENT');
  }

  return prisma.$transaction(async (tx) => {
    const ids = applications.map((x) => x.documentoId);
    const docs = await tx.comprobanteComercial.findMany({
      where: { tenantId, id: { in: ids }, tipo: { in: ['FACTURA_VENTA', 'COMPRA'] }, formaPago: 'CREDITO', estado: { in: ['EMITIDO', 'PAGADO_PARCIAL', 'CONFIRMADO'] } },
      include: { tercero: true, cartera: true }
    });
    if (docs.length !== ids.length) throw new AppError(404, 'Una o más facturas no están disponibles para pago', 'PAYMENT_DOCUMENT_NOT_FOUND');
    const typeSet = new Set(docs.map((d) => d.tipo));
    const thirdSet = new Set(docs.map((d) => d.terceroId));
    if (typeSet.size !== 1 || thirdSet.size !== 1) {
      throw new AppError(409, 'Un pago múltiple debe corresponder al mismo tercero y al mismo tipo de cartera', 'PAYMENT_BATCH_MIXED_PARTY');
    }
    const isSale = docs[0].tipo === 'FACTURA_VENTA';
    const cash = await accountForCashBank(tx, tenantId, input.cajaBancoId);
    const thirdPartyAccount = await integration.resolveMappingInTx(tx, tenantId, isSale ? 'CLIENTES' : 'PROVEEDORES');
    const results = [];

    for (let i = 0; i < applications.length; i += 1) {
      const application = applications[i];
      const document = docs.find((d) => d.id === application.documentoId);
      const cartera = document.cartera.find((c) => ['PENDIENTE', 'PARCIAL'].includes(c.estado));
      if (!cartera) throw new AppError(404, `Saldo no encontrado para ${document.numero}`, 'PAYMENT_RECEIVABLE_NOT_FOUND');
      const amount = money(application.monto);
      if (amount.lte(0) || amount.gt(money(cartera.saldo))) {
        throw new AppError(400, `Monto inválido para ${document.numero}`, 'PAYMENT_AMOUNT_INVALID', { saldo: money(cartera.saldo).toString() });
      }
      const receiptType = isSale ? 'RECIBO_CAJA' : 'COMPROBANTE_EGRESO';
      const receiptNumber = documentNumber(isSale ? 'RC' : 'CE');
      const childSource = input.sourceId ? `${input.sourceId}-${i + 1}` : null;
      const receipt = await tx.comprobanteComercial.create({
        data: {
          tenantId, tipo: receiptType, numero: receiptNumber, sourceId: childSource ? `DOC-${childSource}` : null,
          estado: 'EMITIDO', documentoOrigenId: document.id, terceroId: document.terceroId,
          cajaBancoId: cash.caja.id, creadoPorId: userId,
          formaPago: input.metodoPago === 'EFECTIVO' ? 'EFECTIVO' : 'BANCO', fecha: input.fecha || new Date(), emitidoEn: new Date(),
          observaciones: input.referencia || `Abono a ${document.numero}`, subtotal: amount, total: amount, saldo: 0
        }
      });
      await treasuryService.recordTreasuryMovementInTx(tx, {
        tenantId, userId, cajaBancoId: cash.caja.id, comprobanteId: receipt.id,
        tipo: isSale ? 'INGRESO' : 'EGRESO', monto: amount, sign: isSale ? 1 : -1,
        referencia: receiptNumber, concepto: `Pago ${document.numero}`
      });
      const previous = money(cartera.saldo);
      const next = money(previous.minus(amount));
      await tx.cartera.update({ where: { id: cartera.id }, data: { saldo: next, estado: next.eq(0) ? 'PAGADA' : 'PARCIAL' } });
      await tx.movimientoCartera.create({ data: {
        tenantId, carteraId: cartera.id, comprobanteId: receipt.id, tipo: 'ABONO', valor: amount,
        saldoAnterior: previous, saldoNuevo: next, referencia: receiptNumber, concepto: `Abono ${document.numero}`
      } });
      await tx.comprobanteComercial.update({ where: { id: document.id }, data: { saldo: next, estado: next.eq(0) ? 'PAGADO_TOTAL' : 'PAGADO_PARCIAL' } });

      const details = isSale
        ? [
          { cuentaId: cash.account.id, debito: amount, credito: 0, concepto: receiptNumber },
          { cuentaId: thirdPartyAccount.id, terceroId: document.terceroId, debito: 0, credito: amount, concepto: receiptNumber }
        ]
        : [
          { cuentaId: thirdPartyAccount.id, terceroId: document.terceroId, debito: amount, credito: 0, concepto: receiptNumber },
          { cuentaId: cash.account.id, debito: 0, credito: amount, concepto: receiptNumber }
        ];
      const journal = await accountingService.createJournalInTx(tx, {
        tenantId, userId, comprobanteId: receipt.id,
        sourceId: childSource ? `PAY-${childSource}` : `PAY-${receipt.id}`,
        fecha: receipt.fecha, concepto: `${receiptType} ${receiptNumber}`, referencia: receiptNumber,
        origen: 'AUTOMATICO', codigoTipo: 'AU', detalles: details
      });
      const payment = await tx.pago.create({ data: {
        tenantId, documentoId: document.id, carteraId: cartera.id, comprobanteTesoreriaId: receipt.id,
        cajaBancoId: cash.caja.id, userId, sourceId: childSource, metodoPago: input.metodoPago,
        monto: amount, referencia: input.referencia || null
      } });
      results.push({ documentoId: document.id, numero: document.numero, pago: payment, comprobante: receipt, asiento: journal, saldo: next });
    }
    return { tercero: docs[0].tercero, tipoCartera: isSale ? 'CXC' : 'CXP', aplicaciones: results, total: money(results.reduce((a, x) => a.plus(x.pago.monto), money(0))) };
  });
}

module.exports = { accountForCashBank, transferOwnFunds, directExpense, allocatePaymentBatch };
