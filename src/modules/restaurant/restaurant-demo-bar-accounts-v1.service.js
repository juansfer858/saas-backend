'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money, qty, pct } = require('../../utils/decimal');
const { lockOperation } = require('./restaurant-operation-lock-v111.service');
const commercial = require('../commercial/commercial.service');
const sales = require('../commercial/sales.service');

const MARKER = 'VANTIX_DEMO_RESTAURANTE_BAR_ACCOUNTS_V1';
const DEMO_TENANT = 'demo-restaurante';
const ACCOUNT_NOTE_PREFIX = 'VANTIX_BAR_ACCOUNT:';
const ACTIVE_STATES = ['ABIERTA', 'CUENTA_PEDIDA'];

async function assertDemoTenant(tenantId) {
  const tenant = await prisma.tenant.findUnique({ where:{ id:tenantId }, select:{ subdomain:true } });
  if (String(tenant?.subdomain || '').trim().toLowerCase() !== DEMO_TENANT) {
    throw new AppError(404, 'Recurso no disponible', 'DEMO_BAR_ACCOUNT_NOT_AVAILABLE');
  }
  return tenant;
}

function cleanName(value, fallback = 'Cuenta') {
  const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return name || fallback;
}

function accountNameFromSale(sale, fallback = 'Cuenta') {
  const meta = sales.unpackMeta(sale?.observaciones);
  const notes = String(meta?.notes || '');
  if (notes.startsWith(ACCOUNT_NOTE_PREFIX)) {
    return cleanName(notes.slice(ACCOUNT_NOTE_PREFIX.length), fallback);
  }
  return fallback;
}

function saleNotesForAccount(sale, name) {
  const meta = sales.unpackMeta(sale?.observaciones);
  return sales.packMeta({
    documentType: meta.documentType || 'DOCUMENTO_EQUIVALENTE_POS',
    notes: ACCOUNT_NOTE_PREFIX + cleanName(name)
  });
}


function lineAmounts(detail, quantity) {
  const q = qty(quantity);
  const price = money(detail.precioUnitario);
  const subtotal = money(q.mul(price));
  const iva = money(subtotal.mul(pct(detail.ivaPct || 0)).div(100));
  const impoconsumo = money(subtotal.mul(pct(detail.impoconsumoPct || 0)).div(100));
  return { q, subtotal, iva, impoconsumo, total:money(subtotal.plus(iva).plus(impoconsumo)) };
}

async function recalcSaleTx(tx, saleId) {
  const rows = await tx.detalleComprobante.findMany({
    where:{ comprobanteId:saleId },
    select:{ subtotalLinea:true, ivaValor:true, impoconsumoValor:true, totalLinea:true }
  });
  const sums = rows.reduce((acc,row) => ({
    subtotal:money(acc.subtotal.plus(row.subtotalLinea || 0)),
    iva:money(acc.iva.plus(row.ivaValor || 0)),
    impoconsumo:money(acc.impoconsumo.plus(row.impoconsumoValor || 0)),
    total:money(acc.total.plus(row.totalLinea || 0))
  }), { subtotal:money(0), iva:money(0), impoconsumo:money(0), total:money(0) });
  return tx.comprobanteComercial.update({
    where:{ id:saleId },
    data:{ subtotal:sums.subtotal, ivaTotal:sums.iva, impoconsumoTotal:sums.impoconsumo, total:sums.total }
  });
}

async function createAccountInTx(tx, tenantId, user, table, input = {}) {
  const currentCount = await tx.restaurantTableSession.count({
    where:{ tenantId, tableId:table.id, state:{ in:ACTIVE_STATES } }
  });
  const name = cleanName(input.name, `Cuenta ${currentCount + 1}`);
  const document = await commercial.createDocumentInTx(tx, tenantId, user.id, {
    tipo:'FACTURA_VENTA',
    estado:'BORRADOR',
    sourceId:`REST-DEMO-ACCOUNT-${table.id}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    terceroId:null,
    cajaBancoId:null,
    formaPago:null,
    observaciones:sales.packMeta({
      documentType:'DOCUMENTO_EQUIVALENTE_POS',
      notes:ACCOUNT_NOTE_PREFIX + name
    }),
    detalles:[]
  });
  const session = await tx.restaurantTableSession.create({
    data:{
      tenantId,
      tableId:table.id,
      saleId:document.id,
      openedByUserId:user.id,
      billingMode:'CONJUNTA',
      guestCount:Math.max(Number(input.guestCount) || 1, 1)
    }
  });
  return { session, document, name };
}

async function ensureDraftOrderTx(tx, tenantId, user, sessionId) {
  let order = await tx.restaurantOrder.findFirst({
    where:{ tenantId, sessionId, source:'MESERO', state:'BORRADOR' },
    orderBy:{ creadoEn:'desc' }
  });
  if (!order) {
    order = await tx.restaurantOrder.create({
      data:{ tenantId, sessionId, source:'MESERO', state:'BORRADOR', createdByUserId:user.id, total:money(0) }
    });
  }
  return order;
}

function operationalState(order, item) {
  if (!order) return 'CUENTA';
  if (order.state === 'BORRADOR') return 'POR_ENVIAR';
  if (order.state === 'CANCELADO') return 'CANCELADO';
  const command = (order.commands || []).find((row) => String(row.station || '') === String(item?.station || ''));
  const state = String(command?.state || '').toUpperCase();
  if (state === 'EN_PREPARACION') return 'EN_PREPARACION';
  if (state === 'LISTA') return 'LISTO';
  if (state === 'ENTREGADA') return 'ENTREGADO';
  if (state === 'CANCELADA') return 'CANCELADO';
  return 'PENDIENTE';
}

async function loadActiveAccountTx(tx, tenantId, sessionId) {
  const session = await tx.restaurantTableSession.findFirst({
    where:{ id:sessionId, tenantId, state:{ in:ACTIVE_STATES } },
    include:{ table:true }
  });
  if (!session) throw new AppError(404, 'Cuenta no encontrada', 'DEMO_BAR_ACCOUNT_NOT_FOUND');
  const sale = await tx.comprobanteComercial.findFirst({
    where:{ id:session.saleId, tenantId, tipo:'FACTURA_VENTA', estado:'BORRADOR' },
    include:{ detalles:{ orderBy:{ id:'asc' } } }
  });
  if (!sale) throw new AppError(409, 'La cuenta ya no admite cambios', 'DEMO_BAR_ACCOUNT_NOT_DRAFT');
  return { session, sale };
}

async function retireMovedAccountTx(tx, tenantId, user, session, sale, reason, destinationSessionId) {
  const remaining = await tx.detalleComprobante.count({ where:{ tenantId, comprobanteId:sale.id } });
  if (remaining) return false;
  const payments = await tx.restaurantSessionPayment.count({ where:{ tenantId, sessionId:session.id } });
  const fiscal = await tx.restaurantFiscalDocument.count({ where:{ tenantId, sessionId:session.id } });
  if (payments || fiscal) throw new AppError(409, 'La cuenta ya tiene actividad financiera y no puede moverse', 'DEMO_BAR_ACCOUNT_FINANCIAL_ACTIVITY');
  const now = new Date();
  await tx.restaurantTableSession.update({
    where:{ id:session.id },
    data:{ state:'CANCELADA', closedAt:now, closedByUserId:user.id, accountRequestedAt:null, accountPreparedAt:null, cashierRequestedAt:null }
  });
  await tx.restaurantQrVisitDevice.updateMany({
    where:{ tenantId, sessionId:session.id, revokedAt:null },
    data:{ revokedAt:now }
  });
  await tx.comprobanteComercial.update({
    where:{ id:sale.id },
    data:{
      estado:'ANULADO',
      subtotal:money(0),
      ivaTotal:money(0),
      impoconsumoTotal:money(0),
      total:money(0),
      anuladoEn:now,
      motivoAnulacion:reason
    }
  });
  await tx.auditoriaContable.create({
    data:{
      tenantId,
      userId:user.id,
      entidad:'RESTAURANT_TABLE_SESSION',
      entidadId:session.id,
      accion:'DEMO_BAR_ACCOUNT_RETIRED_AFTER_MOVE',
      metadata:{ marker:MARKER, reason, destinationSessionId }
    }
  });
  return true;
}

async function syncTableStateTx(tx, tenantId, tableId) {
  const rows = await tx.restaurantTableSession.findMany({
    where:{ tenantId, tableId, state:{ in:ACTIVE_STATES } },
    select:{ state:true }
  });
  const state = !rows.length
    ? 'LIBRE'
    : rows.some((row) => row.state === 'ABIERTA')
      ? 'OCUPADA'
      : 'CUENTA_PEDIDA';
  return tx.restaurantTable.update({ where:{ id:tableId }, data:{ state } });
}

async function workspace(tenantId) {
  await assertDemoTenant(tenantId);
  const [zones, tables, sessions] = await Promise.all([
    prisma.restaurantZone.findMany({
      where:{ tenantId, active:true },
      orderBy:[{ sortOrder:'asc' },{ name:'asc' }]
    }),
    prisma.restaurantTable.findMany({
      where:{ tenantId, active:true },
      orderBy:[{ code:'asc' }]
    }),
    prisma.restaurantTableSession.findMany({
      where:{ tenantId, state:{ in:ACTIVE_STATES } },
      orderBy:[{ openedAt:'asc' }]
    })
  ]);

  const saleIds = sessions.map((row) => row.saleId);
  const saleRows = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where:{ tenantId, id:{ in:saleIds }, tipo:'FACTURA_VENTA' },
    select:{ id:true, numero:true, estado:true, total:true, saldo:true, observaciones:true, creadoEn:true }
  }) : [];
  const salesById = new Map(saleRows.map((row) => [row.id,row]));
  const sessionsByTable = new Map();
  for (const session of sessions) {
    if (!sessionsByTable.has(session.tableId)) sessionsByTable.set(session.tableId, []);
    sessionsByTable.get(session.tableId).push(session);
  }
  const zoneById = new Map(zones.map((row) => [row.id,row]));

  const publicTables = tables.map((table) => {
    const rows = sessionsByTable.get(table.id) || [];
    const accounts = rows.map((session, index) => {
      const sale = salesById.get(session.saleId) || null;
      return {
        id: session.id,
        sessionId: session.id,
        tableId: table.id,
        number: sale?.numero || String(index + 1),
        name: accountNameFromSale(sale, `Cuenta ${index + 1}`),
        state: session.state,
        guestCount: Number(session.guestCount || 1),
        openedAt: session.openedAt,
        accountRequestedAt: session.accountRequestedAt || null,
        sale: sale ? {
          id: sale.id,
          numero: sale.numero,
          estado: sale.estado,
          total: String(sale.total || 0),
          saldo: String(sale.saldo || 0)
        } : null
      };
    });
    return {
      id: table.id,
      code: table.code,
      name: table.name,
      state: table.state,
      zoneId: table.zoneId || null,
      zoneName: zoneById.get(table.zoneId)?.name || 'Ubicaciones',
      accounts
    };
  });

  return {
    marker: MARKER,
    tenant: DEMO_TENANT,
    zones: zones.map((row) => ({ id:row.id, name:row.name, sortOrder:row.sortOrder })),
    tables: publicTables
  };
}

async function createAccount(tenantId, user, tableId, input = {}) {
  await assertDemoTenant(tenantId);
  return prisma.$transaction(async (tx) => {
    await lockOperation(tx, tenantId);
    const table = await tx.restaurantTable.findFirst({ where:{ id:tableId, tenantId, active:true } });
    if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');

    const { session, document, name } = await createAccountInTx(tx, tenantId, user, table, input);
    await syncTableStateTx(tx, tenantId, table.id);
    return {
      marker:MARKER,
      account:{
        id:session.id,
        sessionId:session.id,
        tableId:table.id,
        number:document.numero,
        name,
        state:session.state,
        guestCount:session.guestCount,
        openedAt:session.openedAt,
        sale:{ id:document.id, numero:document.numero, estado:document.estado, total:String(document.total || 0), saldo:String(document.saldo || 0) }
      }
    };
  });
}

async function renameAccount(tenantId, user, sessionId, input = {}) {
  await assertDemoTenant(tenantId);
  return prisma.$transaction(async (tx) => {
    await lockOperation(tx, tenantId);
    const session = await tx.restaurantTableSession.findFirst({
      where:{ id:sessionId, tenantId, state:{ in:ACTIVE_STATES } }
    });
    if (!session) throw new AppError(404, 'Cuenta no encontrada', 'DEMO_BAR_ACCOUNT_NOT_FOUND');
    const sale = await tx.comprobanteComercial.findFirst({
      where:{ id:session.saleId, tenantId, estado:'BORRADOR' }
    });
    if (!sale) throw new AppError(409, 'La cuenta ya no admite cambios de nombre', 'DEMO_BAR_ACCOUNT_NOT_DRAFT');
    const name = cleanName(input.name);
    await tx.comprobanteComercial.update({
      where:{ id:sale.id },
      data:{ observaciones:saleNotesForAccount(sale,name) }
    });
    await tx.auditoriaContable.create({
      data:{
        tenantId,
        userId:user.id,
        entidad:'RESTAURANT_TABLE_SESSION',
        entidadId:session.id,
        accion:'DEMO_BAR_ACCOUNT_RENAMED',
        metadata:{ marker:MARKER, name }
      }
    });
    return { marker:MARKER, id:session.id, name };
  });
}

async function requestAccount(tenantId, user, sessionId) {
  await assertDemoTenant(tenantId);
  return prisma.$transaction(async (tx) => {
    await lockOperation(tx, tenantId);
    const session = await tx.restaurantTableSession.findFirst({
      where:{ id:sessionId, tenantId, state:'ABIERTA' }
    });
    if (!session) throw new AppError(404, 'La cuenta no está abierta', 'DEMO_BAR_ACCOUNT_NOT_OPEN');
    const updated = await tx.restaurantTableSession.update({
      where:{ id:session.id },
      data:{ state:'CUENTA_PEDIDA', accountRequestedAt:new Date() }
    });
    await syncTableStateTx(tx, tenantId, session.tableId);
    await tx.auditoriaContable.create({
      data:{
        tenantId,
        userId:user.id,
        entidad:'RESTAURANT_TABLE_SESSION',
        entidadId:session.id,
        accion:'DEMO_BAR_ACCOUNT_REQUESTED',
        metadata:{ marker:MARKER, tableId:session.tableId }
      }
    });
    return { marker:MARKER, session:updated };
  });
}

async function closeEmptyAccount(tenantId, user, sessionId) {
  await assertDemoTenant(tenantId);
  return prisma.$transaction(async (tx) => {
    await lockOperation(tx, tenantId);
    const session = await tx.restaurantTableSession.findFirst({
      where:{ id:sessionId, tenantId, state:{ in:ACTIVE_STATES } },
      include:{ table:true }
    });
    if (!session) throw new AppError(404, 'Cuenta no encontrada', 'DEMO_BAR_ACCOUNT_NOT_FOUND');
    const [sale, orders, payments, fiscal] = await Promise.all([
      tx.comprobanteComercial.findFirst({ where:{ id:session.saleId, tenantId }, include:{ detalles:true } }),
      tx.restaurantOrder.findMany({ where:{ tenantId, sessionId:session.id }, include:{ items:true, commands:true } }),
      tx.restaurantSessionPayment.count({ where:{ tenantId, sessionId:session.id } }),
      tx.restaurantFiscalDocument.count({ where:{ tenantId, sessionId:session.id } })
    ]);
    if (!sale || sale.estado !== 'BORRADOR') throw new AppError(409, 'La cuenta ya tiene actividad comercial', 'DEMO_BAR_EMPTY_ACCOUNT_SALE_LOCKED');
    const hasOrderActivity = orders.some((order) => (order.items||[]).length || (order.commands||[]).length || order.state !== 'BORRADOR');
    if ((sale.detalles||[]).length || hasOrderActivity || payments || fiscal) {
      throw new AppError(409, 'La cuenta tiene consumos o actividad y no puede cerrarse como vacía', 'DEMO_BAR_EMPTY_ACCOUNT_HAS_ACTIVITY');
    }

    const draftIds = orders.filter((order) => order.state === 'BORRADOR').map((order) => order.id);
    if (draftIds.length) await tx.restaurantOrder.deleteMany({ where:{ id:{ in:draftIds }, tenantId } });
    await tx.restaurantTableSession.delete({ where:{ id:session.id } });
    await tx.comprobanteComercial.delete({ where:{ id:sale.id } });
    await syncTableStateTx(tx, tenantId, session.tableId);
    await tx.auditoriaContable.create({
      data:{
        tenantId,
        userId:user.id,
        entidad:'RESTAURANT_TABLE_SESSION',
        entidadId:session.id,
        accion:'DEMO_BAR_EMPTY_ACCOUNT_CLOSED',
        metadata:{ marker:MARKER, tableId:session.tableId, saleId:sale.id }
      }
    });
    return { marker:MARKER, closed:true, sessionId:session.id, tableId:session.tableId };
  });
}

async function accountDetail(tenantId, sessionId) {
  await assertDemoTenant(tenantId);
  return prisma.$transaction(async (tx) => {
    const { session, sale } = await loadActiveAccountTx(tx, tenantId, sessionId);
    const detailIds = sale.detalles.map((row) => row.id);
    const orderItems = detailIds.length ? await tx.restaurantOrderItem.findMany({
      where:{ tenantId, saleDetailId:{ in:detailIds } },
      orderBy:{ creadoEn:'asc' }
    }) : [];
    const orderIds = [...new Set(orderItems.map((row) => row.orderId))];
    const orders = orderIds.length ? await tx.restaurantOrder.findMany({
      where:{ tenantId, id:{ in:orderIds } },
      include:{ commands:true, session:{ include:{ table:true } } }
    }) : [];
    const orderById = new Map(orders.map((row) => [row.id,row]));
    const itemByDetail = new Map();
    for (const item of orderItems) if (!itemByDetail.has(item.saleDetailId)) itemByDetail.set(item.saleDetailId,item);
    const items = sale.detalles.map((detail) => {
      const item = itemByDetail.get(detail.id) || null;
      const order = item ? orderById.get(item.orderId) : null;
      return {
        id:item?.id || detail.id,
        orderItemId:item?.id || null,
        saleDetailId:detail.id,
        menuItemId:item?.menuItemId || null,
        productId:item?.productId || detail.productoId || null,
        description:item?.description || detail.descripcion,
        quantity:String(detail.cantidad),
        unitPrice:String(detail.precioUnitario),
        lineTotal:String(detail.totalLinea),
        station:item?.station || null,
        seatNumber:item?.seatNumber || null,
        notes:item?.notes || null,
        orderId:order?.id || null,
        orderState:order?.state || null,
        operationalState:operationalState(order,item),
        operationalSessionId:order?.sessionId || null,
        originTable:order?.session?.table ? {
          id:order.session.table.id,
          name:order.session.table.name,
          code:order.session.table.code
        } : null,
        editableDraft:Boolean(order?.state === 'BORRADOR' && order?.sessionId === session.id)
      };
    });
    return {
      marker:MARKER,
      session:{
        id:session.id,
        tableId:session.tableId,
        state:session.state,
        guestCount:Number(session.guestCount || 1),
        accountRequestedAt:session.accountRequestedAt || null,
        openedAt:session.openedAt
      },
      table:{ id:session.table.id, code:session.table.code, name:session.table.name },
      accountName:accountNameFromSale(sale,'Cuenta'),
      sale:{
        id:sale.id,
        numero:sale.numero,
        estado:sale.estado,
        total:String(sale.total || 0),
        subtotal:String(sale.subtotal || 0),
        ivaTotal:String(sale.ivaTotal || 0),
        impoconsumoTotal:String(sale.impoconsumoTotal || 0)
      },
      items,
      hasDraft:items.some((row) => row.editableDraft)
    };
  });
}

async function reopenAccount(tenantId, sessionId) {
  await assertDemoTenant(tenantId);
  const session = await prisma.restaurantTableSession.findFirst({
    where:{ id:sessionId, tenantId, state:{ in:ACTIVE_STATES } }
  });
  if (!session) throw new AppError(404, 'Cuenta no encontrada', 'DEMO_BAR_ACCOUNT_NOT_FOUND');
  if (session.splitMetadata) throw new AppError(409, 'La cuenta ya está preparada para cobro', 'RESTAURANT_ACCOUNT_ALREADY_PREPARED');
  if (session.state !== 'ABIERTA' || session.accountRequestedAt || session.accountPreparedAt || session.cashierRequestedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.restaurantTableSession.update({
        where:{ id:session.id },
        data:{ state:'ABIERTA', accountRequestedAt:null, accountPreparedAt:null, cashierRequestedAt:null }
      });
      await syncTableStateTx(tx, tenantId, session.tableId);
    });
  }
  return { marker:MARKER, reopened:true, sessionId:session.id };
}

async function splitAccount(tenantId, user, sessionId, input = {}) {
  await assertDemoTenant(tenantId);
  const requested = Array.isArray(input.lines) ? input.lines : [];
  if (!requested.length || requested.length > 100) throw new AppError(400, 'Selecciona consumos para separar', 'DEMO_BAR_SPLIT_LINES_REQUIRED');
  return prisma.$transaction(async (tx) => {
    await lockOperation(tx, tenantId);
    const { session:sourceSession, sale:sourceSale } = await loadActiveAccountTx(tx, tenantId, sessionId);
    const table = sourceSession.table;
    const { session:destSession, document:destSale } = await createAccountInTx(tx, tenantId, user, table, {
      name:cleanName(input.name,'Cuenta separada'),
      guestCount:sourceSession.guestCount
    });
    const used = new Set();
    let destDraft = null;
    for (const request of requested) {
      const detailId = String(request.detailId || '');
      if (!detailId || used.has(detailId)) throw new AppError(400, 'Consumo repetido o inválido', 'DEMO_BAR_SPLIT_LINE_INVALID');
      used.add(detailId);
      const detail = await tx.detalleComprobante.findFirst({
        where:{ id:detailId, tenantId, comprobanteId:sourceSale.id }
      });
      if (!detail) throw new AppError(404, 'Consumo no encontrado', 'DEMO_BAR_SPLIT_LINE_NOT_FOUND');
      const moveQty = qty(request.quantity);
      const originalQty = qty(detail.cantidad);
      if (!moveQty.gt(0) || moveQty.gt(originalQty)) throw new AppError(400, 'Cantidad inválida para separar', 'DEMO_BAR_SPLIT_QTY_INVALID');
      const item = await tx.restaurantOrderItem.findFirst({ where:{ tenantId, saleDetailId:detail.id } });
      const order = item ? await tx.restaurantOrder.findFirst({ where:{ id:item.orderId, tenantId } }) : null;
      const full = moveQty.eq(originalQty);
      if (full) {
        await tx.detalleComprobante.update({ where:{ id:detail.id }, data:{ comprobanteId:destSale.id } });
        if (item && order?.state === 'BORRADOR') {
          if (!destDraft) destDraft = await ensureDraftOrderTx(tx, tenantId, user, destSession.id);
          await tx.restaurantOrderItem.update({ where:{ id:item.id }, data:{ orderId:destDraft.id } });
          await tx.restaurantOrder.update({ where:{ id:order.id }, data:{ total:{ decrement:detail.totalLinea } } });
          await tx.restaurantOrder.update({ where:{ id:destDraft.id }, data:{ total:{ increment:detail.totalLinea } } });
        }
      } else {
        const moved = lineAmounts(detail, moveQty);
        const remain = lineAmounts(detail, originalQty.minus(moveQty));
        const movedDetail = await tx.detalleComprobante.create({
          data:{
            tenantId,
            comprobanteId:destSale.id,
            productoId:detail.productoId,
            descripcion:detail.descripcion,
            cantidad:moved.q,
            precioUnitario:detail.precioUnitario,
            descuentoPct:detail.descuentoPct,
            ivaPct:detail.ivaPct,
            impoconsumoPct:detail.impoconsumoPct,
            subtotalLinea:moved.subtotal,
            ivaValor:moved.iva,
            impoconsumoValor:moved.impoconsumo,
            totalLinea:moved.total,
            costoUnitario:detail.costoUnitario
          }
        });
        await tx.detalleComprobante.update({
          where:{ id:detail.id },
          data:{ cantidad:remain.q, subtotalLinea:remain.subtotal, ivaValor:remain.iva, impoconsumoValor:remain.impoconsumo, totalLinea:remain.total }
        });
        if (item) {
          if (order?.state === 'BORRADOR') {
            if (!destDraft) destDraft = await ensureDraftOrderTx(tx, tenantId, user, destSession.id);
            await tx.restaurantOrderItem.update({
              where:{ id:item.id },
              data:{ quantity:remain.q, lineTotal:remain.total }
            });
            await tx.restaurantOrderItem.create({
              data:{
                tenantId,
                orderId:destDraft.id,
                menuItemId:item.menuItemId,
                productId:item.productId,
                saleDetailId:movedDetail.id,
                description:item.description,
                quantity:moved.q,
                unitPrice:item.unitPrice,
                lineTotal:moved.total,
                station:item.station,
                seatNumber:item.seatNumber,
                notes:item.notes
              }
            });
            await tx.restaurantOrder.update({ where:{ id:order.id }, data:{ total:{ decrement:moved.total } } });
            await tx.restaurantOrder.update({ where:{ id:destDraft.id }, data:{ total:{ increment:moved.total } } });
          } else {
            await tx.restaurantOrderItem.update({ where:{ id:item.id }, data:{ quantity:remain.q, lineTotal:remain.total } });
            await tx.restaurantOrderItem.create({
              data:{
                tenantId,
                orderId:item.orderId,
                menuItemId:item.menuItemId,
                productId:item.productId,
                saleDetailId:movedDetail.id,
                description:item.description,
                quantity:moved.q,
                unitPrice:item.unitPrice,
                lineTotal:moved.total,
                station:item.station,
                seatNumber:item.seatNumber,
                notes:item.notes
              }
            });
          }
        }
      }
    }
    const emptyDraftOrders = await tx.restaurantOrder.findMany({
      where:{ tenantId, sessionId:sourceSession.id, state:'BORRADOR' },
      include:{ _count:{ select:{ items:true } } }
    });
    for (const order of emptyDraftOrders) if (!order._count.items) await tx.restaurantOrder.delete({ where:{ id:order.id } });
    await recalcSaleTx(tx, sourceSale.id);
    await recalcSaleTx(tx, destSale.id);
    const retired = await retireMovedAccountTx(tx, tenantId, user, sourceSession, sourceSale, 'Cuenta dividida; consumos transferidos a otra cuenta', destSession.id);
    if (!retired) {
      await tx.restaurantTableSession.update({
        where:{ id:sourceSession.id },
        data:{ state:'ABIERTA', accountRequestedAt:null, accountPreparedAt:null, cashierRequestedAt:null }
      });
    }
    await syncTableStateTx(tx, tenantId, sourceSession.tableId);
    await tx.auditoriaContable.create({
      data:{
        tenantId,
        userId:user.id,
        entidad:'RESTAURANT_TABLE_SESSION',
        entidadId:sourceSession.id,
        accion:'DEMO_BAR_ACCOUNT_SPLIT',
        metadata:{ marker:MARKER, destinationSessionId:destSession.id, lineCount:requested.length, sourceRetired:retired }
      }
    });
    return { marker:MARKER, accountId:destSession.id, sourceRetired:retired };
  });
}

async function mergeAccounts(tenantId, user, destinationSessionId, input = {}) {
  await assertDemoTenant(tenantId);
  const sourceIds = [...new Set((Array.isArray(input.sources) ? input.sources : []).map(String).filter(Boolean))];
  if (!sourceIds.length || sourceIds.length > 100 || sourceIds.includes(String(destinationSessionId))) {
    throw new AppError(400, 'Selecciona cuentas válidas para unir', 'DEMO_BAR_MERGE_ACCOUNTS_REQUIRED');
  }
  return prisma.$transaction(async (tx) => {
    await lockOperation(tx, tenantId);
    const { session:destSession, sale:destSale } = await loadActiveAccountTx(tx, tenantId, destinationSessionId);
    let destDraft = null;
    const touchedTables = new Set([destSession.tableId]);
    for (const sourceId of sourceIds) {
      const { session:sourceSession, sale:sourceSale } = await loadActiveAccountTx(tx, tenantId, sourceId);
      const payments = await tx.restaurantSessionPayment.count({ where:{ tenantId, sessionId:sourceSession.id } });
      const fiscal = await tx.restaurantFiscalDocument.count({ where:{ tenantId, sessionId:sourceSession.id } });
      if (payments || fiscal || sourceSession.splitMetadata) throw new AppError(409, 'Una cuenta seleccionada ya está en proceso financiero', 'DEMO_BAR_MERGE_ACCOUNT_LOCKED');
      touchedTables.add(sourceSession.tableId);
      const details = sourceSale.detalles;
      const detailIds = details.map((row) => row.id);
      const items = detailIds.length ? await tx.restaurantOrderItem.findMany({
        where:{ tenantId, saleDetailId:{ in:detailIds } }
      }) : [];
      const orders = items.length ? await tx.restaurantOrder.findMany({
        where:{ tenantId, id:{ in:[...new Set(items.map((row) => row.orderId))] } }
      }) : [];
      const orderById = new Map(orders.map((row) => [row.id,row]));
      for (const item of items) {
        const order = orderById.get(item.orderId);
        if (order?.state === 'BORRADOR') {
          if (!destDraft) destDraft = await ensureDraftOrderTx(tx, tenantId, user, destSession.id);
          await tx.restaurantOrderItem.update({ where:{ id:item.id }, data:{ orderId:destDraft.id } });
          await tx.restaurantOrder.update({ where:{ id:order.id }, data:{ total:{ decrement:item.lineTotal } } });
          await tx.restaurantOrder.update({ where:{ id:destDraft.id }, data:{ total:{ increment:item.lineTotal } } });
        }
      }
      if (detailIds.length) await tx.detalleComprobante.updateMany({
        where:{ tenantId, id:{ in:detailIds } },
        data:{ comprobanteId:destSale.id }
      });
      const emptyDraftOrders = await tx.restaurantOrder.findMany({
        where:{ tenantId, sessionId:sourceSession.id, state:'BORRADOR' },
        include:{ _count:{ select:{ items:true } } }
      });
      for (const order of emptyDraftOrders) if (!order._count.items) await tx.restaurantOrder.delete({ where:{ id:order.id } });
      await recalcSaleTx(tx, sourceSale.id);
      await retireMovedAccountTx(tx, tenantId, user, sourceSession, sourceSale, 'Cuenta unida a otra cuenta', destSession.id);
    }
    await recalcSaleTx(tx, destSale.id);
    if (input.name) {
      const current = await tx.comprobanteComercial.findUnique({ where:{ id:destSale.id } });
      await tx.comprobanteComercial.update({
        where:{ id:destSale.id },
        data:{ observaciones:saleNotesForAccount(current, cleanName(input.name)) }
      });
    }
    await tx.restaurantTableSession.update({
      where:{ id:destSession.id },
      data:{ state:'ABIERTA', accountRequestedAt:null, accountPreparedAt:null, cashierRequestedAt:null }
    });
    for (const tableId of touchedTables) await syncTableStateTx(tx, tenantId, tableId);
    await tx.auditoriaContable.create({
      data:{
        tenantId,
        userId:user.id,
        entidad:'RESTAURANT_TABLE_SESSION',
        entidadId:destSession.id,
        accion:'DEMO_BAR_ACCOUNTS_MERGED',
        metadata:{ marker:MARKER, sourceSessionIds:sourceIds, accountName:input.name || null }
      }
    });
    return { marker:MARKER, accountId:destSession.id, merged:sourceIds.length };
  });
}

module.exports = {
  MARKER,
  DEMO_TENANT,
  ACCOUNT_NOTE_PREFIX,
  assertDemoTenant,
  accountNameFromSale,
  saleNotesForAccount,
  syncTableStateTx,
  workspace,
  createAccount,
  renameAccount,
  requestAccount,
  closeEmptyAccount,
  accountDetail,
  reopenAccount,
  splitAccount,
  mergeAccounts,
  recalcSaleTx,
  lineAmounts
};
