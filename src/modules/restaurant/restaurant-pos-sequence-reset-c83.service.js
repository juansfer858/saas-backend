'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const posNumber = require('./restaurant-pos-number.service');
const testReset = require('./restaurant-test-data-reset-v68.service');

const MARKER = 'VANTIX_RESTAURANT_POS_SEQUENCE_RESET_C83';
const AUDIT_ENTITY = 'RESTAURANT_POS_SEQUENCE_RESET_C83';
const AUDIT_ACTION = 'RESET_INTERNAL_POS_SEQUENCE';
const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 500;

function normalizeReason(value) {
  const reason = String(value || '').replace(/\s+/g, ' ').trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new AppError(400, `Escribe un motivo de al menos ${MIN_REASON_LENGTH} caracteres.`, 'RESTAURANT_POS_RESET_REASON_REQUIRED');
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new AppError(400, `El motivo no puede superar ${MAX_REASON_LENGTH} caracteres.`, 'RESTAURANT_POS_RESET_REASON_TOO_LONG');
  }
  return reason;
}

function auditView(row) {
  if (!row) return null;
  return {
    id: row.id,
    at: row.creadoEn,
    userId: row.userId,
    userName: row.user?.nombre || null,
    userEmail: row.user?.email || null,
    reason: row.metadata?.reason || null,
    resetTo: row.metadata?.resetTo || '000000'
  };
}

async function status(tenantId, client = prisma) {
  await testReset.assertRestaurantTenant(tenantId, client);
  const sequence = await posNumber.assignedSequenceState(client, tenantId);
  const history = await client.auditoriaContable.findMany({
    where: { tenantId, entidad: AUDIT_ENTITY, entidadId: tenantId, accion: AUDIT_ACTION },
    include: { user: { select: { nombre: true, email: true } } },
    orderBy: { creadoEn: 'desc' },
    take: 10
  });
  const assignedCount = Number(sequence.assignedCount);
  const nextNumber = posNumber.formatPosNumber(sequence.assignedCount === 0n ? 0n : sequence.maxNumber + 1n);
  return {
    marker: MARKER,
    version: '83.0.0',
    internalOnly: true,
    dianUntouched: true,
    assignedCount,
    currentMax: assignedCount ? posNumber.formatPosNumber(sequence.maxNumber) : null,
    nextNumber,
    resetAllowed: assignedCount === 0,
    resetTarget: '000000',
    blockedReason: assignedCount === 0
      ? null
      : 'Existen comprobantes POS internos numerados. Para evitar números duplicados, si son datos de prueba primero usa la limpieza transaccional.',
    lastReset: auditView(history[0]),
    history: history.map(auditView)
  };
}

async function reset(tenantId, userId, reason) {
  const cleanReason = normalizeReason(reason);
  const tenant = await testReset.assertRestaurantTenant(tenantId);
  if (!userId) throw new AppError(401, 'Usuario no disponible para registrar el reinicio.', 'RESTAURANT_POS_RESET_USER_REQUIRED');

  const audit = await prisma.$transaction(async (tx) => {
    await posNumber.lockTenantSequence(tx, tenantId);
    const sequence = await posNumber.assignedSequenceState(tx, tenantId);
    if (sequence.assignedCount > 0n) {
      throw new AppError(
        409,
        'No se reinició el consecutivo porque ya existen comprobantes POS internos numerados. Si corresponden a pruebas, ejecuta primero la limpieza de datos de prueba.',
        'RESTAURANT_POS_RESET_NUMBERED_HISTORY_EXISTS',
        { assignedCount: Number(sequence.assignedCount), currentMax: posNumber.formatPosNumber(sequence.maxNumber) }
      );
    }

    return tx.auditoriaContable.create({
      data: {
        tenantId,
        userId,
        entidad: AUDIT_ENTITY,
        entidadId: tenantId,
        accion: AUDIT_ACTION,
        metadata: {
          marker: MARKER,
          version: '83.0.0',
          reason: cleanReason,
          resetTo: '000000',
          internalOnly: true,
          dianUntouched: true,
          tenantSubdomain: tenant.subdomain,
          tenantName: tenant.nombreEmpresa,
          assignedCountBefore: Number(sequence.assignedCount),
          maxBefore: sequence.assignedCount ? posNumber.formatPosNumber(sequence.maxNumber) : null
        }
      },
      include: { user: { select: { nombre: true, email: true } } }
    });
  });

  return {
    marker: MARKER,
    version: '83.0.0',
    ok: true,
    nextNumber: '000000',
    internalOnly: true,
    dianUntouched: true,
    audit: auditView(audit)
  };
}

module.exports = {
  MARKER,
  AUDIT_ENTITY,
  AUDIT_ACTION,
  MIN_REASON_LENGTH,
  MAX_REASON_LENGTH,
  normalizeReason,
  auditView,
  status,
  reset
};
