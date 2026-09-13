'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const testReset = require('./restaurant-test-data-reset-v68.service');

const MARKER = 'VANTIX_RESTAURANT_AUDIT_LOG_C84';
const RECOVERY_MARKER = 'VANTIX_RESTAURANT_AUDIT_SAFE_RECOVERY_V86';
const VERSION = '86.0.0';
const FINANCIAL_SUBJECTS = new Set(['VENTA', 'CAJA', 'PAGO', 'INVENTARIO', 'TESORERIA']);

function limitValue(value) {
  const parsed = Number(value || 100);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

function metadataOf(row) {
  return row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
}

function rowLabel(row) {
  const metadata = metadataOf(row);
  if (metadata.label) return String(metadata.label);
  const action = String(row?.accion || '').trim();
  if (action === 'RESET_INTERNAL_POS_SEQUENCE') return 'Reinicio de consecutivo POS interno';
  if (action === 'RESET_TEST_DATA') return 'Limpieza de datos de prueba';
  return action.replace(/_/g, ' ') || 'Actividad administrativa';
}

function rowReason(row) {
  const metadata = metadataOf(row);
  return metadata.reason || metadata.motivo || metadata.note || null;
}

function objectSnapshot(metadata) {
  if (metadata?.before && typeof metadata.before === 'object' && !Array.isArray(metadata.before)) return metadata.before;
  if (metadata?.result && typeof metadata.result === 'object' && !Array.isArray(metadata.result)) return metadata.result;
  if (metadata?.changes && typeof metadata.changes === 'object' && !Array.isArray(metadata.changes)) return metadata.changes;
  return null;
}

function restoreEligibility(row) {
  const metadata = metadataOf(row);
  const action = String(row?.accion || '').toUpperCase();
  const method = String(metadata.method || '').toUpperCase();
  const subject = String(metadata.subject || '').toUpperCase();
  const path = String(metadata.path || '');
  const snapshot = objectSnapshot(metadata);
  const deleted = action.startsWith('DELETE_') || method === 'DELETE';

  if (!deleted) {
    return { canView:true, canDownload:true, canRestore:false, adapter:null, reason:'Solo los registros eliminados pueden restaurarse.' };
  }
  if (FINANCIAL_SUBJECTS.has(subject)) {
    return {
      canView:true,
      canDownload:true,
      canRestore:false,
      adapter:null,
      reason:'Documento financiero u operativo: se puede consultar y descargar, pero su recuperación requiere el flujo de dominio para no duplicar Caja, Inventario, Tesorería o Contabilidad.'
    };
  }
  if (/^\/restaurante\/mesas\/[^/]+\/?$/.test(path) && snapshot?.id) {
    return { canView:true, canDownload:true, canRestore:true, adapter:'MESA_SOFT_DELETE', reason:null };
  }
  if (/^\/restaurante\/menu\/[^/]+\/?$/.test(path) && snapshot?.id && snapshot?.productId && snapshot?.category && snapshot?.station) {
    return { canView:true, canDownload:true, canRestore:true, adapter:'MENU_ITEM_RECREATE', reason:null };
  }
  return {
    canView:true,
    canDownload:true,
    canRestore:false,
    adapter:null,
    reason:'Este registro puede consultarse y descargarse, pero la auditoría histórica no contiene todavía una instantánea completa y segura para restaurarlo automáticamente.'
  };
}

function view(row) {
  const metadata = metadataOf(row);
  return {
    id: row.id,
    at: row.creadoEn,
    action: row.accion,
    label: rowLabel(row),
    entity: row.entidad,
    entityId: row.entidadId,
    module: metadata.module || null,
    subject: metadata.subject || null,
    user: row.user ? {
      id: row.user.id,
      name: row.user.nombre,
      email: row.user.email,
      role: row.user.rol
    } : null,
    reason: rowReason(row),
    metadata: row.metadata || null,
    recovery: restoreEligibility(row)
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
    recoveryMarker: RECOVERY_MARKER,
    version: VERSION,
    readOnly: false,
    auditHistoryImmutable: true,
    preservedByTestCleanup: true,
    recoveryPolicy: 'VIEW_DOWNLOAD_THEN_RESTORE',
    items: rows.map(view)
  };
}

async function detail(tenantId, auditId, client = prisma) {
  await testReset.assertRestaurantTenant(tenantId, client);
  const row = await client.auditoriaContable.findFirst({
    where: { id: auditId, tenantId },
    include: { user: { select: { id:true, nombre:true, email:true, rol:true } } }
  });
  if (!row) throw new AppError(404, 'Registro de auditoría no encontrado', 'RESTAURANT_AUDIT_NOT_FOUND');
  return view(row);
}

function cleanRestoreReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 3) throw new AppError(400, 'Indique el motivo de la restauración', 'RESTAURANT_AUDIT_RESTORE_REASON_REQUIRED');
  if (reason.length > 500) throw new AppError(400, 'El motivo de restauración es demasiado largo', 'RESTAURANT_AUDIT_RESTORE_REASON_TOO_LONG');
  return reason;
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

async function restoreTable(tx, tenantId, snapshot) {
  const current = await tx.restaurantTable.findFirst({ where: { id: snapshot.id, tenantId } });
  if (!current) throw new AppError(409, 'La mesa eliminada ya no existe físicamente y no puede reactivarse con seguridad', 'RESTAURANT_AUDIT_TABLE_MISSING');
  if (current.active) throw new AppError(409, 'La mesa ya está activa; no se aplicó ninguna restauración', 'RESTAURANT_AUDIT_ALREADY_RESTORED');
  const open = await tx.restaurantTableSession.findFirst({ where: { tenantId, tableId: current.id, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } } });
  if (open) throw new AppError(409, 'La mesa tiene una sesión abierta y requiere revisión antes de restaurarse', 'RESTAURANT_AUDIT_TABLE_SESSION_CONFLICT');
  return tx.restaurantTable.update({ where: { id: current.id }, data: { active:true, state:'LIBRE' } });
}

async function restoreMenuItem(tx, tenantId, snapshot) {
  const existing = await tx.restaurantMenuItem.findFirst({
    where: { tenantId, OR: [{ id: snapshot.id }, { productId: snapshot.productId }] }
  });
  if (existing) throw new AppError(409, 'Ese producto ya está nuevamente vinculado a la carta', 'RESTAURANT_AUDIT_MENU_ALREADY_RESTORED');
  const product = await tx.producto.findFirst({ where: { id: snapshot.productId, tenantId, activo:true } });
  if (!product) throw new AppError(409, 'El producto base ya no está activo; restaure primero el producto', 'RESTAURANT_AUDIT_MENU_PRODUCT_MISSING');
  return tx.restaurantMenuItem.create({
    data: {
      id: snapshot.id,
      tenantId,
      productId: snapshot.productId,
      category: snapshot.category,
      station: snapshot.station,
      requiresRecipe: snapshot.requiresRecipe !== false,
      active: snapshot.active !== false,
      sortOrder: Number.isFinite(Number(snapshot.sortOrder)) ? Number(snapshot.sortOrder) : 0
    }
  });
}

async function restore(tenantId, userId, auditId, reasonInput, client = prisma) {
  await testReset.assertRestaurantTenant(tenantId, client);
  const reason = cleanRestoreReason(reasonInput);
  const source = await client.auditoriaContable.findFirst({ where: { id:auditId, tenantId } });
  if (!source) throw new AppError(404, 'Registro de auditoría no encontrado', 'RESTAURANT_AUDIT_NOT_FOUND');
  const eligibility = restoreEligibility(source);
  if (!eligibility.canRestore) {
    throw new AppError(409, eligibility.reason || 'Este registro no puede restaurarse automáticamente', 'RESTAURANT_AUDIT_RESTORE_NOT_SAFE');
  }
  const metadata = metadataOf(source);
  const snapshot = objectSnapshot(metadata);

  return client.$transaction(async (tx) => {
    const duplicateRestore = await tx.auditoriaContable.findFirst({
      where: {
        tenantId,
        accion: { startsWith:'RESTORE_' },
        metadata: { path:['originalAuditId'], equals:source.id }
      }
    }).catch(() => null);
    if (duplicateRestore) throw new AppError(409, 'Este registro de auditoría ya fue restaurado', 'RESTAURANT_AUDIT_ALREADY_RESTORED');

    let restored;
    if (eligibility.adapter === 'MESA_SOFT_DELETE') restored = await restoreTable(tx, tenantId, snapshot);
    else if (eligibility.adapter === 'MENU_ITEM_RECREATE') restored = await restoreMenuItem(tx, tenantId, snapshot);
    else throw new AppError(409, 'No existe un adaptador seguro para este registro', 'RESTAURANT_AUDIT_RESTORE_ADAPTER_MISSING');

    const subject = String(metadata.subject || 'REGISTRO').toUpperCase();
    const audit = await tx.auditoriaContable.create({
      data: {
        tenantId,
        userId,
        entidad: RECOVERY_MARKER,
        entidadId: String(restored.id || source.entidadId),
        accion: `RESTORE_${subject}`,
        metadata: {
          marker: RECOVERY_MARKER,
          version: VERSION,
          module: metadata.module || 'AUDITORIA',
          subject,
          label: `Restaurar ${subject.toLowerCase()}`,
          reason,
          originalAuditId: source.id,
          originalAction: source.accion,
          adapter: eligibility.adapter,
          restored: jsonSafe(restored)
        }
      }
    });
    return {
      marker: RECOVERY_MARKER,
      restored: jsonSafe(restored),
      restorationAuditId: audit.id,
      originalAuditId: source.id
    };
  });
}

module.exports = {
  MARKER,
  RECOVERY_MARKER,
  VERSION,
  FINANCIAL_SUBJECTS,
  limitValue,
  metadataOf,
  rowLabel,
  rowReason,
  objectSnapshot,
  restoreEligibility,
  view,
  list,
  detail,
  cleanRestoreReason,
  restore
};
