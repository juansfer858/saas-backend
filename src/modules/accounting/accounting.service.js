const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money } = require('../../utils/decimal');
const { validateJournalLines } = require('../../middleware/partida-doble-middleware');

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const raw = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) throw new AppError(400, 'Fecha contable inválida', 'ACCOUNTING_DATE_INVALID');
  return date;
}

function buildDateRange(desde, hasta) {
  const range = {};
  const start = parseDate(desde, false);
  const end = parseDate(hasta, true);
  if (start) range.gte = start;
  if (end) range.lte = end;
  return Object.keys(range).length ? range : undefined;
}

function toNumber(value) {
  return Number(value || 0);
}

async function createAccount(tenantId, input) {
  let parent = null;
  if (input.parentId) {
    parent = await prisma.cuentaPUC.findFirst({ where: { id: input.parentId, tenantId, activa: true } });
    if (!parent) throw new AppError(400, 'Cuenta padre inválida', 'ACCOUNT_PARENT_INVALID');
  }

  try {
    return await prisma.cuentaPUC.create({
      data: {
        tenantId,
        ...input,
        versionCatalogo: 'CUSTOM',
        codigoReferencia: null
      },
      include: { parent: { select: { id: true, codigo: true, nombre: true } } }
    });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'El código PUC ya existe', 'ACCOUNT_CODE_EXISTS');
    throw error;
  }
}

async function listAccounts(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.activa !== undefined) where.activa = filters.activa;
  if (filters.nivel) where.nivel = filters.nivel;
  if (filters.movimiento === true) where.permiteMovimiento = true;
  if (filters.q) {
    where.OR = [
      { codigo: { contains: filters.q, mode: 'insensitive' } },
      { nombre: { contains: filters.q, mode: 'insensitive' } }
    ];
  }

  return prisma.cuentaPUC.findMany({
    where,
    include: { parent: { select: { id: true, codigo: true, nombre: true } } },
    orderBy: { codigo: 'asc' },
    take: Math.min(Number(filters.limit) || 500, 2000)
  });
}

async function getMappedAccount(tx, tenantId, clave) {
  const mapping = await tx.mapeoContable.findFirst({
    where: { tenantId, clave },
    include: { cuenta: true }
  });

  if (!mapping || !mapping.cuenta.activa || !mapping.cuenta.permiteMovimiento) {
    throw new AppError(500, `Mapeo contable faltante: ${clave}`, 'ACCOUNTING_MAPPING_MISSING', { clave });
  }

  return mapping.cuenta;
}

async function validateTenantReferences(tx, tenantId, detalles) {
  const accountIds = [...new Set(detalles.map((line) => line.cuentaId))];
  const thirdPartyIds = [...new Set(detalles.map((line) => line.terceroId).filter(Boolean))];

  const accounts = await tx.cuentaPUC.findMany({
    where: { tenantId, id: { in: accountIds }, activa: true, permiteMovimiento: true },
    select: { id: true, requiereTercero: true }
  });

  if (accounts.length !== accountIds.length) {
    throw new AppError(400, 'Una o más cuentas no pertenecen al tenant o no aceptan movimientos', 'ACCOUNTING_ACCOUNT_INVALID');
  }

  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  for (const line of detalles) {
    if (accountsById.get(line.cuentaId)?.requiereTercero && !line.terceroId) {
      throw new AppError(400, 'La cuenta exige tercero', 'ACCOUNTING_THIRD_PARTY_REQUIRED', {
        cuentaId: line.cuentaId
      });
    }
  }

  if (thirdPartyIds.length) {
    const thirdParties = await tx.tercero.findMany({
      where: { tenantId, id: { in: thirdPartyIds } },
      select: { id: true }
    });
    if (thirdParties.length !== thirdPartyIds.length) {
      throw new AppError(400, 'Uno o más terceros no pertenecen al tenant', 'ACCOUNTING_THIRD_PARTY_INVALID');
    }
  }
}

async function resolveOpenPeriod(tx, tenantId, date) {
  const accountingDate = new Date(date || Date.now());
  const anio = accountingDate.getUTCFullYear();
  const mes = accountingDate.getUTCMonth() + 1;

  const period = await tx.periodoContable.upsert({
    where: { tenantId_anio_mes: { tenantId, anio, mes } },
    create: { tenantId, anio, mes, estado: 'ABIERTO' },
    update: {}
  });

  if (period.estado === 'CERRADO') {
    throw new AppError(409, 'El periodo contable está cerrado', 'ACCOUNTING_PERIOD_CLOSED', { anio, mes });
  }

  return period;
}

async function createJournalInTx(tx, params) {
  const balance = validateJournalLines(params.detalles);
  await validateTenantReferences(tx, params.tenantId, params.detalles);
  const fecha = params.fecha || new Date();
  const period = await resolveOpenPeriod(tx, params.tenantId, fecha);

  if (params.sourceId) {
    const existing = await tx.asientoContable.findFirst({
      where: { tenantId: params.tenantId, sourceId: params.sourceId },
      include: {
        detalles: {
          include: {
            cuenta: { select: { id: true, codigo: true, nombre: true } },
            tercero: { select: { id: true, identificacion: true, nombre: true } }
          }
        }
      }
    });
    if (existing) return existing;
  }

  const journal = await tx.asientoContable.create({
    data: {
      tenantId: params.tenantId,
      comprobanteId: params.comprobanteId || null,
      periodoId: period.id,
      reversoDeId: params.reversoDeId || null,
      creadoPorId: params.userId,
      sourceId: params.sourceId || null,
      fecha,
      concepto: params.concepto,
      referencia: params.referencia || null,
      origen: params.origen || 'AUTOMATICO',
      estado: params.estado || 'CONTABILIZADO',
      totalDebito: balance.totalDebito,
      totalCredito: balance.totalCredito
    }
  });

  await tx.detalleAsiento.createMany({
    data: params.detalles.map((line) => ({
      tenantId: params.tenantId,
      asientoId: journal.id,
      cuentaId: line.cuentaId,
      terceroId: line.terceroId || null,
      concepto: line.concepto || null,
      debito: money(line.debito || 0),
      credito: money(line.credito || 0)
    }))
  });

  return tx.asientoContable.findUnique({
    where: { id: journal.id },
    include: {
      detalles: {
        include: {
          cuenta: { select: { id: true, codigo: true, nombre: true } },
          tercero: { select: { id: true, identificacion: true, nombre: true } }
        }
      }
    }
  });
}

async function reverseJournalInTx(tx, params) {
  const original = typeof params.asiento === 'string'
    ? await tx.asientoContable.findFirst({
      where: { id: params.asiento, tenantId: params.tenantId },
      include: { detalles: true }
    })
    : params.asiento;

  if (!original || original.tenantId !== params.tenantId) {
    throw new AppError(404, 'Asiento original no encontrado', 'ACCOUNTING_JOURNAL_NOT_FOUND');
  }

  const existing = await tx.asientoContable.findFirst({
    where: { tenantId: params.tenantId, reversoDeId: original.id, estado: 'CONTABILIZADO' }
  });
  if (existing) throw new AppError(409, 'El asiento ya fue reversado', 'ACCOUNTING_ALREADY_REVERSED');

  const reversed = await createJournalInTx(tx, {
    tenantId: params.tenantId,
    userId: params.userId,
    comprobanteId: params.comprobanteId || null,
    fecha: params.fecha || new Date(),
    concepto: params.concepto || `Reverso: ${original.concepto}`,
    referencia: params.referencia || `REV-${original.referencia || original.id}`,
    origen: 'REVERSO',
    reversoDeId: original.id,
    sourceId: params.sourceId || `REV-${original.id}`,
    detalles: original.detalles.map((line) => ({
      cuentaId: line.cuentaId,
      terceroId: line.terceroId,
      concepto: `Reverso ${line.concepto || original.concepto}`,
      debito: line.credito,
      credito: line.debito
    }))
  });

  await tx.asientoContable.update({
    where: { id: original.id },
    data: { estado: 'ANULADO' }
  });

  return reversed;
}

async function createManualJournal(tenantId, userId, input) {
  return prisma.$transaction((tx) => createJournalInTx(tx, {
    tenantId,
    userId,
    fecha: input.fecha,
    concepto: input.concepto,
    referencia: input.referencia,
    origen: 'MANUAL',
    detalles: input.detalles
  }));
}

async function listJournals(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.estado) where.estado = filters.estado;
  if (filters.origen) where.origen = filters.origen;
  const fecha = buildDateRange(filters.desde, filters.hasta);
  if (fecha) where.fecha = fecha;
  if (filters.q) {
    where.OR = [
      { concepto: { contains: filters.q, mode: 'insensitive' } },
      { referencia: { contains: filters.q, mode: 'insensitive' } }
    ];
  }

  const page = Math.max(Number(filters.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(filters.pageSize || filters.limit) || 100, 1), 500);
  const [items, total] = await Promise.all([
    prisma.asientoContable.findMany({
      where,
      include: {
        comprobante: { select: { id: true, tipo: true, numero: true, estado: true } },
        creadoPor: { select: { id: true, nombre: true, email: true } },
        detalles: {
          include: {
            cuenta: { select: { id: true, codigo: true, nombre: true } },
            tercero: { select: { id: true, identificacion: true, nombre: true } }
          },
          orderBy: { creadoEn: 'asc' }
        }
      },
      orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.asientoContable.count({ where })
  ]);

  return {
    items,
    meta: { page, pageSize, total, pages: Math.max(Math.ceil(total / pageSize), 1) }
  };
}

async function getJournal(tenantId, id) {
  const journal = await prisma.asientoContable.findFirst({
    where: { id, tenantId },
    include: {
      comprobante: { select: { id: true, tipo: true, numero: true, estado: true, total: true } },
      periodo: true,
      reversoDe: { select: { id: true, referencia: true, concepto: true } },
      creadoPor: { select: { id: true, nombre: true, email: true } },
      detalles: {
        include: {
          cuenta: { select: { id: true, codigo: true, nombre: true, naturaleza: true } },
          tercero: { select: { id: true, identificacion: true, nombre: true } }
        },
        orderBy: { creadoEn: 'asc' }
      }
    }
  });
  if (!journal) throw new AppError(404, 'Asiento contable no encontrado', 'ACCOUNTING_JOURNAL_NOT_FOUND');
  return journal;
}

async function getLedger(tenantId, filters = {}) {
  if (!filters.cuentaId) throw new AppError(400, 'Debe seleccionar una cuenta', 'ACCOUNTING_LEDGER_ACCOUNT_REQUIRED');
  const account = await prisma.cuentaPUC.findFirst({ where: { id: filters.cuentaId, tenantId, activa: true } });
  if (!account) throw new AppError(404, 'Cuenta contable no encontrada', 'ACCOUNTING_ACCOUNT_NOT_FOUND');

  const range = buildDateRange(filters.desde, filters.hasta);
  let opening = decimal(0);
  const start = parseDate(filters.desde, false);
  if (start) {
    const previous = await prisma.detalleAsiento.findMany({
      where: {
        tenantId,
        cuentaId: account.id,
        asiento: { estado: 'CONTABILIZADO', fecha: { lt: start } }
      },
      select: { debito: true, credito: true }
    });
    for (const line of previous) {
      opening = account.naturaleza === 'DEBITO'
        ? opening.plus(line.debito).minus(line.credito)
        : opening.plus(line.credito).minus(line.debito);
    }
  }

  const where = {
    tenantId,
    cuentaId: account.id,
    asiento: { estado: 'CONTABILIZADO' }
  };
  if (range) where.asiento.fecha = range;

  const details = await prisma.detalleAsiento.findMany({
    where,
    include: {
      asiento: { select: { id: true, fecha: true, referencia: true, concepto: true, origen: true } },
      tercero: { select: { id: true, identificacion: true, nombre: true } }
    },
    orderBy: [{ asiento: { fecha: 'asc' } }, { creadoEn: 'asc' }],
    take: Math.min(Number(filters.limit) || 5000, 10000)
  });

  let running = money(opening);
  const movimientos = details.map((line) => {
    running = account.naturaleza === 'DEBITO'
      ? money(running.plus(line.debito).minus(line.credito))
      : money(running.plus(line.credito).minus(line.debito));
    return {
      id: line.id,
      asientoId: line.asiento.id,
      fecha: line.asiento.fecha,
      referencia: line.asiento.referencia,
      concepto: line.concepto || line.asiento.concepto,
      origen: line.asiento.origen,
      tercero: line.tercero,
      debito: line.debito,
      credito: line.credito,
      saldo: running
    };
  });

  return {
    cuenta: { id: account.id, codigo: account.codigo, nombre: account.nombre, naturaleza: account.naturaleza },
    saldoInicial: money(opening),
    saldoFinal: running,
    movimientos
  };
}

async function getTrialBalance(tenantId, filters = {}) {
  const range = buildDateRange(filters.desde, filters.hasta);
  const asiento = { estado: 'CONTABILIZADO' };
  if (range) asiento.fecha = range;

  const details = await prisma.detalleAsiento.findMany({
    where: { tenantId, asiento },
    include: { cuenta: { select: { id: true, codigo: true, nombre: true, naturaleza: true } } }
  });

  const map = new Map();
  for (const line of details) {
    const key = line.cuentaId;
    const current = map.get(key) || {
      cuentaId: key,
      codigo: line.cuenta.codigo,
      nombre: line.cuenta.nombre,
      naturaleza: line.cuenta.naturaleza,
      debitos: decimal(0),
      creditos: decimal(0)
    };
    current.debitos = current.debitos.plus(line.debito);
    current.creditos = current.creditos.plus(line.credito);
    map.set(key, current);
  }

  const rows = [...map.values()].map((row) => {
    const diff = money(row.debitos.minus(row.creditos));
    return {
      cuentaId: row.cuentaId,
      codigo: row.codigo,
      nombre: row.nombre,
      naturaleza: row.naturaleza,
      debitos: money(row.debitos),
      creditos: money(row.creditos),
      saldoDebito: diff.gt(0) ? diff : money(0),
      saldoCredito: diff.lt(0) ? money(diff.abs()) : money(0)
    };
  }).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));

  const totals = rows.reduce((acc, row) => ({
    debitos: money(acc.debitos.plus(row.debitos)),
    creditos: money(acc.creditos.plus(row.creditos)),
    saldoDebito: money(acc.saldoDebito.plus(row.saldoDebito)),
    saldoCredito: money(acc.saldoCredito.plus(row.saldoCredito))
  }), { debitos: decimal(0), creditos: decimal(0), saldoDebito: decimal(0), saldoCredito: decimal(0) });

  return {
    desde: filters.desde || null,
    hasta: filters.hasta || null,
    balanceado: money(totals.debitos).eq(money(totals.creditos)),
    rows,
    totals
  };
}

async function getProfitAndLoss(tenantId, filters = {}) {
  const range = buildDateRange(filters.desde, filters.hasta);
  const asiento = { estado: 'CONTABILIZADO' };
  if (range) asiento.fecha = range;

  const details = await prisma.detalleAsiento.findMany({
    where: { tenantId, asiento },
    include: { cuenta: { select: { id: true, codigo: true, nombre: true } } }
  });

  const groups = {
    ingresos: new Map(),
    gastos: new Map(),
    costos: new Map()
  };

  for (const line of details) {
    const code = line.cuenta.codigo;
    let target = null;
    let amount = decimal(0);
    if (code.startsWith('4')) {
      target = groups.ingresos;
      amount = decimal(line.credito).minus(line.debito);
    } else if (code.startsWith('5')) {
      target = groups.gastos;
      amount = decimal(line.debito).minus(line.credito);
    } else if (code.startsWith('6')) {
      target = groups.costos;
      amount = decimal(line.debito).minus(line.credito);
    }
    if (!target) continue;
    const current = target.get(line.cuentaId) || {
      cuentaId: line.cuentaId,
      codigo: code,
      nombre: line.cuenta.nombre,
      valor: decimal(0)
    };
    current.valor = current.valor.plus(amount);
    target.set(line.cuentaId, current);
  }

  const serialize = (map) => [...map.values()]
    .map((row) => ({ ...row, valor: money(row.valor) }))
    .filter((row) => toNumber(row.valor) !== 0)
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));

  const ingresos = serialize(groups.ingresos);
  const gastos = serialize(groups.gastos);
  const costos = serialize(groups.costos);
  const sum = (rows) => money(rows.reduce((acc, row) => acc.plus(row.valor), decimal(0)));
  const totalIngresos = sum(ingresos);
  const totalGastos = sum(gastos);
  const totalCostos = sum(costos);
  const utilidad = money(totalIngresos.minus(totalGastos).minus(totalCostos));

  return {
    desde: filters.desde || null,
    hasta: filters.hasta || null,
    ingresos,
    gastos,
    costos,
    totales: { totalIngresos, totalGastos, totalCostos, utilidad }
  };
}

module.exports = {
  createAccount,
  listAccounts,
  getMappedAccount,
  resolveOpenPeriod,
  createJournalInTx,
  reverseJournalInTx,
  createManualJournal,
  listJournals,
  getJournal,
  getLedger,
  getTrialBalance,
  getProfitAndLoss
};
