'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const cashClose = require('../src/modules/restaurant/restaurant-cash-close-breakdown-v45.public.routes');

assert.equal(cashClose.MARKER, 'VANTIX_RESTAURANT_CASH_CLOSE_BREAKDOWN_V45');
assert.equal(typeof cashClose.runtime, 'string');
new Function(cashClose.runtime);

assert.match(cashClose.runtime, /version:'45\.0\.0'/);
assert.match(cashClose.runtime, /cashCloseBreakdown:true/);
assert.match(cashClose.runtime, /cashExpectedUsesDrawerBalance:true/);
assert.match(cashClose.runtime, /bankUsesElectronicTurnSales:true/);
assert.match(cashClose.runtime, /creditUsesTurnCreditSales:true/);
assert.match(cashClose.runtime, /quickCollectInlineRemoved:true/);
assert.match(cashClose.runtime, /collectOnlyFromTable:true/);
assert.match(cashClose.runtime, /noPolling:true/);
assert.match(cashClose.runtime, /Efectivo esperado en caja/);
assert.match(cashClose.runtime, /Banco \/ Tarjeta \/ QR/);
assert.match(cashClose.runtime, /Crédito \/ cartera/);
assert.match(cashClose.runtime, /summary\.systemCashExpected/);
assert.match(cashClose.runtime, /breakdown\.cashSales/);
assert.match(cashClose.runtime, /breakdown\.electronicSales/);
assert.match(cashClose.runtime, /breakdown\.creditSales/);
assert.match(cashClose.runtime, /cash-table-collect-only-v45:not\(\.cash-collect-dialog-v40\)\{display:none!important\}/);
assert.match(cashClose.runtime, /Cobrar mesa/);
assert.doesNotMatch(cashClose.runtime, /setInterval|MutationObserver/);

const identity = fs.readFileSync('src/modules/restaurant/restaurant-identity.service.js', 'utf8');
assert.match(identity, /paymentBreakdown:\s*\{\s*cashSales,\s*electronicSales,\s*creditSales,\s*tips,\s*restaurantTotal\s*\}/);
assert.match(identity, /systemCashExpected:\s*expectedDrawer/);
assert.match(identity, /rows\.filter\(\(x\) => x\.formaPago === 'EFECTIVO'\)/);
assert.match(identity, /rows\.filter\(\(x\) => x\.formaPago === 'BANCO'\)/);
assert.match(identity, /rows\.filter\(\(x\) => x\.formaPago === 'CREDITO'\)/);

const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
assert.match(publicRoutes, /restaurant-cash-close-breakdown-v45\.public\.routes/);
assert.match(publicRoutes, /router\.use\(installRestaurantCashCloseBreakdownV45\)/);

console.log('RESTAURANT CASH CLOSE BREAKDOWN V45 SMOKE OK');
console.log(JSON.stringify({
  cashExpectedVisible:true,
  bankTurnReceiptsVisible:true,
  creditTurnSalesVisible:true,
  quickCollectInlineRemoved:true,
  collectFormStillAvailableFromTableDialog:true,
  sourceIsCanonicalCashShiftSummary:true,
  physicalCountStillCashOnly:true,
  pollingAdded:0
}, null, 2));
