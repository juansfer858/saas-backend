const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money, qty, pct } = require('../../utils/decimal');
const base = require('./restaurant.service');
const themeService = require('./restaurant-theme.service');
const rbac = require('../platform/rbac/rbac.service');

function calculation(product, quantity) {
  const q = qty(quantity);
  if (q.lt(0)) throw new AppError(400, 'La cantidad no puede ser negativa', 'RESTAURANT_DRAFT_QTY_INVALID');
  const price = money(product.precio1 || 0);
  const ivaPct = pct(product.ivaPct || 0);
  const impoconsumoPct = pct(product.impoconsumoPct || 0);
  const subtotal = money(q.mul(price));
  const iva = money(subtotal.mul(ivaPct).div(100));
  const impoconsumo = money(subtotal.mul(impoconsumoPct).div(100));
  const total = money(subtotal.plus(iva).plus(impoconsumo));
  return { q, price, ivaPct, impoconsumoPct, subtotal, iva, impoconsumo, total };
}

async function uiContext(tenantId, user) {
  const permissions = await rbac.effectivePermissions(tenantId, user);
  const [theme, status] = await Promise.all([
    themeService.getTheme(tenantId),
    base.getStatus(tenantId)
  ]);
  return {
    user: { id: user.id, nombre: user.nombre, rol: user.rol },
    permissions: [...permissions],
    theme,
    status,
    polling: { kdsMs: 2000, floorMs: 3000 }
  };
}

async function listTablesLive(tenantId, user) {
  const tables = await base.listTables(tenantId, user);
  const sessions = tables.map((x) => x.activeSession).filter(Boolean);
  const saleIds = sessions.map((x) => x.saleId);
  const sales = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds } },
    select: { id: true, numero: true, estado: true, total: true, actualizadoEn: true }
  }) : [];
  const bySale = new Map(sales.map((x) => [x.id, x]));
  return tables.map((table) => {
    const session = table.activeSession;
    const sale = session ? bySale.get(session.saleId) : null;
    return {
      ...table,
      activeSession: session ? {
        ...session,
        sale: sale ? { id: sale.id, numero: sale.numero, estado: sale.estado, total: sale.total, actualizadoEn: sale.actualizadoEn } : null
      } : null
    };
  });
}

function assertWaiterSessionAccess(user, session) {
  if (user?.rol === 'MESERO' && session?.table?.assignedWaiterId !== user.id) {
    throw new AppError(403, 'La mesa no está asignada a este mesero', 'RESTAURANT_WAITER_TABLE_FORBIDDEN');
  }
}

function normalizeSeatNumber(session, seatNumber) {
  if (session.billingMode !== 'INDIVIDUAL') return null;
  const seat = Number(seatNumber || 1);
  if (!Number.isInteger(seat) || seat < 1 || seat > Number(session.guestCount || 1)) {
    throw new AppError(400, 'La persona seleccionada no pertenece a esta mesa', 'RESTAURANT_SEAT_INVALID', {
      seatNumber: seat,
      guestCount: session.guestCount
    });
  }
  return seat;
}

async function sessionOrderIds(tx, tenantId, sessionId) {
  const rows = await tx.restaurantOrder.findMany({ where: { tenantId, sessionId }, select: { id: true } });
  return rows.map((row) => row.id);
}

async function ensureDraftContext(tx, tenantId, user, sessionId, create = true) {
  const session = await tx.restaurantTableSession.findFirst({
    where: { id: sessionId, tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    include: { table: true }
  });
  if (!session) throw new AppError(404, 'Sesión de mesa abierta no encontrada', 'RESTAURANT_SESSION_NOT_FOUND');
  assertWaiterSessionAccess(user, session);
  const sale = await tx.comprobanteComercial.findFirst({
    where: { id: session.saleId, tenantId, tipo: 'FACTURA_VENTA', estado: 'BORRADOR' },
    include: { detalles: true }
  });
  if (!sale) throw new AppError(409, 'La venta de la mesa ya no está en borrador', 'RESTAURANT_SALE_NOT_DRAFT');
  let order = await tx.restaurantOrder.findFirst({
    where: { tenantId, sessionId, source: 'MESERO', state: 'BORRADOR', createdByUserId: user.id },
    orderBy: { creadoEn: 'desc' }
  });
  if (!order && create) {
    order = await tx.restaurantOrder.create({
      data: { tenantId, sessionId, source: 'MESERO', state: 'BORRADOR', createdByUserId: user.id, total: 0 }
    });
  }
  return { session, sale, order };
}

async function loadDraft(tenantId, orderId, client = prisma) {
  const order = await client.restaurantOrder.findFirst({
    where: { id: orderId, tenantId, source: 'MESERO', state: 'BORRADOR' },
    include: { items: { orderBy: { creadoEn: 'asc' } }, session: { include: { table: true } } }
  });
  if (!order) return null;
  const sale = await client.comprobanteComercial.findFirst({
    where: { id: order.session.saleId, tenantId },
    include: { detalles: true }
  });
  return { order, sale };
}

function serviceItem(item, order) {
  return {
    id: item.id,
    orderId: order.id,
    orderState: order.state,
    source: order.source,
    menuItemId: item.menuItemId,
    productId: item.productId,
    saleDetailId: item.saleDetailId,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
    station: item.station,
    seatNumber: item.seatNumber,
    notes: item.notes,
    creadoEn: item.creadoEn
  };
}

async function sessionServiceSummaryInTx(tx, tenantId, session) {
  const [orders, sale] = await Promise.all([
    tx.restaurantOrder.findMany({
      where: { tenantId, sessionId: session.id, state: { not: 'CANCELADO' } },
      include: { items: { orderBy: { creadoEn: 'asc' } }, commands: true },
      orderBy: { creadoEn: 'asc' }
    }),
    tx.comprobanteComercial.findFirst({
      where: { id: session.saleId, tenantId },
      select: { id: true, numero: true, estado: true, total: true, subtotal: true, ivaTotal: true, impoconsumoTotal: true }
    })
  ]);

  const allItems = [];
  for (const order of orders) for (const item of order.items) allItems.push(serviceItem(item, order));
  const guestCount = Math.max(Number(session.guestCount || 1), 1);
  const seats = Array.from({ length: guestCount }, (_, index) => ({
    seatNumber: index + 1,
    label: `Persona ${index + 1}`,
    items: [],
    total: money(0)
  }));
  const unassigned = { items: [], total: money(0) };

  for (const item of allItems) {
    const seat = Number(item.seatNumber || 0);
    if (session.billingMode === 'INDIVIDUAL' && Number.isInteger(seat) && seat >= 1 && seat <= guestCount) {
      const group = seats[seat - 1];
      group.items.push(item);
      group.total = money(group.total.plus(item.lineTotal || 0));
    } else if (session.billingMode === 'INDIVIDUAL') {
      unassigned.items.push(item);
      unassigned.total = money(unassigned.total.plus(item.lineTotal || 0));
    }
  }

  return {
    billingMode: session.billingMode,
    guestCount,
    accountPreparedAt: session.accountPreparedAt,
    cashierRequestedAt: session.cashierRequestedAt,
    accountRequestedAt: session.accountRequestedAt,
    seats: seats.map((seat) => ({ ...seat, total: seat.total.toString() })),
    unassigned: { items: unassigned.items, total: unassigned.total.toString() },
    allItems,
    total: String(sale?.total || 0),
    sale,
    orderCount: orders.filter((order) => order.state !== 'BORRADOR').length,
    hasDraft: orders.some((order) => order.state === 'BORRADOR' && order.items.length > 0)
  };
}

async function getWaiterDraft(tenantId, user, sessionId) {
  return prisma.$transaction(async (tx) => {
    const ctx = await ensureDraftContext(tx, tenantId, user, sessionId, false);
    const service = await sessionServiceSummaryInTx(tx, tenantId, ctx.session);
    if (!ctx.order) return { order: null, sale: ctx.sale, session: ctx.session, service };
    const loaded = await loadDraft(tenantId, ctx.order.id, tx);
    return { ...loaded, session: ctx.session, service };
  });
}

async function resolveMenuLine(tx, tenantId, menuItemId, quantity) {
  const menu = await tx.restaurantMenuItem.findFirst({ where: { id: menuItemId, tenantId, active: true } });
  if (!menu) throw new AppError(404, 'Ítem de menú no encontrado', 'RESTAURANT_MENU_ITEM_NOT_FOUND');
  const product = await tx.producto.findFirst({ where: { id: menu.productId, tenantId, activo: true } });
  if (!product) throw new AppError(409, 'Producto del menú no disponible', 'RESTAURANT_MENU_PRODUCT_INVALID');
  if (menu.requiresRecipe) {
    const recipe = await tx.consumptionRecipe.findFirst({ where: { tenantId, outputProductId: product.id, active: true } });
    if (!recipe) throw new AppError(409, `Configure la receta de ${product.nombre} antes de venderlo`, 'RESTAURANT_RECIPE_REQUIRED');
  }
  return { menu, product, ...calculation(product, quantity) };
}

function detailValues(line) {
  return {
    descripcion: line.product.nombre,
    cantidad: line.q,
    precioUnitario: line.price,
    descuentoPct: 0,
    ivaPct: line.ivaPct,
    impoconsumoPct: line.impoconsumoPct,
    subtotalLinea: line.subtotal,
    ivaValor: line.iva,
    impoconsumoValor: line.impoconsumo,
    totalLinea: line.total,
    costoUnitario: line.product.costoPromedio
  };
}

async function updateTableServiceSetup(tenantId, user, sessionId, input) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.restaurantTableSession.findFirst({
      where: { id: sessionId, tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
      include: { table: true }
    });
    if (!session) throw new AppError(404, 'Sesión de mesa abierta no encontrada', 'RESTAURANT_SESSION_NOT_FOUND');
    assertWaiterSessionAccess(user, session);

    const orderIds = await sessionOrderIds(tx, tenantId, session.id);
    const existingItem = orderIds.length ? await tx.restaurantOrderItem.findFirst({ where: { tenantId, orderId: { in: orderIds } }, select: { id: true } }) : null;
    if (input.billingMode && input.billingMode !== session.billingMode && existingItem) {
      throw new AppError(409, 'El modo de cuenta debe definirse antes de agregar productos. La mesa ya tiene consumos.', 'RESTAURANT_BILLING_MODE_LOCKED');
    }

    if (input.guestCount !== undefined && orderIds.length) {
      const highest = await tx.restaurantOrderItem.aggregate({
        where: { tenantId, orderId: { in: orderIds }, seatNumber: { not: null } },
        _max: { seatNumber: true }
      });
      if (Number(highest._max.seatNumber || 0) > Number(input.guestCount)) {
        throw new AppError(409, `La Persona ${highest._max.seatNumber} todavía tiene productos. Muévelos antes de reducir el número de personas.`, 'RESTAURANT_GUEST_COUNT_IN_USE');
      }
    }

    const updated = await tx.restaurantTableSession.update({
      where: { id: session.id },
      data: {
        billingMode: input.billingMode,
        guestCount: input.guestCount
      },
      include: { table: true }
    });
    const service = await sessionServiceSummaryInTx(tx, tenantId, updated);
    return { session: updated, service };
  });
}

async function setWaiterDraftItem(tenantId, user, sessionId, menuItemId, quantity, seatNumber = null) {
  return prisma.$transaction(async (tx) => {
    const ctx = await ensureDraftContext(tx, tenantId, user, sessionId, true);
    const seat = normalizeSeatNumber(ctx.session, seatNumber);
    const requestedQty = qty(quantity);
    const existing = await tx.restaurantOrderItem.findFirst({
      where: { tenantId, orderId: ctx.order.id, menuItemId, seatNumber: seat }
    });
    const oldDetail = existing ? await tx.detalleComprobante.findFirst({ where: { id: existing.saleDetailId, tenantId, comprobanteId: ctx.sale.id } }) : null;

    if (requestedQty.eq(0)) {
      if (!existing || !oldDetail) return loadDraft(tenantId, ctx.order.id, tx);
      await tx.restaurantOrderItem.delete({ where: { id: existing.id } });
      await tx.detalleComprobante.delete({ where: { id: oldDetail.id } });
      await tx.restaurantOrder.update({ where: { id: ctx.order.id }, data: { total: { decrement: oldDetail.totalLinea } } });
      await tx.comprobanteComercial.update({
        where: { id: ctx.sale.id },
        data: {
          subtotal: { decrement: oldDetail.subtotalLinea },
          ivaTotal: { decrement: oldDetail.ivaValor },
          impoconsumoTotal: { decrement: oldDetail.impoconsumoValor },
          total: { decrement: oldDetail.totalLinea }
        }
      });
      return loadDraft(tenantId, ctx.order.id, tx);
    }

    const line = await resolveMenuLine(tx, tenantId, menuItemId, requestedQty);
    if (existing && oldDetail) {
      const deltaSubtotal = money(line.subtotal.minus(oldDetail.subtotalLinea));
      const deltaIva = money(line.iva.minus(oldDetail.ivaValor));
      const deltaImpoconsumo = money(line.impoconsumo.minus(oldDetail.impoconsumoValor));
      const deltaTotal = money(line.total.minus(oldDetail.totalLinea));
      await tx.detalleComprobante.update({ where: { id: oldDetail.id }, data: detailValues(line) });
      await tx.restaurantOrderItem.update({
        where: { id: existing.id },
        data: {
          productId: line.product.id,
          description: line.product.nombre,
          quantity: line.q,
          unitPrice: line.price,
          lineTotal: line.total,
          station: line.menu.station,
          seatNumber: seat
        }
      });
      await tx.restaurantOrder.update({ where: { id: ctx.order.id }, data: { total: { increment: deltaTotal } } });
      await tx.comprobanteComercial.update({
        where: { id: ctx.sale.id },
        data: {
          subtotal: { increment: deltaSubtotal },
          ivaTotal: { increment: deltaIva },
          impoconsumoTotal: { increment: deltaImpoconsumo },
          total: { increment: deltaTotal }
        }
      });
    } else {
      const detail = await tx.detalleComprobante.create({
        data: { tenantId, comprobanteId: ctx.sale.id, productoId: line.product.id, ...detailValues(line) }
      });
      await tx.restaurantOrderItem.create({
        data: {
          tenantId,
          orderId: ctx.order.id,
          menuItemId: line.menu.id,
          productId: line.product.id,
          saleDetailId: detail.id,
          description: line.product.nombre,
          quantity: line.q,
          unitPrice: line.price,
          lineTotal: line.total,
          station: line.menu.station,
          seatNumber: seat
        }
      });
      await tx.restaurantOrder.update({ where: { id: ctx.order.id }, data: { total: { increment: line.total } } });
      await tx.comprobanteComercial.update({
        where: { id: ctx.sale.id },
        data: {
          subtotal: { increment: line.subtotal },
          ivaTotal: { increment: line.iva },
          impoconsumoTotal: { increment: line.impoconsumo },
          total: { increment: line.total }
        }
      });
    }
    return loadDraft(tenantId, ctx.order.id, tx);
  });
}

async function updateOrderItemMeta(tenantId, user, sessionId, itemId, input) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.restaurantTableSession.findFirst({
      where: { id: sessionId, tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
      include: { table: true }
    });
    if (!session) throw new AppError(404, 'Sesión de mesa abierta no encontrada', 'RESTAURANT_SESSION_NOT_FOUND');
    assertWaiterSessionAccess(user, session);
    const item = await tx.restaurantOrderItem.findFirst({
      where: { id: itemId, tenantId },
      include: { order: true }
    });
    if (!item || item.order.sessionId !== session.id) throw new AppError(404, 'Ítem del pedido no encontrado en esta mesa', 'RESTAURANT_ORDER_ITEM_NOT_FOUND');

    const data = {};
    if (Object.prototype.hasOwnProperty.call(input, 'seatNumber')) data.seatNumber = normalizeSeatNumber(session, input.seatNumber);
    if (Object.prototype.hasOwnProperty.call(input, 'notes')) {
      if (item.order.state !== 'BORRADOR') {
        throw new AppError(409, 'Las notas de cocina sólo pueden editarse antes de enviar la ronda.', 'RESTAURANT_SENT_ITEM_NOTES_LOCKED');
      }
      data.notes = input.notes ? String(input.notes).trim() : null;
    }
    const updated = await tx.restaurantOrderItem.update({ where: { id: item.id }, data });
    const service = await sessionServiceSummaryInTx(tx, tenantId, session);
    return { item: updated, service };
  });
}

async function sendWaiterDraft(tenantId, user, sessionId) {
  return prisma.$transaction(async (tx) => {
    const ctx = await ensureDraftContext(tx, tenantId, user, sessionId, false);
    if (!ctx.order) throw new AppError(409, 'No hay pedido en curso para enviar', 'RESTAURANT_DRAFT_ORDER_NOT_FOUND');
    const items = await tx.restaurantOrderItem.findMany({ where: { tenantId, orderId: ctx.order.id }, orderBy: { creadoEn: 'asc' } });
    if (!items.length) throw new AppError(409, 'Agregue al menos un ítem antes de enviar', 'RESTAURANT_DRAFT_ORDER_EMPTY');
    if (ctx.session.billingMode === 'INDIVIDUAL') {
      const invalid = items.find((item) => !Number.isInteger(Number(item.seatNumber)) || Number(item.seatNumber) < 1 || Number(item.seatNumber) > Number(ctx.session.guestCount));
      if (invalid) throw new AppError(409, 'Asigna cada producto a una persona antes de enviarlo.', 'RESTAURANT_INDIVIDUAL_ITEM_UNASSIGNED');
    }

    const config = await tx.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
    const byStation = new Map();
    for (const item of items) {
      if (!byStation.has(item.station)) byStation.set(item.station, []);
      byStation.get(item.station).push(item);
    }
    for (const [station, stationItems] of byStation.entries()) {
      await tx.restaurantCommand.create({
        data: {
          tenantId,
          orderId: ctx.order.id,
          station,
          printMode: config.printMode,
          simulationRecord: {
            mode: config.printMode,
            simulated: config.printMode === 'SIMULATED_SCREEN',
            watermark: config.printMode === 'SIMULATED_SCREEN' ? 'COMANDA SIMULADA — NO IMPRESA EN HARDWARE' : null,
            generatedAt: new Date().toISOString(),
            table: { id: ctx.session.table.id, code: ctx.session.table.code, name: ctx.session.table.name },
            billingMode: ctx.session.billingMode,
            orderId: ctx.order.id,
            source: 'MESERO',
            station,
            items: stationItems.map((item) => ({
              description: item.description,
              quantity: String(item.quantity),
              seatNumber: item.seatNumber,
              seatLabel: item.seatNumber ? `Persona ${item.seatNumber}` : null,
              notes: item.notes || null
            }))
          }
        }
      });
    }
    await tx.restaurantOrder.update({ where: { id: ctx.order.id }, data: { state: 'ENVIADO' } });
    if (ctx.session.state === 'CUENTA_PEDIDA' || ctx.session.accountPreparedAt || ctx.session.cashierRequestedAt) {
      await tx.restaurantTableSession.update({
        where: { id: ctx.session.id },
        data: {
          state: 'ABIERTA',
          accountPreparedAt: null,
          cashierRequestedAt: null,
          accountRequestedAt: null
        }
      });
      await tx.restaurantTable.update({ where: { id: ctx.session.tableId }, data: { state: 'OCUPADA' } });
    }
    return tx.restaurantOrder.findUnique({
      where: { id: ctx.order.id },
      include: { items: true, commands: true, session: { include: { table: true } } }
    });
  });
}

async function validateBillReadyInTx(tx, tenantId, user, tableId) {
  const session = await tx.restaurantTableSession.findFirst({
    where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    include: { table: true }
  });
  if (!session) throw new AppError(404, 'No hay cuenta abierta para esta mesa', 'RESTAURANT_SESSION_NOT_FOUND');
  assertWaiterSessionAccess(user, session);

  const orderIds = await sessionOrderIds(tx, tenantId, session.id);
  const draftOrders = await tx.restaurantOrder.findMany({
    where: { tenantId, sessionId: session.id, state: 'BORRADOR' },
    select: { id: true }
  });
  if (draftOrders.length) {
    const draftItem = await tx.restaurantOrderItem.findFirst({ where: { tenantId, orderId: { in: draftOrders.map((row) => row.id) } }, select: { id: true } });
    if (draftItem) throw new AppError(409, 'Hay productos sin enviar. Envíalos a cocina/barra o retíralos antes de preparar la cuenta.', 'RESTAURANT_UNSENT_DRAFT_ORDER');
  }
  if (!orderIds.length) throw new AppError(409, 'La mesa todavía no tiene consumos.', 'RESTAURANT_EMPTY_TABLE_BILL');
  const item = await tx.restaurantOrderItem.findFirst({ where: { tenantId, orderId: { in: orderIds } }, select: { id: true } });
  if (!item) throw new AppError(409, 'La mesa todavía no tiene consumos.', 'RESTAURANT_EMPTY_TABLE_BILL');

  const service = await sessionServiceSummaryInTx(tx, tenantId, session);
  if (session.billingMode === 'INDIVIDUAL' && service.unassigned.items.length) {
    throw new AppError(409, 'Hay productos sin persona asignada. Asígnalos antes de preparar la cuenta individual.', 'RESTAURANT_INDIVIDUAL_ITEM_UNASSIGNED');
  }
  return { session, service };
}

async function prepareAccount(tenantId, user, tableId) {
  return prisma.$transaction(async (tx) => {
    const { session, service } = await validateBillReadyInTx(tx, tenantId, user, tableId);
    const preparedAt = new Date();
    const updated = await tx.restaurantTableSession.update({
      where: { id: session.id },
      data: { accountPreparedAt: preparedAt },
      include: { table: true }
    });
    return { session: updated, service: { ...service, accountPreparedAt: preparedAt } };
  });
}

async function sendAccountToCash(tenantId, user, tableId) {
  return prisma.$transaction(async (tx) => {
    const { session, service } = await validateBillReadyInTx(tx, tenantId, user, tableId);
    const now = new Date();
    const updated = await tx.restaurantTableSession.update({
      where: { id: session.id },
      data: {
        state: 'CUENTA_PEDIDA',
        accountPreparedAt: session.accountPreparedAt || now,
        cashierRequestedAt: now,
        accountRequestedAt: now
      },
      include: { table: true }
    });
    await tx.restaurantTable.update({ where: { id: tableId }, data: { state: 'CUENTA_PEDIDA' } });
    return {
      session: updated,
      service: {
        ...service,
        accountPreparedAt: updated.accountPreparedAt,
        cashierRequestedAt: now,
        accountRequestedAt: now
      }
    };
  });
}

async function closeTableGuarded(tenantId, user, tableId, input) {
  const session = await prisma.restaurantTableSession.findFirst({ where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } } });
  if (session) {
    const pending = await prisma.restaurantOrder.findFirst({ where: { tenantId, sessionId: session.id, state: 'BORRADOR' }, include: { _count: { select: { items: true } } } });
    if (pending?._count?.items) throw new AppError(409, 'Hay un pedido del mesero sin enviar. Envíelo o retire sus líneas antes de cerrar la mesa.', 'RESTAURANT_UNSENT_DRAFT_ORDER');
  }
  return base.closeTable(tenantId, user, tableId, input);
}

async function cashShiftSummary(tenantId, userId, shiftId) {
  const shift = await prisma.aperturaCierreCaja.findFirst({ where: { id: shiftId, tenantId } });
  if (!shift) throw new AppError(404, 'Turno de caja no encontrado', 'RESTAURANT_CASH_SHIFT_NOT_FOUND');
  if (shift.userId !== userId) throw new AppError(403, 'El turno pertenece a otro usuario', 'CASH_SESSION_USER_MISMATCH');
  const end = shift.cerradoEn || new Date();
  const sessions = await prisma.restaurantTableSession.findMany({
    where: {
      tenantId,
      state: 'CERRADA',
      closedByUserId: userId,
      closedAt: { gte: shift.abiertoEn, lte: end }
    },
    include: { table: true }
  });
  const saleIds = sessions.map((x) => x.saleId);
  const sales = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds } },
    select: { id: true, numero: true, total: true, formaPago: true, cajaBancoId: true }
  }) : [];
  const saleById = new Map(sales.map((x) => [x.id, x]));
  const rows = sessions.map((session) => {
    const sale = saleById.get(session.saleId);
    const tip = money(session.tipAmount || 0);
    const saleTotal = money(sale?.total || 0);
    return {
      sessionId: session.id,
      table: session.table.name,
      saleNumber: sale?.numero || null,
      formaPago: sale?.formaPago || null,
      saleTotal: saleTotal.toString(),
      tipAmount: tip.toString(),
      total: money(saleTotal.plus(tip)).toString()
    };
  });
  const cashSales = money(rows.filter((x) => x.formaPago === 'EFECTIVO').reduce((acc, x) => acc.plus(x.total), decimal(0)));
  const electronicSales = money(rows.filter((x) => x.formaPago === 'BANCO').reduce((acc, x) => acc.plus(x.total), decimal(0)));
  const creditSales = money(rows.filter((x) => x.formaPago === 'CREDITO').reduce((acc, x) => acc.plus(x.total), decimal(0)));
  const tips = money(rows.reduce((acc, x) => acc.plus(x.tipAmount), decimal(0)));
  const restaurantTotal = money(rows.reduce((acc, x) => acc.plus(x.total), decimal(0)));
  const expectedDrawer = money(decimal(shift.saldoInicial).plus(shift.ingresosEfectivo).minus(shift.egresosEfectivo));
  return {
    shift,
    tables: rows,
    paymentBreakdown: { cashSales, electronicSales, creditSales, tips, restaurantTotal },
    restaurantClosedTablesTotal: restaurantTotal,
    systemCashExpected: expectedDrawer,
    restaurantCashRecorded: shift.ingresosEfectivo,
    voucherRecorded: shift.ingresosVoucher
  };
}

async function publicQrContext(token) {
  const ctx = await base.getQrContext(token);
  const theme = await themeService.getTheme(ctx.tenantId);
  return { ...ctx, theme, restaurantName: theme.restaurantName };
}

module.exports = {
  uiContext,
  listTablesLive,
  getWaiterDraft,
  updateTableServiceSetup,
  setWaiterDraftItem,
  updateOrderItemMeta,
  sendWaiterDraft,
  prepareAccount,
  sendAccountToCash,
  closeTableGuarded,
  cashShiftSummary,
  publicQrContext
};
