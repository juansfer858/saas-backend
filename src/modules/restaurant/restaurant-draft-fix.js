const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money, qty, pct } = require('../../utils/decimal');
const identity = require('./restaurant-identity.service');

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

async function ensureDraftContext(tx, tenantId, user, sessionId, create = true) {
  const session = await tx.restaurantTableSession.findFirst({
    where: { id: sessionId, tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    include: { table: true }
  });
  if (!session) throw new AppError(404, 'Sesión de mesa abierta no encontrada', 'RESTAURANT_SESSION_NOT_FOUND');
  if (user?.rol === 'MESERO' && session.table.assignedWaiterId !== user.id) {
    throw new AppError(403, 'La mesa no está asignada a este mesero', 'RESTAURANT_WAITER_TABLE_FORBIDDEN');
  }
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

async function getWaiterDraft(tenantId, user, sessionId) {
  return prisma.$transaction(async (tx) => {
    const ctx = await ensureDraftContext(tx, tenantId, user, sessionId, false);
    if (!ctx.order) return { order: null, sale: ctx.sale, session: ctx.session };
    const loaded = await loadDraft(tenantId, ctx.order.id, tx);
    return { ...loaded, session: ctx.session };
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

async function setWaiterDraftItem(tenantId, user, sessionId, menuItemId, quantity) {
  return prisma.$transaction(async (tx) => {
    const ctx = await ensureDraftContext(tx, tenantId, user, sessionId, true);
    const requestedQty = qty(quantity);
    const existing = await tx.restaurantOrderItem.findFirst({ where: { tenantId, orderId: ctx.order.id, menuItemId } });
    const oldDetail = existing ? await tx.detalleComprobante.findFirst({ where: { id: existing.saleDetailId, tenantId, comprobanteId: ctx.sale.id } }) : null;

    if (requestedQty.eq(0)) {
      if (!existing || !oldDetail) return loadDraft(tenantId, ctx.order.id, tx);
      await tx.restaurantOrderItem.delete({ where: { id: existing.id } });
      await tx.detalleComprobante.delete({ where: { id: oldDetail.id } });
      await tx.restaurantOrder.update({ where: { id: ctx.order.id }, data: { total: { decrement: oldDetail.totalLinea } } });
      await tx.comprobanteComercial.update({ where: { id: ctx.sale.id }, data: {
        subtotal: { decrement: oldDetail.subtotalLinea }, ivaTotal: { decrement: oldDetail.ivaValor },
        impoconsumoTotal: { decrement: oldDetail.impoconsumoValor }, total: { decrement: oldDetail.totalLinea }
      } });
      return loadDraft(tenantId, ctx.order.id, tx);
    }

    const line = await resolveMenuLine(tx, tenantId, menuItemId, requestedQty);
    if (existing && oldDetail) {
      const deltaSubtotal = money(line.subtotal.minus(oldDetail.subtotalLinea));
      const deltaIva = money(line.iva.minus(oldDetail.ivaValor));
      const deltaImpoconsumo = money(line.impoconsumo.minus(oldDetail.impoconsumoValor));
      const deltaTotal = money(line.total.minus(oldDetail.totalLinea));
      await tx.detalleComprobante.update({ where: { id: oldDetail.id }, data: detailValues(line) });
      await tx.restaurantOrderItem.update({ where: { id: existing.id }, data: {
        productId: line.product.id, description: line.product.nombre, quantity: line.q,
        unitPrice: line.price, lineTotal: line.total, station: line.menu.station
      } });
      await tx.restaurantOrder.update({ where: { id: ctx.order.id }, data: { total: { increment: deltaTotal } } });
      await tx.comprobanteComercial.update({ where: { id: ctx.sale.id }, data: {
        subtotal: { increment: deltaSubtotal }, ivaTotal: { increment: deltaIva },
        impoconsumoTotal: { increment: deltaImpoconsumo }, total: { increment: deltaTotal }
      } });
    } else {
      const detail = await tx.detalleComprobante.create({ data: {
        tenantId, comprobanteId: ctx.sale.id, productoId: line.product.id, ...detailValues(line)
      } });
      await tx.restaurantOrderItem.create({ data: {
        tenantId, orderId: ctx.order.id, menuItemId: line.menu.id, productId: line.product.id,
        saleDetailId: detail.id, description: line.product.nombre, quantity: line.q,
        unitPrice: line.price, lineTotal: line.total, station: line.menu.station
      } });
      await tx.restaurantOrder.update({ where: { id: ctx.order.id }, data: { total: { increment: line.total } } });
      await tx.comprobanteComercial.update({ where: { id: ctx.sale.id }, data: {
        subtotal: { increment: line.subtotal }, ivaTotal: { increment: line.iva },
        impoconsumoTotal: { increment: line.impoconsumo }, total: { increment: line.total }
      } });
    }
    return loadDraft(tenantId, ctx.order.id, tx);
  });
}

async function sendWaiterDraft(tenantId, user, sessionId) {
  return prisma.$transaction(async (tx) => {
    const ctx = await ensureDraftContext(tx, tenantId, user, sessionId, false);
    if (!ctx.order) throw new AppError(409, 'No hay pedido en curso para enviar', 'RESTAURANT_DRAFT_ORDER_NOT_FOUND');
    const items = await tx.restaurantOrderItem.findMany({ where: { tenantId, orderId: ctx.order.id }, orderBy: { creadoEn: 'asc' } });
    if (!items.length) throw new AppError(409, 'Agregue al menos un ítem antes de enviar', 'RESTAURANT_DRAFT_ORDER_EMPTY');
    const config = await tx.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
    const byStation = new Map();
    for (const item of items) {
      if (!byStation.has(item.station)) byStation.set(item.station, []);
      byStation.get(item.station).push(item);
    }
    for (const [station, stationItems] of byStation.entries()) {
      await tx.restaurantCommand.create({ data: {
        tenantId, orderId: ctx.order.id, station, printMode: config.printMode,
        simulationRecord: {
          mode: config.printMode,
          simulated: config.printMode === 'SIMULATED_SCREEN',
          watermark: config.printMode === 'SIMULATED_SCREEN' ? 'COMANDA SIMULADA — NO IMPRESA EN HARDWARE' : null,
          generatedAt: new Date().toISOString(),
          table: { id: ctx.session.table.id, code: ctx.session.table.code, name: ctx.session.table.name },
          orderId: ctx.order.id, source: 'MESERO', station,
          items: stationItems.map((item) => ({ description: item.description, quantity: String(item.quantity), notes: item.notes || null }))
        }
      } });
    }
    await tx.restaurantOrder.update({ where: { id: ctx.order.id }, data: { state: 'ENVIADO' } });
    if (ctx.session.state === 'CUENTA_PEDIDA') {
      await tx.restaurantTableSession.update({ where: { id: ctx.session.id }, data: { state: 'ABIERTA', accountRequestedAt: null } });
      await tx.restaurantTable.update({ where: { id: ctx.session.tableId }, data: { state: 'OCUPADA' } });
    }
    return tx.restaurantOrder.findUnique({ where: { id: ctx.order.id }, include: { items: true, commands: true, session: { include: { table: true } } } });
  });
}

identity.getWaiterDraft = getWaiterDraft;
identity.setWaiterDraftItem = setWaiterDraftItem;
identity.sendWaiterDraft = sendWaiterDraft;

module.exports = { getWaiterDraft, setWaiterDraftItem, sendWaiterDraft };
