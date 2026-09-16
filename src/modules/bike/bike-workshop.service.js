const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money, qty } = require('../../utils/decimal');
const reservations = require('../inventory/inventory-reservation.service');
const commercial = require('../commercial/commercial.service');
const sales = require('../commercial/sales.service');

function workOrderNumber() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `OT-BIKE-${day}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function getBike(tenantId, bikeId, client = prisma) {
  const bike = await client.bikeAsset.findFirst({ where: { id: bikeId, tenantId } });
  if (!bike) throw new AppError(404, 'Bicicleta no encontrada', 'BIKE_NOT_FOUND');
  return bike;
}

async function getWorkOrder(tenantId, id, client = prisma) {
  const workOrder = await client.bikeWorkOrder.findFirst({
    where: { id, tenantId },
    include: {
      bike: true,
      items: { include: { service: true }, orderBy: { createdAt: 'asc' } },
      findings: { orderBy: { createdAt: 'asc' } },
      evidence: { orderBy: { createdAt: 'asc' } },
      finalTests: { orderBy: { testedAt: 'desc' } }
    }
  });
  if (!workOrder) throw new AppError(404, 'Orden Bike no encontrada', 'BIKE_WORK_ORDER_NOT_FOUND');
  return workOrder;
}

async function recalcTotals(tx, tenantId, workOrderId) {
  const items = await tx.bikeWorkOrderItem.findMany({ where: { tenantId, workOrderId, status: { notIn: ['REJECTED', 'CANCELLED'] } } });
  const subtotal = items.reduce((sum, item) => sum.plus(money(item.lineTotal)), money(0));
  return tx.bikeWorkOrder.update({ where: { id: workOrderId }, data: { subtotal, total: subtotal } });
}

async function createWorkOrder(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    const bike = await getBike(tenantId, input.bikeId, tx);
    if (bike.status === 'INACTIVE') throw new AppError(409, 'La bicicleta está inactiva', 'BIKE_INACTIVE');
    const open = await tx.bikeWorkOrder.findFirst({ where: { tenantId, bikeId: bike.id, status: { notIn: ['DELIVERED', 'CANCELLED'] } }, select: { id: true, number: true } });
    if (open) throw new AppError(409, `La bicicleta ya tiene una orden abierta: ${open.number}`, 'BIKE_WORK_ORDER_ALREADY_OPEN');
    const created = await tx.bikeWorkOrder.create({
      data: {
        tenantId,
        branchId: input.branchId || bike.branchId || null,
        number: workOrderNumber(),
        bikeId: bike.id,
        customerThirdPartyId: bike.customerThirdPartyId,
        assignedUserId: input.assignedUserId || null,
        customerRequest: input.customerRequest || null,
        intakeNotes: input.intakeNotes || null,
        estimatedReadyAt: input.estimatedReadyAt || null,
        createdByUserId: userId
      }
    });
    await tx.bikeAsset.update({ where: { id: bike.id }, data: { status: 'IN_WORKSHOP' } });
    return getWorkOrder(tenantId, created.id, tx);
  });
}

async function listWorkOrders(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.status) where.status = filters.status;
  if (filters.bikeId) where.bikeId = filters.bikeId;
  if (filters.customerThirdPartyId) where.customerThirdPartyId = filters.customerThirdPartyId;
  if (filters.assignedUserId) where.assignedUserId = filters.assignedUserId;
  return prisma.bikeWorkOrder.findMany({ where, include: { bike: true, _count: { select: { items: true, findings: true } } }, orderBy: { createdAt: 'desc' }, take: Math.min(Number(filters.limit) || 100, 500) });
}

async function addFinding(tenantId, userId, workOrderId, input) {
  return prisma.$transaction(async (tx) => {
    const workOrder = await getWorkOrder(tenantId, workOrderId, tx);
    if (['DELIVERED', 'CANCELLED'].includes(workOrder.status)) throw new AppError(409, 'La orden está cerrada', 'BIKE_WORK_ORDER_CLOSED');
    const finding = await tx.bikeDiagnosticFinding.create({ data: { tenantId, workOrderId, ...input, createdByUserId: userId } });
    await tx.bikeWorkOrder.update({ where: { id: workOrderId }, data: { status: 'DIAGNOSIS' } });
    return finding;
  });
}

async function addItem(tenantId, workOrderId, input) {
  return prisma.$transaction(async (tx) => {
    const workOrder = await getWorkOrder(tenantId, workOrderId, tx);
    if (['DELIVERED', 'CANCELLED'].includes(workOrder.status)) throw new AppError(409, 'La orden está cerrada', 'BIKE_WORK_ORDER_CLOSED');
    let productId;
    let serviceCatalogId = null;
    let description;
    let unitPrice;
    if (input.type === 'SERVICE') {
      const service = await tx.bikeServiceCatalog.findFirst({ where: { id: input.serviceCatalogId, tenantId, active: true } });
      if (!service) throw new AppError(404, 'Servicio Bike no encontrado', 'BIKE_SERVICE_NOT_FOUND');
      const product = await tx.producto.findFirst({ where: { id: service.productId, tenantId, activo: true, tipo: 'SERVICIO' } });
      if (!product) throw new AppError(409, 'El servicio no tiene un Producto SERVICIO válido en Super Core', 'BIKE_SERVICE_PRODUCT_INVALID');
      productId = product.id;
      serviceCatalogId = service.id;
      description = service.name;
      unitPrice = input.unitPrice ?? Number(service.basePrice);
    } else {
      const product = await tx.producto.findFirst({ where: { id: input.productId, tenantId, activo: true, tipo: 'PRODUCTO' } });
      if (!product) throw new AppError(404, 'Repuesto no encontrado en inventario', 'BIKE_PART_NOT_FOUND');
      productId = product.id;
      description = input.description || product.nombre;
      unitPrice = input.unitPrice ?? Number(product.precio1);
    }
    const quantity = qty(input.quantity || 1);
    const lineTotal = money(quantity.mul(unitPrice));
    const item = await tx.bikeWorkOrderItem.create({ data: { tenantId, workOrderId, type: input.type, serviceCatalogId, productId, description, quantity, unitPrice, lineTotal, status: 'PROPOSED' } });
    await recalcTotals(tx, tenantId, workOrderId);
    await tx.bikeWorkOrder.update({ where: { id: workOrderId }, data: { status: 'WAITING_APPROVAL' } });
    return item;
  });
}

async function authorizeItem(tenantId, userId, workOrderId, itemId, authorizedBy) {
  return prisma.$transaction(async (tx) => {
    await getWorkOrder(tenantId, workOrderId, tx);
    const item = await tx.bikeWorkOrderItem.findFirst({ where: { id: itemId, tenantId, workOrderId } });
    if (!item) throw new AppError(404, 'Línea de OT no encontrada', 'BIKE_WORK_ORDER_ITEM_NOT_FOUND');
    if (item.status !== 'PROPOSED') throw new AppError(409, 'La línea ya fue resuelta', 'BIKE_WORK_ORDER_ITEM_ALREADY_RESOLVED');
    let nextStatus = 'AUTHORIZED';
    let reservation = null;
    if (item.type === 'PART') {
      reservation = await reservations.reserveInTx(tx, { tenantId, productId: item.productId, sourceType: 'BIKE_WORK_ORDER', sourceId: workOrderId, sourceLineId: item.id, quantity: item.quantity, createdByUserId: userId, metadata: { workOrderId, itemId: item.id } });
      nextStatus = 'RESERVED';
    }
    const updated = await tx.bikeWorkOrderItem.update({ where: { id: item.id }, data: { status: nextStatus, authorizedAt: new Date(), authorizedBy: authorizedBy || userId, inventoryRef: reservation?.id || null } });
    const unresolved = await tx.bikeWorkOrderItem.count({ where: { tenantId, workOrderId, status: 'PROPOSED' } });
    if (!unresolved) await tx.bikeWorkOrder.update({ where: { id: workOrderId }, data: { status: 'APPROVED', approvedAt: new Date() } });
    return updated;
  });
}

async function rejectItem(tenantId, workOrderId, itemId, reason) {
  return prisma.$transaction(async (tx) => {
    await getWorkOrder(tenantId, workOrderId, tx);
    const item = await tx.bikeWorkOrderItem.findFirst({ where: { id: itemId, tenantId, workOrderId } });
    if (!item) throw new AppError(404, 'Línea de OT no encontrada', 'BIKE_WORK_ORDER_ITEM_NOT_FOUND');
    if (!['PROPOSED', 'AUTHORIZED', 'RESERVED'].includes(item.status)) throw new AppError(409, 'La línea ya está en ejecución o terminada', 'BIKE_WORK_ORDER_ITEM_LOCKED');
    if (item.status === 'RESERVED') await reservations.releaseSourceLineInTx(tx, tenantId, 'BIKE_WORK_ORDER', item.id, 'CANCELLED');
    const updated = await tx.bikeWorkOrderItem.update({ where: { id: item.id }, data: { status: 'REJECTED', rejectionReason: reason } });
    await recalcTotals(tx, tenantId, workOrderId);
    return updated;
  });
}

async function startItem(tenantId, workOrderId, itemId) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.bikeWorkOrderItem.findFirst({ where: { id: itemId, tenantId, workOrderId } });
    if (!item) throw new AppError(404, 'Línea de OT no encontrada', 'BIKE_WORK_ORDER_ITEM_NOT_FOUND');
    if (item.type !== 'SERVICE' || item.status !== 'AUTHORIZED') throw new AppError(409, 'Solo un servicio autorizado puede iniciarse', 'BIKE_SERVICE_NOT_STARTABLE');
    const updated = await tx.bikeWorkOrderItem.update({ where: { id: item.id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    await tx.bikeWorkOrder.update({ where: { id: workOrderId }, data: { status: 'IN_PROGRESS' } });
    return updated;
  });
}

async function completeItem(tenantId, workOrderId, itemId) {
  const item = await prisma.bikeWorkOrderItem.findFirst({ where: { id: itemId, tenantId, workOrderId } });
  if (!item) throw new AppError(404, 'Línea de OT no encontrada', 'BIKE_WORK_ORDER_ITEM_NOT_FOUND');
  if (item.type !== 'SERVICE' || item.status !== 'IN_PROGRESS') throw new AppError(409, 'El servicio no está en ejecución', 'BIKE_SERVICE_NOT_IN_PROGRESS');
  return prisma.bikeWorkOrderItem.update({ where: { id: item.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
}

async function installPart(tenantId, workOrderId, itemId) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.bikeWorkOrderItem.findFirst({ where: { id: itemId, tenantId, workOrderId } });
    if (!item) throw new AppError(404, 'Línea de OT no encontrada', 'BIKE_WORK_ORDER_ITEM_NOT_FOUND');
    if (item.type !== 'PART' || item.status !== 'RESERVED') throw new AppError(409, 'El repuesto no está reservado', 'BIKE_PART_NOT_RESERVED');
    const reservation = await tx.inventoryReservation.findUnique({ where: { tenantId_sourceType_sourceLineId: { tenantId, sourceType: 'BIKE_WORK_ORDER', sourceLineId: item.id } } });
    if (!reservation || reservation.state !== 'ACTIVE') throw new AppError(409, 'La reserva de inventario ya no está activa', 'BIKE_PART_RESERVATION_MISSING');
    const updated = await tx.bikeWorkOrderItem.update({ where: { id: item.id }, data: { status: 'INSTALLED', completedAt: new Date() } });
    await tx.bikeWorkOrder.update({ where: { id: workOrderId }, data: { status: 'IN_PROGRESS' } });
    return updated;
  });
}

async function finalTest(tenantId, userId, workOrderId, input) {
  return prisma.$transaction(async (tx) => {
    const workOrder = await getWorkOrder(tenantId, workOrderId, tx);
    const blockers = workOrder.items.filter((item) => !['REJECTED', 'CANCELLED'].includes(item.status) && (item.type === 'SERVICE' ? item.status !== 'COMPLETED' : item.status !== 'INSTALLED'));
    if (blockers.length) throw new AppError(409, 'Hay trabajos o repuestos pendientes antes de la prueba final', 'BIKE_FINAL_TEST_BLOCKED', { itemIds: blockers.map((item) => item.id) });
    const test = await tx.bikeFinalTest.create({ data: { tenantId, workOrderId, checklist: input.checklist, approved: input.approved, notes: input.notes || null, testedByUserId: userId } });
    await tx.bikeWorkOrder.update({ where: { id: workOrderId }, data: input.approved ? { status: 'READY', readyAt: new Date() } : { status: 'IN_PROGRESS', readyAt: null } });
    return test;
  });
}

async function createBillingDraft(tenantId, userId, workOrderId, input) {
  const snapshot = await getWorkOrder(tenantId, workOrderId);
  if (snapshot.commercialDocumentId) return sales.get(tenantId, snapshot.commercialDocumentId);
  return prisma.$transaction(async (tx) => {
    const workOrder = await getWorkOrder(tenantId, workOrderId, tx);
    if (workOrder.status !== 'READY') throw new AppError(409, 'La OT debe estar lista y aprobada en prueba final antes de facturar', 'BIKE_WORK_ORDER_NOT_READY');
    const billable = workOrder.items.filter((item) => ['COMPLETED', 'INSTALLED'].includes(item.status));
    if (!billable.length) throw new AppError(409, 'La OT no tiene líneas facturables', 'BIKE_WORK_ORDER_EMPTY');
    const sale = await commercial.createDocumentInTx(tx, tenantId, userId, {
      tipo: 'FACTURA_VENTA',
      estado: 'BORRADOR',
      sourceId: `BIKE-WO-${workOrder.id}`,
      terceroId: workOrder.customerThirdPartyId,
      cajaBancoId: input.cajaBancoId || null,
      formaPago: input.formaPago,
      observaciones: sales.packMeta({ documentType: input.documentType, notes: input.notas || `Orden taller ${workOrder.number}` }),
      detalles: billable.map((item) => ({ productoId: item.productId, descripcion: item.description, cantidad: Number(item.quantity), precioUnitario: Number(item.unitPrice), descuentoPct: 0 }))
    });
    await tx.bikeWorkOrder.update({ where: { id: workOrder.id }, data: { commercialDocumentId: sale.id } });
    return sale;
  });
}

async function emitBilling(tenantId, userId, workOrderId) {
  const snapshot = await getWorkOrder(tenantId, workOrderId);
  if (!snapshot.commercialDocumentId) throw new AppError(409, 'Primero debe crear la venta borrador de la OT', 'BIKE_BILLING_DRAFT_REQUIRED');
  if (snapshot.billedAt) return sales.get(tenantId, snapshot.commercialDocumentId);
  return prisma.$transaction(async (tx) => {
    const workOrder = await getWorkOrder(tenantId, workOrderId, tx);
    await reservations.releaseSourceInTx(tx, tenantId, 'BIKE_WORK_ORDER', workOrder.id, 'RELEASED');
    const sale = await sales.emitSaleInTx(tx, tenantId, userId, workOrder.commercialDocumentId);
    await reservations.markSourceConsumedInTx(tx, tenantId, 'BIKE_WORK_ORDER', workOrder.id);
    await tx.bikeWorkOrder.update({ where: { id: workOrder.id }, data: { billedAt: new Date() } });
    return sale;
  });
}

async function deliverWorkOrder(tenantId, workOrderId) {
  return prisma.$transaction(async (tx) => {
    const workOrder = await getWorkOrder(tenantId, workOrderId, tx);
    if (workOrder.status !== 'READY' || !workOrder.billedAt) throw new AppError(409, 'La OT debe estar lista y facturada antes de entregar', 'BIKE_DELIVERY_BLOCKED');
    await tx.bikeWorkOrder.update({ where: { id: workOrder.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
    await tx.bikeAsset.update({ where: { id: workOrder.bikeId }, data: { status: 'ACTIVE' } });
    return getWorkOrder(tenantId, workOrder.id, tx);
  });
}

async function cancelWorkOrder(tenantId, workOrderId, reason) {
  return prisma.$transaction(async (tx) => {
    const workOrder = await getWorkOrder(tenantId, workOrderId, tx);
    if (workOrder.billedAt) throw new AppError(409, 'Una OT facturada no puede cancelarse desde Taller', 'BIKE_BILLED_ORDER_IMMUTABLE');
    if (workOrder.status === 'DELIVERED') throw new AppError(409, 'La OT ya fue entregada', 'BIKE_WORK_ORDER_DELIVERED');
    await reservations.releaseSourceInTx(tx, tenantId, 'BIKE_WORK_ORDER', workOrder.id, 'CANCELLED');
    await tx.bikeWorkOrderItem.updateMany({ where: { tenantId, workOrderId, status: { notIn: ['COMPLETED', 'INSTALLED', 'REJECTED'] } }, data: { status: 'CANCELLED' } });
    await tx.bikeWorkOrder.update({ where: { id: workOrder.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason } });
    await tx.bikeAsset.update({ where: { id: workOrder.bikeId }, data: { status: 'ACTIVE' } });
    return getWorkOrder(tenantId, workOrder.id, tx);
  });
}

module.exports = {
  createWorkOrder,
  listWorkOrders,
  getWorkOrder,
  addFinding,
  addItem,
  authorizeItem,
  rejectItem,
  startItem,
  completeItem,
  installPart,
  finalTest,
  createBillingDraft,
  emitBilling,
  deliverWorkOrder,
  cancelWorkOrder
};
