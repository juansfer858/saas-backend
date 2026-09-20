'use strict';

const { prisma } = require('../../../config/prisma');
const registry = require('./module-registry.service');
const persistentScopes = require('../rbac/persistent-scope.service');

const GROUP_LABELS = Object.freeze({
  GENERAL: 'General',
  OPERACION: 'Operación',
  FISCAL: 'Fiscal / Administrativo',
  ADMIN: 'Administración'
});

function catalogMap() {
  return new Map(registry.MODULE_CATALOG.map((module) => [module.code, module]));
}

async function resolveModuleScopeSnapshot({ tenantId, user, moduleCode }, client = prisma) {
  const module = catalogMap().get(String(moduleCode || '').toUpperCase());
  if (!module) return [];

  const rows = [];
  for (const permissionCode of module.requiredAny || []) {
    const grants = await persistentScopes.effectiveScopeGrants(tenantId, user, permissionCode, client);
    rows.push({ permissionCode, grants });
  }
  return rows;
}

function groupModules(modules) {
  const groups = new Map();
  for (const module of modules) {
    const code = module.group || 'GENERAL';
    if (!groups.has(code)) {
      groups.set(code, {
        code,
        label: GROUP_LABELS[code] || code,
        items: []
      });
    }
    groups.get(code).items.push(module);
  }
  return [...groups.values()];
}

async function resolveDynamicShell({ tenantId, user, shell = 'FULL', device = 'DESKTOP' }, client = prisma) {
  if (!tenantId || !user?.id) {
    return {
      tenantId: tenantId || null,
      userId: user?.id || null,
      shell,
      device,
      landingPath: null,
      modules: [],
      groups: []
    };
  }

  const visible = await registry.resolveVisibleModules({ tenantId, user, shell, device }, client);
  const modules = [];

  for (const module of visible) {
    const scopeProfile = await resolveModuleScopeSnapshot({
      tenantId,
      user,
      moduleCode: module.code
    }, client);

    modules.push({
      ...module,
      scopeProfile,
      hasScopedGrant: scopeProfile.some((entry) => Array.isArray(entry.grants) && entry.grants.length > 0)
    });
  }

  const dashboard = modules.find((module) => module.code === 'DASHBOARD');
  const landingPath = dashboard?.path || modules[0]?.path || null;

  return {
    tenantId: String(tenantId),
    userId: String(user.id),
    legacyRole: user.rol || null,
    shell: String(shell).toUpperCase(),
    device: String(device).toUpperCase(),
    landingPath,
    modules,
    groups: groupModules(modules)
  };
}

module.exports = {
  GROUP_LABELS,
  groupModules,
  resolveModuleScopeSnapshot,
  resolveDynamicShell
};
