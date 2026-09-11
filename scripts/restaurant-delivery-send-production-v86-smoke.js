'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const send = read('src/web/restaurant-delivery-send-production-v86.js');
const publicRoutes = read('src/modules/restaurant/restaurant-delivery.public.routes.js');
const deliveryService = read('src/modules/restaurant/restaurant-delivery.service.js');

assert.match(send, /VANTIX_RESTAURANT_DELIVERY_SEND_PRODUCTION_V86/);
assert.match(send, /#deliveryCreateSubmit/);
assert.match(send, /ENVIAR A PRODUCCIÓN/);
assert.match(send, /\/api\/v1\/restaurante\/domicilios'/, 'Primero debe crear el domicilio');
assert.match(send, /\/aceptar`/, 'Después debe aceptar el mismo domicilio para despacharlo');
assert.match(send, /deliveryCreatedId/, 'Un reintento no debe crear un domicilio duplicado');
assert.match(send, /VantixGCRestaurantDelivery\?\.refresh/, 'Debe refrescar Domicilios después de despachar');
assert.match(send, /event\.stopImmediatePropagation\(\)/, 'Debe reemplazar el submit legacy NUEVO');

assert.match(publicRoutes, /restaurant-delivery-send-production-v86\.js/);
assert.match(publicRoutes, /X-VantixGC-Restaurant-Delivery-Send-Production/);
assert.match(publicRoutes, /sendProduction/);

// No se altera KDS: el envío reutiliza el contrato probado de aceptar domicilio.
assert.match(deliveryService, /async function acceptDelivery/);
assert.match(deliveryService, /restaurantDeliveryCommand\.create/);
assert.match(deliveryService, /state:\s*'CONFIRMADO'/);
assert.match(deliveryService, /source:\s*'DOMICILIO'/);

console.log('RESTAURANT_DELIVERY_SEND_PRODUCTION_V86_OK');
