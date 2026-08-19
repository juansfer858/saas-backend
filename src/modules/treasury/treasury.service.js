const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money } = require('../../utils/decimal');

async function createCajaBanco(tenantId, input) {
  if (input.cuentaContableId) {
    const account = await prisma.cuentaPUC.findFirst({
      where: { id: input.cuentaContableId, tenantId, permiteMovimiento: true }
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
  const account = await client.cajaBanco.findFirst({ where: { id, tenantId } });
  if (!account) throw new AppError(404, 'Caja/Banco no encontrado', 'CASH_BANK_NOT_FOUND');
  return account;
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

  return tx.aperturaCierreCaja.update({ where: { id: session.id }, data });
}

async function applyCommercialSettlement(tx, params) {
  const { tenantId, userId, comprobante, terceroId, formaPago, cajaBancoId } = params;
  const total = money(comprobante.total);

  if (formaPago === 'CREDITO') {
    if (!terceroId) throw new AppError(400, 'El crédito requiere tercero', 'CREDIT_THIRD_PARTY_REQUIRED');
    const tipo = comprobante.tipo === 'FACTURA_VENTA' ? 'CXC' : 'CXP';

    return tx.cartera.create({
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
  }

  if (!cajaBancoId) throw new AppError(400, 'Pago contado requiere Caja/Banco', 'PAYMENT_ACCOUNT_REQUIRED');

  const caja = await getCajaBanco(tenantId, cajaBancoId, tx);
  const isSale = comprobante.tipo === 'FACTURA_VENTA';
  const delta = isSale ? total : total.negated();

  await tx.cajaBanco.update({
    where: { id: caja.id },
    data: { saldoActual: { increment: delta } }
  });

  if (caja.tipo === 'CAJA') {
    await recordSessionFlow(tx, {
      tenantId,
      cajaBancoId: caja.id,
      userId,
      cashIn: isSale ? total : null,
      cashOut: isSale ? null : total
    });
  } else if (caja.tipo === 'BANCO' && isSale) {
    await recordSessionFlow(tx, {
      tenantId,
      cajaBancoId: caja.id,
      userId,
      voucherIn: total
    });
  }

  return caja;
}

async function listCartera(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.tipo) where.tipo = filters.tipo;
  if (filters.estado) where.estado = filters.estado;
  if (filters.terceroId) where.terceroId = filters.terceroId;

  return prisma.cartera.findMany({
    where,
    include: {
      tercero: { select: { id: true, identificacion: true, nombre: true, razonSocial: true } },
      comprobante: { select: { id: true, tipo: true, numero: true, total: true } }
    },
    orderBy: { creadoEn: 'desc' },
    take: Math.min(Number(filters.limit) || 100, 500)
  });
}

module.exports = {
  createCajaBanco,
  listCajaBanco,
  getCajaBanco,
  openCashSession,
  closeCashSession,
  applyCommercialSettlement,
  listCartera
};
