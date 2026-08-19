const { prisma } = require('../../config/prisma');
const { money, decimal } = require('../../utils/decimal');
const { AppError } = require('../../utils/app-error');
const integration = require('../accounting/accounting-integration.service');

function daysBetween(a, b) {
  return Math.max(Math.floor((a.getTime() - b.getTime()) / 86400000), 0);
}

function bucketFor(days) {
  if (days <= 30) return '0_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return 'MAS_90';
}

async function aging(tenantId, filters = {}) {
  const corte = filters.corte ? new Date(filters.corte) : new Date();
  const where = {
    tenantId,
    estado: { in: ['PENDIENTE', 'PARCIAL'] },
    saldo: { gt: 0 }
  };
  if (filters.tipo) where.tipo = filters.tipo;
  if (filters.terceroId) where.terceroId = filters.terceroId;

  const items = await prisma.cartera.findMany({
    where,
    include: {
      tercero: { select: { id: true, identificacion: true, nombre: true, razonSocial: true, tipo: true } },
      comprobante: { select: { id: true, numero: true, tipo: true, fecha: true } }
    },
    orderBy: [{ terceroId: 'asc' }, { fechaVencimiento: 'asc' }, { fechaEmision: 'asc' }]
  });

  const groups = new Map();
  const totals = { CORRIENTE: decimal(0), '0_30': decimal(0), '31_60': decimal(0), '61_90': decimal(0), MAS_90: decimal(0), TOTAL: decimal(0) };

  for (const item of items) {
    const due = item.fechaVencimiento || item.fechaEmision;
    const overdue = corte > due ? daysBetween(corte, due) : 0;
    const bucket = corte <= due ? 'CORRIENTE' : bucketFor(overdue);
    const saldo = money(item.saldo);
    if (!groups.has(item.terceroId)) {
      groups.set(item.terceroId, {
        tercero: item.tercero,
        tipo: item.tipo,
        CORRIENTE: decimal(0),
        '0_30': decimal(0),
        '31_60': decimal(0),
        '61_90': decimal(0),
        MAS_90: decimal(0),
        TOTAL: decimal(0),
        documentos: []
      });
    }
    const group = groups.get(item.terceroId);
    group[bucket] = group[bucket].plus(saldo);
    group.TOTAL = group.TOTAL.plus(saldo);
    totals[bucket] = totals[bucket].plus(saldo);
    totals.TOTAL = totals.TOTAL.plus(saldo);
    group.documentos.push({
      id: item.id,
      documento: item.comprobante,
      fechaEmision: item.fechaEmision,
      fechaVencimiento: item.fechaVencimiento,
      diasVencido: overdue,
      bucket,
      valorOriginal: item.valorOriginal,
      saldo: item.saldo,
      estado: item.estado
    });
  }

  const normalize = (value) => money(value);
  return {
    corte,
    tipo: filters.tipo || null,
    terceros: [...groups.values()].map((g) => ({
      ...g,
      CORRIENTE: normalize(g.CORRIENTE),
      '0_30': normalize(g['0_30']),
      '31_60': normalize(g['31_60']),
      '61_90': normalize(g['61_90']),
      MAS_90: normalize(g.MAS_90),
      TOTAL: normalize(g.TOTAL)
    })),
    totales: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, normalize(v)]))
  };
}

async function thirdPartyDetail(tenantId, terceroId, filters = {}) {
  const tercero = await prisma.tercero.findFirst({ where: { id: terceroId, tenantId, activo: true } });
  if (!tercero) throw new AppError(404, 'Tercero no encontrado', 'THIRD_PARTY_NOT_FOUND');
  const where = { tenantId, terceroId };
  if (filters.tipo) where.tipo = filters.tipo;
  const items = await prisma.cartera.findMany({
    where,
    include: {
      comprobante: { include: { asiento: { select: { id: true, numeroComprobante: true, estado: true } } } },
      movimientos: { orderBy: { creadoEn: 'asc' }, include: { comprobante: true } },
      pagos: { include: { comprobanteTesoreria: { include: { asiento: { select: { id: true, numeroComprobante: true } } } }, cajaBanco: true } }
    },
    orderBy: { fechaEmision: 'asc' }
  });
  return { tercero, items };
}

async function accountingReconciliation(tenantId, tipo) {
  if (!['CXC', 'CXP'].includes(tipo)) throw new AppError(400, 'Tipo de cartera inválido', 'CARTERA_TYPE_INVALID');
  const mappingKey = tipo === 'CXC' ? 'CLIENTES' : 'PROVEEDORES';
  const account = await integration.resolveMappingInTx(prisma, tenantId, mappingKey);
  const open = await prisma.cartera.aggregate({
    where: { tenantId, tipo, estado: { in: ['PENDIENTE', 'PARCIAL'] } },
    _sum: { saldo: true }
  });
  const lines = await prisma.detalleAsiento.findMany({
    where: {
      tenantId,
      cuentaId: account.id,
      asiento: { estado: { in: ['CONTABILIZADO', 'ANULADO'] } }
    },
    select: { debito: true, credito: true }
  });
  let debit = decimal(0);
  let credit = decimal(0);
  for (const line of lines) {
    debit = debit.plus(line.debito);
    credit = credit.plus(line.credito);
  }
  const ledgerBalance = tipo === 'CXC' ? money(debit.minus(credit)) : money(credit.minus(debit));
  const carteraBalance = money(open._sum.saldo || 0);
  return {
    tipo,
    cuenta: account,
    saldoCartera: carteraBalance,
    saldoAuxiliarContable: ledgerBalance,
    diferencia: money(carteraBalance.minus(ledgerBalance)),
    cuadra: carteraBalance.eq(ledgerBalance)
  };
}

module.exports = { aging, thirdPartyDetail, accountingReconciliation };
