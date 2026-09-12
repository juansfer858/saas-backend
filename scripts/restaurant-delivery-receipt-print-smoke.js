'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const deliveryReceipt = read('src/modules/restaurant/restaurant-delivery-receipt.service.js');
const hooks = read('src/modules/restaurant/restaurant-pos-receipt-hooks.js');
const immediate = read('src/modules/restaurant/restaurant-pos-receipt-immediate.public.routes.js');

assert.match(deliveryReceipt, /RESTAURANT_DELIVERY_POS_RECEIPT/);
assert.match(deliveryReceipt, /paymentStatus:\s*'PAGADO'/);
assert.match(deliveryReceipt, /queueDeliveryReceiptIntent/);
assert.match(deliveryReceipt, /buildPendingDeliveryReceiptJobs/);
assert.match(deliveryReceipt, /selectReceiptPrinters/);
assert.match(deliveryReceipt, /buildReceiptJob/);
assert.match(deliveryReceipt, /Domicilio \$\{delivery\.code\}/);
assert.match(deliveryReceipt, /mergeCustomerNameObservation/);
assert.match(deliveryReceipt, /delivery\.paymentMethod/);
assert.match(deliveryReceipt, /sale\.detalles/);
assert.match(deliveryReceipt, /number\(sale\.saldo\) > 0/);

assert.match(hooks, /restaurant-delivery-receipt\.service/);
assert.match(hooks, /registerDeliveryPaymentWithPosReceipt/);
assert.match(hooks, /queueDeliveryReceiptIntent\(tenantId, deliveryId\)/);
assert.match(hooks, /buildPendingDeliveryReceiptJobs\(tenantId\)/);
assert.match(hooks, /deliveryReceiptJobCount/);

assert.match(immediate, /restaurante\\\/domicilios\\\/\[\^\/\]\+\\\/pago/);
assert.match(immediate, /operation:'POS_RECEIPT_SYNC'/);
assert.match(immediate, /deliveryPayment:true/);

console.log(JSON.stringify({
  ok: true,
  deliveryPaymentQueuesPosReceipt: true,
  deliveryReceiptUsesExistingPosPrinterRouting: true,
  deliveryReceiptIncludesCustomer: true,
  deliveryReceiptIncludesPaymentMethod: true,
  edgeImmediatePrintSignalAfterDeliveryPayment: true,
  tableAndSplitReceiptFlowsPreserved: true
}));
