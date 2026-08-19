const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money } = require('../../utils/decimal');
const { validateJournalLines } = require('../../middleware/partida-doble-middleware');

async function createAccount(tenantId, input) {
  if (input.parentId) {
    const parent = await prisma.cuentaPUC.findFirst({ where: { id: input.parentId, tenantId } });
    if (!parent) throw new AppError(400, 'Cuenta padre inválida', 'ACCOUNT_PARENT_INVALID');
  }

  try {
    return await prisma.cuentaPUC.create({ data: { tenantId, ...input } });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'El código PUC ya existe', 'ACCOUNT_CODE_EXISTS');
    throw error;
  }
}

async function listAccounts(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.activa !== undefined) where.activa = filters.activa;
  if (filters.nivel) where.nivel = filters.nivel;
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

  return prisma.asientoContable.findMany({
    where,
    include: {
      detalles: {
        include: { cuenta: { select: { codigo: true, nombre: true } } }
      }
    },
    orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
    take: Math.min(Number(filters.limit) || 100, 500)
  });
}

module.exports = {
  createAccount,
  listAccounts,
  getMappedAccount,
  resolveOpenPeriod,
  createJournalInTx,
  reverseJournalInTx,
  createManualJournal,
  listJournals
};
