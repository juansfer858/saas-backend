'use strict';

const fs = require('fs');
const path = require('path');
const posNumber = require('../src/modules/restaurant/restaurant-pos-number.service');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const numberService = read('src/modules/restaurant/restaurant-pos-number.service.js');
const operationalMode = read('src/modules/restaurant/restaurant-pos-operational-mode.js');
const deliveryService = read('src/modules/restaurant/restaurant-delivery.service.js');

if (!posNumber.isRestaurantPosSource('REST-TABLE-test')) throw new Error('REST-TABLE debe participar en el consecutivo POS.');
if (!posNumber.isRestaurantPosSource('REST-DELIVERY-test')) throw new Error('REST-DELIVERY debe participar en el consecutivo POS.');
if (posNumber.isRestaurantPosSource('REST-OTHER-test')) throw new Error('Un origen ajeno no debe participar en el consecutivo POS.');
if (posNumber.formatPosNumber(4) !== '000004' || posNumber.formatPosNumber(5) !== '000005') {
  throw new Error('El formato del consecutivo POS cambió inesperadamente.');
}

for (const marker of [
  "'REST-TABLE-'",
  "'REST-DELIVERY-'",
  '"sourceId" LIKE \'REST-TABLE-%\'',
  '"sourceId" LIKE \'REST-DELIVERY-%\''
]) {
  if (!numberService.includes(marker)) throw new Error(`Falta marcador de secuencia V104: ${marker}`);
}

if (!operationalMode.includes('posNumber.isRestaurantPosSource(sale.sourceId)')) {
  throw new Error('El hook de emisión no usa la clasificación POS unificada.');
}
if (!deliveryService.includes('REST-DELIVERY-${crypto.randomUUID()}')) {
  throw new Error('El origen canónico de Domicilios cambió; revisar antes de fusionar V104.');
}

console.log('restaurant-unified-pos-number-v104-smoke: OK');
