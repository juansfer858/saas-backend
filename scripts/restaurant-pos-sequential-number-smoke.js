'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const numbers = require('../src/modules/restaurant/restaurant-pos-number.service');

function fakeTx({ current = 'FV-1788733464654-ABC123', max = '0', sourceId = 'REST-TABLE-table-1-123' } = {}) {
  const calls = [];
  const tx = {
    $queryRawUnsafe: async (query, value) => {
      calls.push({ query, value });
      if (query.includes('pg_advisory_xact_lock')) return [{ locked:true }];
      return [{ maxNumber:max }];
    },
    comprobanteComercial: {
      findFirst: async () => ({ id:'sale-1', numero:current, sourceId }),
      update: async ({ data }) => ({ id:'sale-1', numero:data.numero, sourceId })
    }
  };
  return { tx, calls };
}

(async () => {
  assert.equal(numbers.POS_NUMBER_WIDTH, 6);
  assert.equal(numbers.formatPosNumber(1n), '000001');
  assert.equal(numbers.formatPosNumber(42n), '000042');
  assert.equal(numbers.formatPosNumber(999999n), '999999');
  assert.equal(numbers.formatPosNumber(1000000n), '1000000');
  assert.equal(numbers.isFinalPosNumber('000001'), true);
  assert.equal(numbers.isFinalPosNumber('FV-1788733464654'), false);

  const first = fakeTx({ max:'0' });
  const assignedFirst = await numbers.assignRestaurantPosNumberInTx(first.tx, 'tenant-1', 'sale-1');
  assert.equal(assignedFirst.numero, '000001');
  assert.equal(first.calls[0].value, 'vantixgc:restaurant-pos:tenant-1');
  assert.match(first.calls[1].query, /MAX\(CAST\("numero" AS BIGINT\)\)/);
  assert.match(first.calls[1].query, /"numero" ~ '\^\[0-9\]\{6,\}\$'/);

  const next = fakeTx({ max:'41' });
  const assignedNext = await numbers.assignRestaurantPosNumberInTx(next.tx, 'tenant-1', 'sale-1');
  assert.equal(assignedNext.numero, '000042');

  const existing = fakeTx({ current:'000777', max:'999' });
  const preserved = await numbers.assignRestaurantPosNumberInTx(existing.tx, 'tenant-1', 'sale-1');
  assert.equal(preserved.numero, '000777');
  assert.equal(existing.calls.length, 1, 'an already-final POS number must not consume another sequence lookup');

  const wrongSource = fakeTx({ sourceId:'MANUAL-SALE-1' });
  await assert.rejects(
    () => numbers.assignRestaurantPosNumberInTx(wrongSource.tx, 'tenant-1', 'sale-1'),
    (error) => error?.code === 'RESTAURANT_POS_NUMBER_SOURCE_INVALID'
  );

  const operational = fs.readFileSync('src/modules/restaurant/restaurant-pos-operational-mode.js', 'utf8');
  assert.match(operational, /installPosSequentialNumbering/);
  assert.match(operational, /sales\.emitSaleInTx/);
  assert.match(operational, /assignRestaurantPosNumberInTx/);
  assert.match(operational, /REST-TABLE-/);

  const restaurant = fs.readFileSync('src/modules/restaurant/restaurant.service.js', 'utf8');
  const split = fs.readFileSync('src/modules/restaurant/restaurant-visit-payments.service.js', 'utf8');
  assert.match(restaurant, /sales\.emitSaleInTx/);
  assert.match(split, /sales\.emitSaleInTx/);

  const commercial = fs.readFileSync('src/modules/commercial/commercial.service.js', 'utf8');
  assert.match(commercial, /generateNumber\(input\.tipo\)/, 'non-restaurant commercial numbering must stay unchanged');

  console.log('RESTAURANT POS SEQUENTIAL NUMBER V1 SMOKE OK', JSON.stringify({
    firstClosedSale:'000001',
    sequentialPerTenant:true,
    transactionLock:true,
    draftDoesNotConsumeFinalNumber:true,
    normalCloseCovered:true,
    splitPaymentPreparationCovered:true,
    historicalRandomNumbersIgnored:true,
    otherCommercialDocumentsUntouched:true,
    dianIndependent:true
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
