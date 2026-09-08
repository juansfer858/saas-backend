const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const v38 = require('../src/modules/restaurant/restaurant-pos-receipt-immediate.public.routes');
const v75 = require('../src/modules/restaurant/restaurant-pos-print-choice-v75.public.routes');

assert.equal(v75.MARKER, 'VANTIX_RESTAURANT_POS_PRINT_CHOICE_V75');
assert.match(v38.runtime, /if\(shouldTrigger&&response\.ok\)queueReceiptSync\(\);/);

const base = `const base=true;\n;${v38.runtime}\n`;
const patched = v75.patchRestaurantUiSource(base);
assert.notEqual(patched, base, 'V75 debe modificar el disparo automático V38');
assert.match(patched, /VANTIX_RESTAURANT_POS_PRINT_CHOICE_V75/);
assert.match(patched, /VantixGCPosPrintChoiceV75/);
assert.match(patched, /choice\.request\(queueReceiptSync\)/);
assert.ok(!patched.includes(v75.V38_TRIGGER), 'no debe quedar el disparo automático directo después del cobro');
assert.match(patched, /¿Imprimir comprobante\?/);
assert.match(patched, /No imprimir/);
assert.match(patched, /Imprimir/);
assert.match(patched, /El pago ya fue registrado/);
assert.match(patched, /resolve\(false\)/);
assert.match(patched, /resolve\(true\)/);
assert.match(patched, /paymentAlreadyRegistered:true/);

const patchedAgain = v75.patchRestaurantUiSource(patched);
assert.equal(patchedAgain, patched, 'la instalación V75 debe ser idempotente');
assert.equal(v75.patchRestaurantUiSource('const untouched=true;'), 'const untouched=true;', 'V75 no debe tocar assets sin V38');

const publicRoutes = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant.public.routes.js'), 'utf8');
assert.match(publicRoutes, /installRestaurantPosPrintChoiceV75/);
const v75Pos = publicRoutes.indexOf('router.use(installRestaurantPosPrintChoiceV75)');
const v38Pos = publicRoutes.indexOf('router.use(installPosReceiptImmediateRuntime)');
assert.ok(v75Pos >= 0 && v38Pos >= 0 && v75Pos < v38Pos, 'V75 debe envolver a V38 para ver el asset final');

const paymentChain = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant-payment-chain-v43.public.routes.js'), 'utf8');
assert.match(paymentChain, /response\.ok/);
assert.match(v38.runtime, /const response=await baseFetch\(input,options\);/);
assert.ok(v38.runtime.indexOf('const response=await baseFetch(input,options);') < v38.runtime.indexOf(v75.V38_TRIGGER), 'la elección de impresión debe ocurrir después de registrar el pago');

console.log('RESTAURANT POS PRINT CHOICE V75 SMOKE OK');
