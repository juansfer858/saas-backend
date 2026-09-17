'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { errorHandler } = require('../src/middleware/error-handler');

const restaurant = fs.readFileSync('src/modules/restaurant/restaurant.service.js', 'utf8');
const methods = fs.readFileSync('src/modules/restaurant/restaurant-payment-methods.service.js', 'utf8');
const cash = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.service.js', 'utf8');

assert.match(restaurant, /RESTAURANT_CLOSE_TRANSACTION_OPTIONS/);
assert.match(restaurant, /maxWait:\s*10_000/);
assert.match(restaurant, /timeout:\s*30_000/);
assert.match(restaurant, /}, RESTAURANT_CLOSE_TRANSACTION_OPTIONS\);/);
assert.match(restaurant, /\.\.\.paymentMetadata/);

const methodClose = methods.slice(methods.indexOf('async function closeTableWithMethod'), methods.indexOf('\nmodule.exports'));
assert.doesNotMatch(methodClose, /prisma\.restaurantTableSession\.update/);
assert.doesNotMatch(methodClose, /previous\s*=/);
assert.match(methodClose, /paymentMethodId:\s*method\.id/);
assert.match(methodClose, /paymentReference:\s*reference/);
assert.match(methodClose, /cashShiftId:\s*openShift\.id/);

const creditClose = cash.slice(cash.indexOf('async function chargeWholeAccount'), cash.indexOf('async function queueReceiptPrint'));
assert.doesNotMatch(creditClose, /prisma\.restaurantTableSession\.update/);
assert.match(creditClose, /paymentMethodKind:\s*method\.kind/);
assert.match(creditClose, /cashShiftId:\s*shift\.id/);
assert.match(creditClose, /restorePreparedCredit/);

function responseCapture() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };
}

const originalError = console.error;
console.error = () => {};
try {
  const timeoutResponse = responseCapture();
  errorHandler({ code: 'P2028' }, null, timeoutResponse, null);
  assert.equal(timeoutResponse.statusCode, 503);
  assert.equal(timeoutResponse.body.error.code, 'OPERATION_TIMEOUT');

  const busyResponse = responseCapture();
  errorHandler({ code: 'P2034' }, null, busyResponse, null);
  assert.equal(busyResponse.statusCode, 503);
  assert.equal(busyResponse.body.error.code, 'OPERATION_RETRY_REQUIRED');
} finally {
  console.error = originalError;
}

console.log('RESTAURANT CASH ATOMIC CLOSE V114 SMOKE OK');
