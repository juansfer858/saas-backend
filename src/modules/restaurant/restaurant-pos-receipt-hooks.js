'use strict';

const identity = require('./restaurant-identity.service');
const settlementFinalizer = require('./restaurant-settlement-finalizer.service');
const delivery = require('./restaurant-delivery.service');
const receipts = require('./restaurant-pos-receipt-print.service');
const splitPartReceipts = require('./restaurant-split-part-receipt-v20.service');
const deliveryReceipts = require('./restaurant-delivery-receipt.service');

const IDENTITY_FLAG = Symbol.for('vantixgc.restaurant.pos.receipt.identity.v38');
const SPLIT_FLAG = Symbol.for('vantixgc.restaurant.pos.receipt.split.v38');
const DELIVERY_FLAG = Symbol.for('vantixgc.restaurant.pos.receipt.delivery.v1');
const SPLIT_ROUTING_FLAG = Symbol.for('vantixgc.restaurant.pos.receipt.split.routing.v20');

function installSplitReceiptRouting() {
  if (receipts[SPLIT_ROUTING_FLAG]) return;
  const originalRecentJobs = receipts.buildRecentReceiptJobs.bind(receipts);

  const combinedJobs = async function buildRecentReceiptJobsWithSplitPartsAndDeliveries(tenantId) {
    const [base, split, deliveryReceipt] = await Promise.all([
      originalRecentJobs(tenantId),
      splitPartReceipts.buildPendingSplitPartReceiptJobs(tenantId),
      deliveryReceipts.buildPendingDeliveryReceiptJobs(tenantId)
    ]);
    const splitJobs = Array.isArray(split?.jobs) ? split.jobs : [];
    const deliveryJobs = Array.isArray(deliveryReceipt?.jobs) ? deliveryReceipt.jobs : [];
    return {
      ...base,
      jobs: [...(base?.jobs || []), ...splitJobs, ...deliveryJobs],
      receiptCount: Number(base?.receiptCount || 0) + Number(split?.receiptCount || 0) + Number(deliveryReceipt?.receiptCount || 0),
      splitPartReceiptCount: Number(split?.splitPartReceiptCount || 0),
      splitPartReceiptJobCount: splitJobs.length,
      deliveryReceiptCount: Number(deliveryReceipt?.deliveryReceiptCount || 0),
      deliveryReceiptJobCount: deliveryJobs.length,
      printerCount: Math.max(Number(base?.printerCount || 0), Number(split?.printerCount || 0), Number(deliveryReceipt?.printerCount || 0)),
      routing: base?.routing && base.routing !== 'NO_PHYSICAL_PRINTER'
        ? base.routing
        : (deliveryReceipt?.routing && deliveryReceipt.routing !== 'NO_PHYSICAL_PRINTER'
          ? deliveryReceipt.routing
          : (split?.routing || deliveryReceipt?.routing || base?.routing))
    };
  };

  receipts.buildRecentReceiptJobs = combinedJobs;
  receipts.buildPendingReceiptJobs = combinedJobs;
  Object.defineProperty(receipts, SPLIT_ROUTING_FLAG, { value: true });
}

function installPosReceiptHooks() {
  installSplitReceiptRouting();

  if (!identity[IDENTITY_FLAG]) {
    const originalClose = identity.closeTableGuarded.bind(identity);
    identity.closeTableGuarded = async function closeTableGuardedWithPosReceipt(tenantId, user, tableId, input) {
      const result = await originalClose(tenantId, user, tableId, input);
      // Caja V2 can explicitly defer the POS receipt until the cashier answers
      // the post-settlement Sí / No prompt. Every existing caller keeps the
      // previous automatic queue behavior by default.
      if (input?.deferPosReceipt !== true) {
        await receipts.queueReceiptIntent(tenantId, result?.session?.id).catch(() => {});
      }
      return result;
    };
    Object.defineProperty(identity, IDENTITY_FLAG, { value: true });
  }

  if (!settlementFinalizer[SPLIT_FLAG]) {
    const originalPartPayment = settlementFinalizer.registerPartPaymentFinalized.bind(settlementFinalizer);
    settlementFinalizer.registerPartPaymentFinalized = async function registerPartPaymentWithPosReceipt(tenantId, user, tableId, input) {
      const result = await originalPartPayment(tenantId, user, tableId, input);
      // Cada abono de División genera su propio comprobante. No se encola una
      // segunda tirilla por el total al pagar la última parte: sigue existiendo
      // una sola venta contable y tantos comprobantes como partes cobradas.
      await splitPartReceipts.queueSplitPartReceiptIntent(tenantId, tableId, input?.partKey).catch(() => {});
      return result;
    };
    Object.defineProperty(settlementFinalizer, SPLIT_FLAG, { value: true });
  }

  if (!delivery[DELIVERY_FLAG]) {
    const originalDeliveryPayment = delivery.registerDeliveryPayment.bind(delivery);
    delivery.registerDeliveryPayment = async function registerDeliveryPaymentWithPosReceipt(tenantId, user, deliveryId, input) {
      const result = await originalDeliveryPayment(tenantId, user, deliveryId, input);
      await deliveryReceipts.queueDeliveryReceiptIntent(tenantId, deliveryId).catch(() => {});
      return result;
    };
    Object.defineProperty(delivery, DELIVERY_FLAG, { value: true });
  }

  return { identity, settlementFinalizer, delivery };
}

installPosReceiptHooks();

module.exports = {
  IDENTITY_FLAG,
  SPLIT_FLAG,
  DELIVERY_FLAG,
  SPLIT_ROUTING_FLAG,
  installSplitReceiptRouting,
  installPosReceiptHooks
};
