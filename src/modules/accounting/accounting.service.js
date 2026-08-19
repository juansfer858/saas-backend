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
    select: { id: true }
  });

  if (accounts.length !== accountIds.length) {
    throw new AppError(400, 'Una o más cuentas no pertenecen al tenant o no aceptan movimientos', 'ACCOUNTING_ACCOUNT_INVALID');
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

async function createJournalInTx(tx, params) {
  const balance = validateJournalLines(params.detalles);
  await validateTenantReferences(tx, params.tenantId, params.detalles);

  const journal = await tx.asientoContable.create({
    data: {
      tenantId: params.tenantId,
      comprobanteId: params.comprobanteId || null,
      creadoPorId: params.userId,
      fecha: params.fecha || new Date(),
      concepto: params.concepto,
      referencia: params.referencia || null,
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

async function createManualJournal(tenantId, userId, input) {
  return prisma.$transaction((tx) => createJournalInTx(tx, {
    tenantId,
    userId,
    fecha: input.fecha,
    concepto: input.concepto,
    referencia: input.referencia,
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
  createJournalInTx,
  createManualJournal,
  listJournals
};
