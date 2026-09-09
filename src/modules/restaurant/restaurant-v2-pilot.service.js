'use strict';

const { randomUUID } = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const MARKER = 'VANTIX_RESTAURANT_V2_PILOT_P9';
const ACTIVATION_FIX_MARKER = 'VANTIX_RESTAURANT_V2_PILOT_ACTIVATION_FIX_V2';
const PILOT_KEY = 'restaurantV2Pilot';
const PILOT_HISTORY_KEY = 'restaurantV2PilotHistory';
const PILOT_HISTORY_LIMIT = 50;
const TARGET_VERSION = 'P1-P8';
const ROLLBACK_PATH = '/app/restaurante-v1';
const PRODUCTION_ROLES = Object.freeze(['COCINA', 'BARRA', 'POSTRES']);
const SURFACES = Object.freeze({
  controlCenter: Object.freeze({ label: 'Centro de control V2', url: '/app/centro-de-control' }),
  tables: Object.freeze({ label: 'Mesas V2', url: '/app/restaurante-v2/mesas' }),
  orders: Object.freeze({ label: 'Pedidos V2', url: '/app/restaurante-v2/pedidos' }),
  kds: Object.freeze({ label: 'KDS V2', url: '/app/restaurante-v2/kds' }),
  cash: Object.freeze({ label: 'Caja V2', url: '/app/restaurante-v2/caja' }),
  split: Object.freeze({ label: 'División V2', url: '/app/restaurante-v2/division' }),
  waiter: Object.freeze({ label: 'Mesero PWA V2', url: '/app/centro-de-control/mesero-v2/' }),
  production: Object.freeze({ label: 'Producción PWA V2', url: '/app/produccion-v2/' }),
  clientQr: Object.freeze({ label: 'Cliente QR V2', url: '/r/<qrToken>' })
});

function objectValue(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function historyValue(value) { return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object').slice(-PILOT_HISTORY_LIMIT) : []; }
function cleanNotes(value) {
  if (value === undefined) return undefined;
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, 500) : null;
}
function normalizedPilot(value) {
  const stored = objectValue(value);
  const enabled = Boolean(stored.enabled);
  return {
    marker: MARKER,
    version: 9,
    targetVersion: TARGET_VERSION,
    enabled,
    mode: enabled ? 'PILOT' : 'OFF',
    startedAt: stored.startedAt || null,
    stoppedAt: stored.stoppedAt || null,
    startedByUserId: stored.startedByUserId || null,
    updatedByUserId: stored.updatedByUserId || null,
    updatedAt: stored.updatedAt || null,
    notes: typeof stored.notes === 'string' ? stored.notes : null,
    routingMode: 'PARALLEL_NO_REDIRECT',
    rollbackPath: ROLLBACK_PATH,
    surfaces: SURFACES
  };
}
function auditPilotSnapshot(value) {
  const pilot = normalizedPilot(value);
  return {
    enabled: pilot.enabled,
    mode: pilot.mode,
    startedAt: pilot.startedAt,
    stoppedAt: pilot.stoppedAt,
    startedByUserId: pilot.startedByUserId,
    updatedByUserId: pilot.updatedByUserId,
    updatedAt: pilot.updatedAt,
    notes: pilot.notes,
    routingMode: pilot.routingMode,
    rollbackPath: pilot.rollbackPath
  };
}
function paymentMethodCount(value) {
  if (Array.isArray(value)) return value.filter(Boolean).length;
  const object = objectValue(value);
  if (Array.isArray(object.items)) return object.items.filter(Boolean).length;
  return Object.keys(object).length;
}
async function readiness(tenantId, client = prisma) {
  const [tenant, configRow, admins, tables, menuItems, waiters, productionUsers, cashiers, cashAccounts, manualStations, waiterDevices, productionDevices] = await Promise.all([
    client.tenant.findUnique({ where: { id: tenantId }, select: { id: true, subdomain: true, nombreEmpresa: true, activo: true } }),
    client.restaurantConfig.findUnique({ where: { tenantId } }),
    client.user.count({ where: { tenantId, activo: true, rol: { in: ['ADMIN', 'SUPER_ADMIN'] } } }),
    client.restaurantTable.count({ where: { tenantId, active: true } }),
    client.restaurantMenuItem.count({ where: { tenantId, active: true } }),
    client.user.count({ where: { tenantId, activo: true, rol: 'MESERO' } }),
    client.user.count({ where: { tenantId, activo: true, rol: { in: PRODUCTION_ROLES } } }),
    client.user.count({ where: { tenantId, activo: true, rol: 'CAJERO' } }),
    client.cajaBanco.count({ where: { tenantId, activo: true, tipo: 'CAJA' } }),
    client.restaurantProductionStation?.count ? client.restaurantProductionStation.count({ where: { tenantId, active: true } }) : Promise.resolve(0),
    client.trackingLink.count({ where: { tenantId, originType: 'RESTAURANT_WAITER_DEVICE', active: true, currentStatus: 'ACTIVE' } }),
    client.trackingLink.count({ where: { tenantId, originType: 'RESTAURANT_PRODUCTION_DEVICE_V63', active: true, currentStatus: 'ACTIVE' } })
  ]);
  if (!tenant) throw new AppError(404, 'Restaurante no encontrado', 'RESTAURANT_V2_PILOT_TENANT_NOT_FOUND');
  const config = configRow || {};
  const required = [
    { key: 'tenant', label: 'Tenant activo', ok: Boolean(tenant.activo), value: tenant.activo ? 1 : 0 },
    { key: 'admin', label: 'Administrador activo', ok: admins > 0, value: admins },
    { key: 'tables', label: 'Mesas activas', ok: tables > 0, value: tables },
    { key: 'menu', label: 'Carta activa', ok: menuItems > 0, value: menuItems },
    { key: 'waiters', label: 'Mesero activo', ok: waiters > 0, value: waiters },
    { key: 'productionUsers', label: 'Personal Cocina/Barra/Postres', ok: productionUsers > 0, value: productionUsers },
    { key: 'cashiers', label: 'Cajero activo', ok: cashiers > 0, value: cashiers },
    { key: 'cashAccounts', label: 'Caja operativa', ok: cashAccounts > 0, value: cashAccounts }
  ];
  const optional = [
    { key: 'paymentMethods', label: 'Métodos de pago configurados', ok: paymentMethodCount(config.paymentMethods) > 0, value: paymentMethodCount(config.paymentMethods), gate: false },
    { key: 'manualStations', label: 'Estaciones manuales de producción', ok: manualStations > 0, value: manualStations, gate: false },
    { key: 'waiterDevices', label: 'Dispositivo Mesero vinculado', ok: waiterDevices > 0, value: waiterDevices, gate: false },
    { key: 'productionDevices', label: 'Dispositivo Producción vinculado', ok: productionDevices > 0, value: productionDevices, gate: false },
    { key: 'printer', label: 'Impresora validada en campo', ok: Boolean(config.physicalPrinterFieldPass), value: Boolean(config.physicalPrinterFieldPass), gate: false },
    { key: 'push', label: 'Push FCM', ok: Boolean(process.env.FCM_SERVICE_ACCOUNT_JSON || (process.env.FCM_PROJECT_ID && process.env.FCM_CLIENT_EMAIL && process.env.FCM_PRIVATE_KEY)), value: null, gate: false },
    { key: 'dian', label: 'DIAN', ok: Boolean(config.dianRealEnabled), value: Boolean(config.dianRealEnabled), gate: false }
  ];
  const blockers = required.filter((row) => !row.ok).map((row) => row.key);
  const warnings = optional.filter((row) => !row.ok).map((row) => row.key);
  return {
    marker: MARKER,
    ready: blockers.length === 0,
    tenant: { id: tenant.id, subdomain: tenant.subdomain, nombreEmpresa: tenant.nombreEmpresa },
    required,
    optional,
    blockers,
    warnings,
    notGates: { dian: true, push: true, manualStations: true, printer: true, devicePairing: true },
    rule: 'DIAN_PUSH_IMPRESORA_ESTACIONES_Y_DISPOSITIVOS_NO_BLOQUEAN_ACTIVACION'
  };
}
async function currentConfig(tenantId, client = prisma) { return client.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} }); }
async function getPilot(tenantId, client = prisma) {
  const config = await currentConfig(tenantId, client);
  const checks = await readiness(tenantId, client);
  const themeData = objectValue(config.themeData);
  const history = historyValue(themeData[PILOT_HISTORY_KEY]);
  return {
    marker: MARKER,
    activationFix: ACTIVATION_FIX_MARKER,
    pilot: normalizedPilot(themeData[PILOT_KEY]),
    readiness: checks,
    audit: {
      operationalStorage: `RestaurantConfig.themeData.${PILOT_HISTORY_KEY}`,
      operationalEvents: history.length,
      accountingMirror: 'BEST_EFFORT'
    },
    safety: {
      changesCanonicalRoutes: false,
      rotatesQrTokens: false,
      changesFinancialData: false,
      requiresDian: false,
      requiresPush: false,
      requiresPrinter: false,
      rollback: `Desactivar el piloto y abrir ${ROLLBACK_PATH}; no se eliminan datos.`
    }
  };
}
function buildPilotAuditEvent({ tenantId, userId, before, after, checks, now }) {
  const action = before.enabled === after.enabled ? 'UPDATE' : (after.enabled ? 'ENABLE' : 'DISABLE');
  return {
    id: randomUUID(),
    marker: MARKER,
    activationFix: ACTIVATION_FIX_MARKER,
    tenantId,
    userId,
    action,
    at: now,
    before: auditPilotSnapshot(before),
    after: auditPilotSnapshot(after),
    readiness: { ready: checks.ready, blockers: [...checks.blockers], warnings: [...checks.warnings] }
  };
}
async function mirrorAccountingAudit(event, client = prisma) {
  try {
    if (!client?.auditoriaContable?.create) throw new Error('AUDIT_CLIENT_UNAVAILABLE');
    await client.auditoriaContable.create({
      data: {
        tenantId: event.tenantId,
        userId: event.userId,
        entidad: 'RESTAURANT_V2_PILOT',
        entidadId: event.tenantId,
        accion: event.action,
        metadata: {
          marker: event.marker,
          activationFix: event.activationFix,
          operationalEventId: event.id,
          before: event.before,
          after: event.after,
          readiness: event.readiness
        }
      }
    });
    return { status: 'RECORDED', code: null };
  } catch (error) {
    const code = String(error?.code || error?.name || 'AUDIT_WRITE_FAILED').slice(0, 80);
    console.warn(`[restaurant-v2-pilot] accounting audit mirror skipped: ${code}`);
    return { status: 'FAILED', code };
  }
}
async function setPilot(tenantId, userId, input = {}, client = prisma, options = {}) {
  if (typeof input.enabled !== 'boolean') throw new AppError(400, 'enabled debe ser booleano', 'RESTAURANT_V2_PILOT_ENABLED_REQUIRED');
  const notes = cleanNotes(input.notes);
  const checks = await readiness(tenantId, client);
  if (input.enabled && !checks.ready) throw new AppError(409, `El piloto no está listo: ${checks.blockers.join(', ')}`, 'RESTAURANT_V2_PILOT_NOT_READY');
  const now = new Date().toISOString();
  let config;
  try {
    config = await currentConfig(tenantId, client);
  } catch (error) {
    console.error('[restaurant-v2-pilot] config read failed', error?.code || error?.name || 'UNKNOWN');
    throw new AppError(500, 'No fue posible leer el estado del piloto', 'RESTAURANT_V2_PILOT_STATE_READ_FAILED');
  }
  const themeData = objectValue(config.themeData);
  const before = normalizedPilot(themeData[PILOT_KEY]);
  const turningOn = input.enabled && !before.enabled;
  const turningOff = !input.enabled && before.enabled;
  const nextPilot = {
    ...before,
    marker: MARKER,
    version: 9,
    targetVersion: TARGET_VERSION,
    enabled: input.enabled,
    mode: input.enabled ? 'PILOT' : 'OFF',
    startedAt: turningOn ? now : before.startedAt,
    stoppedAt: turningOff ? now : before.stoppedAt,
    startedByUserId: turningOn ? userId : before.startedByUserId,
    updatedByUserId: userId,
    updatedAt: now,
    notes: notes === undefined ? before.notes : notes,
    routingMode: 'PARALLEL_NO_REDIRECT',
    rollbackPath: ROLLBACK_PATH
  };
  delete nextPilot.surfaces;
  const after = normalizedPilot(nextPilot);
  const event = buildPilotAuditEvent({ tenantId, userId, before, after, checks, now });
  const history = [...historyValue(themeData[PILOT_HISTORY_KEY]), event].slice(-PILOT_HISTORY_LIMIT);
  const nextThemeData = { ...themeData, [PILOT_KEY]: nextPilot, [PILOT_HISTORY_KEY]: history };

  try {
    await client.restaurantConfig.update({ where: { tenantId }, data: { themeData: nextThemeData } });
  } catch (error) {
    console.error('[restaurant-v2-pilot] state write failed', error?.code || error?.name || 'UNKNOWN');
    throw new AppError(500, 'No fue posible guardar el estado del piloto', 'RESTAURANT_V2_PILOT_STATE_WRITE_FAILED');
  }

  const auditClient = options.auditClient || client;
  const mirror = await mirrorAccountingAudit(event, auditClient);
  return {
    marker: MARKER,
    activationFix: ACTIVATION_FIX_MARKER,
    pilot: after,
    readiness: checks,
    audit: {
      operational: 'RECORDED',
      operationalStorage: `RestaurantConfig.themeData.${PILOT_HISTORY_KEY}`,
      operationalEventId: event.id,
      operationalEvents: history.length,
      accountingMirror: mirror.status,
      accountingMirrorCode: mirror.code
    }
  };
}

module.exports = {
  MARKER,
  ACTIVATION_FIX_MARKER,
  PILOT_KEY,
  PILOT_HISTORY_KEY,
  PILOT_HISTORY_LIMIT,
  TARGET_VERSION,
  ROLLBACK_PATH,
  SURFACES,
  normalizedPilot,
  readiness,
  getPilot,
  mirrorAccountingAudit,
  setPilot
};