'use strict';

const fs = require('node:fs');

const overlay = fs.readFileSync('src/web/restaurant-v2-cash-print-choice-v19.js', 'utf8');
const cashHtml = fs.readFileSync('src/web/restaurant-v2-cash.html', 'utf8');
const cashRoutes = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.routes.js', 'utf8');
const cashService = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.service.js', 'utf8');
const customerNameService = fs.readFileSync('src/modules/restaurant/restaurant-customer-display-name.service.js', 'utf8');
const methods = fs.readFileSync('src/modules/restaurant/restaurant-payment-methods.service.js', 'utf8');
const hooks = fs.readFileSync('src/modules/restaurant/restaurant-pos-receipt-hooks.js', 'utf8');
const splitService = fs.readFileSync('src/modules/restaurant/restaurant-v2-split.service.js', 'utf8');
const aggregator = fs.readFileSync('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js', 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

expect(overlay.includes('VANTIX_RESTAURANT_V2_CASH_PRINT_CHOICE_V19'), 'falta marker V19');
expect(overlay.includes('Factura / recibo creado'), 'falta confirmación post-liquidación');
expect(overlay.includes('SÍ, IMPRIMIR'), 'falta acción Sí, imprimir');
expect(overlay.includes('>NO<'), 'falta acción No');
expect(overlay.includes('/api/v1/restaurante/v2/caja/recibo/imprimir'), 'Sí no llama el endpoint explícito de impresión');
expect(overlay.includes('data?.receiptDecisionRequired'), 'la decisión debe aparecer sólo después de una liquidación confirmada');
expect(overlay.includes('data?.result?.session?.id'), 'la decisión debe quedar anclada a la sesión liquidada exacta');
expect(overlay.includes('finishWithoutPrint'), 'No debe cerrar el flujo sin imprimir');
expect(!overlay.includes('recibo/no-imprimir'), 'No no debe crear una operación de impresión');

expect(overlay.includes('postSaleCustomerNameEdit:true'), 'falta marcador de edición postventa del nombre');
expect(overlay.includes('data?.result?.sale?.id'), 'la edición debe quedar anclada a la venta exacta');
expect(overlay.includes('/nombre-cliente'), 'falta llamada para actualizar el nombre del recibo');
expect(overlay.includes('await saveCustomerName({silent:true})'), 'imprimir debe guardar primero el nombre editado');
expect(overlay.includes('No cambia productos, total, pago, Caja ni Contabilidad.'), 'falta alcance visual de la edición');
expect(cashRoutes.includes("router.patch('/v2/caja/ventas/:saleId/nombre-cliente'"), 'falta endpoint de edición postventa');
expect(customerNameService.includes("scope: 'POS_DISPLAY_NAME_ONLY'"), 'la edición debe limitarse al nombre visual POS');
expect(customerNameService.includes('RESTAURANT_RECEIPT_CUSTOMER_NAME_UPDATED'), 'falta auditoría del cambio de nombre');
expect(!customerNameService.includes('dianDocument'), 'la edición POS no debe depender de un modelo fiscal inexistente');

expect(cashHtml.includes('/app/restaurant-v2-cash-print-choice-v19.js?v=v19'), 'Caja no carga V19');
expect(cashHtml.indexOf('restaurant-v2-cash-tender-v18.js?v=v18') < cashHtml.indexOf('restaurant-v2-cash-print-choice-v19.js?v=v19'), 'V19 debe cargar después de V18');
expect(aggregator.includes("'/app/restaurant-v2-cash-print-choice-v19.js'"), 'falta ruta pública del asset V19');

expect(hooks.includes('input?.deferPosReceipt !== true'), 'el hook no respeta la impresión diferida');
expect(hooks.includes('queueSplitPartReceiptIntent'), 'División debe encolar el comprobante individual de cada parte');
expect(!hooks.includes('await receipts.queueReceiptForTableIfClosed(tenantId, tableId)'), 'División no debe encolar otra tirilla total al finalizar');
expect(methods.includes('deferPosReceipt: input.deferPosReceipt === true'), 'métodos de pago no propagan la decisión diferida');

const deferredCount = (cashService.match(/deferPosReceipt: true/g) || []).length;
expect(deferredCount >= 2, 'Caja V2 debe diferir la tirilla tanto en pago normal como en crédito');
expect(cashService.includes('receiptDecisionRequired: true'), 'Caja no informa al frontend que debe preguntar por el recibo');
expect(cashService.includes('async function queueReceiptPrint'), 'falta operación explícita para imprimir después del cobro');
expect(cashService.includes('state: \'CERRADA\''), 'la impresión debe exigir una sesión cerrada');
expect(cashService.includes("money(sale.saldo).gt(0)"), 'la impresión debe exigir venta completamente liquidada');
expect(cashService.includes('posReceiptPrint.queueReceiptIntent(tenantId, session.id)'), 'Sí debe reutilizar la cola POS existente');
expect(cashRoutes.includes("router.post('/v2/caja/recibo/imprimir'"), 'falta endpoint de impresión en Caja V2');
expect(cashRoutes.includes('receiptPrintSchema'), 'falta validación del sessionId de impresión');

expect(splitService.includes('registerPartPaymentFinalized'), 'División V2 dejó de usar su finalizador real');
expect(!splitService.includes('deferPosReceipt'), 'V19 no debe alterar División V2');
expect(!cashService.includes('cashReceived'), 'V19 no debe tocar el monto recibido/contable de V18');
expect(!cashService.includes('cashChange'), 'V19 no debe tocar la devolución contable de V18');

console.log('Restaurant V2 Cash Print Choice V19 + customer name V127 smoke: OK');
