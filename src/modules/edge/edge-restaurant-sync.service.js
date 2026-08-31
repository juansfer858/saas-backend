const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const restaurant = require('../restaurant/restaurant.service');
const identity = require('../restaurant/restaurant-identity.service');

const TYPES = new Set([
  'RESTAURANT_TABLE_OPEN',
  'RESTAURANT_ACCOUNT_REQUEST',
  'RESTAURANT_ORDER_CREATE',
  'RESTAURANT_COMMAND_STATUS',
  'RESTAURANT_CASH_OPEN',
  'RESTAURANT_CASH_CLOSE',
  'RESTAURANT_TABLE_CLOSE'
]);

const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const asNum = (value) => value == null ? null : Number(value);

function actor(agent) {
  return agent.serviceUser || {
    id: agent.serviceUserId,
    tenantId: agent.tenantId,
    rol: 'EDGE_AGENT',
    nombre: `Edge ${agent.pointCode}`
  };
}

async function buildRestaurantBootstrap(agent) {
  const tenantId = agent.tenantId;
  const [tables, menu, commands, shifts] = await Promise.all([
    prisma.restaurantTable.findMany({
      where: { tenantId, active: true },
      include: {
        sessions: {
          where: { state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
          orderBy: { openedAt: 'desc' },
          take: 1
        }
      },
      orderBy: { code: 'asc' }
    }),
    restaurant.listMenu(tenantId, { active: true }),
    prisma.restaurantCommand.findMany({
      where: { tenantId, state: { in: ['PENDIENTE', 'EN_PREPARACION', 'LISTA'] } },
      include: { order: { include: { items: true, session: { include: { table: true } } } } },
      orderBy: { creadoEn: 'asc' },
      take: 500
    }),
    prisma.aperturaCierreCaja.findMany({ where: { tenantId, estado: 'ABIERTA' }, orderBy: { abiertoEn: 'desc' }, take: 50 })
  ]);

  return {
    generatedAt: new Date().toISOString(),
    tables: tables.map((table) => ({
      id: table.id,
      code: table.code,
      name: table.name,
      seats: table.seats,
      state: table.state,
      assignedWaiterId: table.assignedWaiterId,
      activeSession: table.sessions[0] ? {
        id: table.sessions[0].id,
        state: table.sessions[0].state,
        saleId: table.sessions[0].saleId,
        guestCount: table.sessions[0].guestCount,
        billingMode: table.sessions[0].billingMode || 'CONJUNTA'
      } : null
    })),
    menu: menu.map((row) => ({
      id: row.id,
      productId: row.productId,
      category: row.category,
      station: row.station,
      requiresRecipe: row.requiresRecipe,
      recipeConfigured: row.recipeConfigured,
      available: Boolean(row.product && (!row.requiresRecipe || row.recipeConfigured)),
      product: row.product ? {
        id: row.product.id,
        sku: row.product.sku,
        nombre: row.product.nombre,
        precio1: asNum(row.product.precio1),
        ivaPct: asNum(row.product.ivaPct),
        impoconsumoPct: asNum(row.product.impoconsumoPct)
      } : null
    })),
    commands: commands.map((command) => ({
      id: command.id,
      orderId: command.orderId,
      station: command.station,
      state: command.state,
      createdAt: command.creadoEn,
      table: command.order?.session?.table ? {
        id: command.order.session.table.id,
        code: command.order.session.table.code,
        name: command.order.session.table.name
      } : null,
      items: (command.order?.items || [])
        .filter((item) => item.station === command.station)
        .map((item) => ({
          description: item.description,
          quantity: asNum(item.quantity),
          notes: item.notes,
          seatNumber: item.seatNumber
        }))
    })),
    cashShifts: shifts.map((shift) => ({
      id: shift.id,
      cajaBancoId: shift.cajaBancoId,
      userId: shift.userId,
      estado: shift.estado,
      saldoInicial: asNum(shift.saldoInicial),
      abiertoEn: shift.abiertoEn
    }))
  };
}

async function receiptOrigin(agent, operationId, code) {
  if (!operationId) return null;
  const receipt = await prisma.edgeSyncReceipt.findUnique({
    where: { edgeAgentId_operationId: { edgeAgentId: agent.id, operationId } }
  });
  if (!receipt || receipt.state !== 'SYNCED' || !receipt.originDocumentId) {
    throw new AppError(409, 'La operación local dependiente aún no se ha sincronizado', code || 'EDGE_DEPENDENCY_NOT_SYNCED');
  }
  return receipt.originDocumentId;
}

async function resolveSession(agent, payload) {
  return payload.sessionId || receiptOrigin(agent, payload.localSessionOperationId, 'EDGE_LOCAL_SESSION_NOT_SYNCED');
}

async function resolveShift(agent, payload) {
  return payload.shiftId || receiptOrigin(agent, payload.localShiftOperationId, 'EDGE_LOCAL_SHIFT_NOT_SYNCED');
}

async function resolveCommand(agent, payload) {
  if (payload.commandId) return payload.commandId;
  const orderId = await receiptOrigin(agent, payload.localOrderOperationId, 'EDGE_LOCAL_ORDER_NOT_SYNCED');
  const row = await prisma.restaurantCommand.findFirst({
    where: { tenantId: agent.tenantId, orderId, station: payload.station },
    orderBy: { creadoEn: 'asc' }
  });
  if (!row) throw new AppError(409, 'La comanda central aún no existe', 'EDGE_LOCAL_COMMAND_NOT_SYNCED');
  return row.id;
}

function requestedServiceSetup(payload) {
  const first = Array.isArray(payload.items) ? payload.items.find(Boolean) : null;
  const billingMode = String(payload.serviceSetup?.billingMode || first?.serviceBillingMode || '').toUpperCase();
  const guestCountRaw = payload.serviceSetup?.guestCount ?? first?.serviceGuestCount;
  const guestCount = guestCountRaw == null ? null : Number(guestCountRaw);
  return {
    billingMode: ['CONJUNTA', 'INDIVIDUAL'].includes(billingMode) ? billingMode : null,
    guestCount: Number.isInteger(guestCount) && guestCount >= 1 && guestCount <= 50 ? guestCount : null
  };
}

async function migrateSeatsBeforeDecrease(tenantId, sessionId, guestCount) {
  if (!guestCount) return;
  const session = await prisma.restaurantTableSession.findFirst({ where: { id: sessionId, tenantId }, select: { guestCount: true } });
  if (!session || Number(session.guestCount || 1) <= guestCount) return;
  const orders = await prisma.restaurantOrder.findMany({ where: { tenantId, sessionId }, select: { id: true } });
  if (!orders.length) return;
  await prisma.restaurantOrderItem.updateMany({
    where: { tenantId, orderId: { in: orders.map((row) => row.id) }, seatNumber: { gt: guestCount } },
    data: { seatNumber: guestCount }
  });
}

async function applyServiceSetup(agent, user, sessionId, payload) {
  const requested = requestedServiceSetup(payload);
  if (!requested.billingMode && !requested.guestCount) {
    return prisma.restaurantTableSession.findFirst({ where: { id: sessionId, tenantId: agent.tenantId } });
  }
  if (requested.guestCount) await migrateSeatsBeforeDecrease(agent.tenantId, sessionId, requested.guestCount);
  const result = await identity.updateTableServiceSetup(agent.tenantId, user, sessionId, {
    ...(requested.billingMode ? { billingMode: requested.billingMode } : {}),
    ...(requested.guestCount ? { guestCount: requested.guestCount } : {})
  });
  return result.session;
}

function fingerprint(item) {
  return `${item.menuItemId}|${Number(item.quantity || 0)}|${String(item.notes || '').trim()}`;
}

async function applyOrderSeats(tenantId, orderId, requestItems, billingMode, guestCount) {
  const stored = await prisma.restaurantOrderItem.findMany({
    where: { tenantId, orderId },
    orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }]
  });
  const requestedGroups = new Map();
  for (const request of requestItems || []) {
    const key = fingerprint(request);
    if (!requestedGroups.has(key)) requestedGroups.set(key, []);
    requestedGroups.get(key).push(request);
  }
  const storedGroups = new Map();
  for (const item of stored) {
    const key = fingerprint(item);
    if (!storedGroups.has(key)) storedGroups.set(key, []);
    storedGroups.get(key).push(item);
  }

  for (const [key, requests] of requestedGroups.entries()) {
    const rows = storedGroups.get(key) || [];
    const seats = requests.map((request) => {
      if (billingMode !== 'INDIVIDUAL') return null;
      const seat = Number(request.seatNumber || 1);
      return Number.isInteger(seat) && seat >= 1 && seat <= Number(guestCount || 1) ? seat : 1;
    }).sort((a, b) => Number(a || 0) - Number(b || 0));
    const orderedRows = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (let index = 0; index < orderedRows.length; index += 1) {
      await prisma.restaurantOrderItem.update({
        where: { id: orderedRows[index].id },
        data: { seatNumber: seats[index] ?? null }
      });
    }
  }
}

async function execute(agent, operation) {
  const payload = operation.payload || {};
  const user = actor(agent);
  const tenantId = agent.tenantId;

  switch (operation.type) {
    case 'RESTAURANT_TABLE_OPEN':
      return restaurant.openTable(tenantId, user, payload.tableId, {
        guestCount: payload.guestCount || 1,
        customerPhoneE164: payload.customerPhoneE164 || null
      });
    case 'RESTAURANT_ACCOUNT_REQUEST':
      return restaurant.requestAccount(tenantId, user, payload.tableId);
    case 'RESTAURANT_ORDER_CREATE': {
      const sessionId = await resolveSession(agent, payload);
      const service = await applyServiceSetup(agent, user, sessionId, payload);
      const result = await restaurant.placeWaiterOrder(tenantId, user, sessionId, {
        items: payload.items || [],
        notes: payload.notes || null,
        customerPhoneE164: payload.customerPhoneE164 || null,
        externalRequestId: `EDGE-${agent.id}-${operation.id}`
      });
      await applyOrderSeats(tenantId, result.id, payload.items || [], service?.billingMode || 'CONJUNTA', service?.guestCount || 1);
      return restaurant.getOrder ? restaurant.getOrder(tenantId, result.id) : result;
    }
    case 'RESTAURANT_COMMAND_STATUS': {
      const commandId = await resolveCommand(agent, payload);
      return restaurant.updateCommandState(tenantId, user, commandId, payload.state);
    }
    case 'RESTAURANT_CASH_OPEN':
      return restaurant.openCashShift(tenantId, agent.serviceUserId, {
        cajaBancoId: payload.cajaBancoId || agent.defaultCashAccountId,
        saldoInicial: payload.saldoInicial || 0
      });
    case 'RESTAURANT_CASH_CLOSE': {
      const shiftId = await resolveShift(agent, payload);
      return restaurant.closeCashShift(tenantId, agent.serviceUserId, shiftId, { saldoFinal: payload.saldoFinal });
    }
    case 'RESTAURANT_TABLE_CLOSE':
      return restaurant.closeTable(tenantId, user, payload.tableId, {
        formaPago: payload.formaPago || 'EFECTIVO',
        cajaBancoId: payload.cajaBancoId || agent.defaultCashAccountId || null,
        tipAmount: payload.tipAmount || 0,
        split: payload.split || { mode: 'NONE' }
      });
    default:
      throw new AppError(400, `Tipo Restaurante Edge no soportado: ${operation.type}`, 'EDGE_RESTAURANT_OPERATION_UNSUPPORTED');
  }
}

function originId(type, result) {
  if (type === 'RESTAURANT_TABLE_OPEN') return result?.session?.id || null;
  if (type === 'RESTAURANT_ORDER_CREATE') return result?.id || result?.order?.id || null;
  if (type === 'RESTAURANT_COMMAND_STATUS') return result?.command?.id || result?.id || null;
  if (type === 'RESTAURANT_CASH_OPEN') return result?.id || null;
  if (type === 'RESTAURANT_CASH_CLOSE') return result?.closed?.id || result?.id || null;
  if (type === 'RESTAURANT_TABLE_CLOSE') return result?.session?.id || result?.sale?.id || null;
  return result?.id || null;
}

async function processOperation(agent, operation) {
  if (!operation?.id || !TYPES.has(operation.type) || !operation.localTimestamp || !operation.payload) {
    throw new AppError(400, 'Operación Restaurante Edge inválida', 'EDGE_RESTAURANT_OPERATION_INVALID');
  }
  const payloadHash = hash(operation.payload);
  let receipt = await prisma.edgeSyncReceipt.findUnique({
    where: { edgeAgentId_operationId: { edgeAgentId: agent.id, operationId: operation.id } }
  });
  if (receipt?.state === 'SYNCED') return { receipt, result: null };
  if (receipt && receipt.payloadHash !== payloadHash) throw new AppError(409, 'operationId colisiona con otro payload', 'EDGE_OPERATION_ID_COLLISION');
  if (!receipt) {
    receipt = await prisma.edgeSyncReceipt.create({
      data: {
        tenantId: agent.tenantId,
        edgeAgentId: agent.id,
        operationId: operation.id,
        operationType: operation.type,
        localTimestamp: new Date(operation.localTimestamp),
        payloadHash
      }
    });
  }
  try {
    const result = await execute(agent, operation);
    const id = originId(operation.type, result);
    const updated = await prisma.edgeSyncReceipt.update({
      where: { id: receipt.id },
      data: { state: 'SYNCED', originDocumentId: id, errorCode: null, errorMessage: null, processedAt: new Date() }
    });
    await prisma.edgeAgent.update({ where: { id: agent.id }, data: { lastSyncAt: new Date(), lastSeenAt: new Date() } });
    return { receipt: updated, result };
  } catch (error) {
    await prisma.edgeSyncReceipt.update({
      where: { id: receipt.id },
      data: {
        state: 'FAILED',
        errorCode: error.code || 'EDGE_RESTAURANT_SYNC_ERROR',
        errorMessage: error.message || String(error),
        processedAt: new Date()
      }
    });
    throw error;
  }
}

async function processOperations(agent, operations) {
  const ordered = [...(operations || [])].sort((a, b) => new Date(a.localTimestamp) - new Date(b.localTimestamp));
  const out = [];
  for (const operation of ordered) {
    try {
      const result = await processOperation(agent, operation);
      out.push({ id: operation.id, ok: true, state: 'SYNCED', originDocumentId: result.receipt.originDocumentId || null });
    } catch (error) {
      out.push({
        id: operation?.id || null,
        ok: false,
        state: 'FAILED',
        code: error.code || 'EDGE_RESTAURANT_SYNC_ERROR',
        message: error.message || String(error)
      });
    }
  }
  return out;
}

module.exports = { TYPES, buildRestaurantBootstrap, processOperations };
