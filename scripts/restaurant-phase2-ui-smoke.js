const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const app = read('src/app.js');
const operator = read('src/web/restaurant.html');
const customer = read('src/web/restaurant-qr.html');
const service = read('src/modules/restaurant/restaurant.service.js');
const rbac = read('src/modules/restaurant/restaurant.rbac.js');
const phase2 = read('docs/RESTAURANT_PHASE2_SIMULATED_V1.md');
const edgeGate = read('docs/EDGE_FIELD_TEST_GATE_V1.md');

assert.match(app, /restaurantVertical:\s*'PHASE2_FUNCTIONAL_SIMULATED_PRINT_PRODUCTION_BLOCKED'/);
assert.match(app, /FUNCIONAL — VALIDADO CON IMPRESIÓN SIMULADA/);
assert.match(app, /PRODUCCIÓN REAL BLOQUEADA/);
assert.match(app, /app\.get\('\/app\/restaurante'/);
assert.match(app, /app\.get\('\/r\/:token'/);

assert.match(operator, /FUNCIONAL — VALIDADO CON IMPRESIÓN SIMULADA/);
assert.match(operator, /productionLabel/);
assert.match(operator, /Plano del salón/);
assert.match(operator, /Panel mesero/);
assert.match(operator, /KDS \/ comandas/);
assert.match(operator, /COMANDA SIMULADA — NO IMPRESA EN HARDWARE/);
assert.match(operator, /Guardar PDF/);
assert.match(operator, /Caja \/ cierre/);

assert.match(customer, /Pedido directo a cocina\/barra · sin aprobación previa del mesero/);
assert.match(customer, /Revisé el total · Confirmar pedido/);
assert.match(customer, /consentWhatsApp/);
assert.match(customer, /entró de inmediato a las comandas/i);

assert.match(service, /physicalPrinterFieldPass/);
assert.match(service, /metaBusinessManagementReviewPass/);
assert.match(service, /dianRealEnabled \|\| config\.simulatedFiscalOperationExplicitlyAccepted/);
assert.match(service, /RESTAURANT_RECIPE_REQUIRED/);
assert.match(service, /RESTAURANT_QR_TOTAL_CONFIRMATION_MISMATCH/);
assert.match(service, /DOCUMENTO EQUIVALENTE SIMULADO/);
assert.match(service, /Propinas por pagar/);
assert.match(service, /ORDER_READY/);

assert.match(rbac, /MESERO:/);
assert.match(rbac, /COCINA:/);
assert.match(rbac, /BARRA:/);
assert.match(rbac, /CAJERO:/);
assert.doesNotMatch(rbac, /MESERO:[\s\S]*CONTABILIDAD\.VER[\s\S]*COCINA:/);

assert.match(phase2, /RESTAURANT_PRODUCTION_READY = physicalPrinterFieldPass && metaBusinessManagementReviewPass && \(dianRealEnabled \|\| simulatedFiscalOperationExplicitlyAccepted\)/);
assert.match(phase2, /NO significa listo para producción con clientes reales/);
assert.match(edgeGate, /DESARROLLO FUNCIONAL SIMULADO AUTORIZADO/);
assert.match(edgeGate, /RESTAURANTE PRODUCCIÓN REAL: BLOQUEADA/);

console.log('RESTAURANT PHASE 2 SIMULATED UI/GATE SMOKE OK');
console.log(JSON.stringify({
  visibleSimulatedStatus: true,
  dynamicProductionBlockedStatus: true,
  falseProductionClaimBlocked: true,
  floorPlanUi: true,
  waiterUi: true,
  kdsUi: true,
  simulatedPdfCommandUi: true,
  qrDirectOrderUi: true,
  cashShiftUi: true,
  restaurantRbacDeclared: true,
  physicalGateStillRequired: true
}, null, 2));
