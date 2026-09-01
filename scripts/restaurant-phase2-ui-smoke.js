const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const app = read('src/app.js');
const operator = read('src/web/restaurant.html');
const operatorUi = read('src/web/restaurant-ui.js');
const customer = read('src/web/restaurant-qr.html');
const customerUi = read('src/web/restaurant-qr-ui.js');
const themeCss = read('src/web/restaurant-theme.css');
const service = read('src/modules/restaurant/restaurant.service.js');
const zonesService = read('src/modules/restaurant/restaurant-zones.service.js');
const routes = read('src/modules/restaurant/restaurant.routes.js');
const rbac = read('src/modules/restaurant/restaurant.rbac.js');
const phase2Schema = read('prisma/restaurant-phase2-v1.prisma');
const phase2 = read('docs/RESTAURANT_PHASE2_SIMULATED_V1.md');
const edgeGate = read('docs/EDGE_FIELD_TEST_GATE_V1.md');

assert.match(app, /restaurantVertical:\s*'PHASE2_FUNCTIONAL_SIMULATED_PRINT_PRODUCTION_BLOCKED'/);
assert.match(app, /FUNCIONAL — VALIDADO CON IMPRESIÓN SIMULADA/);
assert.match(app, /PRODUCCIÓN REAL BLOQUEADA/);
assert.match(app, /app\.get\('\/app\/restaurante'/);
assert.match(app, /app\.get\('\/r\/:token'/);

assert.match(operator, /restaurant-theme\.css/);
assert.match(operator, /restaurant-ui\.js\?v=salon-qr-v2/);
assert.match(operator, /<dialog id="noticePanel"/);
assert.match(operator, /id="noticeToggle"/);
assert.match(operator, /id="gateInner"/);
assert.match(operator, /id="edgeStatusSlot"/);
assert.ok(!operator.includes('id="gate"'), 'Production warning must not reserve a persistent full-width band');
assert.ok(!operator.includes("insertAdjacentElement('afterend'"), 'Edge status must stay inside the Avisos dialog instead of inserting another band');
assert.match(operatorUi, /Panel del mesero/);
assert.match(operatorUi, /OPERACIÓN DEL SALÓN/);
assert.match(operatorUi, /Cocina \/ Barra/);
assert.match(operatorUi, /COMANDA SIMULADA — NO IMPRESA EN HARDWARE/);
assert.match(operatorUi, /Imprimir \/ Guardar PDF/);

// Salón V2 keeps zones but separates daily operation, layout editing and QR management.
for (const token of [
  'selectedZoneId',
  'loadZones',
  '/api/v1/restaurante/zonas',
  'OPERACIÓN DEL SALÓN',
  'Gestionar zonas',
  'Gestionar QR',
  '+ Mesa',
  'Editar plano',
  'data-salon-view="PLANO"',
  'data-salon-view="LISTA"',
  'zoneId:zone.id',
  'tablesInSelectedZone'
]) assert.ok(operatorUi.includes(token), `Restaurant Salon V2 UI must contain ${token}`);

assert.match(phase2Schema, /model RestaurantZone \{/);
assert.match(phase2Schema, /zoneId\s+String\?/);
assert.match(phase2Schema, /zone\s+RestaurantZone\?\s+@relation/);
assert.match(phase2Schema, /@@index\(\[tenantId, zoneId, active\]\)/);

for (const token of [
  "DEFAULT_ZONE_NAME = 'Salón principal'",
  'ensureDefaultZone',
  'resolveZoneForTable',
  'listZones',
  'createZone',
  'renameZone',
  'removeZone',
  'assignTable',
  'RESTAURANT_ZONE_HAS_TABLES',
  "user?.rol === 'MESERO'",
  'zoneId: null'
]) assert.ok(zonesService.includes(token), `Restaurant zones service must contain ${token}`);

assert.match(routes, /router\.get\('\/zonas', requirePermission\('MESAS\.VER'\)/);
assert.match(routes, /router\.post\('\/zonas', requirePermission\('RESTAURANTE\.ADMINISTRAR'\)/);
assert.match(routes, /router\.patch\('\/zonas\/:id', requirePermission\('RESTAURANTE\.ADMINISTRAR'\)/);
assert.match(routes, /router\.delete\('\/zonas\/:id', requirePermission\('RESTAURANTE\.ADMINISTRAR'\)/);
assert.match(routes, /router\.get\('\/mesas\/:id\/qr', requirePermission\('MESAS\.VER'\)/);
assert.match(routes, /router\.post\('\/mesas\/:id\/qr\/regenerar', requirePermission\('RESTAURANTE\.ADMINISTRAR'\)/);
assert.match(routes, /zones\.ensureDefaultZone\(req\.tenantId\)/);
assert.match(routes, /zones\.assignTable/);
assert.match(routes, /zoneId:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/);

// Caja V2 replaces the old sparse "Cierre de caja / turno" screen with the approved
// operational flow while preserving the same real open/charge/close endpoints.
for (const token of [
  'CAJA CERRADA',
  'CAJA ABIERTA',
  'Mesas por cobrar',
  'Cobro rápido',
  'Confirmar cobro',
  'Resumen del turno',
  'Cerrar turno',
  '/api/v1/restaurante/caja/abrir',
  '/api/v1/restaurante/caja/turnos/',
  '/api/v1/restaurante/mesas/${selected.id}/cerrar',
  'restaurantClosedTablesTotal',
  'restaurantCashRecorded',
  'systemCashExpected'
]) assert.ok(operatorUi.includes(token), `Caja V2 must contain ${token}`);
assert.ok(!operatorUi.includes('summary?.paymentBreakdown'), 'Caja V2 must not depend on a field the backend summary does not provide');

assert.match(themeCss, /\.floor/);
assert.match(themeCss, /\.command-ticket/);
assert.match(themeCss, /\.receipt/);

// QR V3 behavior remains intentionally simple for four stress profiles, while the
// presentation is now a compact traditional list instead of graphic product cards.
for (const token of [
  'id="helpButton"',
  'id="categoryNav"',
  'id="cartBar"',
  'id="reviewButton"',
  'id="helpPanel"',
  'Pedir es muy fácil',
  'menu-list-v4'
]) assert.ok(customer.includes(token), `Restaurant QR customer shell must contain ${token}`);
for (const token of [
  "label:'★ MÁS PEDIDOS'",
  'visibleProducts',
  'cartCount',
  'qrv3-menu-list',
  'ELIGE UN PRODUCTO',
  'ENVIAR PEDIDO A COCINA',
  'AGREGAR OTRO PEDIDO',
  'SYSTEM_ONLY_NO_WHATSAPP_V5',
  '/api/public/restaurante/qr/',
  'No necesitas avisarle al mesero'
]) assert.ok(customerUi.includes(token), `Restaurant QR customer behavior must contain ${token}`);
assert.ok(!customerUi.includes('WhatsApp opcional'), 'QR customer review must not ask for WhatsApp');
assert.ok(!customerUi.includes('consentWhatsApp'), 'QR customer review must not require WhatsApp consent');
assert.ok(!customerUi.includes('customerPhoneE164'), 'QR customer review must not collect a phone number');
assert.ok(!customerUi.includes('qrv3-media-symbol'), 'QR customer menu must not depend on decorative product drawings');
assert.ok(!customerUi.includes('location.origin'), 'QR customer UI must never derive its public identity from browser origin');

assert.match(service, /physicalPrinterFieldPass/);
assert.match(service, /metaBusinessManagementReviewPass/);
assert.match(service, /dianRealEnabled \|\| config\.simulatedFiscalOperationExplicitlyAccepted/);
assert.match(service, /RESTAURANT_RECIPE_REQUIRED/);
assert.match(service, /RESTAURANT_QR_TOTAL_CONFIRMATION_MISMATCH/);
assert.match(service, /DOCUMENTO EQUIVALENTE SIMULADO/);
assert.match(service, /Propinas por pagar/);
assert.match(service, /ORDER_READY/);
assert.match(service, /restaurantClosedTablesTotal/);
assert.match(service, /systemCashExpected/);
assert.match(service, /restaurantCashRecorded/);

assert.match(routes, /restaurantMenuItem\.findFirst/);
assert.match(routes, /tenantId:\s*req\.tenantId/);
assert.match(routes, /RESTAURANT_MENU_ITEM_NOT_FOUND/);
assert.match(routes, /pedido-borrador/);

assert.match(rbac, /MESERO:/);
assert.match(rbac, /COCINA:/);
assert.match(rbac, /BARRA:/);
assert.match(rbac, /CAJERO:/);
assert.match(rbac, /BASE_ROLES\.ADMIN = \['\*'\]/);
assert.doesNotMatch(rbac, /MESERO:[\s\S]*CONTABILIDAD\.VER[\s\S]*COCINA:/);

assert.match(phase2, /RESTAURANT_PRODUCTION_READY = physicalPrinterFieldPass && metaBusinessManagementReviewPass && \(dianRealEnabled \|\| simulatedFiscalOperationExplicitlyAccepted\)/);
assert.match(phase2, /NO significa listo para producción con clientes reales/);
assert.match(edgeGate, /DESARROLLO FUNCIONAL SIMULADO AUTORIZADO/);
assert.match(edgeGate, /RESTAURANTE PRODUCCIÓN REAL: BLOQUEADA/);

new Function(operatorUi);
new Function(customerUi);
new Function(zonesService);

console.log('RESTAURANT PHASE 2 + SALÓN/QR LIST + CAJA V2 + NOTICE DIALOG SMOKE OK');
console.log(JSON.stringify({
  visibleSimulatedStatus: true,
  dynamicProductionBlockedStatus: true,
  noticesDoNotDisplaceWorkspace: true,
  falseProductionClaimBlocked: true,
  zonesAndTablesUi: true,
  defaultZoneBackfill: true,
  zoneAdminRbac: true,
  floorPlanUi: true,
  waiterUi: true,
  kdsUi: true,
  simulatedPdfCommandUi: true,
  qrDirectOrderUi: true,
  qrFourProfileUx: true,
  qrTraditionalListUi: true,
  qrSystemOnlyReview: true,
  qrPersistentCart: true,
  qrHelpFlow: true,
  cashShiftUi: true,
  cashV2RealSummaryFields: true,
  restaurantRbacDeclared: true,
  menuUpdateTenantIsolation: true,
  physicalGateStillRequired: true,
  identityThemeExtracted: true
}, null, 2));