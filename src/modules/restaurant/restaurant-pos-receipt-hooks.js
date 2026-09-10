'use strict';

const identity = require('./restaurant-identity.service');
const settlementFinalizer = require('./restaurant-settlement-finalizer.service');
const receipts = require('./restaurant-pos-receipt-print.service');

const IDENTITY_FLAG = Symbol.for('vantixgc.restaurant.pos.receipt.identity.v38');
const SPLIT_FLAG = Symbol.for('vantixgc.restaurant.pos.receipt.split.v38');

function installPosReceiptHooks() {
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
      await receipts.queueReceiptForTableIfClosed(tenantId, tableId).catch(() => {});
      return result;
    };
    Object.defineProperty(settlementFinalizer, SPLIT_FLAG, { value: true });
  }

  return { identity, settlementFinalizer };
}

installPosReceiptHooks();

module.exports = { IDENTITY_FLAG, SPLIT_FLAG, installPosReceiptHooks };
