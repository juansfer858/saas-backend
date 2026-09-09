'use strict';

const { randomUUID } = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const pilot = require('./restaurant-v2-pilot.service');
const cutover = require('./restaurant-v2-cutover.service');

const MARKER = 'VANTIX_RESTAURANT_V1_RETIREMENT_P11';
const RETIREMENT_KEY = 'restaurantV1Retirement';
const RETIREMENT_HISTORY_KEY = 'restaurantV1RetirementHistory';
const HISTORY_LIMIT = 50;
const MODE_RETIRED = 'V2_ONLY_NORMAL_OPERATION';
const MODE_COMPAT = 'P10_COMPATIBILITY';
const NATIVE_CONTROL_CENTER = '/app/centro-de-control-v2';
const P10_CONTROL_CENTER = '/app/centro-de-control-p10';
const CANONICAL_CONTROL_CENTER = '/app/centro-de-control';

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function historyValue(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object').slice(-HISTORY_LIMIT) : [];
}
function cleanNotes(value) {
  if (value === undefined) return undefined;
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, 500) : null;
}
function normalized(value) {
  const stored = objectValue(value);
  const enabled = Boolean(stored.enabled);
  return {
    marker: MARKER,
    version: 11,
    enabled,
    mode: enabled ? MODE_RETIRED : MODE_COMPAT,
    activatedAt: stored.activatedAt || null,
    deactivatedAt: stored.deactivatedAt || null,
    activatedByUserId: stored.activatedByUserId || null,
    updatedByUserId: stored.updatedByUserId || null,
    updatedAt: stored.updatedAt || null,
    notes: typeof stored.notes === 'string' ? stored.notes : null,
    canonicalControlCenter: CANONICAL_CONTROL_CENTER,
    nativeControlCenter: NATIVE_CONTROL_CENTER,
    compatibilityControlCenter: P10_CONTROL_CENTER,
    rollback: cutover.ROLLBACK,
    qrTokensImmutable: true,
    dianGate: false,
    v1CodeDeleted: false
  };
}
function snapshot(value) {
  const row = normalized(value);
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
  if (!config) throw new AppError(409, 'El restaurante no tiene configuración operativa para retirar V1', 'RESTAURANT_V1_RETIREMENT_CONFIG_REQUIRED');
  return config;
}
async function launchDecision(tenantId, client = prisma) {
  const config = await currentConfig(tenantId, client);
  const themeData = objectValue(config.themeData);
  const retirement = normalized(themeData[RETIREMENT_KEY]);
  const cutoverState = cutover.normalizedCutover(themeData[cutover.CUTOVER_KEY]);
  return {
    marker: MARKER,
    enabled: retirement.enabled,
    mode: retirement.mode,
    target: retirement.enabled ? NATIVE_CONTROL_CENTER : P10_CONTROL_CENTER,
    cutoverEnabled: cutoverState.enabled,
    rollback: cutover.ROLLBACK,
    v1HiddenFromNormalOperation: retirement.enabled,
    v1CodeDeleted: false,
    qrTokensImmutable: true,
    dianGate: false
  };
}
async function getState(tenantId, client = prisma) {
  const config = await currentConfig(tenantId, client);
  const themeData = objectValue(config.themeData);
  const readiness = await pilot.readiness(tenantId, client);
  const pilotState = pilot.normalizedPilot(themeData[pilot.PILOT_KEY]);
  const cutoverState = cutover.normalizedCutover(themeData[cutover.CUTOVER_KEY]);
  const retirement = normalized(themeData[RETIREMENT_KEY]);
  const blockers = [
    ...(pilotState.enabled ? [] : ['pilot']),
    ...(cutoverState.enabled ? [] : ['cutover']),
    ...readiness.blockers
  ];
  return {
    marker: MARKER,
    retirement,
    pilot: pilotState,
    cutover: cutoverState,
    readiness,
    canActivate: blockers.length === 0,
    blockers,
    safety: {
      tenantScoped: true,
      normalV1HiddenOnlyWhenEnabled: true,
      rollbackRoutesPreserved: true,
      v1CodeNotDeleted: true,
      qrTokensUnchanged: true,
      dianDoesNotBlock: true,
      salesSessionsOrdersUntouched: true,
      devicesUntouched: true
    }
  };
}
function buildEvent({ tenantId, userId, before, after, readiness, pilotState, cutoverState, now }) {
  const action = before.enabled === after.enabled ? 'UPDATE' : (after.enabled ? 'RETIRE_V1_NORMAL_OPERATION' : 'RESTORE_P10_COMPATIBILITY');
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
    cutover: { enabled: cutoverState.enabled, mode: cutoverState.mode },
    readiness: { ready: readiness.ready, blockers: [...readiness.blockers], warnings: [...readiness.warnings] },
    safety: { rollbackRoutesPreserved:true, qrTokensUnchanged:true, dianGate:false, v1CodeDeleted:false }
  };
}
async function mirrorAudit(event, client = prisma) {
  try {
    if (!client?.auditoriaContable?.create) throw new Error('AUDIT_CLIENT_UNAVAILABLE');
    await client.auditoriaContable.create({
      data: {
        tenantId: event.tenantId,
        userId: event.userId,
        entidad: 'RESTAURANT_V1_RETIREMENT',
        entidadId: event.tenantId,
        accion: event.action,
        metadata: {
          marker: event.marker,
          operationalEventId: event.id,
          before: event.before,
          after: event.after,
          pilot: event.pilot,
          cutover: event.cutover,
          readiness: event.readiness,
          safety: event.safety
        }
      }
    });
    return { status:'RECORDED', code:null };
  } catch (error) {
    const code = String(error?.code || error?.name || 'AUDIT_WRITE_FAILED').slice(0, 80);
    console.warn(`[restaurant-v1-retirement-p11] accounting audit mirror skipped: ${code}`);
    return { status:'FAILED', code };
  }
}
async function setState(tenantId, userId, input = {}, client = prisma, options = {}) {
  if (typeof input.enabled !== 'boolean') throw new AppError(400, 'enabled debe ser booleano', 'RESTAURANT_V1_RETIREMENT_ENABLED_REQUIRED');
  const notes = cleanNotes(input.notes);
  const config = await currentConfig(tenantId, client);
  const themeData = objectValue(config.themeData);
  const before = normalized(themeData[RETIREMENT_KEY]);
  const pilotState = pilot.normalizedPilot(themeData[pilot.PILOT_KEY]);
  const cutoverState = cutover.normalizedCutover(themeData[cutover.CUTOVER_KEY]);
  const readiness = await pilot.readiness(tenantId, client);

  if (input.enabled && !pilotState.enabled) {
    throw new AppError(409, 'El Piloto V2 debe permanecer activo antes de retirar V1', 'RESTAURANT_V1_RETIREMENT_PILOT_REQUIRED');
  }
  if (input.enabled && !cutoverState.enabled) {
    throw new AppError(409, 'V2 debe estar activo como principal antes de retirar V1', 'RESTAURANT_V1_RETIREMENT_CUTOVER_REQUIRED');
  }
  if (input.enabled && !readiness.ready) {
    throw new AppError(409, `El restaurante no está listo para retirar V1: ${readiness.blockers.join(', ')}`, 'RESTAURANT_V1_RETIREMENT_NOT_READY', { blockers:readiness.blockers });
  }

  const now = new Date().toISOString();
  const turningOn = input.enabled && !before.enabled;
  const turningOff = !input.enabled && before.enabled;
  const nextStored = {
    marker: MARKER,
    version: 11,
    enabled: input.enabled,
    mode: input.enabled ? MODE_RETIRED : MODE_COMPAT,
    activatedAt: turningOn ? now : before.activatedAt,
    deactivatedAt: turningOff ? now : before.deactivatedAt,
    activatedByUserId: turningOn ? userId : before.activatedByUserId,
    updatedByUserId: userId,
    updatedAt: now,
    notes: notes === undefined ? before.notes : notes
  };
  const after = normalized(nextStored);
  const event = buildEvent({ tenantId, userId, before, after, readiness, pilotState, cutoverState, now });
  const history = [...historyValue(themeData[RETIREMENT_HISTORY_KEY]), event].slice(-HISTORY_LIMIT);
  const nextThemeData = { ...themeData, [RETIREMENT_KEY]:nextStored, [RETIREMENT_HISTORY_KEY]:history };

  try {
    await client.restaurantConfig.update({ where:{ tenantId }, data:{ themeData:nextThemeData } });
  } catch (error) {
    console.error('[restaurant-v1-retirement-p11] state write failed', error?.code || error?.name || 'UNKNOWN');
    throw new AppError(500, 'No fue posible guardar el retiro de V1', 'RESTAURANT_V1_RETIREMENT_STATE_WRITE_FAILED');
  }

  const mirror = await mirrorAudit(event, options.auditClient || client);
  return {
    marker: MARKER,
    retirement: after,
    pilot: pilotState,
    cutover: cutoverState,
    readiness,
    audit: {
      operational:'RECORDED',
      operationalStorage:`RestaurantConfig.themeData.${RETIREMENT_HISTORY_KEY}`,
      operationalEventId:event.id,
      operationalEvents:history.length,
      accountingMirror:mirror.status,
      accountingMirrorCode:mirror.code
    }
  };
}

module.exports = {
  MARKER,
  RETIREMENT_KEY,
  RETIREMENT_HISTORY_KEY,
  HISTORY_LIMIT,
  MODE_RETIRED,
  MODE_COMPAT,
  NATIVE_CONTROL_CENTER,
  P10_CONTROL_CENTER,
  CANONICAL_CONTROL_CENTER,
  normalized,
  launchDecision,
  getState,
  setState,
  mirrorAudit
};
