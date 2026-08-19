const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money } = require('../../utils/decimal');
const { validateJournalLines } = require('../../middleware/partida-doble-middleware');
const numbering = require('./accounting-numbering.service');
const reporting = require('./accounting-reporting.service');
const { auditInTx, listAudit } = require('./accounting-audit.service');

function parseDate(value, endOfDay = false) {
  return reporting.parseDate(value, endOfDay);
}

function buildDateRange(desde, hasta) {
  return reporting.rangeWhere(desde, hasta);
}

async function createAccount(tenantId, input, userId = null) {
  let parent = null;
  if (input.parentId) {
    parent = await prisma.cuentaPUC.findFirst({ where: { id: input.parentId, tenantId, activa: true } });
    if (!parent) throw new AppError(400, 'Cuenta padre inválida', 'ACCOUNT_PARENT_INVALID');
  }
  return prisma.$transaction(async (tx) => {
    try {
      const account = await tx.cuentaPUC.create({
        data: {
          tenantId,
          ...input,
          versionCatalogo: 'CUSTOM',
          codigoReferencia: null
        },
        include: { parent: { select: { id: true, codigo: true, nombre: true } } }
      });
      if (userId) await auditInTx(tx, { tenantId, userId, entidad: 'CUENTA', entidadId: account.id, accion: 'CREAR', metadata: { codigo: account.codigo, nombre: account.nombre } });
      return account;
    } catch (error) {
      if (error?.code === 'P2002') throw new AppError(409, 'El código PUC ya existe', 'ACCOUNT_CODE_EXISTS');
      throw error;
    }
  });
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
    take: Math.min(Number(filters.limit) || 500, 3000)
  });
}

async function getMappedAccount(tx, tenantId, clave) {
  const mapping = await tx.mapeoContable.findFirst({ where: { tenantId, clave }, include: { cuenta: true } });
  if (!mapping || !mapping.cuenta.activa || !mapping.cuenta.permiteMovimiento) {
    throw new AppError(500, `Mapeo contable faltante: ${clave}`, 'ACCOUNTING_MAPPING_MISSING', { clave });
  }
  return mapping.cuenta;
}

async function validateTenantReferences(tx, tenantId, detalles) {
  const accountIds = [...new Set(detalles.map((line) => line.cuentaId))];
  const thirdPartyIds = [...new Set(detalles.map((line) => line.terceroId).filter(Boolean))];
  const ivaIds = [...new Set(detalles.map((line) => line.tarifaIvaId).filter(Boolean))];
  const retentionIds = [...new Set(detalles.map((line) => line.conceptoRetencionId).filter(Boolean))];

  const accounts = await tx.cuentaPUC.findMany({
    where: { tenantId, id: { in: accountIds }, activa: true, permiteMovimiento: true },
    select: { id: true, requiereTercero: true }
  });
  if (accounts.length !== accountIds.length) throw new AppError(400, 'Una o más cuentas no pertenecen al tenant o no aceptan movimientos', 'ACCOUNTING_ACCOUNT_INVALID');

  const byId = new Map(accounts.map((x) => [x.id, x]));
  for (const line of detalles) {
    if (byId.get(line.cuentaId)?.requiereTercero && !line.terceroId) {
      throw new AppError(400, 'La cuenta exige tercero', 'ACCOUNTING_THIRD_PARTY_REQUIRED', { cuentaId: line.cuentaId });
    }
  }

  if (thirdPartyIds.length) {
    const found = await tx.tercero.count({ where: { tenantId, id: { in: thirdPartyIds }, activo: true } });
    if (found !== thirdPartyIds.length) throw new AppError(400, 'Uno o más terceros no pertenecen al tenant', 'ACCOUNTING_THIRD_PARTY_INVALID');
  }
  if (ivaIds.length) {
    const found = await tx.tarifaIVA.count({ where: { tenantId, id: { in: ivaIds }, activa: true } });
    if (found !== ivaIds.length) throw new AppError(400, 'Tarifa IVA inválida', 'ACCOUNTING_VAT_INVALID');
  }
  if (retentionIds.length) {
    const found = await tx.conceptoRetencion.count({ where: { tenantId, id: { in: retentionIds }, activo: true } });
    if (found !== retentionIds.length) throw new AppError(400, 'Concepto de retención inválido', 'ACCOUNTING_RETENTION_INVALID');
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
  if (period.estado === 'CERRADO') throw new AppError(409, 'El periodo contable está cerrado', 'ACCOUNTING_PERIOD_CLOSED', { anio, mes });
  return period;
}

function defaultVoucherCode(origin) {
  if (origin === 'MANUAL') return 'CA';
  if (origin === 'REVERSO') return 'RV';
  if (origin === 'CIERRE') return 'CC';
  if (origin === 'DEPRECIACION') return 'DP';
  return 'AU';
}

async function findJournal(tx, tenantId, id) {
  return tx.asientoContable.findFirst({
    where: { id, tenantId },
    include: {
      tipoComprobante: true,
      detalles: {
        include: {
          cuenta: { select: { id: true, codigo: true, nombre: true, naturaleza: true } },
          tercero: { select: { id: true, identificacion: true, nombre: true } },
          tarifaIva: true,
          conceptoRetencion: true
        },
        orderBy: { creadoEn: 'asc' }
      }
    }
  });
}

async function createJournalInTx(tx, params) {
  if (params.sourceId) {
    const existing = await tx.asientoContable.findFirst({ where: { tenantId: params.tenantId, sourceId: params.sourceId } });
    if (existing) return findJournal(tx, params.tenantId, existing.id);
  }

  const balance = validateJournalLines(params.detalles);
  await validateTenantReferences(tx, params.tenantId, params.detalles);
  const fecha = params.fecha || new Date();
  const period = await resolveOpenPeriod(tx, params.tenantId, fecha);
  const origin = params.origen || 'AUTOMATICO';
  const type = await numbering.resolveVoucherType(tx, params.tenantId, {
    tipoComprobanteId: params.tipoComprobanteId,
    codigoTipo: params.codigoTipo || defaultVoucherCode(origin)
  });
  const sequence = await numbering.assignConsecutiveInTx(tx, params.tenantId, type, fecha);

  const journal = await tx.asientoContable.create({
    data: {
      tenantId: params.tenantId,
      comprobanteId: params.comprobanteId || null,
      periodoId: period.id,
      reversoDeId: params.reversoDeId || null,
      creadoPorId: params.userId,
      sourceId: params.sourceId || null,
      ...sequence,
      fecha,
      concepto: params.concepto,
      referencia: params.referencia || null,
      origen: origin,
      estado: 'CONTABILIZADO',
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
      tarifaIvaId: line.tarifaIvaId || null,
      conceptoRetencionId: line.conceptoRetencionId || null,
      concepto: line.concepto || null,
      debito: money(line.debito || 0),
      credito: money(line.credito || 0)
    }))
  });

  if (params.userId) {
    await auditInTx(tx, {
      tenantId: params.tenantId,
      userId: params.userId,
      entidad: 'ASIENTO',
      entidadId: journal.id,
      accion: 'CONTABILIZAR',
      metadata: { numeroComprobante: sequence.numeroComprobante, origen: origin }
    });
  }
  return findJournal(tx, params.tenantId, journal.id);
}

async function createDraftManualJournal(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    const balance = validateJournalLines(input.detalles);
    await validateTenantReferences(tx, tenantId, input.detalles);
    const type = await numbering.resolveVoucherType(tx, tenantId, { tipoComprobanteId: input.tipoComprobanteId, codigoTipo: 'CA' });
    const journal = await tx.asientoContable.create({
      data: {
        tenantId,
        creadoPorId: userId,
        tipoComprobanteId: type.id,
        fecha: input.fecha || new Date(),
        concepto: input.concepto,
        referencia: input.referenciaExterna || null,
        origen: 'MANUAL',
        estado: 'BORRADOR',
        totalDebito: balance.totalDebito,
        totalCredito: balance.totalCredito
      }
    });
    await tx.detalleAsiento.createMany({
      data: input.detalles.map((line) => ({
        tenantId,
        asientoId: journal.id,
        cuentaId: line.cuentaId,
        terceroId: line.terceroId || null,
        tarifaIvaId: line.tarifaIvaId || null,
        conceptoRetencionId: line.conceptoRetencionId || null,
        concepto: line.concepto || null,
        debito: money(line.debito || 0),
        credito: money(line.credito || 0)
      }))
    });
    await auditInTx(tx, { tenantId, userId, entidad: 'ASIENTO', entidadId: journal.id, accion: 'CREAR_BORRADOR' });
    return findJournal(tx, tenantId, journal.id);
  });
}

async function postDraftJournal(tenantId, userId, id) {
  return prisma.$transaction(async (tx) => {
    const journal = await tx.asientoContable.findFirst({ where: { id, tenantId }, include: { detalles: true, tipoComprobante: true } });
    if (!journal) throw new AppError(404, 'Asiento no encontrado', 'ACCOUNTING_JOURNAL_NOT_FOUND');
    if (journal.estado !== 'BORRADOR') throw new AppError(409, 'Solo un borrador se puede contabilizar', 'ACCOUNTING_JOURNAL_NOT_DRAFT');
    const balance = validateJournalLines(journal.detalles);
    const period = await resolveOpenPeriod(tx, tenantId, journal.fecha);
    const type = journal.tipoComprobante || await numbering.resolveVoucherType(tx, tenantId, { codigoTipo: 'CA' });
    const sequence = await numbering.assignConsecutiveInTx(tx, tenantId, type, journal.fecha);
    await tx.asientoContable.update({
      where: { id },
      data: { periodoId: period.id, ...sequence, estado: 'CONTABILIZADO', totalDebito: balance.totalDebito, totalCredito: balance.totalCredito }
    });
    await auditInTx(tx, { tenantId, userId, entidad: 'ASIENTO', entidadId: id, accion: 'CONTABILIZAR', metadata: { numeroComprobante: sequence.numeroComprobante } });
    return findJournal(tx, tenantId, id);
  });
}

async function reverseJournalInTx(tx, params) {
  const original = typeof params.asiento === 'string'
    ? await tx.asientoContable.findFirst({ where: { id: params.asiento, tenantId: params.tenantId }, include: { detalles: true } })
    : params.asiento;
  if (!original || original.tenantId !== params.tenantId) throw new AppError(404, 'Asiento original no encontrado', 'ACCOUNTING_JOURNAL_NOT_FOUND');
  if (original.estado === 'BORRADOR') throw new AppError(409, 'Un borrador no se anula por reversión', 'ACCOUNTING_DRAFT_REVERSAL_INVALID');
  const existing = await tx.asientoContable.findFirst({ where: { tenantId: params.tenantId, reversoDeId: original.id, estado: 'CONTABILIZADO' } });
  if (existing) throw new AppError(409, 'El asiento ya fue reversado', 'ACCOUNTING_ALREADY_REVERSED');

  const reversed = await createJournalInTx(tx, {
    tenantId: params.tenantId,
    userId: params.userId,
    comprobanteId: params.comprobanteId || null,
    fecha: params.fecha || new Date(),
    concepto: params.concepto || `Reversión de ${original.numeroComprobante || original.referencia || original.id}`,
    referencia: params.referencia || original.numeroComprobante || original.referencia || null,
    origen: 'REVERSO',
    codigoTipo: 'RV',
    reversoDeId: original.id,
    sourceId: params.sourceId || `REV-${original.id}`,
    detalles: original.detalles.map((line) => ({
      cuentaId: line.cuentaId,
      terceroId: line.terceroId,
      tarifaIvaId: line.tarifaIvaId,
      conceptoRetencionId: line.conceptoRetencionId,
      concepto: `Reversión: ${line.concepto || original.concepto}`,
      debito: line.credito,
      credito: line.debito
    }))
  });
  await tx.asientoContable.update({ where: { id: original.id }, data: { estado: 'ANULADO' } });
  if (params.userId) await auditInTx(tx, { tenantId: params.tenantId, userId: params.userId, entidad: 'ASIENTO', entidadId: original.id, accion: 'ANULAR', metadata: { reversoId: reversed.id, motivo: params.motivo || null } });
  return reversed;
}

async function reverseJournal(tenantId, userId, id, motivo) {
  return prisma.$transaction((tx) => reverseJournalInTx(tx, { tenantId, userId, asiento: id, motivo }));
}

async function createManualJournal(tenantId, userId, input) {
  return prisma.$transaction((tx) => createJournalInTx(tx, {
    tenantId,
    userId,
    fecha: input.fecha,
    concepto: input.concepto,
    referencia: input.referenciaExterna || input.referencia || null,
    tipoComprobanteId: input.tipoComprobanteId,
    origen: 'MANUAL',
    detalles: input.detalles
  }));
}

async function listJournals(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.estado) where.estado = filters.estado;
  if (filters.origen) where.origen = filters.origen;
  if (filters.tipoComprobanteId) where.tipoComprobanteId = filters.tipoComprobanteId;
  const fecha = buildDateRange(filters.desde, filters.hasta);
  if (fecha) where.fecha = fecha;
  if (filters.q) where.OR = [
    { concepto: { contains: filters.q, mode: 'insensitive' } },
    { numeroComprobante: { contains: filters.q, mode: 'insensitive' } },
    { referencia: { contains: filters.q, mode: 'insensitive' } }
  ];
  const page = Math.max(Number(filters.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(filters.pageSize || filters.limit) || 100, 1), 500);
  const [items, total] = await Promise.all([
    prisma.asientoContable.findMany({
      where,
      include: {
        tipoComprobante: true,
        comprobante: { select: { id: true, tipo: true, numero: true, estado: true } },
        creadoPor: { select: { id: true, nombre: true, email: true } },
        reversoDe: { select: { id: true, numeroComprobante: true } }
      },
      orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.asientoContable.count({ where })
  ]);
  return { items, meta: { page, pageSize, total, pages: Math.max(Math.ceil(total / pageSize), 1) } };
}

async function getJournal(tenantId, id) {
  const journal = await prisma.asientoContable.findFirst({
    where: { id, tenantId },
    include: {
      tipoComprobante: true,
      comprobante: { select: { id: true, tipo: true, numero: true, estado: true, total: true } },
      periodo: true,
      reversoDe: { select: { id: true, numeroComprobante: true, referencia: true, concepto: true } },
      reversos: { select: { id: true, numeroComprobante: true, concepto: true, fecha: true } },
      creadoPor: { select: { id: true, nombre: true, email: true } },
      soportes: { select: { id: true, nombre: true, mimeType: true, tamano: true, hashSha256: true, creadoEn: true } },
      detalles: {
        include: {
          cuenta: { select: { id: true, codigo: true, nombre: true, naturaleza: true } },
          tercero: { select: { id: true, identificacion: true, nombre: true } },
          tarifaIva: { select: { id: true, codigo: true, nombre: true, porcentaje: true } },
          conceptoRetencion: { select: { id: true, codigo: true, nombre: true, tipo: true, porcentaje: true } }
        },
        orderBy: { creadoEn: 'asc' }
      }
    }
  });
  if (!journal) throw new AppError(404, 'Asiento contable no encontrado', 'ACCOUNTING_JOURNAL_NOT_FOUND');
  const auditoria = await listAudit(prisma, tenantId, 'ASIENTO', id);
  return { ...journal, auditoria };
}

async function getLedger(tenantId, filters = {}) {
  if (!filters.cuentaId) throw new AppError(400, 'Debe seleccionar una cuenta', 'ACCOUNTING_LEDGER_ACCOUNT_REQUIRED');
  const account = await prisma.cuentaPUC.findFirst({ where: { id: filters.cuentaId, tenantId, activa: true } });
  if (!account) throw new AppError(404, 'Cuenta contable no encontrada', 'ACCOUNTING_ACCOUNT_NOT_FOUND');
  const start = parseDate(filters.desde, false);
  let opening = decimal(0);
  if (start) {
    const previous = await prisma.detalleAsiento.findMany({
      where: { tenantId, cuentaId: account.id, asiento: { estado: { in: ['CONTABILIZADO', 'ANULADO'] }, fecha: { lt: start } } },
      select: { debito: true, credito: true }
    });
    for (const line of previous) opening = account.naturaleza === 'DEBITO' ? opening.plus(line.debito).minus(line.credito) : opening.plus(line.credito).minus(line.debito);
  }
  const asiento = { estado: { in: ['CONTABILIZADO', 'ANULADO'] } };
  const range = buildDateRange(filters.desde, filters.hasta);
  if (range) asiento.fecha = range;
  const details = await prisma.detalleAsiento.findMany({
    where: { tenantId, cuentaId: account.id, asiento },
    include: {
      asiento: { select: { id: true, fecha: true, numeroComprobante: true, referencia: true, concepto: true, origen: true, estado: true } },
      tercero: { select: { id: true, identificacion: true, nombre: true } }
    },
    orderBy: [{ asiento: { fecha: 'asc' } }, { creadoEn: 'asc' }],
    take: Math.min(Number(filters.limit) || 5000, 10000)
  });
  let running = money(opening);
  const movimientos = details.map((line) => {
    running = account.naturaleza === 'DEBITO' ? money(running.plus(line.debito).minus(line.credito)) : money(running.plus(line.credito).minus(line.debito));
    return {
      id: line.id,
      asientoId: line.asiento.id,
      fecha: line.asiento.fecha,
      numeroComprobante: line.asiento.numeroComprobante,
      referencia: line.asiento.referencia,
      concepto: line.concepto || line.asiento.concepto,
      origen: line.asiento.origen,
      estadoAsiento: line.asiento.estado,
      tercero: line.tercero,
      debito: line.debito,
      credito: line.credito,
      saldo: running
    };
  });
  return { cuenta: account, saldoInicial: money(opening), movimientos, saldoFinal: running };
}

async function getTrialBalance(tenantId, filters = {}) { return reporting.trialBalance(tenantId, filters); }
async function getProfitAndLoss(tenantId, filters = {}) { return reporting.profitAndLoss(tenantId, filters); }
async function getBalanceSheet(tenantId, filters = {}) { return reporting.balanceSheet(tenantId, filters); }

module.exports = {
  createAccount,
  listAccounts,
  getMappedAccount,
  validateTenantReferences,
  resolveOpenPeriod,
  createJournalInTx,
  reverseJournalInTx,
  reverseJournal,
  createManualJournal,
  createDraftManualJournal,
  postDraftJournal,
  listJournals,
  getJournal,
  getLedger,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  parseDate,
  buildDateRange
};
