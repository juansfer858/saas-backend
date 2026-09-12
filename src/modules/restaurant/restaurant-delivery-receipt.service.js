'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const companyService = require('./restaurant-company-profile.service');
const customerDisplay = require('./restaurant-customer-display-name');
const posReceipt = require('./restaurant-pos-receipt-print.service');

const ORIGIN_TYPE = 'RESTAURANT_DELIVERY_POS_RECEIPT';
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

function intentTokenHash(tenantId, deliveryId) {
  return crypto.createHash('sha256').update(`restaurant-delivery-pos-receipt:${tenantId}:${deliveryId}`).digest('hex');
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function paymentLabel(delivery) {
  const method = String(delivery?.paymentMethod || '').trim().toUpperCase();
  if (method === 'EFECTIVO') return 'Efectivo';
  if (method === 'TRANSFERENCIA') return 'Transferencia';
  if (method === 'TARJETA') return 'Tarjeta';
  return method || 'Pago registrado';
}

async function queueDeliveryReceiptIntent(tenantId, deliveryId, client = prisma) {
  const delivery = await client.restaurantDeliveryOrder.findFirst({
    where: { id: deliveryId, tenantId, paymentStatus: 'PAGADO', state: { not: 'CANCELADO' } },
    select: { id: true, code: true, saleId: true }
  });
  if (!delivery) return { queued: false, reason: 'DELIVERY_NOT_PAID' };

  const sale = await client.comprobanteComercial.findFirst({
    where: { id: delivery.saleId, tenantId, tipo: 'FACTURA_VENTA', estado: { not: 'ANULADO' } },
    select: { id: true, numero: true, saldo: true }
  });
  if (!sale || number(sale.saldo) > 0) return { queued: false, reason: 'SALE_NOT_PAID' };

  const now = new Date();
  const data = {
    tokenHash: intentTokenHash(tenantId, delivery.id),
    tokenCiphertext: `DELIVERY_POS_RECEIPT:${delivery.id}`,
    tokenHint: String(sale.numero || sale.id).slice(-6),
    publicReference: String(sale.numero || sale.id),
    currentStatus: 'PENDING',
    timeline: [{
      type: 'DELIVERY_POS_RECEIPT_QUEUED',
      at: now.toISOString(),
      deliveryId: delivery.id,
      deliveryCode: delivery.code,
      saleId: sale.id
    }],
    expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
    completedAt: null,
    active: true,
    lastNotificationAt: now
  };

  const intent = await client.trackingLink.upsert({
    where: { tenantId_originType_originId: { tenantId, originType: ORIGIN_TYPE, originId: delivery.id } },
    create: { tenantId, originType: ORIGIN_TYPE, originId: delivery.id, ...data },
    update: data
  });
  return { queued: true, intentId: intent.id, deliveryId: delivery.id, saleId: sale.id };
}

async function buildPendingDeliveryReceiptJobs(tenantId) {
  const now = new Date();
  const [company, printers, intents] = await Promise.all([
    companyService.getCompanyProfile(tenantId),
    prisma.printerEndpoint.findMany({
      where: { tenantId, active: true, transport: { in: ['LAN', 'WINDOWS'] } },
      orderBy: { name: 'asc' }
    }),
    prisma.trackingLink.findMany({
      where: {
        tenantId,
        originType: ORIGIN_TYPE,
        active: true,
        currentStatus: 'PENDING',
        expiresAt: { gt: now }
      },
      orderBy: { creadoEn: 'asc' },
      take: 80
    })
  ]);

  const selected = posReceipt.selectReceiptPrinters(printers);
  if (!selected.printers.length || !intents.length) {
    return {
      jobs: [],
      routing: selected.routing,
      receiptCount: 0,
      deliveryReceiptCount: 0,
      printerCount: selected.printers.length
    };
  }

  const deliveryIds = [...new Set(intents.map((intent) => intent.originId).filter(Boolean))];
  const deliveries = deliveryIds.length ? await prisma.restaurantDeliveryOrder.findMany({
    where: { tenantId, id: { in: deliveryIds }, paymentStatus: 'PAGADO', state: { not: 'CANCELADO' } }
  }) : [];
  const deliveryById = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
  const saleIds = [...new Set(deliveries.map((delivery) => delivery.saleId).filter(Boolean))];
  const sales = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds }, tipo: 'FACTURA_VENTA', estado: { not: 'ANULADO' } },
    include: { detalles: { orderBy: { id: 'asc' } } }
  }) : [];
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));

  const jobs = [];
  let deliveryReceiptCount = 0;
  for (const intent of intents) {
    const delivery = deliveryById.get(intent.originId);
    const sale = delivery ? saleById.get(delivery.saleId) : null;
    if (!delivery || !sale || !sale.detalles?.length || number(sale.saldo) > 0) continue;

    const saleForPrint = {
      ...sale,
      observaciones: customerDisplay.mergeCustomerNameObservation(sale.observaciones, delivery.customerName)
    };
    const session = {
      id: delivery.id,
      closedAt: delivery.actualizadoEn || delivery.creadoEn || null,
      tipAmount: 0,
      paymentMethodKind: delivery.paymentMethod || null,
      paymentMethodLabel: paymentLabel(delivery),
      paymentReference: null
    };
    const table = {
      id: delivery.id,
      code: delivery.code,
      name: `Domicilio ${delivery.code}`
    };

    deliveryReceiptCount += 1;
    for (const printer of selected.printers) {
      jobs.push(posReceipt.buildReceiptJob({ company, sale: saleForPrint, session, table, printer }));
    }
  }

  return {
    jobs,
    routing: selected.routing,
    receiptCount: deliveryReceiptCount,
    deliveryReceiptCount,
    printerCount: selected.printers.length
  };
}

module.exports = {
  ORIGIN_TYPE,
  INTENT_TTL_MS,
  intentTokenHash,
  paymentLabel,
  queueDeliveryReceiptIntent,
  buildPendingDeliveryReceiptJobs
};
