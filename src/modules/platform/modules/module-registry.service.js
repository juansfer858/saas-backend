'use strict';

const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');
const rbac = require('../rbac/rbac.service');

const SHELLS = Object.freeze({
  FULL: 'FULL',
  OPERATION: 'OPERATION',
  FISCAL: 'FISCAL',
  TRANSITION: 'TRANSITION'
});

const DEVICES = Object.freeze({
  DESKTOP: 'DESKTOP',
  TABLET: 'TABLET',
  POS: 'POS',
  MOBILE: 'MOBILE'
});

const MODULE_CATALOG = Object.freeze([
  Object.freeze({
    code: 'DASHBOARD', label: 'Dashboard', path: '/app/dashboard', group: 'GENERAL',
    requiredAny: ['DASHBOARD.VER'], shells: ['FULL', 'OPERATION', 'FISCAL', 'TRANSITION'],
    devices: ['DESKTOP', 'TABLET', 'POS', 'MOBILE'], defaultEnabled: true, order: 10
  }),
  Object.freeze({
    code: 'VENTAS', label: 'Ventas', path: '/app/ventas', group: 'OPERACION',
    requiredAny: ['VENTAS.VER'], shells: ['FULL', 'OPERATION', 'TRANSITION'],
    devices: ['DESKTOP', 'TABLET', 'POS'], defaultEnabled: true, order: 20
  }),
  Object.freeze({
    code: 'COMPRAS', label: 'Compras', path: '/app/compras', group: 'OPERACION',
    requiredAny: ['COMPRAS.VER'], shells: ['FULL', 'OPERATION', 'TRANSITION'],
    devices: ['DESKTOP', 'TABLET'], defaultEnabled: true, order: 30
  }),
  Object.freeze({
    code: 'INVENTARIO', label: 'Inventarios / Kardex', path: '/app/inventario', group: 'OPERACION',
    requiredAny: ['INVENTARIO.VER'], shells: ['FULL', 'OPERATION', 'TRANSITION'],
    devices: ['DESKTOP', 'TABLET', 'POS'], defaultEnabled: true, order: 40
  }),
  Object.freeze({
    code: 'TERCEROS', label: 'Terceros', path: '/app/terceros', group: 'GENERAL',
    requiredAny: ['TERCEROS.VER'], shells: ['FULL', 'OPERATION', 'FISCAL', 'TRANSITION'],
    devices: ['DESKTOP', 'TABLET'], defaultEnabled: true, order: 50
  }),
  Object.freeze({
    code: 'TESORERIA', label: 'Tesorería & Bancos', path: '/app/tesoreria', group: 'FISCAL',
    requiredAny: ['TESORERIA.VER'], shells: ['FULL', 'FISCAL'],
    devices: ['DESKTOP', 'TABLET'], defaultEnabled: true, order: 60
  }),
  Object.freeze({
    code: 'CARTERA', label: 'Cartera', path: '/app/cartera', group: 'FISCAL',
    requiredAny: ['CARTERA.VER'], shells: ['FULL', 'FISCAL'],
    devices: ['DESKTOP', 'TABLET'], defaultEnabled: true, order: 70
  }),
  Object.freeze({
    code: 'CONTABILIDAD', label: 'Contabilidad', path: '/app/contabilidad', group: 'FISCAL',
    requiredAny: ['CONTABILIDAD.VER'], shells: ['FULL', 'FISCAL'],
    devices: ['DESKTOP', 'TABLET'], defaultEnabled: true, order: 80
  }),
  Object.freeze({
    code: 'REPORTES', label: 'Reportes', path: '/app/reportes', group: 'FISCAL',
    requiredAny: ['REPORTES.VER'], shells: ['FULL', 'FISCAL'],
    devices: ['DESKTOP', 'TABLET'], defaultEnabled: true, order: 90
  }),
  Object.freeze({
    code: 'DIAN', label: 'Facturación electrónica', path: '/app/configuracion-avanzada', group: 'FISCAL',
    requiredAny: ['DIAN.VER'], shells: ['FULL', 'FISCAL'],
    devices: ['DESKTOP', 'TABLET'], defaultEnabled: true, order: 100
  }),
  Object.freeze({
    code: 'CONFIGURACION', label: 'Configuración', path: '/app/configuracion-avanzada', group: 'ADMIN',
    requiredAny: ['CONFIGURACION.ADMINISTRAR'], shells: ['FULL'],
    devices: ['DESKTOP', 'TABLET'], defaultEnabled: true, order: 110
  })
]);

function clean(value) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text || null;
}

function normalizeEnum(value, allowed, code, label) {
  const normalized = clean(value)?.toUpperCase();
  if (!normalized || !Object.prototype.hasOwnProperty.call(allowed, normalized)) {
    throw new AppError(400, `${label} inválido`, code);
  }
  return normalized;
}

function catalogByCode() {
  return new Map(MODULE_CATALOG.map((module) => [module.code, module]));
}

function permissionMatches(module, effectivePermissions) {
  if (effectivePermissions.has('*')) return true;
  return (module.requiredAny || []).some((permission) => effectivePermissions.has(permission));
}

async function listTenantModuleStates(tenantId, client = prisma) {
  const safeTenantId = clean(tenantId);
  if (!safeTenantId) throw new AppError(400, 'tenantId es obligatorio', 'MODULE_REGISTRY_TENANT_REQUIRED');
  const rows = await client.platformTenantModule.findMany({
    where: { tenantId: safeTenantId },
    orderBy: [{ moduleCode: 'asc' }]
  });
  const stateByCode = new Map(rows.map((row) => [row.moduleCode, row]));
  return MODULE_CATALOG.map((module) => {
    const row = stateByCode.get(module.code);
    return {
      ...module,
      enabled: row ? row.enabled : module.defaultEnabled,
      settings: row?.settings || null,
      persisted: Boolean(row)
    };
  }).sort((a, b) => a.order - b.order);
}

async function setTenantModuleState({ tenantId, actorUserId, moduleCode, enabled, settings = null }, client = prisma) {
  const safeTenantId = clean(tenantId);
  const safeActorUserId = clean(actorUserId);
  const safeCode = clean(moduleCode)?.toUpperCase();
  if (!safeTenantId || !safeActorUserId || !safeCode) {
    throw new AppError(400, 'tenantId, actorUserId y moduleCode son obligatorios', 'MODULE_REGISTRY_INPUT_REQUIRED');
  }
  const module = catalogByCode().get(safeCode);
  if (!module) throw new AppError(400, `Módulo no registrado: ${safeCode}`, 'MODULE_REGISTRY_MODULE_INVALID');

  const actor = await client.user.findFirst({ where: { id: safeActorUserId, tenantId: safeTenantId, activo: true } });
  if (!actor) throw new AppError(404, 'Usuario actor no encontrado', 'MODULE_REGISTRY_ACTOR_NOT_FOUND');

  const row = await client.platformTenantModule.upsert({
    where: { tenantId_moduleCode: { tenantId: safeTenantId, moduleCode: safeCode } },
    create: {
      tenantId: safeTenantId,
      moduleCode: safeCode,
      enabled: Boolean(enabled),
      settings,
      updatedByUserId: safeActorUserId
    },
    update: {
      enabled: Boolean(enabled),
      settings,
      updatedByUserId: safeActorUserId
    }
  });

  await client.rbacAudit.create({
    data: {
      tenantId: safeTenantId,
      actorUserId: safeActorUserId,
      action: 'TENANT_MODULE_STATE_SET',
      metadata: { moduleCode: safeCode, enabled: Boolean(enabled), settings }
    }
  });

  return row;
}

async function resolveVisibleModules({ tenantId, user, shell = 'FULL', device = 'DESKTOP' }, client = prisma) {
  const safeTenantId = clean(tenantId);
  if (!safeTenantId || !user?.id) return [];
  const safeShell = normalizeEnum(shell, SHELLS, 'MODULE_REGISTRY_SHELL_INVALID', 'Shell');
  const safeDevice = normalizeEnum(device, DEVICES, 'MODULE_REGISTRY_DEVICE_INVALID', 'Dispositivo');

  const [states, effectivePermissionsRaw] = await Promise.all([
    listTenantModuleStates(safeTenantId, client),
    rbac.effectivePermissions(safeTenantId, user)
  ]);
  const effectivePermissions = new Set(effectivePermissionsRaw);

  return states
    .filter((module) => module.enabled)
    .filter((module) => module.shells.includes(safeShell))
    .filter((module) => module.devices.includes(safeDevice))
    .filter((module) => permissionMatches(module, effectivePermissions))
    .map((module) => ({
      code: module.code,
      label: module.label,
      path: module.path,
      group: module.group,
      order: module.order
    }));
}

module.exports = {
  SHELLS,
  DEVICES,
  MODULE_CATALOG,
  listTenantModuleStates,
  setTenantModuleState,
  resolveVisibleModules
};
