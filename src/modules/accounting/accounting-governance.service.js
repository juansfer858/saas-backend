const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money } = require('../../utils/decimal');
const accounting = require('./accounting.service');
const reporting = require('./accounting-reporting.service');
const { auditInTx } = require('./accounting-audit.service');

function periodBounds(anio, mes) {
  const start = new Date(Date.UTC(anio, mes - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(anio, mes, 0, 23, 59, 59, 999));
  return { start, end };
}

async function listPeriods(tenantId, limit = 36) {
  return prisma.periodoContable.findMany({
    where: { tenantId },
    include: {
      cerradoPor: { select: { id: true, nombre: true, email: true } },
      reabiertoPor: { select: { id: true, nombre: true, email: true } },
      asientoCierre: { select: { id: true, numeroComprobante: true, estado: true } }
    },
    orderBy: [{ anio: 'desc' }, { mes: 'desc' }],
    take: Math.min(Number(limit) || 36, 240)
  });
}

async function getConfig(tenantId) {
  return prisma.configuracionContable.findUnique({
    where: { tenantId },
    include: {
      cuentaImpuestoRenta: { select: { id: true, codigo: true, nombre: true } },
      cuentaImpuestoRentaPorPagar: { select: { id: true, codigo: true, nombre: true } },
      cuentaUtilidadEjercicio: { select: { id: true, codigo: true, nombre: true } },
      cuentaPerdidaEjercicio: { select: { id: true, codigo: true, nombre: true } }
    }
  });
}

async function validateConfigAccounts(tx, tenantId, input) {
  const ids = [
    input.cuentaImpuestoRentaId,
    input.cuentaImpuestoRentaPorPagarId,
    input.cuentaUtilidadEjercicioId,
    input.cuentaPerdidaEjercicioId
  ].filter(Boolean);
  if (!ids.length) return;
  const count = await tx.cuentaPUC.count({ where: { tenantId, id: { in: [...new Set(ids)] }, activa: true, permiteMovimiento: true } });
  if (count !== new Set(ids).size) throw new AppError(400, 'Una cuenta de configuración no pertenece al tenant o no acepta movimientos', 'ACCOUNTING_CONFIG_ACCOUNT_INVALID');
}

async function updateConfig(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    await validateConfigAccounts(tx, tenantId, input);
    const data = {};
    for (const key of ['cuentaImpuestoRentaId', 'cuentaImpuestoRentaPorPagarId', 'cuentaUtilidadEjercicioId', 'cuentaPerdidaEjercicioId']) {
      if (Object.prototype.hasOwnProperty.call(input, key)) data[key] = input[key] || null;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'tasaImpuestoRenta')) data.tasaImpuestoRenta = input.tasaImpuestoRenta;
    const cfg = await tx.configuracionContable.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data
    });
    await auditInTx(tx, { tenantId, userId, entidad: 'CONFIGURACION_CONTABLE', entidadId: cfg.id, accion: 'ACTUALIZAR', metadata: data });
    return cfg;
  });
}

async function accrueIncomeTaxIfNeeded(tx, tenantId, userId, anio, mes, config) {
  if (!config || decimal(config.tasaImpuestoRenta || 0).lte(0)) return null;
  const { start, end } = periodBounds(anio, mes);
  const pnl = await reporting.profitAndLoss(tenantId, { desde: start.toISOString(), hasta: end.toISOString(), comparar: false });
  if (!pnl.impuestoEstimado || money(pnl.impuestoRenta).lte(0)) return null;
  if (!config.cuentaImpuestoRentaId || !config.cuentaImpuestoRentaPorPagarId) {
    throw new AppError(409, 'Configure las cuentas de impuesto de renta antes de cerrar el periodo', 'ACCOUNTING_TAX_CONFIG_REQUIRED');
  }
  return accounting.createJournalInTx(tx, {
    tenantId,
    userId,
    fecha: end,
    concepto: `Provisión impuesto de renta ${anio}-${String(mes).padStart(2, '0')}`,
    origen: 'AUTOMATICO',
    codigoTipo: 'CA',
    sourceId: `TAX-CLOSE-${tenantId}-${anio}-${mes}`,
    detalles: [
      { cuentaId: config.cuentaImpuestoRentaId, debito: pnl.impuestoRenta, credito: 0, concepto: 'Impuesto de renta del periodo' },
      { cuentaId: config.cuentaImpuestoRentaPorPagarId, debito: 0, credito: pnl.impuestoRenta, concepto: 'Impuesto de renta por pagar' }
    ]
  });
}

async function closePeriod(tenantId, userId, anio, mes) {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new AppError(400, 'Periodo inválido', 'ACCOUNTING_PERIOD_INVALID');
  return prisma.$transaction(async (tx) => {
    let period = await tx.periodoContable.upsert({
      where: { tenantId_anio_mes: { tenantId, anio, mes } },
      create: { tenantId, anio, mes, estado: 'ABIERTO' },
      update: {}
    });
    if (period.estado === 'CERRADO') throw new AppError(409, 'El periodo ya está cerrado', 'ACCOUNTING_PERIOD_ALREADY_CLOSED');

    const config = await tx.configuracionContable.findUnique({ where: { tenantId } });
    await accrueIncomeTaxIfNeeded(tx, tenantId, userId, anio, mes, config);

    const { start, end } = periodBounds(anio, mes);
    const rows = await tx.detalleAsiento.findMany({
      where: {
        tenantId,
        cuenta: { tenantId, categoriaResultado: { not: null }, permiteMovimiento: true },
        asiento: {
          estado: { in: ['CONTABILIZADO', 'ANULADO'] },
          origen: { not: 'CIERRE' },
          fecha: { gte: start, lte: end }
        }
      },
      include: { cuenta: true }
    });

    const map = new Map();
    for (const row of rows) {
      const x = map.get(row.cuentaId) || { cuenta: row.cuenta, debito: decimal(0), credito: decimal(0) };
      x.debito = x.debito.plus(row.debito);
      x.credito = x.credito.plus(row.credito);
      map.set(row.cuentaId, x);
    }

    const detalles = [];
    let closingDebit = decimal(0);
    let closingCredit = decimal(0);
    for (const x of map.values()) {
      const saldo = x.cuenta.naturaleza === 'DEBITO' ? money(x.debito.minus(x.credito)) : money(x.credito.minus(x.debito));
      if (saldo.eq(0)) continue;
      if (x.cuenta.naturaleza === 'DEBITO') {
        if (saldo.gt(0)) { detalles.push({ cuentaId: x.cuenta.id, debito: 0, credito: saldo, concepto: 'Cierre de cuenta de resultado' }); closingCredit = closingCredit.plus(saldo); }
        else { const v = saldo.abs(); detalles.push({ cuentaId: x.cuenta.id, debito: v, credito: 0, concepto: 'Cierre de saldo contrario' }); closingDebit = closingDebit.plus(v); }
      } else {
        if (saldo.gt(0)) { detalles.push({ cuentaId: x.cuenta.id, debito: saldo, credito: 0, concepto: 'Cierre de cuenta de resultado' }); closingDebit = closingDebit.plus(saldo); }
        else { const v = saldo.abs(); detalles.push({ cuentaId: x.cuenta.id, debito: 0, credito: v, concepto: 'Cierre de saldo contrario' }); closingCredit = closingCredit.plus(v); }
      }
    }

    let closingJournal = null;
    const net = money(closingDebit.minus(closingCredit));
    if (detalles.length && !net.eq(0)) {
      if (net.gt(0)) {
        if (!config?.cuentaUtilidadEjercicioId) throw new AppError(409, 'Configure la cuenta de Utilidad del Ejercicio', 'ACCOUNTING_PROFIT_ACCOUNT_REQUIRED');
        detalles.push({ cuentaId: config.cuentaUtilidadEjercicioId, debito: 0, credito: net, concepto: 'Traslado de utilidad del periodo' });
      } else {
        if (!config?.cuentaPerdidaEjercicioId) throw new AppError(409, 'Configure la cuenta de Pérdida del Ejercicio', 'ACCOUNTING_LOSS_ACCOUNT_REQUIRED');
        detalles.push({ cuentaId: config.cuentaPerdidaEjercicioId, debito: net.abs(), credito: 0, concepto: 'Traslado de pérdida del periodo' });
      }
    }

    if (detalles.length) {
      closingJournal = await accounting.createJournalInTx(tx, {
        tenantId,
        userId,
        fecha: end,
        concepto: `Cierre contable ${anio}-${String(mes).padStart(2, '0')}`,
        origen: 'CIERRE',
        codigoTipo: 'CC',
        sourceId: `CLOSE-${tenantId}-${anio}-${mes}`,
        detalles
      });
    }

    period = await tx.periodoContable.update({
      where: { id: period.id },
      data: {
        estado: 'CERRADO',
        cerradoEn: new Date(),
        cerradoPorId: userId,
        reabiertoEn: null,
        reabiertoPorId: null,
        asientoCierreId: closingJournal?.id || null
      }
    });
    await auditInTx(tx, { tenantId, userId, entidad: 'PERIODO', entidadId: period.id, accion: 'CERRAR', metadata: { anio, mes, asientoCierreId: closingJournal?.id || null } });
    return { periodo: period, asientoCierre: closingJournal };
  }, { timeout: 30000 });
}

async function reopenPeriod(tenantId, userId, userRole, anio, mes) {
  if (userRole !== 'ADMIN') throw new AppError(403, 'Solo un administrador puede reabrir periodos', 'ACCOUNTING_REOPEN_ADMIN_ONLY');
  return prisma.$transaction(async (tx) => {
    let period = await tx.periodoContable.findUnique({ where: { tenantId_anio_mes: { tenantId, anio, mes } } });
    if (!period || period.estado !== 'CERRADO') throw new AppError(409, 'El periodo no está cerrado', 'ACCOUNTING_PERIOD_NOT_CLOSED');
    const closingId = period.asientoCierreId;
    period = await tx.periodoContable.update({
      where: { id: period.id },
      data: { estado: 'ABIERTO', reabiertoEn: new Date(), reabiertoPorId: userId, asientoCierreId: null }
    });
    let reversal = null;
    if (closingId) {
      const { end } = periodBounds(anio, mes);
      reversal = await accounting.reverseJournalInTx(tx, {
        tenantId,
        userId,
        asiento: closingId,
        fecha: end,
        concepto: `Reapertura ${anio}-${String(mes).padStart(2, '0')} — reversión del cierre`,
        sourceId: `REOPEN-${tenantId}-${anio}-${mes}-${Date.now()}`,
        motivo: 'Reapertura de periodo'
      });
    }
    await auditInTx(tx, { tenantId, userId, entidad: 'PERIODO', entidadId: period.id, accion: 'REABRIR', metadata: { anio, mes, reversoCierreId: reversal?.id || null } });
    return { periodo: period, reversoCierre: reversal };
  }, { timeout: 30000 });
}

module.exports = {
  periodBounds,
  listPeriods,
  getConfig,
  updateConfig,
  closePeriod,
  reopenPeriod
};
