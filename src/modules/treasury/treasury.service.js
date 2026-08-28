const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money } = require('../../utils/decimal');
const accountingService = require('../accounting/accounting.service');

function paymentNumber(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function createCajaBanco(tenantId, input) {
  if (input.cuentaContableId) {
    const account = await prisma.cuentaPUC.findFirst({
      where: { id: input.cuentaContableId, tenantId, permiteMovimiento: true, activa: true }
    });
    if (!account) throw new AppError(400, 'Cuenta contable inválida', 'TREASURY_ACCOUNT_INVALID');
  }

  try {
    return await prisma.cajaBanco.create({ data: { tenantId, ...input } });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'La caja/banco ya existe', 'CASH_BANK_EXISTS');
    throw error;
  }
}

async function listCajaBanco(tenantId) {
  return prisma.cajaBanco.findMany({
    where: { tenantId },
    include: { cuentaContable: { select: { id: true, codigo: true, nombre: true } } },
    orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }]
  });
}

async function getCajaBanco(tenantId, id, client = prisma) {
  const account = await client.cajaBanco.findFirst({ where: { id, tenantId, activo: true } });
  if (!account) throw new AppError(404, 'Caja/Banco no encontrado', 'CASH_BANK_NOT_FOUND');
  return account;
}

async function deactivateCajaBanco(tenantId, id) {
  await getCajaBanco(tenantId, id);
  return prisma.cajaBanco.update({ where: { id }, data: { activo: false } });
}

async function openCashSession(tenantId, userId, cajaBancoId, input) {
  const caja = await getCajaBanco(tenantId, cajaBancoId);
  if (caja.tipo !== 'CAJA') throw new AppError(400, 'Solo una caja puede abrir turno', 'CASH_SESSION_REQUIRES_CASH');

  const open = await prisma.aperturaCierreCaja.findFirst({
    where: { tenantId, cajaBancoId, estado: 'ABIERTA' }
  });
  if (open) throw new AppError(409, 'La caja ya tiene un turno abierto', 'CASH_SESSION_ALREADY_OPEN');

  return prisma.aperturaCierreCaja.create({
    data: {
      tenantId,
      cajaBancoId,
      userId,
      saldoInicial: money(input.saldoInicial),
      saldoEsperado: money(input.saldoInicial)
    }
  });
}

async function closeCashSession(tenantId, userId, sessionId, input) {
  const session = await prisma.aperturaCierreCaja.findFirst({
    where: { id: sessionId, tenantId, estado: 'ABIERTA' }
  });
  if (!session) throw new AppError(404, 'Turno de caja abierto no encontrado', 'CASH_SESSION_NOT_FOUND');
  if (session.userId !== userId) throw new AppError(403, 'El turno pertenece a otro usuario', 'CASH_SESSION_USER_MISMATCH');

  const expected = money(session.saldoInicial)
    .plus(money(session.ingresosEfectivo))
    .minus(money(session.egresosEfectivo));
  const finalBalance = money(input.saldoFinal);
  const difference = finalBalance.minus(expected).toDecimalPlaces(2);

  return prisma.aperturaCierreCaja.update({
    where: { id: session.id },
    data: {
      estado: 'CERRADA',
      saldoEsperado: expected,
      saldoFinal: finalBalance,
      descuadre: difference,
      cerradoEn: new Date()
    }
  });
}

async function recordSessionFlow(tx, params) {
  const session = await tx.aperturaCierreCaja.findFirst({
    where: {
      tenantId: params.tenantId,
      cajaBancoId: params.cajaBancoId,
      userId: params.userId,
      estado: 'ABIERTA'
    },
    orderBy: { abiertoEn: 'desc' }
  });

  if (!session) return null;

  const data = {};
  if (params.cashIn) data.ingresosEfectivo = { increment: money(params.cashIn) };
  if (params.voucherIn) data.ingresosVoucher = { increment: money(params.voucherIn) };
  if (params.cashOut) data.egresosEfectivo = { increment: money(params.cashOut) };

  if (!Object.keys(data).length) return session;
  return tx.aperturaCierreCaja.update({ where: { id: session.id }, data });
}

async function recordTreasuryMovementInTx(tx, params) {
  const caja = await getCajaBanco(params.tenantId, params.cajaBancoId, tx);
  const amount = money(params.monto);
  if (amount.lte(0)) throw new AppError(400, 'El monto debe ser mayor que cero', 'TREASURY_AMOUNT_INVALID');

  const direction = Number(params.sign || 1) >= 0 ? 1 : -1;

  // saldoActual es un acumulador compartido por muchas operaciones concurrentes.
  // Nunca debe calcularse con read -> absolute write porque dos cobros simultáneos
  // pueden leer el mismo saldo y el último commit borra el incremento del anterior.
  // Prisma traduce increment/decrement a una operación atómica en PostgreSQL.
  const updated = await tx.cajaBanco.update({
    where: { id: caja.id },
    data: {
      saldoActual: direction > 0
        ? { increment: amount }
        : { decrement: amount }
    }
  });
  const next = money(updated.saldoActual);
  const previous = money(direction > 0 ? next.minus(amount) : next.plus(amount));

  const movement = await tx.movimientoTesoreria.create({
    data: {
      tenantId: params.tenantId,
      cajaBancoId: caja.id,
      comprobanteId: params.comprobanteId || null,
      tipo: params.tipo,
      monto: amount,
      saldoAnterior: previous,
      saldoNuevo: next,
      referencia: params.referencia || null,
      concepto: params.concepto || null
    }
  });

  if (caja.tipo === 'CAJA') {
    if (direction > 0) {
      await recordSessionFlow(tx, { tenantId: params.tenantId, cajaBancoId: caja.id, userId: params.userId, cashIn: amount });
    } else {
      await recordSessionFlow(tx, { tenantId: params.tenantId, cajaBancoId: caja.id, userId: params.userId, cashOut: amount });
    }
  } else if (direction > 0) {
    await recordSessionFlow(tx, { tenantId: params.tenantId, cajaBancoId: caja.id, userId: params.userId, voucherIn: amount });
  }

  return { caja: updated, movement };
}

async function applyCommercialSettlement(tx, params) {
  const { tenantId, userId, comprobante, terceroId, formaPago, cajaBancoId } = params;
  const total = money(comprobante.total);

  if (formaPago === 'CREDITO') {
    if (!terceroId) throw new AppError(400, 'El crédito requiere tercero', 'CREDIT_THIRD_PARTY_REQUIRED');
    const tipo = comprobante.tipo === 'FACTURA_VENTA' ? 'CXC' : 'CXP';

    const cartera = await tx.cartera.create({
      data: {
        tenantId,
        terceroId,
        comprobanteId: comprobante.id,
        tipo,
        valorOriginal: total,
        saldo: total,
        fechaVencimiento: comprobante.fechaVencimiento || null,
        referencia: comprobante.numero
      }
    });

    await tx.movimientoCartera.create({
      data: {
        tenantId,
        carteraId: cartera.id,
        comprobanteId: comprobante.id,
        tipo: 'CARGO',
        valor: total,
        saldoAnterior: 0,
        saldoNuevo: total,
        referencia: comprobante.numero,
        concepto: `Emisión ${comprobante.tipo} ${comprobante.numero}`
      }
    });

    return cartera;
  }

  if (!cajaBancoId) throw new AppError(400, 'Pago contado requiere Caja/Banco', 'PAYMENT_ACCOUNT_REQUIRED');
  const isSale = comprobante.tipo === 'FACTURA_VENTA';

  return recordTreasuryMovementInTx(tx, {
    tenantId,
    userId,
    cajaBancoId,
    comprobanteId: comprobante.id,
    tipo: isSale ? 'INGRESO' : 'EGRESO',
    monto: total,
    sign: isSale ? 1 : -1,
    referencia: comprobante.numero,
    concepto: `${isSale ? 'Venta' : 'Compra'} contado ${comprobante.numero}`
  });
}

async function resolveCashAccountingAccount(tx, tenantId, cajaBancoId) {
  const caja = await getCajaBanco(tenantId, cajaBancoId, tx);
  if (caja.cuentaContableId) {
    const account = await tx.cuentaPUC.findFirst({
      where: { id: caja.cuentaContableId, tenantId, activa: true, permiteMovimiento: true }
    });
    if (account) return { caja, account };
  }

  const account = await accountingService.getMappedAccount(
    tx,
    tenantId,
    caja.tipo === 'BANCO' ? 'BANCO_GENERAL' : 'CAJA_GENERAL'
  );
  return { caja, account };
}

async function registerPayment(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    if (input.sourceId) {
      const existing = await tx.pago.findFirst({
        where: { tenantId, sourceId: input.sourceId },
        include: { comprobanteTesoreria: true }
      });
      if (existing) return existing;
    }

    const documento = await tx.comprobanteComercial.findFirst({
      where: {
        id: input.documentoId,
        tenantId,
        tipo: { in: ['FACTURA_VENTA', 'COMPRA'] },
        estado: { in: ['EMITIDO', 'PAGADO_PARCIAL', 'CONFIRMADO'] }
      },
      include: { tercero: true }
    });
    if (!documento) throw new AppError(404, 'Documento por pagar no encontrado', 'PAYMENT_DOCUMENT_NOT_FOUND');
    if (documento.formaPago !== 'CREDITO') {
      throw new AppError(409, 'El documento no es a crédito', 'PAYMENT_DOCUMENT_NOT_CREDIT');
    }

    const cartera = await tx.cartera.findFirst({
      where: {
        tenantId,
        comprobanteId: documento.id,
        estado: { in: ['PENDIENTE', 'PARCIAL'] }
      }
    });
    if (!cartera) throw new AppError(404, 'Saldo de cartera no encontrado', 'PAYMENT_RECEIVABLE_NOT_FOUND');

    const amount = money(input.monto);
    if (amount.lte(0)) {
      throw new AppError(400, 'Monto de abono inválido', 'PAYMENT_AMOUNT_INVALID', {
        saldo: money(cartera.saldo).toString()
      });
    }

    // Cartera.saldo también es un acumulador compartido. La resta condicional
    // adquiere el lock de la fila y PostgreSQL serializa pagos concurrentes del
    // mismo documento. Si otro pago agotó el saldo mientras esperábamos, esta
    // transacción no modifica nada y se revierte completa.
    const reserved = await tx.cartera.updateMany({
      where: {
        id: cartera.id,
        tenantId,
        estado: { in: ['PENDIENTE', 'PARCIAL'] },
        saldo: { gte: amount }
      },
      data: { saldo: { decrement: amount } }
    });
    if (reserved.count !== 1) {
      const fresh = await tx.cartera.findFirst({ where: { id: cartera.id, tenantId }, select: { saldo: true, estado: true } });
      throw new AppError(400, 'Monto de abono inválido', 'PAYMENT_AMOUNT_INVALID', {
        saldo: money(fresh?.saldo || 0).toString(), estado: fresh?.estado || null
      });
    }

    const currentCartera = await tx.cartera.findFirst({ where: { id: cartera.id, tenantId } });
    if (!currentCartera) throw new AppError(404, 'Saldo de cartera no encontrado', 'PAYMENT_RECEIVABLE_NOT_FOUND');
    const newBalance = money(currentCartera.saldo);
    const previousBalance = money(newBalance.plus(amount));
    const carteraEstado = newBalance.eq(0) ? 'PAGADA' : 'PARCIAL';
    const documentState = newBalance.eq(0) ? 'PAGADO_TOTAL' : 'PAGADO_PARCIAL';
    await tx.cartera.update({ where: { id: cartera.id }, data: { estado: carteraEstado } });

    const isSale = documento.tipo === 'FACTURA_VENTA';
    const receiptType = isSale ? 'RECIBO_CAJA' : 'COMPROBANTE_EGRESO';
    const receipt = await tx.comprobanteComercial.create({
      data: {
        tenantId,
        tipo: receiptType,
        numero: paymentNumber(isSale ? 'RC' : 'CE'),
        sourceId: input.sourceId ? `DOC-${input.sourceId}` : null,
        estado: 'EMITIDO',
        documentoOrigenId: documento.id,
        terceroId: documento.terceroId,
        cajaBancoId: input.cajaBancoId,
        creadoPorId: userId,
        formaPago: input.metodoPago === 'EFECTIVO' ? 'EFECTIVO' : 'BANCO',
        fecha: new Date(),
        emitidoEn: new Date(),
        observaciones: input.referencia || `Abono a ${documento.numero}`,
        subtotal: amount,
        total: amount,
        saldo: 0
      }
    });

    await recordTreasuryMovementInTx(tx, {
      tenantId,
      userId,
      cajaBancoId: input.cajaBancoId,
      comprobanteId: receipt.id,
      tipo: isSale ? 'INGRESO' : 'EGRESO',
      monto: amount,
      sign: isSale ? 1 : -1,
      referencia: receipt.numero,
      concepto: `Pago ${documento.numero}`
    });

    await tx.movimientoCartera.create({
      data: {
        tenantId,
        carteraId: cartera.id,
        comprobanteId: receipt.id,
        tipo: 'ABONO',
        valor: amount,
        saldoAnterior: previousBalance,
        saldoNuevo: newBalance,
        referencia: receipt.numero,
        concepto: `Abono ${documento.numero}`
      }
    });

    await tx.comprobanteComercial.update({
      where: { id: documento.id },
      data: { saldo: newBalance, estado: documentState }
    });

    const { account: cashAccount } = await resolveCashAccountingAccount(tx, tenantId, input.cajaBancoId);
    const thirdPartyAccount = await accountingService.getMappedAccount(
      tx,
      tenantId,
      isSale ? 'CLIENTES' : 'PROVEEDORES'
    );

    const details = isSale
      ? [
        { cuentaId: cashAccount.id, debito: amount, credito: 0, concepto: receipt.numero },
        { cuentaId: thirdPartyAccount.id, terceroId: documento.terceroId, debito: 0, credito: amount, concepto: receipt.numero }
      ]
      : [
        { cuentaId: thirdPartyAccount.id, terceroId: documento.terceroId, debito: amount, credito: 0, concepto: receipt.numero },
        { cuentaId: cashAccount.id, debito: 0, credito: amount, concepto: receipt.numero }
      ];

    await accountingService.createJournalInTx(tx, {
      tenantId,
      userId,
      comprobanteId: receipt.id,
      sourceId: input.sourceId ? `PAY-${input.sourceId}` : null,
      fecha: receipt.fecha,
      concepto: `${receiptType} ${receipt.numero}`,
      referencia: receipt.numero,
      detalles: details
    });

    const pago = await tx.pago.create({
      data: {
        tenantId,
        documentoId: documento.id,
        carteraId: cartera.id,
        comprobanteTesoreriaId: receipt.id,
        cajaBancoId: input.cajaBancoId,
        userId,
        sourceId: input.sourceId || null,
        metodoPago: input.metodoPago,
        monto: amount,
        referencia: input.referencia || null
      }
    });

    return tx.pago.findUnique({
      where: { id: pago.id },
      include: {
        documento: true,
        cartera: true,
        cajaBanco: true,
        comprobanteTesoreria: { include: { asiento: { include: { detalles: true } } } }
      }
    });
  });
}

async function reversePaymentsForDocumentInTx(tx, params) {
  const payments = await tx.pago.findMany({
    where: {
      tenantId: params.tenantId,
      documentoId: params.documentoId,
      comprobanteTesoreria: { estado: { not: 'ANULADO' } }
    },
    include: {
      cartera: true,
      comprobanteTesoreria: { include: { asiento: { include: { detalles: true } } } }
    },
    orderBy: { creadoEn: 'desc' }
  });

  for (const payment of payments) {
    const isSale = payment.cartera.tipo === 'CXC';
    const amount = money(payment.monto);

    await recordTreasuryMovementInTx(tx, {
      tenantId: params.tenantId,
      userId: params.userId,
      cajaBancoId: payment.cajaBancoId,
      comprobanteId: payment.comprobanteTesoreriaId,
      tipo: 'AJUSTE',
      monto: amount,
      sign: isSale ? -1 : 1,
      referencia: `REV-${payment.comprobanteTesoreria.numero}`,
      concepto: `Reverso pago ${payment.comprobanteTesoreria.numero}`
    });

    if (payment.comprobanteTesoreria.asiento) {
      await accountingService.reverseJournalInTx(tx, {
        tenantId: params.tenantId,
        userId: params.userId,
        asiento: payment.comprobanteTesoreria.asiento,
        sourceId: `REV-PAGO-${payment.id}`,
        referencia: `REV-${payment.comprobanteTesoreria.numero}`
      });
    }

    const currentCartera = await tx.cartera.findFirst({
      where: { id: payment.carteraId, tenantId: params.tenantId }
    });
    if (currentCartera && currentCartera.estado !== 'ANULADA') {
      const previous = money(currentCartera.saldo);
      const next = money(previous.plus(amount));
      await tx.cartera.update({
        where: { id: currentCartera.id },
        data: { saldo: next, estado: next.eq(currentCartera.valorOriginal) ? 'PENDIENTE' : 'PARCIAL' }
      });
      await tx.movimientoCartera.create({
        data: {
          tenantId: params.tenantId,
          carteraId: currentCartera.id,
          comprobanteId: payment.comprobanteTesoreriaId,
          tipo: currentCartera.tipo === 'CXC' ? 'AJUSTE_DEBITO' : 'AJUSTE_CREDITO',
          valor: amount,
          saldoAnterior: previous,
          saldoNuevo: next,
          referencia: `REV-${payment.comprobanteTesoreria.numero}`,
          concepto: 'Reverso de pago por anulación del documento'
        }
      });
    }

    await tx.comprobanteComercial.update({
      where: { id: payment.comprobanteTesoreriaId },
      data: { estado: 'ANULADO', anuladoEn: new Date(), motivoAnulacion: params.motivo }
    });
  }

  return payments.length;
}

async function cancelCarteraForDocumentInTx(tx, params) {
  const rows = await tx.cartera.findMany({
    where: { tenantId: params.tenantId, comprobanteId: params.documentoId, estado: { not: 'ANULADA' } }
  });

  for (const cartera of rows) {
    const previous = money(cartera.saldo);
    await tx.cartera.update({ where: { id: cartera.id }, data: { saldo: 0, estado: 'ANULADA' } });
    if (previous.gt(0)) {
      await tx.movimientoCartera.create({
        data: {
          tenantId: params.tenantId,
          carteraId: cartera.id,
          comprobanteId: params.reversalDocumentId || null,
          tipo: 'ANULACION',
          valor: previous,
          saldoAnterior: previous,
          saldoNuevo: 0,
          referencia: params.referencia,
          concepto: params.motivo
        }
      });
    }
  }

  return rows.length;
}

async function listCartera(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.tipo) where.tipo = filters.tipo;
  if (filters.estado) where.estado = filters.estado;
  if (filters.terceroId) where.terceroId = filters.terceroId;
  if (filters.desde || filters.hasta) {
    where.fechaEmision = {};
    if (filters.desde) where.fechaEmision.gte = new Date(filters.desde);
    if (filters.hasta) where.fechaEmision.lte = new Date(filters.hasta);
  }
  if (filters.montoMin !== undefined || filters.montoMax !== undefined) {
    where.valorOriginal = {};
    if (filters.montoMin !== undefined) where.valorOriginal.gte = money(filters.montoMin);
    if (filters.montoMax !== undefined) where.valorOriginal.lte = money(filters.montoMax);
  }

  const page = Math.max(Number(filters.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(filters.pageSize || filters.limit) || 50, 1), 200);
  const [items, total] = await Promise.all([
    prisma.cartera.findMany({
      where,
      include: {
        tercero: { select: { id: true, identificacion: true, nombre: true, razonSocial: true } },
        comprobante: { select: { id: true, tipo: true, numero: true, total: true, estado: true } }
      },
      orderBy: { creadoEn: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.cartera.count({ where })
  ]);

  return { items, meta: { page, pageSize, total, pages: Math.max(Math.ceil(total / pageSize), 1) } };
}

async function listPayments(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.documentoId) where.documentoId = filters.documentoId;
  if (filters.cajaBancoId) where.cajaBancoId = filters.cajaBancoId;

  return prisma.pago.findMany({
    where,
    include: { documento: true, cajaBanco: true, comprobanteTesoreria: true },
    orderBy: { creadoEn: 'desc' },
    take: Math.min(Number(filters.limit) || 100, 500)
  });
}

module.exports = {
  createCajaBanco,
  listCajaBanco,
  getCajaBanco,
  deactivateCajaBanco,
  openCashSession,
  closeCashSession,
  recordTreasuryMovementInTx,
  applyCommercialSettlement,
  registerPayment,
  reversePaymentsForDocumentInTx,
  cancelCarteraForDocumentInTx,
  listCartera,
  listPayments
};