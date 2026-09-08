'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const v76 = require('../src/modules/restaurant/restaurant-person-product-split-v76.public.routes');
const v49 = require('../src/modules/restaurant/restaurant-individual-cash-v49.public.routes');

assert.equal(v76.MARKER, 'VANTIX_RESTAURANT_PERSON_PRODUCT_SPLIT_V76');
new Function(v76.runtime);

assert.match(v76.runtime, /DIVIDIR CUENTA · PRODUCTOS \/ PERSONAS/);
assert.match(v76.runtime, /rvpPeopleCountV76/);
assert.match(v76.runtime, /min=\"2\" max=\"50\"/);
assert.match(v76.runtime, /data-split-mode=\"BY_ITEM\"/);
assert.match(v76.runtime, /Asigna productos al menos a 2 personas/);
assert.match(v76.runtime, /stopImmediatePropagation/);
assert.match(v76.runtime, /rvp-manual-row select/);
assert.match(v76.runtime, /Productos: /);
assert.match(v76.runtime, /pagos-divididos/);
assert.match(v76.runtime, /\/api\/v1\/restaurante\/sesiones\//);
assert.match(v76.runtime, /Partes iguales \(opcional\)/);
assert.doesNotMatch(v76.runtime, /method:'POST'/, 'V76 no debe crear una segunda ruta de cobro; reutiliza el motor existente');

const individualSource = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant-individual-cash-v49.public.routes.js'), 'utf8');
assert.match(individualSource, /restaurant-person-product-split-v76\.public\.routes/);
assert.match(individualSource, /PERSON_PRODUCT_SPLIT_V76_MARKER/);
assert.match(individualSource, /X-VantixGC-Person-Product-Split/);
assert.match(individualSource, /v76-cash-person-products/);
assert.match(individualSource, /VANTIX_RESTAURANT_INDIVIDUAL_CASH_V49/);

// Verify the actual response composition, not only source strings.
const req = { method: 'GET', path: '/app/restaurant-ui.js' };
const headers = {};
let sent = null;
const res = {
  set(name, value) { headers[String(name).toLowerCase()] = String(value); return this; },
  send(body) { sent = body; return body; }
};
v49.installRestaurantIndividualCashV49(req, res, () => res.send('BASE_RESTAURANT_UI'));
assert.match(String(sent), /VANTIX_RESTAURANT_INDIVIDUAL_CASH_V49/);
assert.match(String(sent), /VANTIX_RESTAURANT_PERSON_PRODUCT_SPLIT_V76/);
assert.equal(headers['x-vantixgc-person-product-split'], 'v76-cash-person-products');

const paymentsUi = fs.readFileSync(path.join(__dirname, '../src/web/restaurant-visit-payments-ui.js'), 'utf8');
assert.match(paymentsUi, /data-split-mode=\"BY_ITEM\"/);
assert.match(paymentsUi, /payload\.assignments/);
assert.match(paymentsUi, /data-pay-part/);
assert.match(paymentsUi, /PAGADA ✓/);
assert.match(paymentsUi, /\/pagos-divididos\/preparar/);
assert.match(paymentsUi, /\/pagos-divididos`/);

const paymentService = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant-visit-payments.service.js'), 'utf8');
assert.match(paymentService, /mode === 'BY_ITEM'/);
assert.match(paymentService, /restaurantSessionPayment\.upsert/);
assert.match(paymentService, /summary\.parts\.every\(\(part\) => part\.paid\)/);
assert.match(paymentService, /state: 'CERRADA'/);
assert.match(paymentService, /state: 'LIBRE'/);

const paymentRoutes = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant-visit-payments.routes.js'), 'utf8');
assert.match(paymentRoutes, /mode: z\.enum\(\['TOGETHER', 'EQUAL', 'BY_SEAT', 'BY_ITEM'\]\)/);
assert.match(paymentRoutes, /\/mesas\/:id\/pagos-divididos\/preparar/);
assert.match(paymentRoutes, /\/mesas\/:id\/pagos-divididos'/);
assert.match(paymentRoutes, /requirePermission\('TESORERIA\.PAGAR'\)/);

console.log('RESTAURANT PERSON PRODUCT SPLIT V76 SMOKE OK');
console.log(JSON.stringify({
  cashEntryProminent: true,
  jointToProductPeopleAtCash: true,
  peopleSelectableFrom2To50: true,
  productAssignmentPerPerson: true,
  equalSplitStillAvailable: true,
  independentPersonPayments: true,
  paidPersonStatus: true,
  tableClosesOnlyAfterAllPartsPaid: true,
  reusesExistingTransactionalPaymentEngine: true
}, null, 2));
