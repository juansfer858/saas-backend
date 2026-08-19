const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { auditInTx } = require('./accounting-audit.service');

const DEFINITIONS = {
  CAJA_GENERAL: { label: 'Caja general', module: 'TESORERIA', required: true },
  BANCO_GENERAL: { label: 'Banco general (fallback)', module: 'TESORERIA', required: true },
  CLIENTES: { label: 'Clientes / cuentas por cobrar', module: 'VENTAS', required: true },
  PROVEEDORES: { label: 'Proveedores / cuentas por pagar', module: 'COMPRAS', required: true },
  INVENTARIO: { label: 'Inventario de mercancías', module: 'INVENTARIO', required: true },
  COSTO_VENTAS: { label: 'Costo de ventas', module: 'VENTAS', required: true },
  VENTAS: { label: 'Ingresos por ventas', module: 'VENTAS', required: true },
  IMPUESTO_VENTA: { label: 'IVA generado', module: 'VENTAS', required: true },
  IMPUESTO_COMPRA: { label: 'IVA descontable', module: 'COMPRAS', required: true },
  RETEFUENTE_PAGAR: { label: 'Retención en la fuente por pagar', module: 'COMPRAS', required: false },
  RETEFUENTE_FAVOR: { label: 'Retención en la fuente a favor', module: 'VENTAS', required: false },
  GASTO_COMPRA: { label: 'Gasto de compra / servicio', module: 'COMPRAS', required: true },
  GASTO_FALTANTE_INVENTARIO: { label: 'Gasto por faltante/merma de inventario', module: 'INVENTARIO', required: true },
  INGRESO_SOBRANTE_INVENTARIO: { label: 'Ingreso por sobrante de inventario', module: 'INVENTARIO', required: true },
  GASTO_DIRECTO: { label: 'Gasto directo de tesorería', module: 'TESORERIA', required: true }
};

const EVENTS = {
  VENTA: ['CLIENTES', 'VENTAS', 'COSTO_VENTAS', 'INVENTARIO'],
  VENTA_IVA: ['IMPUESTO_VENTA'],
  COMPRA: ['PROVEEDORES', 'INVENTARIO', 'GASTO_COMPRA'],
  COMPRA_IVA: ['IMPUESTO_COMPRA'],
  AJUSTE_FALTANTE: ['INVENTARIO', 'GASTO_FALTANTE_INVENTARIO'],
  AJUSTE_SOBRANTE: ['INVENTARIO', 'INGRESO_SOBRANTE_INVENTARIO'],
  TESORERIA: ['CAJA_GENERAL', 'BANCO_GENERAL'],
  GASTO_DIRECTO: ['GASTO_DIRECTO'],
  CARTERA_CXC: ['CLIENTES'],
  CARTERA_CXP: ['PROVEEDORES']
};

function definitionFor(key) {
  const normalized = String(key || '').trim().toUpperCase();
  const def = DEFINITIONS[normalized];
  if (!def) throw new AppError(400, `Parámetro contable desconocido: ${normalized}`, 'ACCOUNTING_MAPPING_KEY_INVALID', { clave: normalized });
  return { clave: normalized, ...def };
}

async function resolveMappingInTx(tx, tenantId, key) {
  const def = definitionFor(key);
  const mapping = await tx.mapeoContable.findFirst({
    where: { tenantId, clave: def.clave },
    include: { cuenta: { select: { id: true, codigo: true, nombre: true, activa: true, permiteMovimiento: true, naturaleza: true } } }
  });
  if (!mapping || !mapping.cuenta?.activa || !mapping.cuenta?.permiteMovimiento) {
    throw new AppError(409, `Configure la cuenta contable de ${def.label} antes de continuar`, 'ACCOUNTING_CONFIGURATION_REQUIRED', def);
  }
  return mapping.cuenta;
}

async function assertEventMappingsInTx(tx, tenantId, event, extraKeys = []) {
  const keys = [...new Set([...(EVENTS[event] || []), ...extraKeys])];
  const result = {};
  for (const key of keys) result[key] = await resolveMappingInTx(tx, tenantId, key);
  return result;
}

async function listMappings(tenantId) {
  const existing = await prisma.mapeoContable.findMany({
    where: { tenantId },
    include: { cuenta: { select: { id: true, codigo: true, nombre: true, naturaleza: true, activa: true, permiteMovimiento: true } } }
  });
  const byKey = new Map(existing.map((x) => [x.clave, x]));
  return Object.entries(DEFINITIONS).map(([clave, def]) => {
    const mapping = byKey.get(clave);
    const ready = Boolean(mapping?.cuenta?.activa && mapping?.cuenta?.permiteMovimiento);
    return { clave, ...def, ready, mappingId: mapping?.id || null, cuenta: mapping?.cuenta || null };
  });
}

async function setMapping(tenantId, userId, key, cuentaId) {
  const def = definitionFor(key);
  return prisma.$transaction(async (tx) => {
    const account = await tx.cuentaPUC.findFirst({ where: { id: cuentaId, tenantId, activa: true, permiteMovimiento: true } });
    if (!account) throw new AppError(400, 'La cuenta seleccionada no pertenece a la empresa o no permite movimientos', 'ACCOUNTING_MAPPING_ACCOUNT_INVALID');
    const mapping = await tx.mapeoContable.upsert({
      where: { tenantId_clave: { tenantId, clave: def.clave } },
      create: { tenantId, clave: def.clave, cuentaId: account.id },
      update: { cuentaId: account.id },
      include: { cuenta: true }
    });
    if (userId) await auditInTx(tx, { tenantId, userId, entidad: 'CONFIGURACION_CONTABLE', entidadId: mapping.id, accion: 'MAPEAR_CUENTA', metadata: { clave: def.clave, cuentaId: account.id, codigo: account.codigo } });
    return mapping;
  });
}

async function integrationStatus(tenantId) {
  const mappings = await listMappings(tenantId);
  const byKey = new Map(mappings.map((m) => [m.clave, m]));
  const moduleRules = {
    VENTAS: ['CLIENTES', 'VENTAS', 'COSTO_VENTAS', 'INVENTARIO', 'IMPUESTO_VENTA'],
    COMPRAS: ['PROVEEDORES', 'INVENTARIO', 'GASTO_COMPRA', 'IMPUESTO_COMPRA'],
    INVENTARIO: ['INVENTARIO', 'GASTO_FALTANTE_INVENTARIO', 'INGRESO_SOBRANTE_INVENTARIO'],
    TESORERIA: ['CAJA_GENERAL', 'BANCO_GENERAL', 'CLIENTES', 'PROVEEDORES', 'GASTO_DIRECTO'],
    CARTERA: ['CLIENTES', 'PROVEEDORES']
  };
  const modules = {};
  for (const [module, keys] of Object.entries(moduleRules)) {
    const missing = keys.filter((key) => !byKey.get(key)?.ready);
    modules[module] = { ready: missing.length === 0, missing };
  }
  return { ready: Object.values(modules).every((x) => x.ready), modules, mappings };
}

module.exports = {
  DEFINITIONS,
  EVENTS,
  definitionFor,
  resolveMappingInTx,
  assertEventMappingsInTx,
  listMappings,
  setMapping,
  integrationStatus
};
