'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money, qty, pct } = require('../../utils/decimal');
const commercial = require('../commercial/commercial.service');
const sales = require('../commercial/sales.service');
const treasury = require('../treasury/treasury.service');
const notifications = require('../notifications/notifications.service');

const ACTIVE_STATES = ['NUEVO','CONFIRMADO','EN_PREPARACION','LISTO','EN_CAMINO'];
const COMMAND_STATES = ['PENDIENTE','EN_PREPARACION','LISTA','ENTREGADA','CANCELADA'];
const STATIONS = ['COCINA','BARRA','POSTRES'];
const FEE_SKU = 'REST-DELIVERY-FEE';

function deliveryCode() {
  return `D-${Date.now().toString(36).slice(-6).toUpperCase()}${crypto.randomBytes(1).toString('hex').toUpperCase()}`;
}

function normalizedPhone(value) {
  try { return notifications.normalizePhone(value); }
  catch { return String(value || '').replace(/\D+/g, ''); }
}

function phoneIdentification(phone) {
  return `TEL-${String(phone || '').replace(/\D+/g, '').slice(-15)}`;
}

function calculateLine(product, quantity) {
  const q = qty(quantity);
  if (q.lte(0)) throw new AppError(400, 'La cantidad debe ser mayor que cero', 'RESTAURANT_DELIVERY_QTY_INVALID');
  const price = money(product.precio1 || 0);
  const ivaPct = pct(product.ivaPct || 0);
  const impoconsumoPct = pct(product.impoconsumoPct || 0);
  const subtotal = money(q.mul(price));
  const iva = money(subtotal.mul(ivaPct).div(100));
  const impoconsumo = money(subtotal.mul(impoconsumoPct).div(100));
  const total = money(subtotal.plus(iva).plus(impoconsumo));
  return { q, price, ivaPct, impoconsumoPct, subtotal, iva, impoconsumo, total };
}

async function ensureCustomer(tx, tenantId, input) {
  const phone = normalizedPhone(input.customerPhone);
  if (!phone) throw new AppError(400, 'El domicilio requiere teléfono del cliente', 'RESTAURANT_DELIVERY_PHONE_REQUIRED');
  const identificacion = phoneIdentification(phone);
  return tx.tercero.upsert({
    where: { tenantId_identificacion: { tenantId, identificacion } },
    create: {
      tenantId,
      tipo: 'CLIENTE',
      tipoDocumento: 'OTRO',
      identificacion,
      nombre: input.customerName.trim(),
      razonSocial: input.customerName.trim(),
      direccion: input.address.trim(),
      telefono: phone,
      email: null
    },
    update: {
      activo: true,
      nombre: input.customerName.trim(),
      razonSocial: input.customerName.trim(),
      direccion: input.address.trim(),
      telefono: phone
    }
  });
}

async function ensureDeliveryFeeProduct(tx, tenantId) {
  return tx.producto.upsert({
    where: { tenantId_sku: { tenantId, sku: FEE_SKU } },
    create: {
      tenantId,
      tipo: 'SERVICIO',
      sku: FEE_SKU,
      nombre: 'Servicio de domicilio',
      descripcion: 'Cargo de entrega de pedidos Restaurante',
      unidadMedida: 'UND',
      controlaInventario: false,
      costoPromedio: 0,
      stockActual: 0,
      precio1: 0,
      ivaPct: 0,
      impoconsumoPct: 0,
      activo: true
    },
    update: { activo: true, controlaInventario: false, tipo: 'SERVICIO' }
  });
}

async function resolveMenuLines(tx, tenantId, requests) {
  const menuItemIds = [...new Set(requests.map((row) => row.menuItemId))];
  const menuRows = await tx.restaurantMenuItem.findMany({ where: { tenantId, id: { in: menuItemIds }, active: true } });
  if (menuRows.length !== menuItemIds.length) throw new AppError(400, 'Uno o más productos no pertenecen a la carta activa', 'RESTAURANT_DELIVERY_MENU_INVALID');
  const menuById = new Map(menuRows.map((row) => [row.id, row]));
  const productIds = [...new Set(menuRows.map((row) => row.productId))];
  const [products, recipes] = await Promise.all([
    tx.producto.findMany({ where: { tenantId, id: { in: productIds }, activo: true } }),
    tx.consumptionRecipe.findMany({ where: { tenantId, outputProductId: { in: productIds }, active: true } })
  ]);
  if (products.length !== productIds.length) throw new AppError(409, 'Uno o más productos de la carta ya no están disponibles', 'RESTAURANT_DELIVERY_PRODUCT_INVALID');
  const productById = new Map(products.map((row) => [row.id, row]));
  const recipeProducts = new Set(recipes.map((row) => row.outputProductId));
  return requests.map((request) => {
    const menu = menuById.get(request.menuItemId);
    const product = productById.get(menu.productId);
    if (menu.requiresRecipe && !recipeProducts.has(product.id)) {
      throw new AppError(409, `Configure la receta de ${product.nombre} antes de venderlo`, 'RESTAURANT_RECIPE_REQUIRED');
    }
    return { request, menu, product, ...calculateLine(product, request.quantity) };
  });
}

async function loadDelivery(tenantId, id, client = prisma) {
  const row = await client.restaurantDeliveryOrder.findFirst({
    where: { id, tenantId },
    include: { items: { orderBy: { creadoEn: 'asc' } }, commands: { orderBy: { creadoEn: 'asc' } } }
  });
  if (!row) throw new AppError(404, 'Domicilio no encontrado', 'RESTAURANT_DELIVERY_NOT_FOUND');
  const sale = await client.comprobanteComercial.findFirst({
    where: { id: row.saleId, tenantId },
    select: { id: true, numero: true, estado: true, total: true, saldo: true, formaPago: true }
  });
  return { ...row, sale };
}

async function createDelivery(tenantId, user, input) {
  return prisma.$transaction(async (tx) => {
    const customer = await ensureCustomer(tx, tenantId, input);
    const prepared = await resolveMenuLines(tx, tenantId, input.items);
    const itemsSubtotal = prepared.reduce((acc, line) => money(decimal(acc).plus(line.total)), money(0));
    const deliveryFee = money(input.deliveryFee || 0);
    if (deliveryFee.lt(0)) throw new AppError(400, 'El valor del domicilio no puede ser negativo', 'RESTAURANT_DELIVERY_FEE_INVALID');
    const total = money(decimal(itemsSubtotal).plus(deliveryFee));
    const code = deliveryCode();
    const document = await commercial.createDocumentInTx(tx, tenantId, user.id, {
      tipo: 'FACTURA_VENTA',
      estado: 'BORRADOR',
      sourceId: `REST-DELIVERY-${crypto.randomUUID()}`,
      terceroId: customer.id,
      cajaBancoId: null,
      formaPago: 'CREDITO',
      observaciones: sales.packMeta({ documentType: 'DOCUMENTO_EQUIVALENTE_POS', notes: `Domicilio ${code} · ${input.address.trim()}` }),
      detalles: []
    });

    const delivery = await tx.restaurantDeliveryOrder.create({
      data: {
        tenantId,
        code,
        saleId: document.id,
        channel: input.channel || 'MANUAL',
        customerName: input.customerName.trim(),
        customerPhone: normalizedPhone(input.customerPhone),
        address: input.address.trim(),
        neighborhood: input.neighborhood?.trim() || null,
        deliveryReference: input.deliveryReference?.trim() || null,
        notes: input.notes?.trim() || null,
        itemsSubtotal,
        deliveryFee,
        total,
        createdByUserId: user.id,
        promisedAt: input.promisedAt ? new Date(input.promisedAt) : null
      }
    });

    for (const line of prepared) {
      const detail = await tx.detalleComprobante.create({
        data: {
          tenantId,
          comprobanteId: document.id,
          productoId: line.product.id,
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
        }
      });
      await tx.restaurantDeliveryItem.create({
        data: {
          tenantId,
          deliveryId: delivery.id,
          menuItemId: line.menu.id,
          productId: line.product.id,
          saleDetailId: detail.id,
          description: line.product.nombre,
          quantity: line.q,
          unitPrice: line.price,
          lineTotal: line.total,
          station: line.menu.station,
          notes: line.request.notes?.trim() || null
        }
      });
    }

    if (deliveryFee.gt(0)) {
      const feeProduct = await ensureDeliveryFeeProduct(tx, tenantId);
      await tx.detalleComprobante.create({
        data: {
          tenantId,
          comprobanteId: document.id,
          productoId: feeProduct.id,
          descripcion: 'Servicio de domicilio',
          cantidad: 1,
          precioUnitario: deliveryFee,
          descuentoPct: 0,
          ivaPct: 0,
          impoconsumoPct: 0,
          subtotalLinea: deliveryFee,
          ivaValor: 0,
          impoconsumoValor: 0,
          totalLinea: deliveryFee,
          costoUnitario: 0
        }
      });
    }

    const subtotal = prepared.reduce((acc, line) => money(decimal(acc).plus(line.subtotal)), money(0));
    const iva = prepared.reduce((acc, line) => money(decimal(acc).plus(line.iva)), money(0));
    const impoconsumo = prepared.reduce((acc, line) => money(decimal(acc).plus(line.impoconsumo)), money(0));
    await tx.comprobanteComercial.update({
      where: { id: document.id },
      data: {
        subtotal: money(decimal(subtotal).plus(deliveryFee)),
        ivaTotal: iva,
        impoconsumoTotal: impoconsumo,
        total
      }
    });

    return loadDelivery(tenantId, delivery.id, tx);
  });
}

async function listDeliveries(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.state) where.state = filters.state;
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.activeOnly) where.state = { in: ACTIVE_STATES };
  const rows = await prisma.restaurantDeliveryOrder.findMany({
    where,
    include: { items: { orderBy: { creadoEn: 'asc' } }, commands: { orderBy: { creadoEn: 'asc' } } },
    orderBy: [{ creadoEn: 'asc' }],
    take: Math.min(Number(filters.limit) || 200, 500)
  });
  const saleIds = rows.map((row) => row.saleId);
  const salesRows = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds } },
    select: { id: true, numero: true, estado: true, total: true, saldo: true, formaPago: true }
  }) : [];
  const saleById = new Map(salesRows.map((sale) => [sale.id, sale]));
  return rows.map((row) => ({ ...row, sale: saleById.get(row.saleId) || null }));
}

async function summary(tenantId) {
  const rows = await prisma.restaurantDeliveryOrder.findMany({
    where: { tenantId, state: { in: [...ACTIVE_STATES, 'ENTREGADO'] } },
    select: { state: true, paymentStatus: true, promisedAt: true, creadoEn: true }
  });
  const counts = Object.fromEntries(['NUEVO','CONFIRMADO','EN_PREPARACION','LISTO','EN_CAMINO','ENTREGADO'].map((state) => [state, 0]));
  for (const row of rows) if (counts[row.state] !== undefined) counts[row.state] += 1;
  const now = Date.now();
  const late = rows.filter((row) => ACTIVE_STATES.includes(row.state) && row.promisedAt && new Date(row.promisedAt).getTime() < now).length;
  const unpaid = rows.filter((row) => row.paymentStatus === 'PENDIENTE' && row.state !== 'CANCELADO').length;
  return { counts, late, unpaid, active: ACTIVE_STATES.reduce((sum, state) => sum + (counts[state] || 0), 0) };
}

async function recentCustomerByPhone(tenantId, phone) {
  const normalized = normalizedPhone(phone);
  if (!normalized) return null;
  const row = await prisma.restaurantDeliveryOrder.findFirst({
    where: { tenantId, customerPhone: normalized, state: { not: 'CANCELADO' } },
    orderBy: { creadoEn: 'desc' },
    select: { customerName: true, customerPhone: true, address: true, neighborhood: true, deliveryReference: true, creadoEn: true }
  });
  return row || null;
}

async function acceptDelivery(tenantId, user, id) {
  return prisma.$transaction(async (tx) => {
    const delivery = await tx.restaurantDeliveryOrder.findFirst({ where: { id, tenantId }, include: { items: true, commands: true } });
    if (!delivery) throw new AppError(404, 'Domicilio no encontrado', 'RESTAURANT_DELIVERY_NOT_FOUND');
    if (delivery.state !== 'NUEVO') return loadDelivery(tenantId, id, tx);
    const config = await tx.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
    const byStation = new Map();
    for (const item of delivery.items) {
      if (!byStation.has(item.station)) byStation.set(item.station, []);
      byStation.get(item.station).push(item);
    }
    for (const [station, items] of byStation.entries()) {
      await tx.restaurantDeliveryCommand.create({
        data: {
          tenantId,
          deliveryId: delivery.id,
          station,
          simulationRecord: {
            mode: config.printMode,
            simulated: config.printMode === 'SIMULATED_SCREEN',
            watermark: config.printMode === 'SIMULATED_SCREEN' ? 'COMANDA SIMULADA — NO IMPRESA EN HARDWARE' : null,
            generatedAt: new Date().toISOString(),
            source: 'DOMICILIO',
            delivery: { id: delivery.id, code: delivery.code, customerName: delivery.customerName, address: delivery.address },
            station,
            items: items.map((item) => ({ description: item.description, quantity: String(item.quantity), notes: item.notes || null }))
          }
        }
      });
    }
    await tx.restaurantDeliveryOrder.update({
      where: { id },
      data: { state: 'CONFIRMADO', acceptedByUserId: user.id, acceptedAt: new Date() }
    });
    return loadDelivery(tenantId, id, tx);
  });
}

function stationForRole(user, requestedStation = null) {
  const role = String(user?.rol || '').toUpperCase();
  if (['COCINA','BARRA','POSTRES'].includes(role)) return role;
  if (requestedStation && !STATIONS.includes(requestedStation)) throw new AppError(400, 'Estación inválida', 'RESTAURANT_STATION_INVALID');
  return requestedStation || null;
}

async function listKdsCommands(tenantId, user, filters = {}) {
  const station = stationForRole(user, filters.station || null);
  const where = { tenantId };
  if (station) where.station = station;
  if (filters.state) where.state = filters.state;
  const commands = await prisma.restaurantDeliveryCommand.findMany({
    where,
    include: { delivery: { include: { items: true } } },
    orderBy: { creadoEn: 'asc' },
    take: Math.min(Number(filters.limit) || 200, 500)
  });
  return commands.map((command) => ({
    id: command.id,
    tenantId: command.tenantId,
    station: command.station,
    state: command.state,
    simulationRecord: command.simulationRecord,
    creadoEn: command.creadoEn,
    startedAt: command.startedAt,
    readyAt: command.readyAt,
    deliveredAt: command.deliveredAt,
    actualizadoEn: command.actualizadoEn,
    waiter: null,
    channel: 'DOMICILIO',
    order: {
      id: command.delivery.id,
      source: 'DOMICILIO',
      state: command.delivery.state,
      items: command.delivery.items.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        station: item.station,
        notes: item.notes
      })),
      session: {
        table: {
          id: command.delivery.id,
          code: command.delivery.code,
          name: `Domicilio ${command.delivery.code}`,
          zone: { id: 'DOMICILIOS', name: 'Domicilios' }
        }
      },
      delivery: {
        id: command.delivery.id,
        code: command.delivery.code,
        customerName: command.delivery.customerName,
        address: command.delivery.address,
        neighborhood: command.delivery.neighborhood
      }
    }
  }));
}

async function updateDeliveryCommandState(tenantId, user, commandId, state) {
  if (!COMMAND_STATES.includes(state)) throw new AppError(400, 'Estado de comanda inválido', 'RESTAURANT_COMMAND_STATE_INVALID');
  return prisma.$transaction(async (tx) => {
    const command = await tx.restaurantDeliveryCommand.findFirst({ where: { id: commandId, tenantId }, include: { delivery: true } });
    if (!command) throw new AppError(404, 'Comanda de domicilio no encontrada', 'RESTAURANT_DELIVERY_COMMAND_NOT_FOUND');
    const forced = stationForRole(user);
    if (forced && command.station !== forced) throw new AppError(403, 'Este rol solo puede operar su estación', 'RESTAURANT_STATION_FORBIDDEN');
    const timestamps = {};
    if (state === 'EN_PREPARACION') timestamps.startedAt = new Date();
    if (state === 'LISTA') timestamps.readyAt = new Date();
    if (state === 'ENTREGADA') timestamps.deliveredAt = new Date();
    await tx.restaurantDeliveryCommand.update({ where: { id: command.id }, data: { state, ...timestamps } });
    const commands = await tx.restaurantDeliveryCommand.findMany({ where: { tenantId, deliveryId: command.deliveryId } });
    let next = command.delivery.state;
    if (!['EN_CAMINO','ENTREGADO','CANCELADO'].includes(next)) {
      if (commands.length && commands.every((row) => ['LISTA','ENTREGADA'].includes(row.state))) next = 'LISTO';
      else if (commands.some((row) => row.state === 'EN_PREPARACION')) next = 'EN_PREPARACION';
      else next = 'CONFIRMADO';
    }
    await tx.restaurantDeliveryOrder.update({
      where: { id: command.deliveryId },
      data: { state: next, readyAt: next === 'LISTO' && !command.delivery.readyAt ? new Date() : undefined }
    });
    return loadDelivery(tenantId, command.deliveryId, tx);
  });
}

async function markOnRoute(tenantId, user, id, input = {}) {
  return prisma.$transaction(async (tx) => {
    const delivery = await tx.restaurantDeliveryOrder.findFirst({ where: { id, tenantId }, include: { commands: true } });
    if (!delivery) throw new AppError(404, 'Domicilio no encontrado', 'RESTAURANT_DELIVERY_NOT_FOUND');
    if (delivery.state === 'EN_CAMINO' || delivery.state === 'ENTREGADO') return loadDelivery(tenantId, id, tx);
    if (delivery.state !== 'LISTO') throw new AppError(409, 'El pedido debe estar listo antes de salir', 'RESTAURANT_DELIVERY_NOT_READY');
    await tx.restaurantDeliveryCommand.updateMany({ where: { tenantId, deliveryId: id, state: 'LISTA' }, data: { state: 'ENTREGADA', deliveredAt: new Date() } });
    await tx.restaurantDeliveryOrder.update({
      where: { id },
      data: { state: 'EN_CAMINO', courierName: input.courierName?.trim() || delivery.courierName || null, dispatchedAt: new Date() }
    });
    return loadDelivery(tenantId, id, tx);
  });
}

async function markDelivered(tenantId, user, id) {
  return prisma.$transaction(async (tx) => {
    const delivery = await tx.restaurantDeliveryOrder.findFirst({ where: { id, tenantId } });
    if (!delivery) throw new AppError(404, 'Domicilio no encontrado', 'RESTAURANT_DELIVERY_NOT_FOUND');
    if (delivery.state === 'ENTREGADO') return loadDelivery(tenantId, id, tx);
    if (!['LISTO','EN_CAMINO'].includes(delivery.state)) throw new AppError(409, 'El pedido todavía no está listo para marcarlo entregado', 'RESTAURANT_DELIVERY_NOT_DISPATCHABLE');
    await tx.restaurantDeliveryOrder.update({ where: { id }, data: { state: 'ENTREGADO', deliveredAt: new Date() } });
    return loadDelivery(tenantId, id, tx);
  });
}

async function ensureSaleEmitted(tenantId, userId, deliveryId) {
  return prisma.$transaction(async (tx) => {
    const delivery = await tx.restaurantDeliveryOrder.findFirst({ where: { id: deliveryId, tenantId } });
    if (!delivery) throw new AppError(404, 'Domicilio no encontrado', 'RESTAURANT_DELIVERY_NOT_FOUND');
    const sale = await tx.comprobanteComercial.findFirst({ where: { id: delivery.saleId, tenantId } });
    if (!sale) throw new AppError(404, 'Venta del domicilio no encontrada', 'RESTAURANT_DELIVERY_SALE_NOT_FOUND');
    if (sale.estado === 'BORRADOR') {
      await tx.comprobanteComercial.update({ where: { id: sale.id }, data: { formaPago: 'CREDITO', cajaBancoId: null } });
      return sales.emitSaleInTx(tx, tenantId, userId, sale.id, 'DOCUMENTO_EQUIVALENTE_POS');
    }
    return sale;
  });
}

async function registerDeliveryPayment(tenantId, user, id, input) {
  const delivery = await prisma.restaurantDeliveryOrder.findFirst({ where: { id, tenantId } });
  if (!delivery) throw new AppError(404, 'Domicilio no encontrado', 'RESTAURANT_DELIVERY_NOT_FOUND');
  if (delivery.state === 'CANCELADO') throw new AppError(409, 'No se puede cobrar un domicilio cancelado', 'RESTAURANT_DELIVERY_CANCELLED');
  if (delivery.paymentStatus === 'PAGADO') return loadDelivery(tenantId, id);

  const caja = await treasury.getCajaBanco(tenantId, input.cajaBancoId);
  const method = String(input.metodoPago || '').toUpperCase();
  if (!['EFECTIVO','TRANSFERENCIA','TARJETA'].includes(method)) throw new AppError(400, 'Método de pago inválido', 'RESTAURANT_DELIVERY_PAYMENT_METHOD_INVALID');
  if (method === 'EFECTIVO' && caja.tipo !== 'CAJA') throw new AppError(400, 'El efectivo debe registrarse en una caja', 'RESTAURANT_DELIVERY_CASH_ACCOUNT_INVALID');
  if (method !== 'EFECTIVO' && caja.tipo !== 'BANCO') throw new AppError(400, 'Transferencia o tarjeta deben registrarse en una cuenta bancaria', 'RESTAURANT_DELIVERY_BANK_ACCOUNT_INVALID');
  if (method === 'EFECTIVO') {
    const shift = await prisma.aperturaCierreCaja.findFirst({ where: { tenantId, cajaBancoId: caja.id, userId: user.id, estado: 'ABIERTA' } });
    if (!shift) throw new AppError(409, 'Abra el turno de caja antes de registrar efectivo', 'RESTAURANT_CASH_SHIFT_REQUIRED');
  }

  const emitted = await ensureSaleEmitted(tenantId, user.id, id);
  const payment = await treasury.registerPayment(tenantId, user.id, {
    documentoId: emitted.id || delivery.saleId,
    cajaBancoId: input.cajaBancoId,
    metodoPago: method,
    monto: delivery.total,
    referencia: input.referencia || `${delivery.code} · ${delivery.customerName}`,
    sourceId: `REST-DELIVERY-PAY-${delivery.id}`
  });

  await prisma.restaurantDeliveryOrder.update({
    where: { id },
    data: {
      paymentStatus: 'PAGADO',
      paymentMethod: method,
      cajaBancoId: input.cajaBancoId,
      treasuryPaymentId: payment.id
    }
  });
  return loadDelivery(tenantId, id);
}

async function cancelDelivery(tenantId, user, id) {
  return prisma.$transaction(async (tx) => {
    const delivery = await tx.restaurantDeliveryOrder.findFirst({ where: { id, tenantId }, include: { commands: true } });
    if (!delivery) throw new AppError(404, 'Domicilio no encontrado', 'RESTAURANT_DELIVERY_NOT_FOUND');
    if (delivery.state === 'CANCELADO') return loadDelivery(tenantId, id, tx);
    if (delivery.paymentStatus === 'PAGADO') throw new AppError(409, 'Un domicilio ya pagado requiere reversión formal; no se cancela desde operación', 'RESTAURANT_DELIVERY_PAID_CANCEL_FORBIDDEN');
    if (!['NUEVO','CONFIRMADO'].includes(delivery.state) || delivery.commands.some((row) => ['EN_PREPARACION','LISTA','ENTREGADA'].includes(row.state))) {
      throw new AppError(409, 'El pedido ya entró en producción; requiere gestión de anulación', 'RESTAURANT_DELIVERY_IN_PRODUCTION');
    }
    const sale = await tx.comprobanteComercial.findFirst({ where: { id: delivery.saleId, tenantId } });
    if (sale?.estado !== 'BORRADOR') throw new AppError(409, 'La venta ya fue emitida y requiere reversión formal', 'RESTAURANT_DELIVERY_SALE_EMITTED');
    await tx.restaurantDeliveryCommand.updateMany({ where: { tenantId, deliveryId: id }, data: { state: 'CANCELADA' } });
    await tx.comprobanteComercial.update({ where: { id: delivery.saleId }, data: { estado: 'ANULADO', anuladoEn: new Date(), motivoAnulacion: 'Domicilio cancelado antes de producción' } });
    await tx.restaurantDeliveryOrder.update({ where: { id }, data: { state: 'CANCELADO', cancelledAt: new Date() } });
    return loadDelivery(tenantId, id, tx);
  });
}

module.exports = {
  createDelivery,
  listDeliveries,
  loadDelivery,
  summary,
  recentCustomerByPhone,
  acceptDelivery,
  listKdsCommands,
  updateDeliveryCommandState,
  markOnRoute,
  markDelivered,
  registerDeliveryPayment,
  cancelDelivery
};
