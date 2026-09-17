'use strict';

const fs = require('node:fs');

const overlay = fs.readFileSync('src/web/restaurant-v2-cash-print-choice-v19.js', 'utf8');
const cashHtml = fs.readFileSync('src/web/restaurant-v2-cash.html', 'utf8');
const cashRoutes = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.routes.js', 'utf8');
const cashService = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.service.js', 'utf8');
const customerNameService = fs.readFileSync('src/modules/restaurant/restaurant-customer-display-name.service.js', 'utf8');
const reissueService = fs.readFileSync('src/modules/restaurant/restaurant-sale-customer-reissue-v128.service.js', 'utf8');
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

expect(overlay.includes('postSaleCustomerReissue:true'), 'falta marcador de anulación y recreación postventa');
expect(overlay.includes('data?.result?.sale?.id'), 'la recreación debe quedar anclada a la venta exacta');
expect(overlay.includes('IDENTIFICAR CLIENTE (ANULAR Y RECREAR)'), 'falta acción segura para identificar cliente');
expect(overlay.includes('/recrear-cliente'), 'falta llamada al flujo V128 de recreación');
expect(overlay.includes('/api/v1/restaurante/v2/caja/clientes'), 'falta búsqueda/creación del cliente real');
expect(!overlay.includes('saveCustomerName'), 'V19.3 no debe editar el nombre de una venta liquidada');
expect(!overlay.includes('/nombre-cliente`'), 'V19.3 no debe mutar el nombre postventa desde la interfaz');
expect(cashRoutes.includes("router.get('/v2/caja/ventas/:saleId/recrear-cliente'"), 'falta contexto de recreación V128');
expect(cashRoutes.includes("router.post('/v2/caja/ventas/:saleId/recrear-cliente'"), 'falta operación de recreación V128');
expect(customerNameService.includes('RESTAURANT_RECEIPT_CUSTOMER_NAME_REQUIRES_REISSUE'), 'una venta liquidada debe exigir anulación y recreación');

expect(reissueService.includes('VANTIX_RESTAURANT_CUSTOMER_REISSUE_V128'), 'falta marker del servicio V128');
expect(reissueService.includes('lockOperation(tx, tenantId, true)'), 'la recreación debe bloquear el cierre concurrente del turno');
expect(reissueService.includes('reverseDirectDocumentSettlementInTx'), 'falta reversión de Tesorería del documento original');
expect(reissueService.includes('reverseDocumentMovementsInTx'), 'falta reversión de inventario del documento original');
expect(reissueService.includes('reverseJournalInTx'), 'falta reversión contable');
expect(reissueService.includes('reverseTipJournalInTx'), 'falta reversión del asiento separado de propina');
expect(reissueService.includes('postReplacementTipInTx'), 'falta recrear la propina cuando aplica');
expect(reissueService.includes('sales.emitSaleInTx'), 'la nueva venta debe usar la emisión real de Restaurante');
expect(reissueService.includes("sourceId = `REST-TABLE-REISSUE-"), 'la venta reemplazo debe conservar el contrato POS de Restaurante');
expect(reissueService.includes('restaurantOrderItem.updateMany'), 'Producción debe remapear sus saleDetailId a la nueva venta');
expect(reissueService.includes('data: { saleId: replacement.id }'), 'la sesión debe apuntar a la venta reemplazo');
expect(reissueService.includes("state: 'ACEPTADO'"), 'un documento aceptado por DIAN debe quedar bloqueado');
expect(reissueService.includes("shift.estado !== 'ABIERTA'"), 'el turno original debe seguir abierto');
expect(reissueService.includes('shift.userId !== userId'), 'la recreación debe exigir el cajero dueño del turno');
expect(reissueService.includes("scope: 'VOID_AND_REISSUE'"), 'falta alcance auditable VOID_AND_REISSUE');
expect(reissueService.includes('originalPreservedAsCancelled: true'), 'la venta original debe conservarse anulada');
expect(reissueService.includes('money(replacement.total).eq(money(original.total))'), 'el total reemplazo debe ser exactamente igual al original');

expect(cashHtml.includes('/app/restaurant-v2-cash-print-choice-v19.js?v=v19.3'), 'Caja no fuerza la carga de V19.3');
expect(cashHtml.indexOf('restaurant-v2-cash-tender-v18.js?v=v18') < cashHtml.indexOf('restaurant-v2-cash-print-choice-v19.js?v=v19.3'), 'V19.3 debe cargar después de V18');
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

console.log('Restaurant V2 Cash Print Choice V19.3 + customer reissue V128 smoke: OK');
