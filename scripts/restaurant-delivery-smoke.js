'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const schema = read('prisma/restaurant-delivery-v1.prisma');
const service = read('src/modules/restaurant/restaurant-delivery.service.js');
const routes = read('src/modules/restaurant/restaurant-delivery.routes.js');
const core = read('src/routes/core.routes.js');
const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');
const publicRoutes = read('src/modules/restaurant/restaurant-delivery.public.routes.js');
const theme = read('src/web/restaurant-theme.js');
const ui = read('src/web/restaurant-delivery-ui.js');
const customerAutofill = read('src/web/restaurant-delivery-customer-autofill-v83.js');
const center = read('src/web/restaurant-control-center.js');
const rbac = read('src/modules/restaurant/restaurant.rbac.js');
const runtime = read('scripts/ensure-restaurant-runtime-schema.js');

assert.match(schema, /model RestaurantDeliveryOrder/);
assert.match(schema, /model RestaurantDeliveryItem/);
assert.match(schema, /model RestaurantDeliveryCommand/);
assert.match(schema, /NUEVO[\s\S]*CONFIRMADO[\s\S]*EN_PREPARACION[\s\S]*LISTO[\s\S]*EN_CAMINO[\s\S]*ENTREGADO/);
assert.match(schema, /paymentStatus\s+RestaurantDeliveryPaymentStatus/);
assert.doesNotMatch(schema, /RestaurantTableSession\?/, 'Domicilios no debe persistirse como una mesa falsa');

assert.match(service, /createDelivery/);
assert.match(service, /recentCustomerByPhone/);
assert.match(service, /orderBy:\s*\{\s*creadoEn:\s*'desc'\s*\}/);
assert.match(service, /acceptDelivery/);
assert.match(service, /listKdsCommands/);
assert.match(service, /registerDeliveryPayment/);
assert.match(service, /sales\.emitSaleInTx/);
assert.match(service, /treasury\.registerPayment/);
assert.match(service, /REST-DELIVERY-FEE/);
assert.match(service, /controlaInventario:\s*false/);
assert.match(service, /source:\s*'DOMICILIO'/);

assert.match(routes, /\/domicilios/);
assert.match(routes, /\/domicilios\/clientes\/telefono\/:phone/);
assert.match(routes, /\/domicilios\/:id\/aceptar/);
assert.match(routes, /\/domicilios\/:id\/en-camino/);
assert.match(routes, /\/domicilios\/:id\/entregado/);
assert.match(routes, /\/domicilios\/:id\/pago/);
assert.match(routes, /restaurantDeliveryCommand/);
assert.match(routes, /restaurant\.listCommands/);
assert.match(core, /restaurantDeliveryRouter/);
assert.match(rbac, /'DOMICILIOS'/);
assert.match(rbac, /DOMICILIOS\.PAGAR/);

assert.match(publicRoot, /restaurantDeliveryPublicRouter/);
assert.match(publicRoutes, /restaurant-delivery-ui\.js/);
assert.match(publicRoutes, /restaurant-delivery-customer-autofill-v83\.js/);
assert.match(publicRoutes, /X-VantixGC-Restaurant-Delivery-Customer-Autofill/);
assert.match(publicRoutes, /fs\.promises\.readFile/);
assert.match(theme, /restaurant-delivery-ui\.js\?v=delivery-v1/);
assert.match(ui, /🛵 Domicilios/);
assert.match(ui, /NUEVO DOMICILIO/);
assert.match(ui, /ACEPTAR PEDIDO/);
assert.match(ui, /MARCAR EN CAMINO/);
assert.match(ui, /MARCAR ENTREGADO/);
assert.match(ui, /PAGO PENDIENTE/);
assert.match(ui, /Ya conocemos a/);
assert.match(ui, /deliveryLayoutReady/, 'El MutationObserver debe quedar estabilizado después de ordenar los botones');

assert.match(customerAutofill, /VANTIX_RESTAURANT_DELIVERY_CUSTOMER_AUTOFILL_V83/);
assert.match(customerAutofill, /domicilios\/clientes\/telefono/);
assert.match(customerAutofill, /deliveryName/);
assert.match(customerAutofill, /deliveryAddress/);
assert.match(customerAutofill, /deliveryNeighborhood/);
assert.match(customerAutofill, /deliveryReference/);
assert.match(customerAutofill, /Datos del último domicilio cargados automáticamente/);
assert.match(customerAutofill, /Puedes corregir nombre, dirección, barrio o referencia/);
assert.match(customerAutofill, /requestSeq/);
assert.match(customerAutofill, /nextPhone !== activePhone/);
assert.match(customerAutofill, /automaticFill:\s*true/);
assert.match(customerAutofill, /latestDeliveryWins:\s*true/);
assert.match(customerAutofill, /manualCorrectionPersistsOnCreate:\s*true/);
assert.match(customerAutofill, /crossCustomerLeakGuard:\s*true/);

assert.match(center, /domicilios:'Domicilios'/);
assert.match(center, /function openCustomView\(view, pushState = true\)/);
assert.match(center, /view === 'domicilios'/);
assert.match(center, /VantixGCRestaurantDelivery\.open\(false\)/);
assert.match(ui, /openCustomView\?\.\('domicilios', pushState\)/);
assert.match(ui, /navigateBack\(\)/);
assert.doesNotMatch(ui, /data-delivery-home/, 'Domicilios debe usar el Atrás canónico y no un botón paralelo');

assert.match(runtime, /RestaurantDeliveryOrder/);
assert.match(runtime, /RestaurantDeliveryItem/);
assert.match(runtime, /RestaurantDeliveryCommand/);

console.log(JSON.stringify({
  ok: true,
  channel: 'DOMICILIO',
  fakeTable: false,
  sharedKds: true,
  sharedAccounting: true,
  guidedUi: true,
  customerAutofillByPhone: true,
  lastDeliveryAsDefault: true,
  manualCorrectionsBecomeLatestOnCreate: true,
  crossCustomerLeakGuard: true,
  states: ['NUEVO','CONFIRMADO','EN_PREPARACION','LISTO','EN_CAMINO','ENTREGADO'],
  paymentStateSeparated: true
}));
