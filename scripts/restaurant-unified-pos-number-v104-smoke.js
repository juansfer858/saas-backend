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

if (!posNumber.isRestaurantPosSource('REST-TABLE-abc')) throw new Error('REST-TABLE debe participar en el consecutivo POS.');
if (!posNumber.isRestaurantPosSource('REST-DELIVERY-abc')) throw new Error('REST-DELIVERY debe participar en el consecutivo POS.');
if (posNumber.isRestaurantPosSource('REST-OTHER-abc')) throw new Error('Orígenes ajenos no deben participar en el consecutivo POS.');
if (posNumber.formatPosNumber(4) !== '000004') throw new Error('El formato POS de seis dígitos cambió inesperadamente.');

for (const marker of [
  "'REST-TABLE-'",
  "'REST-DELIVERY-'",
  '"sourceId" LIKE \'REST-TABLE-%\'',
  '"sourceId" LIKE \'REST-DELIVERY-%\'',
  'isRestaurantPosSource(sale.sourceId)'
]) {
  if (!numberService.includes(marker) && !operationalMode.includes(marker)) {
    throw new Error(`Falta marcador de consecutivo unificado: ${marker}`);
  }
}

if (!deliveryService.includes("sourceId: `REST-DELIVERY-${crypto.randomUUID()}`")) {
  throw new Error('El contrato actual de origen de Domicilios cambió; revisar integración antes de numerar.');
}

if (!operationalMode.includes('posNumber.isRestaurantPosSource(sale.sourceId)')) {
  throw new Error('El hook de emisión debe usar la clasificación canónica de origen POS.');
}

if (operationalMode.includes("String(sale.sourceId || '').startsWith('REST-TABLE-') && !posNumber.isFinalPosNumber")) {
  throw new Error('El hook sigue limitado exclusivamente a mesas.');
}

console.log('restaurant-unified-pos-number-v104-smoke: OK');
