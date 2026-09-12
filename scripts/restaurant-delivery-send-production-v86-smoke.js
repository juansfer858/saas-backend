'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const send = read('src/web/restaurant-delivery-send-production-v86.js');
const publicRoutes = read('src/modules/restaurant/restaurant-delivery.public.routes.js');
const deliveryRoutes = read('src/modules/restaurant/restaurant-delivery.routes.js');
const deliveryService = read('src/modules/restaurant/restaurant-delivery.service.js');
const deliveryV94 = read('src/web/restaurant-delivery-orders-compact-v93.js');

assert.match(send, /VANTIX_RESTAURANT_DELIVERY_SEND_PRODUCTION_V86/);
assert.match(send, /VANTIX_RESTAURANT_DELIVERY_FREEZE_ROOT_FIX_V94/);
assert.match(send, /VANTIX_RESTAURANT_DELIVERY_REQUIRED_FIELDS_V95/);
assert.match(send, /#deliveryCreateSubmit/);
assert.match(send, /ENVIAR A PRODUCCIÓN/);
assert.match(send, /\/api\/v1\/restaurante\/domicilios'/, 'Primero debe crear el domicilio');
assert.match(send, /\/aceptar`/, 'Después debe aceptar el mismo domicilio para despacharlo');
assert.match(send, /deliveryCreatedId/, 'Un reintento no debe crear un domicilio duplicado');
assert.match(send, /VantixGCRestaurantDelivery\?\.refresh/, 'Debe refrescar Domicilios después de despachar');
assert.match(send, /event\.stopImmediatePropagation\(\)/, 'Debe reemplazar el submit legacy NUEVO');

// Regresión V94: el carrito editable usa data-v94-line, no data-v93-plus. El envío
// inmediato debe reconocer cada línea y conservar precio aplicado + nota.
assert.match(deliveryV94, /data-v94-line/);
assert.match(deliveryV94, /data-v94-price/);
assert.match(deliveryV94, /data-v94-note/);
assert.match(send, /\[data-v94-line\]/, 'V95 debe leer las líneas V94 activas');
assert.match(send, /v94MenuByLine/, 'V95 debe conservar la relación línea ↔ producto de Carta');
assert.match(send, /appliedUnitPrice:\s*rawPrice/, 'V95 debe enviar el precio aplicado de la línea');
assert.match(send, /notes:\s*notes \|\| null/, 'V95 debe enviar la nota de la línea');
assert.match(send, /supportsV94Lines:true/);
assert.match(send, /preservesAppliedUnitPrice:true/);
assert.match(send, /preservesLineNotes:true/);

// Sólo teléfono, nombre y dirección son obligatorios. Barrio y referencia son opcionales
// tanto en la UI como en el esquema real del endpoint.
assert.match(send, /Barrio \/ zona \(opcional\)/);
assert.match(send, /Referencia \(opcional\)/);
assert.match(send, /requiredFields:\['customerPhone','customerName','address'\]/);
assert.match(send, /optionalFields:\['neighborhood','deliveryReference'\]/);
assert.match(deliveryRoutes, /neighborhood:\s*z\.string\(\)\.trim\(\)\.max\(100\)\.optional\(\)\.nullable\(\)/);
assert.match(deliveryRoutes, /deliveryReference:\s*z\.string\(\)\.trim\(\)\.max\(180\)\.optional\(\)\.nullable\(\)/);
assert.doesNotMatch(send, /!value\(dialog, '#deliveryNeighborhood'\)/);
assert.doesNotMatch(send, /!value\(dialog, '#deliveryReference'\)/);

// Se conserva el fix contra congelamiento del diálogo.
assert.doesNotMatch(send, /new\s+MutationObserver/);
assert.doesNotMatch(send, /observer\.observe\(document\.documentElement/);
assert.match(send, /requestAnimationFrame\(\(\) => patchVisibleDialog\(\)\)/);
assert.match(send, /globalObserver:false/);
assert.match(send, /supportsV93:true/);

assert.match(publicRoutes, /restaurant-delivery-send-production-v86\.js/);
assert.match(publicRoutes, /X-VantixGC-Restaurant-Delivery-Send-Production/);
assert.match(publicRoutes, /sendProduction/);

// No se altera KDS: el envío reutiliza el contrato probado de aceptar domicilio.
assert.match(deliveryService, /async function acceptDelivery/);
assert.match(deliveryService, /restaurantDeliveryCommand\.create/);
assert.match(deliveryService, /state:\s*'CONFIRMADO'/);
assert.match(deliveryService, /source:\s*'DOMICILIO'/);

console.log('RESTAURANT_DELIVERY_SEND_PRODUCTION_V95_REQUIRED_FIELDS_AND_V94_LINES_OK');
