'use strict';

const { prisma } = require('../../config/prisma');
const testReset = require('./restaurant-test-data-reset-v68.service');

const MARKER = 'VANTIX_RESTAURANT_AUDIT_LOG_C84';
const VERSION = '84.0.0';

function limitValue(value) {
  const parsed = Number(value || 100);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

function rowLabel(row) {
  const action = String(row?.accion || '').trim();
  if (action === 'RESET_INTERNAL_POS_SEQUENCE') return 'Reinicio de consecutivo POS interno';
  if (action === 'RESET_TEST_DATA') return 'Limpieza de datos de prueba';
  return action.replace(/_/g, ' ') || 'Actividad administrativa';
}

function rowReason(row) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return metadata.reason || metadata.motivo || metadata.note || null;
}

function view(row) {
  return {
    id: row.id,
    at: row.creadoEn,
    action: row.accion,
    label: rowLabel(row),
    entity: row.entidad,
    entityId: row.entidadId,
    user: row.user ? {
      id: row.user.id,
      name: row.user.nombre,
      email: row.user.email,
      role: row.user.rol
    } : null,
    reason: rowReason(row),
    metadata: row.metadata || null
  };
}

async function list(tenantId, options = {}, client = prisma) {
  await testReset.assertRestaurantTenant(tenantId, client);
  const rows = await client.auditoriaContable.findMany({
    where: { tenantId },
    include: {
      user: { select: { id: true, nombre: true, email: true, rol: true } }
    },
    orderBy: { creadoEn: 'desc' },
    take: limitValue(options.limit)
  });

  return {
    marker: MARKER,
    version: VERSION,
    readOnly: true,
    preservedByTestCleanup: true,
    items: rows.map(view)
  };
}

module.exports = {
  MARKER,
  VERSION,
  limitValue,
  rowLabel,
  rowReason,
  view,
  list
};
