const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const sales = require('../commercial/sales.service');
const { runEdgeSyncContext } = require('./edge-sync-context');

function authSecret() {
  const value = process.env.EDGE_AUTH_SECRET || process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new AppError(500, 'EDGE_AUTH_SECRET/JWT_SECRET insuficiente para autenticar Edge Agents', 'EDGE_AUTH_SECRET_REQUIRED');
  return value;
}

function hashCredential(secret) {
  return crypto.createHmac('sha256', authSecret()).update(String(secret)).digest('hex');
}

function sameHash(a, b) {
  const aa = Buffer.from(String(a || ''), 'hex');
  const bb = Buffer.from(String(b || ''), 'hex');
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function payloadHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function snapshotHash(value) {
  return payloadHash(value);
}

async function provisionAgent(tenantId, actorUserId, input) {
  const edgeKey = crypto.randomBytes(32).toString('base64url');
  const agentId = crypto.randomUUID();
  const serviceUserId = crypto.randomUUID();
  const randomPassword = await bcrypt.hash(crypto.randomBytes(48).toString('base64url'), 10);
  const pointCode = String(input.pointCode || '').trim().toUpperCase();
  const name = String(input.name || '').trim();
  if (!name || !pointCode) throw new AppError(400, 'Nombre y código del punto son obligatorios', 'EDGE_AGENT_INVALID');

  const created = await prisma.$transaction(async (tx) => {
    if (input.defaultCustomerId) {
      const customer = await tx.tercero.findFirst({ where: { id: input.defaultCustomerId, tenantId, activo: true } });
      if (!customer) throw new AppError(400, 'Cliente por defecto inválido', 'EDGE_DEFAULT_CUSTOMER_INVALID');
    }
    if (input.defaultCashAccountId) {
      const cash = await tx.cajaBanco.findFirst({ where: { id: input.defaultCashAccountId, tenantId, activo: true } });
      if (!cash) throw new AppError(400, 'Caja por defecto inválida', 'EDGE_DEFAULT_CASH_INVALID');
    }

    await tx.user.create({
      data: {
        id: serviceUserId,
        tenantId,
        nombre: `Edge Agent · ${name}`,
        email: `edge-${agentId}@agent.vantixgc.local`,
        password: randomPassword,
        rol: 'EDGE_AGENT',
        activo: true
      }
    });

    return tx.edgeAgent.create({
      data: {
        id: agentId,
        tenantId,
        name,
        pointCode,
        credentialHash: hashCredential(edgeKey),
        serviceUserId,
        defaultCustomerId: input.defaultCustomerId || null,
        defaultCashAccountId: input.defaultCashAccountId || null,
        softwareVersion: input.softwareVersion || null,
        createdByUserId: actorUserId
      }
    });
  });

  return { ...created, edgeKey };
}

async function listAgents(tenantId) {
  return prisma.edgeAgent.findMany({ where: { tenantId }, orderBy: [{ state: 'asc' }, { name: 'asc' }] });
}

async function revokeAgent(tenantId, actorUserId, agentId) {
  const agent = await prisma.edgeAgent.findFirst({ where: { id: agentId, tenantId } });
  if (!agent) throw new AppError(404, 'Edge Agent no encontrado', 'EDGE_AGENT_NOT_FOUND');
  return prisma.$transaction(async (tx) => {
    await tx.user.updateMany({ where: { id: agent.serviceUserId, tenantId }, data: { activo: false } });
    return tx.edgeAgent.update({
      where: { id: agent.id },
      data: { state: 'REVOKED', revokedAt: new Date(), revokedByUserId: actorUserId }
    });
  });
}

async function rotateCredential(tenantId, agentId) {
  const agent = await prisma.edgeAgent.findFirst({ where: { id: agentId, tenantId, state: 'ACTIVE' } });
  if (!agent) throw new AppError(404, 'Edge Agent activo no encontrado', 'EDGE_AGENT_NOT_FOUND');
  const edgeKey = crypto.randomBytes(32).toString('base64url');
  await prisma.edgeAgent.update({ where: { id: agent.id }, data: { credentialHash: hashCredential(edgeKey) } });
  return { id: agent.id, pointCode: agent.pointCode, edgeKey };
}

async function authenticateAgent(agentId, edgeKey) {
  if (!agentId || !edgeKey) throw new AppError(401, 'Credenciales Edge incompletas', 'EDGE_AUTH_REQUIRED');
  const agent = await prisma.edgeAgent.findUnique({ where: { id: agentId } });
  if (!agent || agent.state !== 'ACTIVE' || !sameHash(agent.credentialHash, hashCredential(edgeKey))) {
    throw new AppError(401, 'Edge Agent no autorizado o revocado', 'EDGE_AUTH_INVALID');
  }
  const [tenant, serviceUser] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: agent.tenantId } }),
    prisma.user.findFirst({ where: { id: agent.serviceUserId, tenantId: agent.tenantId } })
  ]);
  if (!tenant?.activo || !serviceUser?.activo) throw new AppError(401, 'Edge Agent suspendido', 'EDGE_AUTH_REVOKED');
  await prisma.edgeAgent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });
  return { ...agent, tenant, serviceUser };
}

async function buildBootstrap(agent) {
  const tenantId = agent.tenantId;
  const [products, recipes, cashAccounts, printers, accountingConfig] = await Promise.all([
    prisma.producto.findMany({
      where: { tenantId, activo: true },
      select: {
        id: true, sku: true, codigoBarras: true, nombre: true, tipo: true, unidadMedida: true,
        controlaInventario: true, stockActual: true, costoPromedio: true, precio1: true, ivaPct: true, impoconsumoPct: true
      },
      orderBy: { sku: 'asc' }
    }),
    prisma.consumptionRecipe.findMany({
      where: { tenantId, active: true },
      include: { items: { orderBy: { ingredientProductId: 'asc' } } },
      orderBy: { code: 'asc' }
    }),
    prisma.cajaBanco.findMany({ where: { tenantId, activo: true }, select: { id: true, nombre: true, tipo: true }, orderBy: { nombre: 'asc' } }),
    prisma.printerEndpoint.findMany({ where: { tenantId, active: true }, select: { id: true, name: true, role: true, host: true, port: true, format: true } }),
    prisma.configuracionContable.findUnique({ where: { tenantId } })
  ]);

  const defaultCustomer = agent.defaultCustomerId
    ? await prisma.tercero.findFirst({ where: { tenantId, id: agent.defaultCustomerId, activo: true }, select: { id: true, identificacion: true, nombre: true, razonSocial: true } })
    : await prisma.tercero.findFirst({ where: { tenantId, activo: true, tipo: { in: ['CLIENTE', 'CLIENTE_PROVEEDOR'] } }, orderBy: { creadoEn: 'asc' }, select: { id: true, identificacion: true, nombre: true, razonSocial: true } });

  const normalizedProducts = products.map((p) => ({ ...p,
    stockActual: Number(p.stockActual), costoPromedio: Number(p.costoPromedio), precio1: Number(p.precio1), ivaPct: Number(p.ivaPct), impoconsumoPct: Number(p.impoconsumoPct)
  }));
  const normalizedRecipes = recipes.map((r) => ({
    id: r.id, code: r.code, name: r.name, outputProductId: r.outputProductId, version: r.version,
    items: r.items.map((i) => ({ ingredientProductId: i.ingredientProductId, quantity: Number(i.quantity), unitLabel: i.unitLabel }))
  }));
  const snapshot = {
    tenant: { id: agent.tenant.id, nombreEmpresa: agent.tenant.nombreEmpresa, moneda: agent.tenant.moneda, pais: agent.tenant.pais },
    edge: { id: agent.id, pointCode: agent.pointCode, name: agent.name, defaultCustomerId: defaultCustomer?.id || null, defaultCashAccountId: agent.defaultCashAccountId || cashAccounts.find((c) => c.tipo === 'CAJA')?.id || null },
    products: normalizedProducts,
    recipes: normalizedRecipes,
    cashAccounts,
    printers,
    configurationFingerprint: snapshotHash({
      products: normalizedProducts.map((p) => [p.id, p.precio1, p.ivaPct, p.impoconsumoPct]),
      accountingUpdatedAt: accountingConfig?.actualizadoEn || accountingConfig?.creadoEn || null
    })
  };
  return { ...snapshot, snapshotVersion: snapshotHash(snapshot), generatedAt: new Date().toISOString() };
}

async function createConfigDriftAlerts(agent, operation, payload, currentProducts, originDocumentId) {
  const byId = new Map(currentProducts.map((p) => [p.id, p]));
  for (const line of payload.detalles || []) {
    const current = byId.get(line.productoId);
    if (!current) continue;
    const drift = Number(current.precio1) !== Number(line.precioUnitario)
      || Number(current.ivaPct) !== Number(line.ivaPct || 0)
      || Number(current.impoconsumoPct) !== Number(line.impoconsumoPct || 0);
    if (!drift) continue;
    await prisma.edgeReconciliationAlert.upsert({
      where: { edgeAgentId_operationId_type_productoId: { edgeAgentId: agent.id, operationId: operation.id, type: 'CONFIG_DRIFT', productoId: current.id } },
      create: {
        tenantId: agent.tenantId,
        edgeAgentId: agent.id,
        operationId: operation.id,
        type: 'CONFIG_DRIFT',
        severity: 'WARNING',
        productoId: current.id,
        originDocumentId,
        message: `Venta offline sincronizada con precio/impuesto histórico: ${current.nombre}`,
        details: {
          captured: { precio: Number(line.precioUnitario), ivaPct: Number(line.ivaPct || 0), impoconsumoPct: Number(line.impoconsumoPct || 0) },
          current: { precio: Number(current.precio1), ivaPct: Number(current.ivaPct), impoconsumoPct: Number(current.impoconsumoPct) }
        }
      },
      update: { state: 'OPEN', originDocumentId }
    });
  }
}

async function syncSaleOperation(agent, operation) {
  const payload = operation.payload || {};
  if (payload.formaPago && payload.formaPago !== 'EFECTIVO') {
    throw new AppError(400, 'Edge Offline V1 solo permite cobro local en efectivo', 'EDGE_OFFLINE_PAYMENT_NOT_SUPPORTED');
  }
  const sourceId = `EDGE-${agent.id}-${operation.id}`;
  const existing = await prisma.comprobanteComercial.findFirst({ where: { tenantId: agent.tenantId, sourceId, tipo: 'FACTURA_VENTA' }, select: { id: true } });
  if (existing) return sales.get(agent.tenantId, existing.id);

  const currentProducts = await prisma.producto.findMany({ where: { tenantId: agent.tenantId, id: { in: (payload.detalles || []).map((x) => x.productoId).filter(Boolean) } } });
  const sale = await runEdgeSyncContext({
    allowNegativeInventory: true,
    edgeAgentId: agent.id,
    operationId: operation.id,
    tenantId: agent.tenantId
  }, () => sales.create(agent.tenantId, agent.serviceUserId, {
    estado: 'EMITIDO',
    sourceId,
    terceroId: payload.terceroId || agent.defaultCustomerId || null,
    cajaBancoId: payload.cajaBancoId || agent.defaultCashAccountId || null,
    formaPago: 'EFECTIVO',
    fecha: new Date(operation.localTimestamp),
    documentType: payload.documentType || 'DOCUMENTO_EQUIVALENTE_POS',
    notas: `Sincronizada desde Edge ${agent.pointCode}. Operación local ${operation.id}`,
    detalles: payload.detalles || []
  }));

  await createConfigDriftAlerts(agent, operation, payload, currentProducts, sale.id);
  return sale;
}

async function processOperation(agent, operation) {
  if (!operation?.id || !operation?.type || !operation?.localTimestamp || !operation?.payload) {
    throw new AppError(400, 'Operación Edge inválida', 'EDGE_OPERATION_INVALID');
  }
  const hash = payloadHash(operation.payload);
  const existingReceipt = await prisma.edgeSyncReceipt.findUnique({ where: { edgeAgentId_operationId: { edgeAgentId: agent.id, operationId: operation.id } } });
  if (existingReceipt?.state === 'SYNCED') return existingReceipt;
  if (existingReceipt && existingReceipt.payloadHash !== hash) {
    throw new AppError(409, 'El operationId ya existe con otro payload', 'EDGE_OPERATION_ID_COLLISION');
  }

  const receipt = existingReceipt || await prisma.edgeSyncReceipt.create({
    data: {
      tenantId: agent.tenantId,
      edgeAgentId: agent.id,
      operationId: operation.id,
      operationType: operation.type,
      localTimestamp: new Date(operation.localTimestamp),
      payloadHash: hash
    }
  });

  try {
    let origin = null;
    if (operation.type === 'SALE_EMIT') origin = await syncSaleOperation(agent, operation);
    else throw new AppError(400, `Tipo de operación Edge no soportado: ${operation.type}`, 'EDGE_OPERATION_UNSUPPORTED');

    const updated = await prisma.edgeSyncReceipt.update({
      where: { id: receipt.id },
      data: { state: 'SYNCED', originDocumentId: origin?.id || null, errorCode: null, errorMessage: null, processedAt: new Date() }
    });
    await prisma.edgeAgent.update({ where: { id: agent.id }, data: { lastSyncAt: new Date(), lastSeenAt: new Date() } });
    return updated;
  } catch (error) {
    await prisma.edgeSyncReceipt.update({
      where: { id: receipt.id },
      data: { state: 'FAILED', errorCode: error?.code || 'EDGE_SYNC_ERROR', errorMessage: error?.message || String(error), processedAt: new Date() }
    });
    throw error;
  }
}

async function processOperations(agent, operations) {
  const ordered = [...(operations || [])].sort((a, b) => new Date(a.localTimestamp) - new Date(b.localTimestamp));
  const results = [];
  for (const operation of ordered) {
    try {
      const receipt = await processOperation(agent, operation);
      results.push({ id: operation.id, ok: true, state: receipt.state, originDocumentId: receipt.originDocumentId || null });
    } catch (error) {
      results.push({ id: operation?.id || null, ok: false, state: 'FAILED', code: error?.code || 'EDGE_SYNC_ERROR', message: error?.message || String(error) });
    }
  }
  return results;
}

async function listAlerts(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.state) where.state = filters.state;
  if (filters.edgeAgentId) where.edgeAgentId = filters.edgeAgentId;
  return prisma.edgeReconciliationAlert.findMany({ where, include: { agent: { select: { id: true, name: true, pointCode: true } } }, orderBy: { creadoEn: 'desc' }, take: 500 });
}

async function acknowledgeAlert(tenantId, userId, id) {
  const alert = await prisma.edgeReconciliationAlert.findFirst({ where: { id, tenantId } });
  if (!alert) throw new AppError(404, 'Alerta Edge no encontrada', 'EDGE_ALERT_NOT_FOUND');
  return prisma.edgeReconciliationAlert.update({ where: { id }, data: { state: 'ACKNOWLEDGED', acknowledgedById: userId, acknowledgedAt: new Date() } });
}

module.exports = {
  provisionAgent,
  listAgents,
  revokeAgent,
  rotateCredential,
  authenticateAgent,
  buildBootstrap,
  processOperations,
  listAlerts,
  acknowledgeAlert,
  hashCredential
};
