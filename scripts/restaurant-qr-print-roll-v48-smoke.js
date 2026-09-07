'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { QR_PRINT_ROLL_CSS } = require('../src/modules/restaurant/restaurant-qr-print-roll-v48.public.routes');

assert(QR_PRINT_ROLL_CSS.includes('VANTIX_QR_PRINT_ROLL_V48'));
assert(QR_PRINT_ROLL_CSS.includes('@media print'));
assert(QR_PRINT_ROLL_CSS.includes('@page { margin: 0; }'));
assert(QR_PRINT_ROLL_CSS.includes('.qr-print-grid { display:block!important;'));
assert(QR_PRINT_ROLL_CSS.includes('width:100%!important'));
assert(QR_PRINT_ROLL_CSS.includes('.qr-print-code { width:56mm!important; max-width:84%!important;'));
assert(QR_PRINT_ROLL_CSS.includes('page-break-after:always!important'));
assert(QR_PRINT_ROLL_CSS.includes('.qr-print-card:last-child'));

const routes = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant.public.routes.js'), 'utf8');
assert(routes.includes("require('./restaurant-qr-print-roll-v48.public.routes')"));
assert(routes.includes('router.use(installRestaurantQrPrintRollV48);'));

console.log('RESTAURANT_QR_PRINT_ROLL_V48_OK');
