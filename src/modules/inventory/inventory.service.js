const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money, qty } = require('../../utils/decimal');

const ENTRY_TYPES = new Set(['COMPRA', 'AJUSTE_ENTRADA', 'DEVOLUCION_VENTA']);
const EXIT_TYPES = new Set(['VENTA', 'AJUSTE_SALIDA', 'MERMA', 'DEVOLUCION_COMPRA']);

async function createProduct(tenantId, input) {
  try {
    return await prisma.producto.create({ data: { tenantId, ...input } });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new AppError(409, 'El SKU ya existe en esta empresa', 'PRODUCT_SKU_EXISTS');
    }
    throw error;
  }
}

async function listProducts(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.tipo) where.tipo = filters.tipo;
  if (filters.activo !== undefined) where.activo = filters.activo;
  if (filters.q) {
    where.OR = [
      { sku: { contains: filters.q, mode: 'insensitive' } },
      { nombre: { contains: filters.q, mode: 'insensitive' } },
      { codigoBarras: { contains: filters.q, mode: 'insensitive' } }
    ];
  }

  return prisma.producto.findMany({
    where,
    orderBy: { nombre: 'asc' },
    take: Math.min(Number(filters.limit) || 100, 500)
  });
}

async function getProduct(tenantId, id, client = prisma) {
  const product = await client.producto.findFirst({ where: { id, tenantId } });
  if (!product) throw new AppError(404, 'Producto no encontrado', 'PRODUCT_NOT_FOUND');
  return product;
}

async function updateProduct(tenantId, id, input) {
  await getProduct(tenantId, id);
  try {
    return await prisma.producto.update({ where: { id }, data: input });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new AppError(409, 'El SKU ya existe en esta empresa', 'PRODUCT_SKU_EXISTS');
    }
    throw error;
  }
}

async function deactivateProduct(tenantId, id) {
  await getProduct(tenantId, id);
  return prisma.producto.update({ where: { id }, data: { activo: false } });
}

async function applyMovement(tx, params) {
  const product = await getProduct(params.tenantId, params.productoId, tx);

  if (product.tipo === 'SERVICIO' || !product.controlaInventario) {
    return { movement: null, product, costOfMovement: money(0) };
  }

  const quantity = qty(params.cantidad);
  if (quantity.lte(0)) {
    throw new AppError(400, 'La cantidad debe ser mayor que cero', 'INVENTORY_INVALID_QTY');
  }

  const oldStock = qty(product.stockActual);
  const oldAvg = decimal(product.costoPromedio);
  let newStock;
  let newAvg;
  let unitCost;

  if (ENTRY_TYPES.has(params.tipo)) {
    unitCost = decimal(params.costoUnitario || 0).toDecimalPlaces(4);
    if (unitCost.lt(0)) throw new AppError(400, 'Costo inválido', 'INVENTORY_INVALID_COST');

    newStock = oldStock.plus(quantity).toDecimalPlaces(4);
    const oldValue = oldStock.mul(oldAvg);
    const incomingValue = quantity.mul(unitCost);
    newAvg = newStock.gt(0)
      ? oldValue.plus(incomingValue).div(newStock).toDecimalPlaces(4)
      : unitCost;
  } else if (EXIT_TYPES.has(params.tipo)) {
    if (oldStock.lt(quantity)) {
      throw new AppError(409, `Stock insuficiente para ${product.nombre}`, 'INVENTORY_INSUFFICIENT_STOCK', {
        productoId: product.id,
        stockActual: oldStock.toString(),
        solicitado: quantity.toString()
      });
    }

    unitCost = oldAvg;
    newStock = oldStock.minus(quantity).toDecimalPlaces(4);
    newAvg = oldAvg;
  } else {
    throw new AppError(400, 'Tipo de movimiento de inventario inválido', 'INVENTORY_INVALID_MOVEMENT');
  }

  const costOfMovement = money(quantity.mul(unitCost));

  const updatedProduct = await tx.producto.update({
    where: { id: product.id },
    data: {
      stockActual: newStock,
      costoPromedio: newAvg
    }
  });

  const movement = await tx.movimientoInventario.create({
    data: {
      tenantId: params.tenantId,
      productoId: product.id,
      comprobanteId: params.comprobanteId || null,
      tipo: params.tipo,
      cantidad: quantity,
      costoUnitario: unitCost,
      costoTotal: costOfMovement,
      stockAnterior: oldStock,
      stockNuevo: newStock,
      costoPromedioAnterior: oldAvg,
      costoPromedioNuevo: newAvg,
      referencia: params.referencia || null
    }
  });

  return { movement, product: updatedProduct, costOfMovement };
}

async function reverseDocumentMovementsInTx(tx, params) {
  const originals = await tx.movimientoInventario.findMany({
    where: {
      tenantId: params.tenantId,
      comprobanteId: params.comprobanteId,
      tipo: { in: ['VENTA', 'COMPRA'] }
    },
    orderBy: { creadoEn: 'asc' }
  });

  const reversals = [];
  for (const movement of originals) {
    const reverseType = movement.tipo === 'VENTA' ? 'DEVOLUCION_VENTA' : 'DEVOLUCION_COMPRA';
    const result = await applyMovement(tx, {
      tenantId: params.tenantId,
      productoId: movement.productoId,
      comprobanteId: params.reversalDocumentId || null,
      tipo: reverseType,
      cantidad: movement.cantidad,
      costoUnitario: movement.tipo === 'VENTA' ? movement.costoUnitario : undefined,
      referencia: params.referencia || `REV-${movement.referencia || params.comprobanteId}`
    });
    if (result.movement) reversals.push(result.movement);
  }

  return reversals;
}

async function createManualMovement(tenantId, input) {
  return prisma.$transaction((tx) => applyMovement(tx, { tenantId, ...input }));
}

async function listMovements(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.productoId) where.productoId = filters.productoId;
  if (filters.tipo) where.tipo = filters.tipo;
  if (filters.desde || filters.hasta) {
    where.creadoEn = {};
    if (filters.desde) where.creadoEn.gte = new Date(filters.desde);
    if (filters.hasta) where.creadoEn.lte = new Date(filters.hasta);
  }

  return prisma.movimientoInventario.findMany({
    where,
    include: { producto: { select: { id: true, sku: true, nombre: true } } },
    orderBy: { creadoEn: 'desc' },
    take: Math.min(Number(filters.limit) || 100, 500)
  });
}

module.exports = {
  createProduct,
  listProducts,
  getProduct,
  updateProduct,
  deactivateProduct,
  applyMovement,
  reverseDocumentMovementsInTx,
  createManualMovement,
  listMovements
};
