const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money, decimal } = require('../../utils/decimal');
const { auditInTx } = require('./accounting-audit.service');

async function listReconciliations(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.cajaBancoId) where.cajaBancoId = filters.cajaBancoId;
  if (filters.estado) where.estado = filters.estado;
  return prisma.conciliacionBancaria.findMany({
    where,
    include: {
      cajaBanco: { select: { id: true, nombre: true, banco: true, numeroCuenta: true, saldoActual: true } },
      creadoPor: { select: { id: true, nombre: true, email: true } },
      partidas: { orderBy: [{ fecha: 'asc' }, { creadoEn: 'asc' }] }
    },
    orderBy: { fechaCorte: 'desc' },
    take: 200
  });
}

async function createReconciliation(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    const bank = await tx.cajaBanco.findFirst({ where: { id: input.cajaBancoId, tenantId, tipo: 'BANCO', activo: true } });
    if (!bank) throw new AppError(400, 'La conciliación requiere una cuenta bancaria activa', 'BANK_RECONCILIATION_ACCOUNT_INVALID');
    let rec;
    try {
      rec = await tx.conciliacionBancaria.create({
        data: { tenantId, cajaBancoId: bank.id, creadoPorId: userId, fechaCorte: input.fechaCorte, saldoExtracto: input.saldoExtracto, estado: 'BORRADOR' }
      });
    } catch (error) {
      if (error?.code === 'P2002') throw new AppError(409, 'Ya existe una conciliación para esa cuenta y fecha de corte', 'BANK_RECONCILIATION_EXISTS');
      throw error;
    }
    if (Array.isArray(input.partidas) && input.partidas.length) {
      await tx.partidaExtractoBancario.createMany({
        data: input.partidas.map((p) => ({
          tenantId,
          conciliacionId: rec.id,
          fecha: p.fecha,
          descripcion: p.descripcion,
          referencia: p.referencia || null,
          tipo: p.tipo,
          valor: p.valor,
          estado: 'PENDIENTE'
        }))
      });
    }
    await auditInTx(tx, { tenantId, userId, entidad: 'CONCILIACION', entidadId: rec.id, accion: 'CREAR', metadata: { cajaBancoId: bank.id, fechaCorte: rec.fechaCorte.toISOString() } });
    return tx.conciliacionBancaria.findUnique({ where: { id: rec.id }, include: { partidas: true, cajaBanco: true } });
  });
}

async function matchEntry(tenantId, userId, reconciliationId, entryId, movementId) {
  return prisma.$transaction(async (tx) => {
    const rec = await tx.conciliacionBancaria.findFirst({ where: { id: reconciliationId, tenantId, estado: 'BORRADOR' } });
    if (!rec) throw new AppError(404, 'Conciliación abierta no encontrada', 'BANK_RECONCILIATION_NOT_FOUND');
    const entry = await tx.partidaExtractoBancario.findFirst({ where: { id: entryId, tenantId, conciliacionId: rec.id } });
    if (!entry) throw new AppError(404, 'Partida de extracto no encontrada', 'BANK_STATEMENT_ENTRY_NOT_FOUND');
    if (!movementId) {
      const updated = await tx.partidaExtractoBancario.update({ where: { id: entry.id }, data: { movimientoTesoreriaId: null, estado: 'PENDIENTE' } });
      await auditInTx(tx, { tenantId, userId, entidad: 'CONCILIACION', entidadId: rec.id, accion: 'DESCONCILIAR_PARTIDA', metadata: { partidaId: entry.id } });
      return updated;
    }
    const movement = await tx.movimientoTesoreria.findFirst({ where: { id: movementId, tenantId, cajaBancoId: rec.cajaBancoId } });
    if (!movement) throw new AppError(400, 'Movimiento de tesorería inválido para esta conciliación', 'BANK_MOVEMENT_INVALID');
    const updated = await tx.partidaExtractoBancario.update({ where: { id: entry.id }, data: { movimientoTesoreriaId: movement.id, estado: 'CONCILIADA' } });
    await auditInTx(tx, { tenantId, userId, entidad: 'CONCILIACION', entidadId: rec.id, accion: 'CONCILIAR_PARTIDA', metadata: { partidaId: entry.id, movimientoTesoreriaId: movement.id } });
    return updated;
  });
}

async function candidateMovements(tenantId, reconciliationId) {
  const rec = await prisma.conciliacionBancaria.findFirst({ where: { id: reconciliationId, tenantId } });
  if (!rec) throw new AppError(404, 'Conciliación no encontrada', 'BANK_RECONCILIATION_NOT_FOUND');
  return prisma.movimientoTesoreria.findMany({
    where: { tenantId, cajaBancoId: rec.cajaBancoId, creadoEn: { lte: rec.fechaCorte } },
    orderBy: { creadoEn: 'desc' },
    take: 1000
  });
}

async function closeReconciliation(tenantId, userId, id) {
  return prisma.$transaction(async (tx) => {
    const rec = await tx.conciliacionBancaria.findFirst({ where: { id, tenantId, estado: 'BORRADOR' }, include: { partidas: true, cajaBanco: true } });
    if (!rec) throw new AppError(404, 'Conciliación abierta no encontrada', 'BANK_RECONCILIATION_NOT_FOUND');
    const matched = rec.partidas.filter((p) => p.estado === 'CONCILIADA');
    const pending = rec.partidas.filter((p) => p.estado === 'PENDIENTE');
    const debit = matched.filter((p) => p.tipo === 'DEBITO').reduce((a, p) => a.plus(p.valor), decimal(0));
    const credit = matched.filter((p) => p.tipo === 'CREDITO').reduce((a, p) => a.plus(p.valor), decimal(0));
    const movimientoConciliado = money(debit.minus(credit));
    const updated = await tx.conciliacionBancaria.update({ where: { id }, data: { estado: 'CERRADA', cerradoEn: new Date() } });
    await auditInTx(tx, { tenantId, userId, entidad: 'CONCILIACION', entidadId: id, accion: 'CERRAR', metadata: { conciliadas: matched.length, pendientes: pending.length, movimientoConciliado: movimientoConciliado.toString() } });
    return { conciliacion: updated, conciliadas: matched.length, pendientes: pending.length, movimientoConciliado, saldoExtracto: rec.saldoExtracto, saldoLibro: rec.cajaBanco.saldoActual, diferencia: money(decimal(rec.saldoExtracto).minus(rec.cajaBanco.saldoActual)) };
  });
}

module.exports = { listReconciliations, createReconciliation, matchEntry, candidateMovements, closeReconciliation };
