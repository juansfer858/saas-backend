'use strict';

const { decimal, money, qty } = require('../../utils/decimal');

const MARKER = 'VANTIX_RESTAURANT_SHIFT_PRODUCTION_SALES_RECONCILE_V119';
const DELIVERY_FEE_SKU = 'REST-DELIVERY-FEE';
const FINAL_ORDER_EXCLUDED = new Set(['BORRADOR', 'CANCELADO']);

function text(value) {
  return String(value || '').trim().toUpperCase();
}

function amount(value) {
  return money(value || 0);
}

function quantity(value) {
  return qty(value || 0);
}

function allowedNonProductionDetail(detail, channel) {
  if (channel !== 'DOMICILIO') return false;
  const sku = text(detail?.producto?.sku);
  const description = text(detail?.descripcion);
  return sku === DELIVERY_FEE_SKU || description === 'SERVICIO DE DOMICILIO';
}

function issue(code, message, extra = {}) {
  return { code, message, ...extra };
}

function reconcileSaleRecord(record = {}) {
  const channel = record.channel || 'MESAS';
  const reference = record.reference || record.sale?.numero || record.sale?.id || 'Sin referencia';
  const sale = record.sale || null;
  const productionItems = Array.isArray(record.productionItems) ? record.productionItems : [];
  const issues = [];

  if (!sale) {
    return {
      marker: MARKER,
      channel,
      reference,
      saleId: record.saleId || null,
      saleNumber: null,
      productionTotal: '0.00',
      nonProductionCharges: '0.00',
      saleDetailTotal: '0.00',
      saleTotal: '0.00',
      difference: '0.00',
      balanced: false,
      issues: [issue('SALE_NOT_FOUND', 'No existe la venta asociada a la operación.')]
    };
  }

  const details = Array.isArray(sale.detalles) ? sale.detalles : [];
  const detailById = new Map(details.map((detail) => [detail.id, detail]));
  const groups = new Map();
  let productionTotal = decimal(0);

  for (const item of productionItems) {
    productionTotal = productionTotal.plus(item.lineTotal || 0);
    if (!item.saleDetailId) {
      issues.push(issue(
        'PRODUCTION_ITEM_WITHOUT_SALE_DETAIL',
        'Hay un producto enviado a Producción sin vínculo con una línea de venta.',
        { itemId:item.id || null, product:item.description || item.descripcion || null, amount:amount(item.lineTotal).toString() }
      ));
      continue;
    }
    let group = groups.get(item.saleDetailId);
    if (!group) {
      group = { quantity:decimal(0), total:decimal(0), itemIds:[] };
      groups.set(item.saleDetailId, group);
    }
    group.quantity = group.quantity.plus(item.quantity || 0);
    group.total = group.total.plus(item.lineTotal || 0);
    if (item.id) group.itemIds.push(item.id);
  }

  for (const [detailId, group] of groups) {
    const detail = detailById.get(detailId);
    if (!detail) {
      issues.push(issue(
        'PRODUCTION_DETAIL_NOT_IN_SALE',
        'Producción conserva una línea que ya no existe en la venta.',
        { detailId, itemIds:group.itemIds, productionAmount:amount(group.total).toString() }
      ));
      continue;
    }
    const qtyDifference = quantity(group.quantity).minus(quantity(detail.cantidad));
    const amountDifference = amount(group.total).minus(amount(detail.totalLinea));
    if (!qtyDifference.eq(0)) {
      issues.push(issue(
        'PRODUCTION_SALE_QUANTITY_MISMATCH',
        'La cantidad producida no coincide con la cantidad facturada.',
        {
          detailId,
          product:detail.descripcion || null,
          productionQuantity:quantity(group.quantity).toString(),
          saleQuantity:quantity(detail.cantidad).toString(),
          difference:quantity(qtyDifference).toString()
        }
      ));
    }
    if (!amountDifference.eq(0)) {
      issues.push(issue(
        'PRODUCTION_SALE_AMOUNT_MISMATCH',
        'El valor de la línea producida no coincide con el valor de la línea vendida.',
        {
          detailId,
          product:detail.descripcion || null,
          productionAmount:amount(group.total).toString(),
          saleAmount:amount(detail.totalLinea).toString(),
          difference:amount(amountDifference).toString()
        }
      ));
    }
  }

  let nonProductionCharges = decimal(0);
  let saleDetailTotal = decimal(0);
  for (const detail of details) {
    saleDetailTotal = saleDetailTotal.plus(detail.totalLinea || 0);
    if (groups.has(detail.id)) continue;
    if (allowedNonProductionDetail(detail, channel)) {
      nonProductionCharges = nonProductionCharges.plus(detail.totalLinea || 0);
      continue;
    }
    issues.push(issue(
      'SALE_DETAIL_WITHOUT_PRODUCTION',
      'La venta contiene una línea sin respaldo en Producción.',
      { detailId:detail.id, product:detail.descripcion || null, saleAmount:amount(detail.totalLinea).toString() }
    ));
  }

  const saleTotal = amount(sale.total);
  const detailDifference = amount(saleDetailTotal).minus(saleTotal);
  if (!detailDifference.eq(0)) {
    issues.push(issue(
      'SALE_HEADER_DETAIL_MISMATCH',
      'El total de la venta no coincide con la suma de sus líneas.',
      {
        saleDetailTotal:amount(saleDetailTotal).toString(),
        saleTotal:saleTotal.toString(),
        difference:amount(detailDifference).toString()
      }
    ));
  }

  const operationalExpected = amount(decimal(productionTotal).plus(nonProductionCharges));
  const difference = amount(operationalExpected.minus(saleTotal));
  if (!difference.eq(0)) {
    issues.push(issue(
      'PRODUCTION_SALE_TOTAL_MISMATCH',
      'El total operativo de Producción no coincide con la venta final.',
      {
        productionTotal:amount(productionTotal).toString(),
        nonProductionCharges:amount(nonProductionCharges).toString(),
        saleTotal:saleTotal.toString(),
        difference:difference.toString()
      }
    ));
  }

  return {
    marker: MARKER,
    channel,
    reference,
    saleId: sale.id,
    saleNumber: sale.numero || null,
    productionTotal: amount(productionTotal).toString(),
    nonProductionCharges: amount(nonProductionCharges).toString(),
    saleDetailTotal: amount(saleDetailTotal).toString(),
    saleTotal: saleTotal.toString(),
    difference: difference.toString(),
    balanced: issues.length === 0,
    issues
  };
}

async function reconcileShiftProductionSales(tx, tenantId, shift) {
  const end = shift?.cerradoEn ? new Date(shift.cerradoEn) : new Date();
  const start = new Date(shift.abiertoEn);
  const [sessions, paymentRows] = await Promise.all([
    tx.restaurantTableSession.findMany({
      where:{ tenantId, cashShiftId:shift.id },
      include:{
        table:{ select:{ id:true, name:true } },
        orders:{
          where:{ state:{ notIn:[...FINAL_ORDER_EXCLUDED] } },
          include:{ items:true, commands:true }
        }
      },
      orderBy:{ openedAt:'asc' }
    }),
    tx.pago.findMany({
      where:{
        tenantId,
        userId:shift.userId,
        creadoEn:{ gte:start, lte:end },
        documento:{ tipo:'FACTURA_VENTA' },
        comprobanteTesoreria:{ estado:{ not:'ANULADO' } }
      },
      select:{ id:true, documentoId:true }
    })
  ]);

  const paymentIds = paymentRows.map((row) => row.id);
  const deliveries = paymentIds.length ? await tx.restaurantDeliveryOrder.findMany({
    where:{
      tenantId,
      treasuryPaymentId:{ in:paymentIds },
      paymentStatus:'PAGADO',
      state:{ not:'CANCELADO' }
    },
    include:{ items:true },
    orderBy:{ creadoEn:'asc' }
  }) : [];

  const saleIds = [...new Set([
    ...sessions.map((session) => session.saleId),
    ...deliveries.map((delivery) => delivery.saleId)
  ].filter(Boolean))];

  const sales = saleIds.length ? await tx.comprobanteComercial.findMany({
    where:{ tenantId, id:{ in:saleIds }, tipo:'FACTURA_VENTA', estado:{ not:'ANULADO' } },
    include:{
      detalles:{
        include:{ producto:{ select:{ sku:true } } },
        orderBy:{ id:'asc' }
      }
    }
  }) : [];
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));

  const records = [];
  for (const session of sessions) {
    records.push({
      channel:'MESAS',
      reference:session.table?.name || session.id,
      saleId:session.saleId,
      sale:saleById.get(session.saleId) || null,
      productionItems:session.orders.flatMap((order) => order.items || [])
    });
  }
  for (const delivery of deliveries) {
    records.push({
      channel:'DOMICILIO',
      reference:delivery.code || delivery.id,
      saleId:delivery.saleId,
      sale:saleById.get(delivery.saleId) || null,
      productionItems:delivery.items || []
    });
  }

  const entries = records.map(reconcileSaleRecord);
  let productionTotal = decimal(0);
  let nonProductionCharges = decimal(0);
  let saleTotal = decimal(0);
  for (const entry of entries) {
    productionTotal = productionTotal.plus(entry.productionTotal || 0);
    nonProductionCharges = nonProductionCharges.plus(entry.nonProductionCharges || 0);
    saleTotal = saleTotal.plus(entry.saleTotal || 0);
  }
  const expectedSales = amount(decimal(productionTotal).plus(nonProductionCharges));
  const difference = amount(expectedSales.minus(saleTotal));
  const failed = entries.filter((entry) => !entry.balanced);

  return {
    marker: MARKER,
    shiftId: shift.id,
    productionTotal: amount(productionTotal).toString(),
    nonProductionCharges: amount(nonProductionCharges).toString(),
    operationalTotal: expectedSales.toString(),
    saleTotal: amount(saleTotal).toString(),
    difference: difference.toString(),
    balanced: difference.eq(0) && failed.length === 0,
    checkedOperations: entries.length,
    failedOperations: failed.length,
    entries,
    failures: failed
  };
}

module.exports = {
  MARKER,
  DELIVERY_FEE_SKU,
  allowedNonProductionDetail,
  reconcileSaleRecord,
  reconcileShiftProductionSales
};
