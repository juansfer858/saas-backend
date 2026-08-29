const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money, qty, pct } = require('../../utils/decimal');
const commercial = require('../commercial/commercial.service');
const sales = require('../commercial/sales.service');
const treasury = require('../treasury/treasury.service');
const accounting = require('../accounting/accounting.service');
const notifications = require('../notifications/notifications.service');

const SIMULATED_STATUS = 'Funcional — validado con impresión simulada (PDF/pantalla)';
const PRODUCTION_BLOCKED = 'PRODUCCIÓN REAL BLOQUEADA';
const MENU_CATEGORIES = ['ENTRADAS', 'FUERTES', 'BEBIDAS', 'POSTRES'];
const STATIONS = ['COCINA', 'BARRA', 'POSTRES'];
const COMMAND_STATES = ['PENDIENTE', 'EN_PREPARACION', 'LISTA', 'ENTREGADA', 'CANCELADA'];

function productionStatus(config) {
  const fiscalGate = Boolean(config.dianRealEnabled || config.simulatedFiscalOperationExplicitlyAccepted);
  const productionReady = Boolean(
    config.physicalPrinterFieldPass
    && config.metaBusinessManagementReviewPass
    && fiscalGate
  );
  return {
    verticalStatus: config.verticalStatus,
    label: SIMULATED_STATUS,
    printMode: config.printMode,
    productionReady,
    productionLabel: productionReady ? 'GATES DE PRODUCCIÓN CERRADOS' : PRODUCTION_BLOCKED,
    gates: {
      physicalPrinterFieldPass: config.physicalPrinterFieldPass,
      metaBusinessManagementReviewPass: config.metaBusinessManagementReviewPass,
      dianRealEnabled: config.dianRealEnabled,
      simulatedFiscalOperationExplicitlyAccepted: config.simulatedFiscalOperationExplicitlyAccepted,
      fiscalGateSatisfied: fiscalGate
    },
    limitations: productionReady ? [] : [
      !config.physicalPrinterFieldPass ? 'Prueba física Edge + impresora térmica pendiente' : null,
      !config.metaBusinessManagementReviewPass ? 'Revisión Meta business_management pendiente' : null,
      !fiscalGate ? 'Habilitación DIAN real o decisión fiscal simulada explícita pendiente' : null
    ].filter(Boolean),
    whatsappOrderReadyEnabled: config.whatsappOrderReadyEnabled,
    allowSimulatedDocumentEquivalent: config.allowSimulatedDocumentEquivalent
  };
}

async function getOrCreateConfig(tenantId, client = prisma) {
  return client.restaurantConfig.upsert({
    where: { tenantId },
    create: { tenantId },
    update: {}
  });
}

async function getStatus(tenantId) {
  return productionStatus(await getOrCreateConfig(tenantId));
}

async function saveOperationalConfig(tenantId, input) {
  const current = await getOrCreateConfig(tenantId);
  const row = await prisma.restaurantConfig.update({
    where: { tenantId },
    data: {
      whatsappOrderReadyEnabled: Object.prototype.hasOwnProperty.call(input, 'whatsappOrderReadyEnabled')
        ? Boolean(input.whatsappOrderReadyEnabled)
        : current.whatsappOrderReadyEnabled,
      allowSimulatedDocumentEquivalent: Object.prototype.hasOwnProperty.call(input, 'allowSimulatedDocumentEquivalent')
        ? Boolean(input.allowSimulatedDocumentEquivalent)
        : current.allowSimulatedDocumentEquivalent
    }
  });
  return productionStatus(row);
}

function requireEvidence(flag, evidence, fields, code) {
  if (!flag) return;
  if (!evidence || typeof evidence !== 'object') throw new AppError(400, 'El gate requiere evidencia documentada', code);
  for (const field of fields) {
    if (!String(evidence[field] || '').trim()) throw new AppError(400, `Falta evidencia: ${field}`, code);
  }
}

async function updateProductionGates(tenantId, userId, input) {
  const current = await getOrCreateConfig(tenantId);
  const data = {};

  if (Object.prototype.hasOwnProperty.call(input, 'physicalPrinterFieldPass')) {
    requireEvidence(input.physicalPrinterFieldPass, input.physicalPrinterEvidence, ['sessionId', 'printerModel'], 'RESTAURANT_PHYSICAL_GATE_EVIDENCE_REQUIRED');
    data.physicalPrinterFieldPass = Boolean(input.physicalPrinterFieldPass);
    data.physicalPrinterEvidence = input.physicalPrinterEvidence || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'metaBusinessManagementReviewPass')) {
    requireEvidence(input.metaBusinessManagementReviewPass, input.metaReviewEvidence, ['reviewReference'], 'RESTAURANT_META_GATE_EVIDENCE_REQUIRED');
    data.metaBusinessManagementReviewPass = Boolean(input.metaBusinessManagementReviewPass);
    data.metaReviewEvidence = input.metaReviewEvidence || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'dianRealEnabled')) {
    requireEvidence(input.dianRealEnabled, input.dianEvidence, ['provider', 'enablementReference'], 'RESTAURANT_DIAN_GATE_EVIDENCE_REQUIRED');
    data.dianRealEnabled = Boolean(input.dianRealEnabled);
    data.dianEvidence = input.dianEvidence || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'simulatedFiscalOperationExplicitlyAccepted')) {
    requireEvidence(input.simulatedFiscalOperationExplicitlyAccepted, input.simulatedFiscalDecisionEvidence, ['decisionReference', 'approvedBy'], 'RESTAURANT_SIMULATED_FISCAL_DECISION_REQUIRED');
    data.simulatedFiscalOperationExplicitlyAccepted = Boolean(input.simulatedFiscalOperationExplicitlyAccepted);
    data.simulatedFiscalDecisionEvidence = input.simulatedFiscalDecisionEvidence || null;
  }

  if (!Object.keys(data).length) throw new AppError(400, 'No se enviaron cambios de gate', 'RESTAURANT_GATE_CHANGE_REQUIRED');
  const updated = await prisma.restaurantConfig.update({ where: { tenantId }, data });
  await prisma.auditoriaContable.create({
    data: {
      tenantId,
      userId,
      entidad: 'RESTAURANT_PRODUCTION_GATE',
      entidadId: tenantId,
      accion: 'UPDATE',
      metadata: { before: productionStatus(current), after: productionStatus(updated), evidence: data }
    }
  });
  return productionStatus(updated);
}

async function validateAssignedWaiter(tenantId, assignedWaiterId, client = prisma) {
  if (!assignedWaiterId) return null;
  const user = await client.user.findFirst({ where: { id: assignedWaiterId, tenantId, activo: true } });
  if (!user) throw new AppError(400, 'Mesero asignado inválido para el tenant', 'RESTAURANT_WAITER_INVALID');
  return user;
}

function applyWaiterTableVisibility(where, user) {
  if (user?.rol === 'MESERO') {
    where.OR = [
      { assignedWaiterId: null },
      { assignedWaiterId: user.id }
    ];
  }
  return where;
}

async function createTable(tenantId, input) {
  await validateAssignedWaiter(tenantId, input.assignedWaiterId || null);
  try {
    return await prisma.restaurantTable.create({
      data: {
        tenantId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        seats: input.seats || 4,
        posX: input.posX ?? 24,
        posY: input.posY ?? 24,
        width: input.width ?? 124,
        height: input.height ?? 92,
        assignedWaiterId: input.assignedWaiterId || null,
        state: input.state === 'RESERVADA' ? 'RESERVADA' : 'LIBRE'
      }
    });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'Ya existe una mesa con ese código', 'RESTAURANT_TABLE_DUPLICATE');
    throw error;
  }
}

async function listTables(tenantId, user = null) {
  const where = applyWaiterTableVisibility({ tenantId, active: true }, user);
  const tables = await prisma.restaurantTable.findMany({
    where,
    include: { sessions: { where: { state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } }, orderBy: { openedAt: 'desc' }, take: 1 } },
    orderBy: [{ code: 'asc' }]
  });
  return tables.map((table) => ({ ...table, activeSession: table.sessions[0] || null, sessions: undefined }));
}

async function updateTable(tenantId, id, input) {
  return prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findFirst({ where: { id, tenantId, active: true } });
    if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
    if (Object.prototype.hasOwnProperty.call(input, 'assignedWaiterId')) await validateAssignedWaiter(tenantId, input.assignedWaiterId || null, tx);
    if (input.state && !['LIBRE', 'RESERVADA'].includes(input.state)) throw new AppError(400, 'El estado operativo se modifica abriendo/cerrando la mesa', 'RESTAURANT_TABLE_STATE_MANAGED');
    if (input.state) {
      const open = await tx.restaurantTableSession.findFirst({ where: { tenantId, tableId: id, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } } });
      if (open) throw new AppError(409, 'No puede cambiar manualmente el estado de una mesa con cuenta abierta', 'RESTAURANT_TABLE_HAS_OPEN_SESSION');
    }
    return tx.restaurantTable.update({
      where: { id },
      data: {
        name: input.name?.trim() || undefined,
        seats: input.seats,
        posX: input.posX,
        posY: input.posY,
        width: input.width,
        height: input.height,
        assignedWaiterId: Object.prototype.hasOwnProperty.call(input, 'assignedWaiterId') ? input.assignedWaiterId || null : undefined,
        state: input.state
      }
    });
  });
}

async function removeTable(tenantId, id) {
  return prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findFirst({ where: { id, tenantId, active: true } });
    if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
    const open = await tx.restaurantTableSession.findFirst({ where: { tenantId, tableId: id, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } } });
    if (open) throw new AppError(409, 'Cierre la mesa antes de retirarla del plano', 'RESTAURANT_TABLE_HAS_OPEN_SESSION');
    return tx.restaurantTable.update({ where: { id }, data: { active: false, state: 'LIBRE' } });
  });
}

function assertWaiterTableAccess(user, table) {
  if (user?.rol === 'MESERO' && table.assignedWaiterId && table.assignedWaiterId !== user.id) {
    throw new AppError(403, 'La mesa está asignada a otro mesero', 'RESTAURANT_WAITER_TABLE_FORBIDDEN');
  }
}

async function openTable(tenantId, user, tableId, input = {}) {
  return prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findFirst({ where: { id: tableId, tenantId, active: true } });
    if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
    assertWaiterTableAccess(user, table);
    const existing = await tx.restaurantTableSession.findFirst({ where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } } });
    if (existing) throw new AppError(409, 'La mesa ya tiene una cuenta abierta', 'RESTAURANT_TABLE_ALREADY_OPEN');

    const document = await commercial.createDocumentInTx(tx, tenantId, user.id, {
      tipo: 'FACTURA_VENTA',
      estado: 'BORRADOR',
      sourceId: `REST-TABLE-${table.id}-${Date.now()}`,
      terceroId: null,
      cajaBancoId: null,
      formaPago: null,
      observaciones: sales.packMeta({ documentType: 'DOCUMENTO_EQUIVALENTE_POS', notes: `Mesa ${table.name}` }),
      detalles: []
    });

    const session = await tx.restaurantTableSession.create({
      data: {
        tenantId,
        tableId: table.id,
        saleId: document.id,
        openedByUserId: user.id,
        billingMode: input.billingMode === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'CONJUNTA',
        guestCount: Math.max(Number(input.guestCount) || 1, 1),
        customerPhoneE164: input.customerPhoneE164 ? notifications.normalizePhone(input.customerPhoneE164) : null
      }
    });
    await tx.restaurantTable.update({ where: { id: table.id }, data: { state: 'OCUPADA' } });
    return { table: { ...table, state: 'OCUPADA' }, session, sale: document };
  });
}

async function requestAccount(tenantId, user, tableId) {
  return prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findFirst({ where: { id: tableId, tenantId, active: true } });
    if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
    assertWaiterTableAccess(user, table);
    const session = await tx.restaurantTableSession.findFirst({ where: { tenantId, tableId, state: 'ABIERTA' } });
    if (!session) throw new AppError(404, 'No hay cuenta abierta para esta mesa', 'RESTAURANT_SESSION_NOT_FOUND');
    const now = new Date();
    const updated = await tx.restaurantTableSession.update({ where: { id: session.id }, data: { state: 'CUENTA_PEDIDA', accountRequestedAt: now } });
    await tx.restaurantTable.update({ where: { id: table.id }, data: { state: 'CUENTA_PEDIDA' } });
    return updated;
  });
}

async function menuRows(tenantId, filters = {}, client = prisma) {
  const where = { tenantId };
  if (filters.active !== undefined) where.active = filters.active;
  else where.active = true;
  if (filters.category) where.category = filters.category;
  if (filters.station) where.station = filters.station;
  const rows = await client.restaurantMenuItem.findMany({ where, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { creadoEn: 'asc' }] });
  const productIds = rows.map((x) => x.productId);
  const [products, recipes] = productIds.length ? await Promise.all([
    client.producto.findMany({ where: { tenantId, id: { in: productIds }, activo: true } }),
    client.consumptionRecipe.findMany({ where: { tenantId, outputProductId: { in: productIds }, active: true }, include: { items: true } })
  ]) : [[], []];
  const productById = new Map(products.map((x) => [x.id, x]));
  const recipeByProduct = new Map(recipes.map((x) => [x.outputProductId, x]));
  return rows.map((row) => {
    const product = productById.get(row.productId) || null;
    const recipe = recipeByProduct.get(row.productId) || null;
    return {
      ...row,
      product,
      recipeConfigured: Boolean(recipe),
      recipe,
      warning: row.requiresRecipe && !recipe ? 'RECETA REQUERIDA ANTES DE VENDER' : null
    };
  });
}

async function listMenu(tenantId, filters = {}) {
  return menuRows(tenantId, filters);
}

async function saveMenuItem(tenantId, id, input) {
  if (!MENU_CATEGORIES.includes(input.category)) throw new AppError(400, 'Categoría de menú inválida', 'RESTAURANT_MENU_CATEGORY_INVALID');
  if (!STATIONS.includes(input.station)) throw new AppError(400, 'Estación de comanda inválida', 'RESTAURANT_STATION_INVALID');
  const product = await prisma.producto.findFirst({ where: { id: input.productId, tenantId, activo: true } });
  if (!product) throw new AppError(400, 'Producto inválido para el menú', 'RESTAURANT_MENU_PRODUCT_INVALID');
  try {
    const row = id
      ? await prisma.restaurantMenuItem.update({
        where: { id },
        data: { productId: input.productId, category: input.category, station: input.station, requiresRecipe: input.requiresRecipe !== false, active: input.active !== false, sortOrder: input.sortOrder || 0 }
      })
      : await prisma.restaurantMenuItem.create({
        data: { tenantId, productId: input.productId, category: input.category, station: input.station, requiresRecipe: input.requiresRecipe !== false, active: input.active !== false, sortOrder: input.sortOrder || 0 }
      });
    const [decorated] = await menuRows(tenantId, { active: undefined });
    const recipe = await prisma.consumptionRecipe.findFirst({ where: { tenantId, outputProductId: row.productId, active: true } });
    return { ...row, product, recipeConfigured: Boolean(recipe), warning: row.requiresRecipe && !recipe ? 'RECETA REQUERIDA ANTES DE VENDER' : null, decorated };
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'El producto ya está vinculado al menú', 'RESTAURANT_MENU_DUPLICATE');
    if (error?.code === 'P2025') throw new AppError(404, 'Ítem de menú no encontrado', 'RESTAURANT_MENU_ITEM_NOT_FOUND');
    throw error;
  }
}

async function deactivateMenuItem(tenantId, id) {
  const row = await prisma.restaurantMenuItem.findFirst({ where: { id, tenantId } });
  if (!row) throw new AppError(404, 'Ítem de menú no encontrado', 'RESTAURANT_MENU_ITEM_NOT_FOUND');
  return prisma.restaurantMenuItem.update({ where: { id }, data: { active: false } });
}

function calculateCommercialLine(product, quantity) {
  const q = qty(quantity);
  if (q.lte(0)) throw new AppError(400, 'La cantidad debe ser mayor que cero', 'RESTAURANT_ORDER_QTY_INVALID');
  const price = money(product.precio1);
  const ivaPct = pct(product.ivaPct || 0);
  const impoconsumoPct = pct(product.impoconsumoPct || 0);
  const gross = money(q.mul(price));
  const iva = money(gross.mul(ivaPct).div(100));
  const impoconsumo = money(gross.mul(impoconsumoPct).div(100));
  const total = money(gross.plus(iva).plus(impoconsumo));
  return { q, price, ivaPct, impoconsumoPct, subtotal: gross, iva, impoconsumo, total };
}

async function loadOrder(tenantId, id, client = prisma) {
  const order = await client.restaurantOrder.findFirst({
    where: { id, tenantId },
    include: { items: true, commands: true, session: { include: { table: true } } }
  });
  if (!order) throw new AppError(404, 'Pedido no encontrado', 'RESTAURANT_ORDER_NOT_FOUND');
  return order;
}

async function placeOrderInTx(tx, params) {
  if (params.externalRequestId) {
    const existing = await tx.restaurantOrder.findFirst({ where: { tenantId: params.tenantId, externalRequestId: params.externalRequestId } });
    if (existing) return loadOrder(params.tenantId, existing.id, tx);
  }

  const session = await tx.restaurantTableSession.findFirst({
    where: { id: params.sessionId, tenantId: params.tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    include: { table: true }
  });
  if (!session) throw new AppError(404, 'Sesión de mesa abierta no encontrada', 'RESTAURANT_SESSION_NOT_FOUND');
  if (params.user) assertWaiterTableAccess(params.user, session.table);
  const sale = await tx.comprobanteComercial.findFirst({ where: { id: session.saleId, tenantId: params.tenantId, tipo: 'FACTURA_VENTA', estado: 'BORRADOR' } });
  if (!sale) throw new AppError(409, 'La venta de la mesa ya no está en borrador', 'RESTAURANT_SALE_NOT_DRAFT');
  if (!Array.isArray(params.items) || !params.items.length) throw new AppError(400, 'El pedido requiere al menos un ítem', 'RESTAURANT_ORDER_EMPTY');

  const menuItemIds = [...new Set(params.items.map((x) => x.menuItemId))];
  const menuItems = await tx.restaurantMenuItem.findMany({ where: { tenantId: params.tenantId, id: { in: menuItemIds }, active: true } });
  if (menuItems.length !== menuItemIds.length) throw new AppError(400, 'Uno o más ítems no pertenecen al menú activo', 'RESTAURANT_MENU_ITEM_INVALID');
  const menuById = new Map(menuItems.map((x) => [x.id, x]));
  const productIds = [...new Set(menuItems.map((x) => x.productId))];
  const [products, recipes] = await Promise.all([
    tx.producto.findMany({ where: { tenantId: params.tenantId, id: { in: productIds }, activo: true } }),
    tx.consumptionRecipe.findMany({ where: { tenantId: params.tenantId, outputProductId: { in: productIds }, active: true } })
  ]);
  if (products.length !== productIds.length) throw new AppError(400, 'Uno o más productos del menú están inactivos', 'RESTAURANT_MENU_PRODUCT_INVALID');
  const productById = new Map(products.map((x) => [x.id, x]));
  const recipeProducts = new Set(recipes.map((x) => x.outputProductId));

  const prepared = params.items.map((request) => {
    const menu = menuById.get(request.menuItemId);
    const product = productById.get(menu.productId);
    if (menu.requiresRecipe && !recipeProducts.has(product.id)) {
      throw new AppError(409, `Configure la receta de ${product.nombre} antes de venderlo`, 'RESTAURANT_RECIPE_REQUIRED', { productId: product.id, menuItemId: menu.id });
    }
    const calculation = calculateCommercialLine(product, request.quantity);
    return { request, menu, product, ...calculation };
  });

  const totals = prepared.reduce((acc, line) => ({
    subtotal: money(acc.subtotal.plus(line.subtotal)),
    iva: money(acc.iva.plus(line.iva)),
    impoconsumo: money(acc.impoconsumo.plus(line.impoconsumo)),
    total: money(acc.total.plus(line.total))
  }), { subtotal: money(0), iva: money(0), impoconsumo: money(0), total: money(0) });

  if (params.source === 'QR') {
    const confirmed = money(params.confirmedTotal);
    if (!confirmed.eq(totals.total)) {
      throw new AppError(409, 'El total cambió. Revise el pedido y confirme nuevamente.', 'RESTAURANT_QR_TOTAL_CONFIRMATION_MISMATCH', { expected: totals.total.toString(), confirmed: confirmed.toString() });
    }
  }

  const order = await tx.restaurantOrder.create({
    data: {
      tenantId: params.tenantId,
      sessionId: session.id,
      source: params.source,
      createdByUserId: params.user?.id || null,
      customerPhoneE164: params.customerPhoneE164 ? notifications.normalizePhone(params.customerPhoneE164) : session.customerPhoneE164,
      externalRequestId: params.externalRequestId || null,
      total: totals.total,
      notes: params.notes || null
    }
  });

  const storedItems = [];
  for (const line of prepared) {
    const detail = await tx.detalleComprobante.create({
      data: {
        tenantId: params.tenantId,
        comprobanteId: sale.id,
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
    const item = await tx.restaurantOrderItem.create({
      data: {
        tenantId: params.tenantId,
        orderId: order.id,
        menuItemId: line.menu.id,
        productId: line.product.id,
        saleDetailId: detail.id,
        description: line.product.nombre,
        quantity: line.q,
        unitPrice: line.price,
        lineTotal: line.total,
        station: line.menu.station,
        notes: line.request.notes || null
      }
    });
    storedItems.push(item);
  }

  await tx.comprobanteComercial.update({
    where: { id: sale.id },
    data: {
      subtotal: { increment: totals.subtotal },
      ivaTotal: { increment: totals.iva },
      impoconsumoTotal: { increment: totals.impoconsumo },
      total: { increment: totals.total }
    }
  });

  if (session.state === 'CUENTA_PEDIDA') {
    await tx.restaurantTableSession.update({ where: { id: session.id }, data: { state: 'ABIERTA', accountRequestedAt: null } });
    await tx.restaurantTable.update({ where: { id: session.tableId }, data: { state: 'OCUPADA' } });
  }

  const config = await getOrCreateConfig(params.tenantId, tx);
  const byStation = new Map();
  for (const item of storedItems) {
    if (!byStation.has(item.station)) byStation.set(item.station, []);
    byStation.get(item.station).push(item);
  }
  for (const [station, items] of byStation.entries()) {
    await tx.restaurantCommand.create({
      data: {
        tenantId: params.tenantId,
        orderId: order.id,
        station,
        printMode: config.printMode,
        simulationRecord: {
          mode: config.printMode,
          simulated: config.printMode === 'SIMULATED_SCREEN',
          watermark: config.printMode === 'SIMULATED_SCREEN' ? 'COMANDA SIMULADA — NO IMPRESA EN HARDWARE' : null,
          generatedAt: new Date().toISOString(),
          table: { id: session.table.id, code: session.table.code, name: session.table.name },
          orderId: order.id,
          source: params.source,
          station,
          items: items.map((item) => ({ description: item.description, quantity: String(item.quantity), notes: item.notes || null }))
        }
      }
    });
  }
  return loadOrder(params.tenantId, order.id, tx);
}

async function placeWaiterOrder(tenantId, user, sessionId, input) {
  return prisma.$transaction((tx) => placeOrderInTx(tx, { tenantId, user, sessionId, source: 'MESERO', items: input.items, notes: input.notes, customerPhoneE164: input.customerPhoneE164, externalRequestId: input.externalRequestId }));
}

async function getQrContext(qrToken) {
  const table = await prisma.restaurantTable.findUnique({ where: { qrToken } });
  if (!table || !table.active) throw new AppError(404, 'QR de mesa no encontrado', 'RESTAURANT_QR_NOT_FOUND');
  const session = await prisma.restaurantTableSession.findFirst({ where: { tenantId: table.tenantId, tableId: table.id, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } }, orderBy: { openedAt: 'desc' } });
  const menu = await menuRows(table.tenantId, { active: true });
  const sale = session ? await prisma.comprobanteComercial.findFirst({ where: { id: session.saleId, tenantId: table.tenantId }, select: { id: true, numero: true, total: true, estado: true } }) : null;
  return {
    tenantId: table.tenantId,
    table: { id: table.id, code: table.code, name: table.name, state: table.state },
    open: Boolean(session),
    session: session ? { id: session.id, state: session.state } : null,
    currentTotal: sale?.total || 0,
    menu: menu.map((item) => ({
      id: item.id,
      category: item.category,
      station: item.station,
      recipeConfigured: item.recipeConfigured,
      available: Boolean(item.product && (!item.requiresRecipe || item.recipeConfigured)),
      product: item.product ? { id: item.product.id, name: item.product.nombre, price: item.product.precio1, ivaPct: item.product.ivaPct, impoconsumoPct: item.product.impoconsumoPct } : null
    }))
  };
}

async function placeQrOrder(qrToken, input) {
  const table = await prisma.restaurantTable.findUnique({ where: { qrToken } });
  if (!table || !table.active) throw new AppError(404, 'QR de mesa no encontrado', 'RESTAURANT_QR_NOT_FOUND');
  const session = await prisma.restaurantTableSession.findFirst({ where: { tenantId: table.tenantId, tableId: table.id, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } }, orderBy: { openedAt: 'desc' } });
  if (!session) throw new AppError(409, 'La mesa debe estar abierta antes del autopedido', 'RESTAURANT_QR_TABLE_NOT_OPEN');
  return prisma.$transaction((tx) => placeOrderInTx(tx, {
    tenantId: table.tenantId,
    sessionId: session.id,
    source: 'QR',
    items: input.items,
    notes: input.notes,
    customerPhoneE164: input.customerPhoneE164,
    externalRequestId: input.externalRequestId,
    confirmedTotal: input.confirmedTotal
  }));
}

async function listOrders(tenantId, filters = {}, user = null) {
  const where = { tenantId };
  if (filters.sessionId) where.sessionId = filters.sessionId;
  if (filters.state) where.state = filters.state;
  if (user?.rol === 'MESERO') {
    const tables = await prisma.restaurantTable.findMany({
      where: applyWaiterTableVisibility({ tenantId, active: true }, user),
      select: { id: true }
    });
    const sessions = await prisma.restaurantTableSession.findMany({ where: { tenantId, tableId: { in: tables.map((x) => x.id) } }, select: { id: true } });
    where.sessionId = { in: sessions.map((x) => x.id) };
  }
  return prisma.restaurantOrder.findMany({
    where,
    include: { items: true, commands: true, session: { include: { table: true } } },
    orderBy: { creadoEn: 'desc' },
    take: Math.min(Number(filters.limit) || 200, 500)
  });
}

function stationAllowedForRole(user, requestedStation = null) {
  if (user?.rol === 'COCINA') return 'COCINA';
  if (user?.rol === 'BARRA') return 'BARRA';
  if (user?.rol === 'POSTRES') return 'POSTRES';
  if (requestedStation && !STATIONS.includes(requestedStation)) throw new AppError(400, 'Estación inválida', 'RESTAURANT_STATION_INVALID');
  return requestedStation || null;
}

async function listCommands(tenantId, user, filters = {}) {
  const station = stationAllowedForRole(user, filters.station || null);
  const where = { tenantId };
  if (station) where.station = station;
  if (filters.state) where.state = filters.state;
  const commands = await prisma.restaurantCommand.findMany({
    where,
    include: {
      order: {
        include: {
          items: true,
          session: { include: { table: { include: { zone: true } } } }
        }
      }
    },
    orderBy: { creadoEn: 'asc' },
    take: Math.min(Number(filters.limit) || 200, 500)
  });
  const waiterIds = [...new Set(commands.map((command) => command.order?.createdByUserId).filter(Boolean))];
  const waiters = waiterIds.length ? await prisma.user.findMany({
    where: { tenantId, id: { in: waiterIds } },
    select: { id: true, nombre: true }
  }) : [];
  const waiterById = new Map(waiters.map((row) => [row.id, row]));
  return commands.map((command) => ({
    ...command,
    waiter: command.order?.source === 'MESERO' ? waiterById.get(command.order?.createdByUserId) || null : null
  }));
}

async function maybeNotifyOrderReady(tenantId, order) {
  try {
    const config = await getOrCreateConfig(tenantId);
    if (!config.whatsappOrderReadyEnabled) return { queued: false, reason: 'TENANT_DISABLED' };
    const phone = order.customerPhoneE164 || order.session?.customerPhoneE164;
    if (!phone) return { queued: false, reason: 'NO_CUSTOMER_PHONE' };
    return notifications.enqueueEventNotification(tenantId, {
      recipientPhoneE164: phone,
      eventCode: 'ORDER_READY',
      parameters: [order.session?.table?.name || 'Mesa'],
      originType: 'RESTAURANT_ORDER',
      originId: order.id
    });
  } catch (error) {
    return { queued: false, reason: error.code || 'NOTIFICATION_ERROR', error: error.message };
  }
}

async function updateCommandState(tenantId, user, commandId, state) {
  if (!COMMAND_STATES.includes(state)) throw new AppError(400, 'Estado de comanda inválido', 'RESTAURANT_COMMAND_STATE_INVALID');
  const result = await prisma.$transaction(async (tx) => {
    const command = await tx.restaurantCommand.findFirst({ where: { id: commandId, tenantId }, include: { order: true } });
    if (!command) throw new AppError(404, 'Comanda no encontrada', 'RESTAURANT_COMMAND_NOT_FOUND');
    const forced = stationAllowedForRole(user);
    if (forced && command.station !== forced) throw new AppError(403, 'Este rol solo puede operar su estación', 'RESTAURANT_STATION_FORBIDDEN');
    const timestamps = {};
    if (state === 'EN_PREPARACION') timestamps.startedAt = new Date();
    if (state === 'LISTA') timestamps.readyAt = new Date();
    if (state === 'ENTREGADA') timestamps.deliveredAt = new Date();
    const updated = await tx.restaurantCommand.update({ where: { id: command.id }, data: { state, ...timestamps } });
    const commands = await tx.restaurantCommand.findMany({ where: { tenantId, orderId: command.orderId } });
    let orderState = command.order.state;
    if (commands.every((x) => ['LISTA', 'ENTREGADA'].includes(x.id === updated.id ? state : x.state))) orderState = 'LISTO';
    else if (commands.some((x) => (x.id === updated.id ? state : x.state) === 'EN_PREPARACION')) orderState = 'EN_PREPARACION';
    if (commands.every((x) => (x.id === updated.id ? state : x.state) === 'ENTREGADA')) orderState = 'ENTREGADO';
    await tx.restaurantOrder.update({ where: { id: command.orderId }, data: { state: orderState } });
    return { command: updated, becameReady: command.order.state !== 'LISTO' && orderState === 'LISTO', orderId: command.orderId };
  });
  const order = await loadOrder(tenantId, result.orderId);
  const notification = result.becameReady ? await maybeNotifyOrderReady(tenantId, order) : null;
  return { ...result, order, notification };
}

function splitEqual(total, parts) {
  const count = Math.max(Number(parts) || 1, 1);
  if (count > 50) throw new AppError(400, 'Máximo 50 partes', 'RESTAURANT_SPLIT_TOO_MANY');
  const base = money(decimal(total).div(count));
  const rows = [];
  let used = money(0);
  for (let i = 0; i < count; i += 1) {
    const amount = i === count - 1 ? money(decimal(total).minus(used)) : base;
    rows.push({ part: i + 1, amount: amount.toString() });
    used = money(used.plus(amount));
  }
  return { mode: 'EQUAL', parts: rows, total: money(total).toString() };
}

function splitByItem(sale, tipAmount, assignments) {
  if (!Array.isArray(assignments) || !assignments.length) throw new AppError(400, 'La división por ítem requiere asignaciones', 'RESTAURANT_SPLIT_ASSIGNMENTS_REQUIRED');
  const details = new Map((sale.detalles || []).map((x) => [x.id, x]));
  const used = new Set();
  const tip = money(tipAmount);
  const tipBase = money(tip.div(assignments.length));
  let usedTip = money(0);
  const parts = assignments.map((assignment, index) => {
    if (!Array.isArray(assignment.saleDetailIds) || !assignment.saleDetailIds.length) throw new AppError(400, 'Cada comensal requiere al menos un ítem', 'RESTAURANT_SPLIT_PART_EMPTY');
    let itemTotal = money(0);
    for (const detailId of assignment.saleDetailIds) {
      if (used.has(detailId)) throw new AppError(400, 'Un ítem fue asignado más de una vez', 'RESTAURANT_SPLIT_ITEM_DUPLICATE');
      const detail = details.get(detailId);
      if (!detail) throw new AppError(400, 'Ítem de cuenta inválido en la división', 'RESTAURANT_SPLIT_ITEM_INVALID');
      used.add(detailId);
      itemTotal = money(itemTotal.plus(detail.totalLinea));
    }
    const tipShare = index === assignments.length - 1 ? money(tip.minus(usedTip)) : tipBase;
    usedTip = money(usedTip.plus(tipShare));
    return { name: assignment.name || `Comensal ${index + 1}`, saleDetailIds: assignment.saleDetailIds, itemTotal: itemTotal.toString(), tip: tipShare.toString(), amount: money(itemTotal.plus(tipShare)).toString() };
  });
  if (used.size !== details.size) throw new AppError(400, 'Todos los ítems deben quedar asignados para dividir por ítem', 'RESTAURANT_SPLIT_ITEMS_INCOMPLETE');
  return { mode: 'BY_ITEM', parts, total: money(decimal(sale.total).plus(tip)).toString() };
}

function computeSplit(sale, tipAmount, input = null) {
  const total = money(decimal(sale.total).plus(money(tipAmount)));
  if (!input || input.mode === 'NONE') return { mode: 'NONE', parts: [{ part: 1, amount: total.toString() }], total: total.toString() };
  if (input.mode === 'EQUAL') return splitEqual(total, input.parts);
  if (input.mode === 'BY_ITEM') return splitByItem(sale, tipAmount, input.assignments);
  throw new AppError(400, 'Modo de división inválido', 'RESTAURANT_SPLIT_MODE_INVALID');
}

async function ensureTipAccountInTx(tx, tenantId) {
  const root = await tx.cuentaPUC.findFirst({ where: { tenantId, codigo: '23' } });
  if (!root) throw new AppError(409, 'PUC no tiene grupo 23 para contabilizar propinas', 'RESTAURANT_TIP_ACCOUNT_PARENT_MISSING');
  const parent = await tx.cuentaPUC.upsert({
    where: { tenantId_codigo: { tenantId, codigo: '2380' } },
    create: { tenantId, codigo: '2380', codigoReferencia: '2380', nombre: 'Acreedores varios - Restaurante', nivel: 'CUENTA', naturaleza: 'CREDITO', parentId: root.id, permiteMovimiento: false, clasificacionESF: 'PASIVO_CORRIENTE', versionCatalogo: 'CO-RESTAURANT-V1', activa: true },
    update: { activa: true }
  });
  return tx.cuentaPUC.upsert({
    where: { tenantId_codigo: { tenantId, codigo: '238095' } },
    create: { tenantId, codigo: '238095', codigoReferencia: '238095', nombre: 'Propinas por pagar', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parentId: parent.id, permiteMovimiento: true, clasificacionESF: 'PASIVO_CORRIENTE', versionCatalogo: 'CO-RESTAURANT-V1', activa: true },
    update: { nombre: 'Propinas por pagar', activa: true, permiteMovimiento: true }
  });
}

async function cashAccountingAccountInTx(tx, tenantId, cajaBancoId) {
  const caja = await treasury.getCajaBanco(tenantId, cajaBancoId, tx);
  if (caja.cuentaContableId) {
    const mapped = await tx.cuentaPUC.findFirst({ where: { id: caja.cuentaContableId, tenantId, activa: true, permiteMovimiento: true } });
    if (mapped) return { caja, account: mapped };
  }
  const account = await accounting.getMappedAccount(tx, tenantId, caja.tipo === 'BANCO' ? 'BANCO_GENERAL' : 'CAJA_GENERAL');
  return { caja, account };
}

async function postTipInTx(tx, params) {
  const tip = money(params.tipAmount);
  if (tip.lte(0)) return null;
  if (params.formaPago === 'CREDITO') throw new AppError(409, 'La propina debe cobrarse por un medio de pago de contado', 'RESTAURANT_TIP_CREDIT_NOT_ALLOWED');
  const { account: cashAccount } = await cashAccountingAccountInTx(tx, params.tenantId, params.cajaBancoId);
  const tipAccount = await ensureTipAccountInTx(tx, params.tenantId);
  const movement = await treasury.recordTreasuryMovementInTx(tx, {
    tenantId: params.tenantId,
    userId: params.userId,
    cajaBancoId: params.cajaBancoId,
    comprobanteId: params.sale.id,
    tipo: 'INGRESO',
    monto: tip,
    sign: 1,
    referencia: params.sale.numero,
    concepto: `Propina separada ${params.sale.numero}`
  });
  const journal = await accounting.createJournalInTx(tx, {
    tenantId: params.tenantId,
    userId: params.userId,
    comprobanteId: null,
    sourceId: `REST-TIP-${params.sessionId}`,
    fecha: new Date(),
    concepto: `Propina por pagar ${params.sale.numero}`,
    referencia: params.sale.numero,
    detalles: [
      { cuentaId: cashAccount.id, debito: tip, credito: 0, concepto: `Cobro propina ${params.sale.numero}` },
      { cuentaId: tipAccount.id, debito: 0, credito: tip, concepto: `Propina por pagar ${params.sale.numero}` }
    ]
  });
  return { movement, journal };
}

async function closeTable(tenantId, user, tableId, input) {
  return prisma.$transaction(async (tx) => {
    const config = await getOrCreateConfig(tenantId, tx);
    const session = await tx.restaurantTableSession.findFirst({
      where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
      include: { table: true }
    });
    if (!session) throw new AppError(404, 'No hay cuenta abierta para cerrar', 'RESTAURANT_SESSION_NOT_FOUND');
    const saleBefore = await tx.comprobanteComercial.findFirst({ where: { id: session.saleId, tenantId, estado: 'BORRADOR' }, include: { detalles: true } });
    if (!saleBefore) throw new AppError(409, 'La venta asociada ya no está disponible como borrador', 'RESTAURANT_SALE_NOT_DRAFT');
    if (!saleBefore.detalles.length) throw new AppError(409, 'No se puede cerrar una mesa sin consumos', 'RESTAURANT_EMPTY_TABLE_CLOSE');
    if (!['EFECTIVO', 'BANCO', 'CREDITO'].includes(input.formaPago)) throw new AppError(400, 'Forma de pago inválida', 'RESTAURANT_PAYMENT_METHOD_INVALID');
    if (input.formaPago !== 'CREDITO' && !input.cajaBancoId) throw new AppError(400, 'Seleccione caja o banco', 'RESTAURANT_PAYMENT_ACCOUNT_REQUIRED');

    let cashShift = null;
    if (input.formaPago !== 'CREDITO') {
      const caja = await treasury.getCajaBanco(tenantId, input.cajaBancoId, tx);
      if (caja.tipo === 'CAJA') {
        cashShift = await tx.aperturaCierreCaja.findFirst({ where: { tenantId, cajaBancoId: caja.id, userId: user.id, estado: 'ABIERTA' }, orderBy: { abiertoEn: 'desc' } });
        if (!cashShift) throw new AppError(409, 'Abra el turno de caja antes de cerrar mesas en efectivo', 'RESTAURANT_CASH_SHIFT_REQUIRED');
      }
    }

    const tipAmount = money(input.tipAmount || 0);
    if (tipAmount.lt(0)) throw new AppError(400, 'La propina no puede ser negativa', 'RESTAURANT_TIP_INVALID');
    if (tipAmount.gt(0) && input.formaPago === 'CREDITO') throw new AppError(409, 'La propina debe cobrarse de contado', 'RESTAURANT_TIP_CREDIT_NOT_ALLOWED');

    await tx.comprobanteComercial.update({
      where: { id: saleBefore.id },
      data: { formaPago: input.formaPago, cajaBancoId: input.cajaBancoId || null }
    });
    const emitted = await sales.emitSaleInTx(tx, tenantId, user.id, saleBefore.id, 'DOCUMENTO_EQUIVALENTE_POS');
    const split = computeSplit(emitted, tipAmount, input.split || null);
    const tipPosting = await postTipInTx(tx, { tenantId, userId: user.id, sessionId: session.id, sale: emitted, formaPago: input.formaPago, cajaBancoId: input.cajaBancoId || null, tipAmount });

    if (config.dianRealEnabled && !emitted.dianDocument) throw new AppError(409, 'Restaurante está marcado DIAN real, pero la venta no generó documento fiscal en el Core', 'RESTAURANT_DIAN_DOCUMENT_REQUIRED');
    if (!emitted.dianDocument && !config.allowSimulatedDocumentEquivalent) throw new AppError(409, 'Documento Equivalente simulado deshabilitado y DIAN real no generó documento', 'RESTAURANT_SIMULATED_FISCAL_DISABLED');

    const fiscalMode = emitted.dianDocument ? 'DIAN' : 'SIMULATED';
    const fiscal = await tx.restaurantFiscalDocument.create({
      data: {
        tenantId,
        sessionId: session.id,
        saleId: emitted.id,
        mode: fiscalMode,
        documentType: 'DOCUMENTO_EQUIVALENTE_POS',
        internalNumber: emitted.numero,
        dianDocumentId: emitted.dianDocument?.id || null,
        simulatedData: emitted.dianDocument ? null : {
          label: 'DOCUMENTO EQUIVALENTE SIMULADO',
          fiscalAcceptance: false,
          reason: 'DIAN/PT real no habilitado en este tenant',
          saleNumber: emitted.numero,
          subtotal: String(emitted.subtotal),
          ivaTotal: String(emitted.ivaTotal),
          impoconsumoTotal: String(emitted.impoconsumoTotal),
          saleTotal: String(emitted.total),
          tipAmount: tipAmount.toString(),
          grandTotal: money(decimal(emitted.total).plus(tipAmount)).toString(),
          generatedAt: new Date().toISOString()
        }
      }
    });

    const closed = await tx.restaurantTableSession.update({
      where: { id: session.id },
      data: {
        state: 'CERRADA',
        closedByUserId: user.id,
        cashShiftId: cashShift?.id || null,
        tipAmount,
        splitMode: split.mode,
        splitMetadata: split,
        closedAt: new Date()
      }
    });
    await tx.restaurantTable.update({ where: { id: session.tableId }, data: { state: 'LIBRE' } });
    return { session: closed, sale: emitted, fiscalDocument: fiscal, tipPosting, split, status: productionStatus(config) };
  });
}

async function getSession(tenantId, sessionId) {
  const session = await prisma.restaurantTableSession.findFirst({
    where: { id: sessionId, tenantId },
    include: { table: true, orders: { include: { items: true, commands: true }, orderBy: { creadoEn: 'asc' } }, fiscalDocuments: true }
  });
  if (!session) throw new AppError(404, 'Sesión de mesa no encontrada', 'RESTAURANT_SESSION_NOT_FOUND');
  const sale = await sales.get(tenantId, session.saleId);
  return { ...session, sale };
}

async function openCashShift(tenantId, userId, input) {
  return treasury.openCashSession(tenantId, userId, input.cajaBancoId, { saldoInicial: input.saldoInicial || 0 });
}

async function cashShiftSummary(tenantId, userId, shiftId) {
  const shift = await prisma.aperturaCierreCaja.findFirst({ where: { id: shiftId, tenantId } });
  if (!shift) throw new AppError(404, 'Turno de caja no encontrado', 'RESTAURANT_CASH_SHIFT_NOT_FOUND');
  if (shift.userId !== userId) throw new AppError(403, 'El turno pertenece a otro usuario', 'CASH_SESSION_USER_MISMATCH');
  const sessions = await prisma.restaurantTableSession.findMany({ where: { tenantId, cashShiftId: shift.id, state: 'CERRADA' }, include: { table: true } });
  const salesRows = sessions.length ? await prisma.comprobanteComercial.findMany({ where: { tenantId, id: { in: sessions.map((x) => x.saleId) } }, select: { id: true, numero: true, total: true } }) : [];
  const saleById = new Map(salesRows.map((x) => [x.id, x]));
  const tables = sessions.map((session) => {
    const sale = saleById.get(session.saleId);
    const total = money(decimal(sale?.total || 0).plus(session.tipAmount || 0));
    return { sessionId: session.id, table: session.table.name, saleNumber: sale?.numero || null, saleTotal: String(sale?.total || 0), tipAmount: String(session.tipAmount || 0), total: total.toString() };
  });
  const restaurantTotal = money(tables.reduce((acc, row) => acc.plus(row.total), decimal(0)));
  const expectedDrawer = money(decimal(shift.saldoInicial).plus(shift.ingresosEfectivo).minus(shift.egresosEfectivo));
  return { shift, tables, restaurantClosedTablesTotal: restaurantTotal, systemCashExpected: expectedDrawer, restaurantCashRecorded: shift.ingresosEfectivo };
}

async function closeCashShift(tenantId, userId, shiftId, input) {
  const before = await cashShiftSummary(tenantId, userId, shiftId);
  const closed = await treasury.closeCashSession(tenantId, userId, shiftId, { saldoFinal: input.saldoFinal });
  return { before, closed };
}

module.exports = {
  SIMULATED_STATUS,
  PRODUCTION_BLOCKED,
  MENU_CATEGORIES,
  STATIONS,
  getStatus,
  getOrCreateConfig,
  saveOperationalConfig,
  updateProductionGates,
  createTable,
  listTables,
  updateTable,
  removeTable,
  openTable,
  requestAccount,
  listMenu,
  saveMenuItem,
  deactivateMenuItem,
  placeWaiterOrder,
  getQrContext,
  placeQrOrder,
  listOrders,
  listCommands,
  updateCommandState,
  closeTable,
  getSession,
  openCashShift,
  cashShiftSummary,
  closeCashShift,
  productionStatus,
  computeSplit
};
