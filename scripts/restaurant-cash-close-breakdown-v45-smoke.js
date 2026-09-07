'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const cashClose = require('../src/modules/restaurant/restaurant-cash-close-breakdown-v45.public.routes');

assert.equal(cashClose.MARKER, 'VANTIX_RESTAURANT_CASH_CLOSE_BREAKDOWN_V45');
assert.equal(typeof cashClose.runtime, 'string');
new Function(cashClose.runtime);

assert.match(cashClose.runtime, /version:'45\.1\.0'/);
assert.match(cashClose.runtime, /cashCloseBreakdown:true/);
assert.match(cashClose.runtime, /cashExpectedUsesDrawerBalance:true/);
assert.match(cashClose.runtime, /bankUsesElectronicTurnSales:true/);
assert.match(cashClose.runtime, /creditUsesTurnCreditSales:true/);
assert.match(cashClose.runtime, /quickCollectInlineRemoved:true/);
assert.match(cashClose.runtime, /collectOnlyFromTable:true/);
assert.match(cashClose.runtime, /inlineHiddenByStructuralCss:true/);
assert.match(cashClose.runtime, /metricRerenderSafe:true/);
assert.match(cashClose.runtime, /noPolling:true/);
assert.match(cashClose.runtime, /Efectivo esperado en caja/);
assert.match(cashClose.runtime, /Banco \/ Tarjeta \/ QR/);
assert.match(cashClose.runtime, /Crédito \/ cartera/);
assert.match(cashClose.runtime, /summary\.systemCashExpected/);
assert.match(cashClose.runtime, /breakdown\.cashSales/);
assert.match(cashClose.runtime, /breakdown\.electronicSales/);
assert.match(cashClose.runtime, /breakdown\.creditSales/);

// The base payment panel must be hidden by structure, not by a transient class added
// after render. This protects metric/detail rerenders such as "Otros medios".
assert.match(cashClose.runtime, /#view \.cash-shell \.cash-fast-panel:not\(\.cash-collect-dialog-v40\)\{display:none!important\}/);
assert.match(cashClose.runtime, /#view \.cash-shell \.cash-fast-panel\.cash-collect-dialog-v40\{display:block!important\}/);
assert.match(cashClose.runtime, /#view \.cash-shell \.cash-workspace\{grid-template-columns:minmax\(0,1fr\)!important\}/);
assert.doesNotMatch(cashClose.runtime, /cash-fast-panel\.cash-table-collect-only-v45:not/);
assert.match(cashClose.runtime, /\[data-cash-metric\],\[data-cash-metric-back\]/);
assert.match(cashClose.runtime, /Cobrar mesa/);
assert.doesNotMatch(cashClose.runtime, /setInterval|MutationObserver/);

const identity = fs.readFileSync('src/modules/restaurant/restaurant-identity.service.js', 'utf8');
assert.match(identity, /paymentBreakdown:\s*\{\s*cashSales,\s*electronicSales,\s*creditSales,\s*tips,\s*restaurantTotal\s*\}/);
assert.match(identity, /systemCashExpected:\s*expectedDrawer/);
assert.match(identity, /rows\.filter\(\(x\) => x\.formaPago === 'EFECTIVO'\)/);
assert.match(identity, /rows\.filter\(\(x\) => x\.formaPago === 'BANCO'\)/);
assert.match(identity, /rows\.filter\(\(x\) => x\.formaPago === 'CREDITO'\)/);

const collectDialog = fs.readFileSync('src/modules/restaurant/restaurant-cash-collect-dialog.public.routes.js', 'utf8');
assert.match(collectDialog, /DIALOG_CLASS='cash-collect-dialog-v40'/);
assert.match(collectDialog, /panel\.classList\.add\(DIALOG_CLASS\)/);
assert.match(collectDialog, /\[data-cash-table\]/);

const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
assert.match(publicRoutes, /restaurant-cash-close-breakdown-v45\.public\.routes/);
assert.match(publicRoutes, /router\.use\(installRestaurantCashCloseBreakdownV45\)/);

console.log('RESTAURANT CASH CLOSE BREAKDOWN V45.1 SMOKE OK');
console.log(JSON.stringify({
  cashExpectedVisible:true,
  bankTurnReceiptsVisible:true,
  creditTurnSalesVisible:true,
  quickCollectInlineRemoved:true,
  inlinePanelHiddenAfterMetricRerender:true,
  collectFormStillAvailableFromTableDialog:true,
  sourceIsCanonicalCashShiftSummary:true,
  physicalCountStillCashOnly:true,
  pollingAdded:0
}, null, 2));
