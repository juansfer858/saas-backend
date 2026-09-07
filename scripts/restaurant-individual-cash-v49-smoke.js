'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { MARKER, runtime } = require('../src/modules/restaurant/restaurant-individual-cash-v49.public.routes');

assert.strictEqual(MARKER, 'VANTIX_RESTAURANT_INDIVIDUAL_CASH_V49');
assert(runtime.includes("billingMode||'').toUpperCase()==='INDIVIDUAL'"));
assert(runtime.includes("partsLabel.hidden=true"));
assert(runtime.includes("summary.textContent='Propina'"));
assert(runtime.includes('Cuenta individual · cada persona paga lo suyo'));
assert(runtime.includes('COBRAR POR PERSONA · CADA UNO PAGA LO SUYO'));
assert(runtime.includes('[data-split-mode="EQUAL"]'));
assert(runtime.includes('equal.hidden=true'));
assert(runtime.includes('[data-split-mode="BY_SEAT"]'));
assert(runtime.includes('bySeat.click()'));

const routes = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant.public.routes.js'), 'utf8');
assert(routes.includes("require('./restaurant-individual-cash-v49.public.routes')"));
assert(routes.includes('router.use(installRestaurantIndividualCashV49);'));

console.log('RESTAURANT_INDIVIDUAL_CASH_V49_OK');
