'use strict';

const fs = require('node:fs');

const overlay = fs.readFileSync('src/web/restaurant-v2-cash-print-choice-v19.js', 'utf8');
const cashHtml = fs.readFileSync('src/web/restaurant-v2-cash.html', 'utf8');
const operational = fs.readFileSync('src/modules/restaurant/restaurant-pos-operational-mode.js', 'utf8');
const cashService = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.service.js', 'utf8');
const hooks = fs.readFileSync('src/modules/restaurant/restaurant-pos-receipt-hooks.js', 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

expect(overlay.includes("version:'19.1.0'"), 'Caja no expone el hotfix V19.1');
expect(overlay.includes('visibleChargeErrors:true'), 'falta marcador de errores visibles');
expect(overlay.includes('showChargeFailure'), 'el rechazo del cobro sigue oculto');
expect(overlay.includes('COBRO NO REALIZADO'), 'falta estado explícito de cobro rechazado');
expect(overlay.includes('No se modificó la cuenta'), 'falta garantía visual de no mutación ante rechazo');
expect(overlay.includes('!response.ok'), 'el overlay no captura respuestas HTTP fallidas');
expect(overlay.includes('error?.message'), 'el overlay no muestra el mensaje real del backend');
expect(overlay.includes('error?.code'), 'el overlay no muestra el código real del backend');
expect(cashHtml.includes('restaurant-v2-cash-print-choice-v19.js?v=v19.1'), 'Caja no fuerza la carga del hotfix V19.1');

expect(operational.includes("input?.deferPosReceipt === true"), 'POS operacional no respeta deferPosReceipt');
expect(operational.includes("reason: 'DEFERRED_BY_CASHIER_CHOICE'"), 'falta marca explícita de recibo diferido');
expect(operational.includes('deferred: Boolean(result?.posReceipt?.deferred)'), 'el resultado operacional pierde el estado diferido');
expect(operational.includes("? { queued: false, deferred: true, reason: 'DEFERRED_BY_CASHIER_CHOICE' }"), 'Caja todavía podría encolar antes de la decisión del cajero');

expect(cashService.includes('deferPosReceipt: true'), 'Caja V2 dejó de pedir impresión diferida');
expect(cashService.includes('receiptDecisionRequired: true'), 'Caja V2 dejó de exigir decisión post-liquidación');
expect(hooks.includes('input?.deferPosReceipt !== true'), 'el hook superior dejó de respetar impresión diferida');

console.log('Restaurant V2 Cash Charge V19.1 smoke: OK');
