'use strict';

const { randomUUID } = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const pilot = require('./restaurant-v2-pilot.service');

const MARKER = 'VANTIX_RESTAURANT_V2_CUTOVER_P10';
const CUTOVER_KEY = 'restaurantV2Cutover';
const CUTOVER_HISTORY_KEY = 'restaurantV2CutoverHistory';
const CUTOVER_HISTORY_LIMIT = 50;
const MODE_V2 = 'V2_DEFAULT';
const MODE_V1 = 'V1_DEFAULT';
const ROLLBACK = Object.freeze({
  restaurant: '/app/restaurante-v1',
  waiter: '/app/centro-de-control/mesero-v1',
  production: '/app/produccion-v1'
});
const CANONICAL = Object.freeze({
  controlCenter: '/app/centro-de-control',
  restaurant: '/app/restaurante',
  waiter: '/app/centro-de-control/mesero',
  production: '/app/produccion',
  clientQr: '/r/<qrToken>'
});
const V2_TARGETS = Object.freeze({
  controlCenter: '/app/centro-de-control',
  tables: '/app/restaurante-v2/mesas',
  orders: '/app/restaurante-v2/pedidos',
  kds: '/app/restaurante-v2/kds',
  cash: '/app/restaurante-v2/caja',
  split: '/app/restaurante-v2/division',
  qrs: '/app/restaurante-v2/qrs',
  devices: '/app/restaurante-v2/dispositivos',
  waiter: '/app/centro-de-control/mesero-v2/',
  production: '/app/produccion-v2/'
});

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function historyValue(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object').slice(-CUTOVER_HISTORY_LIMIT) : [];
}
function cleanNotes(value) {
  if (value === undefined) return undefined;
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, 500) : null;
}
function normalizedCutover(value) {
  const stored = objectValue(value);
  const enabled = Boolean(stored.enabled);
  return {
    marker: MARKER,
    version: 10,
    enabled,
    mode: enabled ? MODE_V2 : MODE_V1,
    activatedAt: stored.activatedAt || null,
    deactivatedAt: stored.deactivatedAt || null,
    activatedByUserId: stored.activatedByUserId || null,
    updatedByUserId: stored.updatedByUserId || null,
    updatedAt: stored.updatedAt || null,
    notes: typeof stored.notes === 'string' ? stored.notes : null,
    canonical: CANONICAL,
    v2Targets: V2_TARGETS,
    rollback: ROLLBACK,
    tenantScoped: true,
    qrTokensImmutableByCutover: true,
    dianGate: false
  };
}
function snapshot(value) {
  const row = normalizedCutover(value);
  return {
    enabled: row.enabled,
    mode: row.mode,
    activatedAt: row.activatedAt,
    deactivatedAt: row.deactivatedAt,
    activatedByUserId: row.activatedByUserId,
    updatedByUserId: row.updatedByUserId,
    updatedAt: row.updatedAt,
    notes: row.notes
  };
}
async function currentConfig(tenantId, client = prisma) {
  const config = await client.restaurantConfig.findUnique({ where: { tenantId } });
  if (!config) throw new AppError(409, 'El restaurante no tiene configuración operativa para migrar', 'RESTAURANT_V2_CUTOVER_CONFIG_REQUIRED');
  return config;
}
async function launchDecision(tenantId, client = prisma) {
  const config = await currentConfig(tenantId, client);
  const themeData = objectValue(config.themeData);
  const cutover = normalizedCutover(themeData[CUTOVER_KEY]);
  return {
    marker: MARKER,
    enabled: cutover.enabled,
    mode: cutover.mode,
    targets: cutover.enabled ? V2_TARGETS : ROLLBACK,
    rollback: ROLLBACK,
    qrTokensImmutableByCutover: true,
    dianGate: false
  };
}
async function getCutover(tenantId, client = prisma) {
  const config = await currentConfig(tenantId, client);
  const themeData = objectValue(config.themeData);
  const [readiness] = await Promise.all([pilot.readiness(tenantId, client)]);
  const pilotState = pilot.normalizedPilot(themeData[pilot.PILOT_KEY]);
  return {
    marker: MARKER,
    cutover: normalizedCutover(themeData[CUTOVER_KEY]),
    pilot: pilotState,
    readiness,
    canActivate: Boolean(pilotState.enabled && readiness.ready),
    blockers: [
      ...(pilotState.enabled ? [] : ['pilot']),
      ...readiness.blockers
    ],
    safety: {
      tenantScoped: true,
      rollbackWithoutDataDeletion: true,
      qrTokensUnchanged: true,
      dianDoesNotBlock: true,
      salesSessionsOrdersUntouched: true,
      noGlobalRedirect: true
    }
  };
}
function buildEvent({ tenantId, userId, before, after, readiness, pilotState, now }) {
  const action = before.enabled === after.enabled ? 'UPDATE' : (after.enabled ? 'ACTIVATE_V2_DEFAULT' : 'ROLLBACK_V1_DEFAULT');
  return {
    id: randomUUID(),
    marker: MARKER,
    tenantId,
    userId,
    action,
    at: now,
    before: snapshot(before),
    after: snapshot(after),
    pilot: { enabled: pilotState.enabled, mode: pilotState.mode },
    readiness: { ready: readiness.ready, blockers: [...readiness.blockers], warnings: [...readiness.warnings] },
    safety: { qrTokensUnchanged: true, dianGate: false, tenantScoped: true }
  };
}
async function mirrorAudit(event, client = prisma) {
  try {
    if (!client?.auditoriaContable?.create) throw new Error('AUDIT_CLIENT_UNAVAILABLE');
    await client.auditoriaContable.create({
      data: {
        tenantId: event.tenantId,
        userId: event.userId,
        entidad: 'RESTAURANT_V2_CUTOVER',
        entidadId: event.tenantId,
        accion: event.action,
        metadata: {
          marker: event.marker,
          operationalEventId: event.id,
          before: event.before,
          after: event.after,
          pilot: event.pilot,
          readiness: event.readiness,
          safety: event.safety
        }
      }
    });
    return { status: 'RECORDED', code: null };
  } catch (error) {
    const code = String(error?.code || error?.name || 'AUDIT_WRITE_FAILED').slice(0, 80);
    console.warn(`[restaurant-v2-cutover] accounting audit mirror skipped: ${code}`);
    return { status: 'FAILED', code };
  }
}
async function setCutover(tenantId, userId, input = {}, client = prisma, options = {}) {
  if (typeof input.enabled !== 'boolean') throw new AppError(400, 'enabled debe ser booleano', 'RESTAURANT_V2_CUTOVER_ENABLED_REQUIRED');
  const notes = cleanNotes(input.notes);
  const config = await currentConfig(tenantId, client);
  const themeData = objectValue(config.themeData);
  const before = normalizedCutover(themeData[CUTOVER_KEY]);
  const pilotState = pilot.normalizedPilot(themeData[pilot.PILOT_KEY]);
  const readiness = await pilot.readiness(tenantId, client);

  if (input.enabled && !pilotState.enabled) {
    throw new AppError(409, 'Activa y valida primero el Piloto V2 antes de convertir V2 en principal', 'RESTAURANT_V2_CUTOVER_PILOT_REQUIRED');
  }
  if (input.enabled && !readiness.ready) {
    throw new AppError(409, `El restaurante no está listo para el corte: ${readiness.blockers.join(', ')}`, 'RESTAURANT_V2_CUTOVER_NOT_READY', { blockers: readiness.blockers });
  }

  const now = new Date().toISOString();
  const turningOn = input.enabled && !before.enabled;
  const turningOff = !input.enabled && before.enabled;
  const nextStored = {
    marker: MARKER,
    version: 10,
    enabled: input.enabled,
    mode: input.enabled ? MODE_V2 : MODE_V1,
    activatedAt: turningOn ? now : before.activatedAt,
    deactivatedAt: turningOff ? now : before.deactivatedAt,
    activatedByUserId: turningOn ? userId : before.activatedByUserId,
    updatedByUserId: userId,
    updatedAt: now,
    notes: notes === undefined ? before.notes : notes
  };
  const after = normalizedCutover(nextStored);
  const event = buildEvent({ tenantId, userId, before, after, readiness, pilotState, now });
  const history = [...historyValue(themeData[CUTOVER_HISTORY_KEY]), event].slice(-CUTOVER_HISTORY_LIMIT);
  const nextThemeData = { ...themeData, [CUTOVER_KEY]: nextStored, [CUTOVER_HISTORY_KEY]: history };

  try {
    await client.restaurantConfig.update({ where: { tenantId }, data: { themeData: nextThemeData } });
  } catch (error) {
    console.error('[restaurant-v2-cutover] state write failed', error?.code || error?.name || 'UNKNOWN');
    throw new AppError(500, 'No fue posible guardar el corte V2', 'RESTAURANT_V2_CUTOVER_STATE_WRITE_FAILED');
  }

  const mirror = await mirrorAudit(event, options.auditClient || client);
  return {
    marker: MARKER,
    cutover: after,
    pilot: pilotState,
    readiness,
    audit: {
      operational: 'RECORDED',
      operationalStorage: `RestaurantConfig.themeData.${CUTOVER_HISTORY_KEY}`,
      operationalEventId: event.id,
      operationalEvents: history.length,
      accountingMirror: mirror.status,
      accountingMirrorCode: mirror.code
    }
  };
}

module.exports = {
  MARKER,
  CUTOVER_KEY,
  CUTOVER_HISTORY_KEY,
  CUTOVER_HISTORY_LIMIT,
  MODE_V2,
  MODE_V1,
  ROLLBACK,
  CANONICAL,
  V2_TARGETS,
  normalizedCutover,
  launchDecision,
  getCutover,
  setCutover,
  mirrorAudit
};
