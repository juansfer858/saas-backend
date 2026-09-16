const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { qty } = require('../../utils/decimal');

async function getProduct(tenantId, productId, client = prisma) {
  const product = await client.producto.findFirst({ where: { id: productId, tenantId, activo: true } });
  if (!product) throw new AppError(404, 'Producto no encontrado', 'PRODUCT_NOT_FOUND');
  return product;
}

async function reservedQuantity(client, tenantId, productId, options = {}) {
  const where = { tenantId, productId, state: 'ACTIVE' };
  if (options.excludeSourceLineId) where.sourceLineId = { not: options.excludeSourceLineId };
  const result = await client.inventoryReservation.aggregate({ where, _sum: { quantity: true } });
  return qty(result._sum.quantity || 0);
}

async function availability(tenantId, productId, client = prisma) {
  const product = await getProduct(tenantId, productId, client);
  const reserved = await reservedQuantity(client, tenantId, productId);
  const physical = qty(product.stockActual);
  return { product, physical, reserved, available: physical.minus(reserved).toDecimalPlaces(4) };
}

async function reserveInTx(tx, params) {
  const quantity = qty(params.quantity);
  if (quantity.lte(0)) throw new AppError(400, 'La cantidad a reservar debe ser mayor que cero', 'INVENTORY_RESERVATION_INVALID_QTY');
  const product = await getProduct(params.tenantId, params.productId, tx);
  if (product.tipo !== 'PRODUCTO' || !product.controlaInventario) throw new AppError(409, 'El producto no admite reserva de inventario', 'INVENTORY_RESERVATION_NOT_APPLICABLE');

  const key = { tenantId_sourceType_sourceLineId: { tenantId: params.tenantId, sourceType: params.sourceType, sourceLineId: params.sourceLineId } };
  const existing = await tx.inventoryReservation.findUnique({ where: key });
  if (existing?.state === 'ACTIVE') {
    if (existing.productId !== params.productId || !qty(existing.quantity).eq(quantity)) throw new AppError(409, 'La línea ya tiene una reserva diferente', 'INVENTORY_RESERVATION_CONFLICT');
    return existing;
  }

  const currentReserved = await reservedQuantity(tx, params.tenantId, params.productId, { excludeSourceLineId: params.sourceLineId });
  const available = qty(product.stockActual).minus(currentReserved);
  if (available.lt(quantity)) {
    throw new AppError(409, `Stock disponible insuficiente para reservar ${product.nombre}`, 'INVENTORY_RESERVATION_INSUFFICIENT_STOCK', {
      productId: product.id,
      physical: qty(product.stockActual).toString(),
      reserved: currentReserved.toString(),
      available: available.toString(),
      requested: quantity.toString()
    });
  }

  if (existing) {
    return tx.inventoryReservation.update({
      where: { id: existing.id },
      data: {
        productId: params.productId,
        sourceId: params.sourceId,
        quantity,
        state: 'ACTIVE',
        createdByUserId: params.createdByUserId || null,
        expiresAt: params.expiresAt || null,
        metadata: params.metadata || undefined,
        releasedAt: null,
        consumedAt: null
      }
    });
  }

  return tx.inventoryReservation.create({
    data: {
      tenantId: params.tenantId,
      productId: params.productId,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      sourceLineId: params.sourceLineId,
      quantity,
      state: 'ACTIVE',
      createdByUserId: params.createdByUserId || null,
      expiresAt: params.expiresAt || null,
      metadata: params.metadata || undefined
    }
  });
}

async function reserve(params) {
  return prisma.$transaction((tx) => reserveInTx(tx, params));
}

async function releaseSourceLineInTx(tx, tenantId, sourceType, sourceLineId, state = 'RELEASED') {
  const current = await tx.inventoryReservation.findUnique({ where: { tenantId_sourceType_sourceLineId: { tenantId, sourceType, sourceLineId } } });
  if (!current || current.state !== 'ACTIVE') return current;
  return tx.inventoryReservation.update({ where: { id: current.id }, data: { state, releasedAt: new Date() } });
}

async function releaseSourceInTx(tx, tenantId, sourceType, sourceId, state = 'RELEASED') {
  const rows = await tx.inventoryReservation.findMany({ where: { tenantId, sourceType, sourceId, state: 'ACTIVE' } });
  if (!rows.length) return [];
  const now = new Date();
  await tx.inventoryReservation.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { state, releasedAt: now } });
  return rows;
}

async function markSourceConsumedInTx(tx, tenantId, sourceType, sourceId) {
  const rows = await tx.inventoryReservation.findMany({ where: { tenantId, sourceType, sourceId, state: { in: ['ACTIVE', 'RELEASED'] } } });
  if (!rows.length) return [];
  const now = new Date();
  await tx.inventoryReservation.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { state: 'CONSUMED', consumedAt: now, releasedAt: now } });
  return rows;
}

async function listReservations(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.productId) where.productId = filters.productId;
  if (filters.sourceType) where.sourceType = filters.sourceType;
  if (filters.sourceId) where.sourceId = filters.sourceId;
  if (filters.state) where.state = filters.state;
  return prisma.inventoryReservation.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(Number(filters.limit) || 100, 500) });
}

module.exports = { availability, reservedQuantity, reserve, reserveInTx, releaseSourceLineInTx, releaseSourceInTx, markSourceConsumedInTx, listReservations };
