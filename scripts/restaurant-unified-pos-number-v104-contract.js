'use strict';

const fs = require('fs');
const path = require('path');

const numberService = fs.readFileSync(path.join(__dirname, '..', 'src/modules/restaurant/restaurant-pos-number.service.js'), 'utf8');
const mode = fs.readFileSync(path.join(__dirname, '..', 'src/modules/restaurant/restaurant-pos-operational-mode.js'), 'utf8');

const required = [
  "RESTAURANT_POS_SOURCE_PREFIXES = Object.freeze(['REST-TABLE-', 'REST-DELIVERY-'])",
  'posNumber.isRestaurantPosSource(sale.sourceId)',
  "\"sourceId\" LIKE 'REST-TABLE-%' OR \"sourceId\" LIKE 'REST-DELIVERY-%'"
];

for (const marker of required) {
  if (!numberService.includes(marker) && !mode.includes(marker)) throw new Error(`Falta contrato V104: ${marker}`);
}

if (!numberService.includes('Los documentos\n  // históricos FV-* no se renumeran')) {
  throw new Error('Debe conservarse explícitamente la regla de no renumerar históricos FV-*');
}

console.log('restaurant-unified-pos-number-v104-contract: OK');
