'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money } = require('../../utils/decimal');

const MARKER = 'VANTIX_RESTAURANT_INVENTORY_BAR_V1';
const PILOT = 'demo-restaurante';
const ACTIVE_SESSIONS = ['ABIERTA','CUENTA_PEDIDA'];
const SENT_ORDERS = ['ENVIADO','EN_PREPARACION','LISTO','ENTREGADO'];

const n = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value) => Math.round(n(value) * 10000) / 10000;
const text = (value, max, required = true) => {
  const out = String(value == null ? '' : value).trim();
  if ((required && !out) || out.length > max) throw new AppError(400, 'Dato de inventario inválido', 'RESTAURANT_INVENTORY_INVALID_TEXT');
  return out;
};
const qty = (value, allowZero = false) => {
  const out = round(value);
  if (!Number.isFinite(out) || out < (allowZero ? 0 : 0.0001) || out > 1000000000) {
    throw new AppError(400, 'Cantidad de inventario inválida', 'RESTAURANT_INVENTORY_INVALID_QUANTITY');
  }
  return out;
};
const dateOnly = (value, label) => {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new AppError(400, (label || 'Fecha') + ' inválida', 'RESTAURANT_INVENTORY_INVALID_DATE');
  return new Date(raw + 'T00:00:00.000Z');
};
const serial = (value) => typeof value === 'bigint' ? value.toString() : value;

async function assertPilot(tenantId, client = prisma) {
  const tenant = await client.tenant.findUnique({ where:{ id:tenantId }, select:{ subdomain:true } });
  if (!tenant || String(tenant.subdomain || '').trim().toLowerCase() !== PILOT) {
    throw new AppError(404, 'Inventario Restaurante no habilitado para este tenant', 'RESTAURANT_INVENTORY_NOT_ENABLED');
  }
  return tenant;
}

async function activeReserved(client, tenantId) {
  const sessions = await client.restaurantTableSession.findMany({
    where:{ tenantId, state:{ in:ACTIVE_SESSIONS } },
    select:{ saleId:true }
  });
  const saleIds = sessions.map((row)=>row.saleId).filter(Boolean);
  if (!saleIds.length) return new Map();

  const details = await client.detalleComprobante.findMany({
    where:{ tenantId, comprobanteId:{ in:saleIds } },
    select:{ id:true, productoId:true, cantidad:true }
  });
  if (!details.length) return new Map();

  const sent = await client.restaurantOrderItem.findMany({
    where:{
      tenantId,
      saleDetailId:{ in:details.map((row)=>row.id) },
      order:{ state:{ in:SENT_ORDERS } }
    },
    select:{ saleDetailId:true }
  });
  const sentIds = new Set(sent.map((row)=>row.saleDetailId));
  const result = new Map();
  for (const detail of details) {
    if (!sentIds.has(detail.id)) continue;
    result.set(detail.productoId, round((result.get(detail.productoId) || 0) + n(detail.cantidad)));
  }
  return result;
}

async function stockForUpdate(tx, tenantId, productId) {
  const rows = await tx.$queryRawUnsafe(
    'SELECT * FROM "RestaurantInventoryStock" WHERE "tenantId"=$1 AND "productId"=$2 FOR UPDATE',
    tenantId, productId
  );
  return rows && rows[0] ? rows[0] : null;
}

async function ensureStock(tx, tenantId, productId) {
  return tx.restaurantInventoryStock.upsert({
    where:{ tenantId_productId:{ tenantId, productId } },
    create:{ tenantId, productId, enabled:false },
    update:{}
  });
}

async function workspace(tenantId, client = prisma) {
  await assertPilot(tenantId, client);
  const menu = await client.restaurantMenuItem.findMany({
    where:{ tenantId },
    orderBy:[{ active:'desc' },{ sortOrder:'asc' },{ creadoEn:'asc' }]
  });
  const productIds = [...new Set(menu.map((row)=>row.productId).filter(Boolean))];
  const [products, stocks, categories, reserved] = await Promise.all([
    productIds.length ? client.producto.findMany({
      where:{ tenantId, id:{ in:productIds } },
      select:{ id:true,sku:true,nombre:true,unidadMedida:true,precio1:true,activo:true,controlaInventario:true,stockActual:true,costoPromedio:true }
    }) : [],
    productIds.length ? client.restaurantInventoryStock.findMany({ where:{ tenantId, productId:{ in:productIds } } }) : [],
    client.restaurantCommercialCategory.findMany({ where:{ tenantId }, select:{ id:true,name:true } }).catch(()=>[]),
    activeReserved(client, tenantId)
  ]);
  const productById = new Map(products.map((row)=>[row.id,row]));
  const stockById = new Map(stocks.map((row)=>[row.productId,row]));
  const catById = new Map(categories.map((row)=>[row.id,row.name]));
  const rows = menu.map((item)=>{
    const product = productById.get(item.productId);
    if (!product) return null;
    const stock = stockById.get(item.productId);
    const held = reserved.get(item.productId) || 0;
    const onHand = n(stock && stock.onHand);
    return {
      productId:item.productId,
      menuItemId:item.id,
      sku:product.sku,
      name:product.nombre,
      unit:product.unidadMedida || 'UND',
      category:catById.get(item.commercialCategoryId) || item.category,
      station:item.station,
      recipe:Boolean(item.requiresRecipe),
      active:item.active !== false && product.activo !== false,
      enabled:Boolean(stock && stock.enabled),
      onHand:onHand,
      reserved:held,
      available:round(onHand - held),
      minimum:n(stock && stock.minimum),
      version:Number(stock && stock.version || 1),
      price:n(product.precio1),
      legacyCoreInventory:Boolean(product.controlaInventario),
      legacyCoreStock:n(product.stockActual),
      legacyCoreAverageCost:n(product.costoPromedio)
    };
  }).filter(Boolean);
  const controlled = rows.filter((row)=>row.enabled);
  return {
    marker:MARKER,
    source:'RESTAURANT_OWNED',
    superCoreInventory:false,
    products:rows,
    metrics:{
      controlled:controlled.length,
      low:controlled.filter((row)=>row.available <= row.minimum).length,
      out:controlled.filter((row)=>row.available <= 0).length,
      reserved:controlled.filter((row)=>row.reserved > 0).length
    }
  };
}

async function record(tx, input) {
  const next = round(n(input.stock.onHand) + n(input.delta));
  if (next < -0.00001) throw new AppError(409, 'El saldo no puede quedar negativo', 'RESTAURANT_INVENTORY_NEGATIVE_STOCK');
  const updated = await tx.restaurantInventoryStock.update({
    where:{ id:input.stock.id },
    data:{ onHand:next, version:{ increment:1 } }
  });
  const movement = await tx.restaurantInventoryMovement.create({
    data:{
      tenantId:input.tenantId,
      productId:input.product.id,
      productName:input.product.nombre,
      kind:input.kind,
      units:qty(Math.abs(input.units), true),
      delta:round(input.delta),
      balance:next,
      reason:text(input.reason,400),
      sessionId:input.sessionId || null,
      orderId:input.orderId || null,
      saleId:input.saleId || null,
      userId:input.userId || 'SYSTEM'
    }
  });
  return {
    stock:{ onHand:n(updated.onHand), minimum:n(updated.minimum), version:updated.version, enabled:updated.enabled },
    movement:{ ...movement, number:serial(movement.number), units:n(movement.units), delta:n(movement.delta), balance:n(movement.balance) }
  };
}

async function configureTrackingInTx(tx, tenantId, userId, productId, enabled) {
  await assertPilot(tenantId, tx);
  const [product, menuItem] = await Promise.all([
    tx.producto.findFirst({ where:{ tenantId, id:productId } }),
    tx.restaurantMenuItem.findFirst({ where:{ tenantId, productId } })
  ]);
  if (!product || !menuItem) throw new AppError(404, 'Producto de Carta no encontrado', 'RESTAURANT_INVENTORY_PRODUCT_NOT_FOUND');
  if (enabled && menuItem.requiresRecipe) throw new AppError(409, 'El producto usa receta. No puede controlarse también como terminado.', 'RESTAURANT_INVENTORY_RECIPE_CONFLICT');

  let stock = await ensureStock(tx, tenantId, productId);
  const reserved = (await activeReserved(tx, tenantId)).get(productId) || 0;
  if (!enabled && (n(stock.onHand) > 0 || reserved > 0)) {
    throw new AppError(409, 'Deja existencias y reservas en cero antes de desactivar Afecta inventario.', 'RESTAURANT_INVENTORY_DISABLE_WITH_STOCK');
  }

  if (enabled && !stock.enabled && n(stock.onHand) === 0 && n(product.stockActual) > 0) {
    const opening = n(product.stockActual);
    stock = await tx.restaurantInventoryStock.update({
      where:{ id:stock.id },
      data:{ onHand:opening, version:{ increment:1 } }
    });
    await tx.restaurantInventoryMovement.create({
      data:{
        tenantId,
        productId,
        productName:product.nombre,
        kind:'initial',
        units:opening,
        delta:opening,
        balance:opening,
        reason:'Migración inicial desde Inventarios / Kardex del Super Core',
        userId:userId || 'SYSTEM'
      }
    });
  }

  stock = await tx.restaurantInventoryStock.update({
    where:{ id:stock.id },
    data:{ enabled:Boolean(enabled), version:{ increment:1 } }
  });

  if (product.controlaInventario) {
    await tx.producto.update({ where:{ id:product.id }, data:{ controlaInventario:false } });
  }

  if (userId) {
    await tx.auditoriaContable.create({
      data:{
        tenantId,
        userId,
        entidad:'RESTAURANT_INVENTORY_STOCK',
        entidadId:stock.id,
        accion:enabled ? 'ENABLE' : 'DISABLE',
        metadata:{ marker:MARKER, productId:productId, productName:product.nombre, enabled:Boolean(enabled) }
      }
    }).catch(()=>{});
  }
  return { marker:MARKER, productId:productId, enabled:Boolean(enabled), version:stock.version };
}

async function configureTracking(tenantId, userId, productId, enabled) {
  return prisma.$transaction((tx)=>configureTrackingInTx(tx, tenantId, userId, productId, enabled));
}

async function setMinimum(tenantId, userId, input) {
  await assertPilot(tenantId);
  return prisma.$transaction(async (tx)=>{
    const product = await tx.producto.findFirst({ where:{ tenantId, id:text(input.productId,80) } });
    if (!product) throw new AppError(404, 'Producto no encontrado', 'RESTAURANT_INVENTORY_PRODUCT_NOT_FOUND');
    const stock = await ensureStock(tx, tenantId, product.id);
    if (Number(input.version) !== Number(stock.version)) throw new AppError(409, 'El inventario cambió. Actualiza antes de guardar.', 'RESTAURANT_INVENTORY_VERSION_CONFLICT');
    const updated = await tx.restaurantInventoryStock.update({
      where:{ id:stock.id },
      data:{ minimum:qty(input.minimum,true), version:{ increment:1 } }
    });
    return { marker:MARKER, productId:product.id, minimum:n(updated.minimum), version:updated.version };
  });
}

async function moveStock(tenantId, userId, input) {
  await assertPilot(tenantId);
  return prisma.$transaction(async (tx)=>{
    const productId = text(input.productId,80);
    const product = await tx.producto.findFirst({ where:{ tenantId, id:productId } });
    if (!product) throw new AppError(404, 'Producto no encontrado', 'RESTAURANT_INVENTORY_PRODUCT_NOT_FOUND');
    const kind = String(input.kind || '');
    if (!['initial','entry','exit','adjustment'].includes(kind)) throw new AppError(400, 'Movimiento inválido', 'RESTAURANT_INVENTORY_MOVEMENT_INVALID');
    const stock = await stockForUpdate(tx, tenantId, productId) || await ensureStock(tx, tenantId, productId);
    if (!stock.enabled) throw new AppError(409, 'Activa Afecta inventario para este producto.', 'RESTAURANT_INVENTORY_PRODUCT_NOT_ENABLED');
    if (Number(input.version) !== Number(stock.version)) throw new AppError(409, 'El inventario cambió. Actualiza antes de guardar.', 'RESTAURANT_INVENTORY_VERSION_CONFLICT');

    const amount = qty(input.quantity, kind === 'initial' || kind === 'adjustment');
    const held = (await activeReserved(tx, tenantId)).get(productId) || 0;
    if (kind === 'initial') {
      const existing = await tx.restaurantInventoryMovement.findFirst({ where:{ tenantId, productId, delta:{ not:0 } }, select:{ id:true } });
      if (n(stock.onHand) !== 0 || existing) throw new AppError(409, 'Ya existen movimientos. Usa Entrada o Conteo físico.', 'RESTAURANT_INVENTORY_INITIAL_ALREADY_SET');
    }
    const delta = kind === 'initial' || kind === 'adjustment' ? round(amount - n(stock.onHand)) : kind === 'exit' ? -amount : amount;
    if (Math.abs(delta) < 0.00001) throw new AppError(409, 'El conteo coincide con el saldo.', 'RESTAURANT_INVENTORY_NO_CHANGE');
    if (n(stock.onHand) + delta < held - 0.00001) {
      throw new AppError(409, 'Hay ' + held + ' unidades reservadas. Resuelve los pedidos antes de reducir el saldo.', 'RESTAURANT_INVENTORY_RESERVED_FLOOR');
    }
    return { marker:MARKER, ...(await record(tx,{tenantId,userId,product,stock,kind,units:Math.abs(delta),delta,reason:input.reason})) };
  });
}

function purchaseInput(input) {
  const supplier = text(input && input.supplier,200);
  const reference = text(input && input.reference || '',160,false);
  const purchaseDate = dateOnly(input && input.purchaseDate,'Fecha de compra');
  const paymentTerms = input && input.paymentTerms === 'credit' ? 'credit' : input && input.paymentTerms === 'cash' ? 'cash' : null;
  if (!paymentTerms) throw new AppError(400, 'Condición de pago inválida', 'RESTAURANT_INVENTORY_PAYMENT_TERMS_INVALID');
  const dueDate = paymentTerms === 'credit' ? dateOnly(input && input.dueDate,'Fecha de vencimiento') : null;
  if (dueDate && dueDate < purchaseDate) throw new AppError(400, 'El vencimiento no puede ser anterior a la compra', 'RESTAURANT_INVENTORY_DUE_DATE_INVALID');
  const notes = text(input && input.notes || '',400,false);
  const rawItems = Array.isArray(input && input.items) ? input.items : [];
  if (!rawItems.length || rawItems.length > 200) throw new AppError(400, 'Agrega entre 1 y 200 productos al pedido', 'RESTAURANT_INVENTORY_PURCHASE_ITEMS_REQUIRED');

  const seen = new Set();
  let subtotal = decimal(0);
  let taxTotal = decimal(0);
  const items = rawItems.map((row)=>{
    const productId = text(row.productId,80);
    if (seen.has(productId)) throw new AppError(409, 'No repitas el mismo producto en el pedido', 'RESTAURANT_INVENTORY_DUPLICATE_PURCHASE_ITEM');
    seen.add(productId);
    const quantity = qty(row.quantity);
    const unitCost = qty(row.unitCost);
    const taxPercent = qty(row.taxPercent == null ? 0 : row.taxPercent,true);
    if (taxPercent > 100) throw new AppError(400, 'IVA inválido', 'RESTAURANT_INVENTORY_TAX_INVALID');
    const lineSubtotal = decimal(quantity).mul(unitCost);
    const tax = lineSubtotal.mul(taxPercent).div(100);
    const total = lineSubtotal.plus(tax);
    subtotal = subtotal.plus(lineSubtotal);
    taxTotal = taxTotal.plus(tax);
    return {
      productId,
      quantity,
      unitCost,
      taxPercent,
      subtotal:money(lineSubtotal).toString(),
      tax:money(tax).toString(),
      total:money(total).toString()
    };
  });

  return {
    supplier,reference,purchaseDate,paymentTerms,dueDate,notes,items,
    subtotal:money(subtotal).toString(),
    taxTotal:money(taxTotal).toString(),
    total:money(subtotal.plus(taxTotal)).toString()
  };
}

function publicPurchase(row) {
  if (!row) return row;
  return {
    ...row,
    number:serial(row.number),
    subtotal:n(row.subtotal),
    taxTotal:n(row.taxTotal),
    total:n(row.total),
    items:Array.isArray(row.items) ? row.items.map((item)=>({
      ...item,
      quantity:n(item.quantity),
      unitCost:n(item.unitCost),
      taxPercent:n(item.taxPercent),
      subtotal:n(item.subtotal),
      tax:n(item.tax),
      total:n(item.total)
    })) : row.items
  };
}

async function purchaseList(tenantId) {
  await assertPilot(tenantId);
  const rows = await prisma.restaurantInventoryPurchase.findMany({
    where:{ tenantId },
    orderBy:{ number:'desc' },
    take:200,
    include:{ _count:{ select:{ items:true } } }
  });
  return rows.map((row)=>publicPurchase({ ...row, itemCount:row._count.items, _count:undefined }));
}

async function purchaseDetailInTx(tx, tenantId, id) {
  return publicPurchase(await tx.restaurantInventoryPurchase.findFirst({
    where:{ id, tenantId },
    include:{ items:{ orderBy:{ productName:'asc' } } }
  }));
}

async function purchaseDetail(tenantId, id) {
  await assertPilot(tenantId);
  const row = await purchaseDetailInTx(prisma, tenantId, id);
  if (!row) throw new AppError(404, 'Pedido de inventario no encontrado', 'RESTAURANT_INVENTORY_PURCHASE_NOT_FOUND');
  return row;
}

async function savePurchase(tenantId, userId, input) {
  await assertPilot(tenantId);
  const data = purchaseInput(input || {});
  return prisma.$transaction(async (tx)=>{
    let purchase;
    if (input && input.id) {
      purchase = await tx.restaurantInventoryPurchase.findFirst({ where:{ id:input.id, tenantId } });
      if (!purchase) throw new AppError(404, 'Pedido de inventario no encontrado', 'RESTAURANT_INVENTORY_PURCHASE_NOT_FOUND');
      if (purchase.status !== 'draft') throw new AppError(409, 'Un pedido recibido ya no se puede editar', 'RESTAURANT_INVENTORY_PURCHASE_LOCKED');
      purchase = await tx.restaurantInventoryPurchase.update({
        where:{ id:purchase.id },
        data:{
          supplier:data.supplier,reference:data.reference,purchaseDate:data.purchaseDate,paymentTerms:data.paymentTerms,
          dueDate:data.dueDate,notes:data.notes,subtotal:data.subtotal,taxTotal:data.taxTotal,total:data.total
        }
      });
      await tx.restaurantInventoryPurchaseItem.deleteMany({ where:{ purchaseId:purchase.id } });
    } else {
      purchase = await tx.restaurantInventoryPurchase.create({
        data:{
          tenantId,supplier:data.supplier,reference:data.reference,purchaseDate:data.purchaseDate,paymentTerms:data.paymentTerms,
          dueDate:data.dueDate,notes:data.notes,subtotal:data.subtotal,taxTotal:data.taxTotal,total:data.total,createdByUserId:userId
        }
      });
    }

    for (const item of data.items) {
      const product = await tx.producto.findFirst({ where:{ id:item.productId, tenantId, activo:true } });
      const stock = await tx.restaurantInventoryStock.findUnique({ where:{ tenantId_productId:{ tenantId, productId:item.productId } } });
      if (!product || !stock || !stock.enabled) throw new AppError(409, 'Todos los productos deben tener Afecta inventario activo', 'RESTAURANT_INVENTORY_PURCHASE_PRODUCT_NOT_ENABLED');
      await tx.restaurantInventoryPurchaseItem.create({
        data:{
          tenantId,purchaseId:purchase.id,productId:product.id,productName:product.nombre,quantity:item.quantity,unitCost:item.unitCost,
          taxPercent:item.taxPercent,subtotal:item.subtotal,tax:item.tax,total:item.total
        }
      });
    }
    return { marker:MARKER, purchase:await purchaseDetailInTx(tx,tenantId,purchase.id) };
  });
}

async function receivePurchase(tenantId, userId, id) {
  await assertPilot(tenantId);
  return prisma.$transaction(async (tx)=>{
    const purchase = await tx.restaurantInventoryPurchase.findFirst({ where:{ id, tenantId }, include:{ items:true } });
    if (!purchase) throw new AppError(404, 'Pedido de inventario no encontrado', 'RESTAURANT_INVENTORY_PURCHASE_NOT_FOUND');
    if (purchase.status === 'received') return { marker:MARKER, alreadyReceived:true, purchase:publicPurchase(purchase) };

    for (const item of purchase.items) {
      const product = await tx.producto.findFirst({ where:{ id:item.productId, tenantId } });
      const stock = await stockForUpdate(tx,tenantId,item.productId);
      if (!product || !stock || !stock.enabled) throw new AppError(409, 'Producto de inventario no disponible', 'RESTAURANT_INVENTORY_PRODUCT_NOT_ENABLED');
      await record(tx,{
        tenantId,userId,product,stock,kind:'entry',units:n(item.quantity),delta:n(item.quantity),
        reason:'Pedido inventario #' + serial(purchase.number) + ' · ' + purchase.supplier + (purchase.reference ? ' · ' + purchase.reference : '')
      });
    }

    await tx.restaurantInventoryPurchase.update({
      where:{ id },
      data:{ status:'received', receivedByUserId:userId, receivedAt:new Date() }
    });
    return { marker:MARKER, alreadyReceived:false, purchase:await purchaseDetailInTx(tx,tenantId,id) };
  });
}

async function costHistory(tenantId, productId) {
  await assertPilot(tenantId);
  const rows = await prisma.restaurantInventoryPurchaseItem.findMany({
    where:{ tenantId, productId, purchase:{ status:'received' } },
    include:{ purchase:{ select:{ id:true,number:true,purchaseDate:true,supplier:true,reference:true } } },
    orderBy:{ creadoEn:'desc' },
    take:3
  });
  return rows.map((row)=>({
    purchaseId:row.purchase.id,
    purchaseNumber:serial(row.purchase.number),
    purchaseDate:row.purchase.purchaseDate,
    supplier:row.purchase.supplier,
    reference:row.purchase.reference,
    quantity:n(row.quantity),
    unitCost:n(row.unitCost),
    taxPercent:n(row.taxPercent),
    total:n(row.total)
  }));
}

async function history(tenantId, filters = {}) {
  await assertPilot(tenantId);
  const where = { tenantId };
  if (filters.productId) where.productId = String(filters.productId);
  if (filters.from || filters.to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(filters.to || '') || filters.from > filters.to) {
      throw new AppError(400, 'Selecciona un período válido', 'RESTAURANT_INVENTORY_HISTORY_PERIOD_INVALID');
    }
    where.creadoEn = {
      gte:new Date(filters.from + 'T05:00:00.000Z'),
      lt:new Date(new Date(filters.to + 'T05:00:00.000Z').getTime() + 86400000)
    };
  }
  if (filters.before) where.number = { lt:BigInt(String(filters.before)) };
  const rows = await prisma.restaurantInventoryMovement.findMany({ where, orderBy:{ number:'desc' }, take:201 });
  return {
    rows:rows.slice(0,200).map((row)=>({ ...row, number:serial(row.number), units:n(row.units), delta:n(row.delta), balance:n(row.balance) })),
    next:rows.length > 200 ? serial(rows[199].number) : null
  };
}

async function assertItemsAvailableInTx(tx, tenantId, items) {
  await assertPilot(tenantId, tx);
  const grouped = new Map();
  for (const item of items || []) grouped.set(item.productId, round((grouped.get(item.productId) || 0) + n(item.quantity)));
  if (!grouped.size) return { checked:0 };
  const stocks = await tx.restaurantInventoryStock.findMany({
    where:{ tenantId, productId:{ in:[...grouped.keys()] }, enabled:true }
  });
  if (!stocks.length) return { checked:0 };
  const reserved = await activeReserved(tx,tenantId);
  for (const stock of stocks) {
    const need = grouped.get(stock.productId) || 0;
    const available = round(n(stock.onHand) - (reserved.get(stock.productId) || 0));
    if (need > available + 0.00001) {
      const product = await tx.producto.findFirst({ where:{ id:stock.productId, tenantId }, select:{ nombre:true } });
      throw new AppError(409, 'Existencias insuficientes de ' + (product && product.nombre || 'producto') + ': ' + available + ' disponibles; se solicitan ' + need + '.', 'RESTAURANT_INVENTORY_INSUFFICIENT_STOCK');
    }
  }
  return { checked:stocks.length };
}

async function recordReservationInTx(tx, tenantId, userId, sessionId, orderId, items) {
  const productIds = [...new Set((items || []).map((row)=>row.productId))];
  if (!productIds.length) return;
  const stocks = await tx.restaurantInventoryStock.findMany({
    where:{ tenantId, productId:{ in:productIds }, enabled:true }
  });
  const stockById = new Map(stocks.map((row)=>[row.productId,row]));
  const grouped = new Map();
  for (const item of items || []) {
    if (!stockById.has(item.productId)) continue;
    grouped.set(item.productId, round((grouped.get(item.productId) || 0) + n(item.quantity)));
  }
  for (const [productId, units] of grouped.entries()) {
    const existing = await tx.restaurantInventoryMovement.findFirst({ where:{ tenantId, orderId, productId, kind:'reserve' }, select:{ id:true } });
    if (existing) continue;
    const product = await tx.producto.findFirst({ where:{ id:productId, tenantId } });
    await record(tx,{
      tenantId,userId,product,stock:stockById.get(productId),kind:'reserve',units,delta:0,
      reason:'Pedido enviado a producción',sessionId,orderId
    });
  }
}

async function consumeSaleInTx(tx, tenantId, userId, sessionId, saleId) {
  await assertPilot(tenantId, tx);
  const existing = await tx.restaurantInventoryMovement.findFirst({ where:{ tenantId, saleId, kind:'sale' }, select:{ id:true } });
  if (existing) return { consumed:false, alreadyConsumed:true };

  const details = await tx.detalleComprobante.findMany({
    where:{ tenantId, comprobanteId:saleId },
    select:{ productoId:true, cantidad:true }
  });
  const grouped = new Map();
  for (const detail of details) grouped.set(detail.productoId, round((grouped.get(detail.productoId) || 0) + n(detail.cantidad)));
  const ids = [...grouped.keys()];
  if (!ids.length) return { consumed:false, products:0 };

  const stocks = await tx.restaurantInventoryStock.findMany({
    where:{ tenantId, productId:{ in:ids }, enabled:true }
  });
  for (const row of stocks) {
    const product = await tx.producto.findFirst({ where:{ id:row.productId, tenantId } });
    const stock = await stockForUpdate(tx,tenantId,row.productId);
    const units = grouped.get(row.productId) || 0;
    if (units > n(stock.onHand) + 0.00001) throw new AppError(409, 'Existencias insuficientes de ' + (product && product.nombre || 'producto') + ' al cobrar.', 'RESTAURANT_INVENTORY_INSUFFICIENT_AT_PAYMENT');
    await record(tx,{tenantId,userId,product,stock,kind:'sale',units,delta:-units,reason:'Cobro de cuenta',sessionId,saleId});
  }
  return { consumed:true, products:stocks.length };
}

async function trackingMap(tenantId) {
  await assertPilot(tenantId);
  const rows = await prisma.restaurantInventoryStock.findMany({ where:{ tenantId }, select:{ productId:true,enabled:true } });
  return Object.fromEntries(rows.map((row)=>[row.productId,Boolean(row.enabled)]));
}

module.exports = {
  MARKER,PILOT,assertPilot,workspace,trackingMap,configureTracking,configureTrackingInTx,
  setMinimum,moveStock,purchaseList,purchaseDetail,savePurchase,receivePurchase,costHistory,history,
  assertItemsAvailableInTx,recordReservationInTx,consumeSaleInTx
};
