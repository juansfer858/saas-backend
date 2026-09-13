'use strict';

const posNumber = require('../src/modules/restaurant/restaurant-pos-number.service');

const cases = [
  ['REST-TABLE-1', true],
  ['REST-DELIVERY-1', true],
  ['REST-DELIVERY-XYZ', true],
  ['REST-TABLE-XYZ', true],
  ['FV-123', false],
  ['REST-PICKUP-1', false],
  ['', false]
];

for (const [source, expected] of cases) {
  const actual = posNumber.isRestaurantPosSource(source);
  if (actual !== expected) throw new Error(`${source}: expected ${expected}, got ${actual}`);
}

const expectedNumbers = new Map([[0, '000000'], [4, '000004'], [5, '000005'], [999999, '999999'], [1000000, '1000000']]);
for (const [value, expected] of expectedNumbers) {
  const actual = posNumber.formatPosNumber(value);
  if (actual !== expected) throw new Error(`${value}: expected ${expected}, got ${actual}`);
}

console.log('restaurant-unified-pos-number-v104-invariants: OK');
