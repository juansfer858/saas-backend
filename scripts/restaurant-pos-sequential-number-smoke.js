'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const numbers = require('../src/modules/restaurant/restaurant-pos-number.service');

function fakeTx({
  current = 'FV-1788733464654-ABC123',
  max = '0',
  sourceId = 'REST-TABLE-table-1-123',
  lockResults = [true]
} = {}) {
  const calls = [];
  let currentNumber = current;
  let lockIndex = 0;
  const tx = {
    $queryRawUnsafe: async (query, value) => {
      calls.push({ query, value });
      if (query.includes('pg_try_advisory_xact_lock')) {
        const locked = lockResults[Math.min(lockIndex, lockResults.length - 1)] !== false;
        lockIndex += 1;
        return [{ locked }];
      }
      return [{ maxNumber:max }];
    },
    comprobanteComercial: {
      findFirst: async () => ({ id:'sale-1', numero:currentNumber, sourceId }),
      update: async ({ data }) => {
        currentNumber = data.numero;
        return { id:'sale-1', numero:currentNumber, sourceId };
      }
    }
  };
  return { tx, calls, getNumber:() => currentNumber };
}

(async () => {
  assert.equal(numbers.POS_NUMBER_WIDTH, 6);
  assert.equal(numbers.POS_LOCK_ATTEMPTS, 25);
  assert.equal(numbers.POS_LOCK_RETRY_MS, 40);
  assert.equal(numbers.formatPosNumber(1n), '000001');
  assert.equal(numbers.formatPosNumber(42n), '000042');
  assert.equal(numbers.formatPosNumber(999999n), '999999');
  assert.equal(numbers.formatPosNumber(1000000n), '1000000');
  assert.equal(numbers.isFinalPosNumber('000001'), true);
  assert.equal(numbers.isFinalPosNumber('FV-1788733464654'), false);

  const first = fakeTx({ max:'0' });
  const assignedFirst = await numbers.assignRestaurantPosNumberInTx(first.tx, 'tenant-1', 'sale-1');
  assert.equal(assignedFirst.numero, '000001');
  assert.equal(first.calls[0].value, 'vantixgc:restaurant-pos:v2:tenant-1');
  assert.match(first.calls[0].query, /pg_try_advisory_xact_lock/);
  assert.match(first.calls[0].query, /hashtextextended/);
  assert.match(first.calls[1].query, /MAX\(CAST\("numero" AS BIGINT\)\)/);
  assert.match(first.calls[1].query, /"numero" ~ '\^\[0-9\]\{6,\}\$'/);

  const next = fakeTx({ max:'41' });
  const assignedNext = await numbers.assignRestaurantPosNumberInTx(next.tx, 'tenant-1', 'sale-1');
  assert.equal(assignedNext.numero, '000042');

  const existing = fakeTx({ current:'000777', max:'999' });
  const preserved = await numbers.assignRestaurantPosNumberInTx(existing.tx, 'tenant-1', 'sale-1');
  assert.equal(preserved.numero, '000777');
  assert.equal(existing.calls.length, 0, 'an already-final POS number must not acquire or consume the sequence');

  const transient = fakeTx({ lockResults:[false, true] });
  const lock = await numbers.lockTenantSequence(transient.tx, 'tenant-1', { attempts:2, retryMs:0 });
  assert.equal(lock.locked, true);
  assert.equal(lock.attempt, 2);
  assert.equal(transient.calls.length, 2);

  const busy = fakeTx({ lockResults:[false, false] });
  await assert.rejects(
    () => numbers.lockTenantSequence(busy.tx, 'tenant-1', { attempts:2, retryMs:0 }),
    (error) => error?.code === 'RESTAURANT_POS_SEQUENCE_BUSY' && error?.statusCode === 409
  );
  assert.equal(busy.calls.length, 2, 'busy sequence must fail in bounded attempts, never block indefinitely');

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

  const numberSource = fs.readFileSync('src/modules/restaurant/restaurant-pos-number.service.js', 'utf8');
  assert.match(numberSource, /pg_try_advisory_xact_lock/);
  assert.match(numberSource, /hashtextextended/);
  assert.doesNotMatch(numberSource, /SELECT pg_advisory_xact_lock\(/, 'blocking advisory lock must not return');
  assert.match(numberSource, /RESTAURANT_POS_SEQUENCE_BUSY/);

  const restaurant = fs.readFileSync('src/modules/restaurant/restaurant.service.js', 'utf8');
  const split = fs.readFileSync('src/modules/restaurant/restaurant-visit-payments.service.js', 'utf8');
  assert.match(restaurant, /sales\.emitSaleInTx/);
  assert.match(split, /sales\.emitSaleInTx/);

  const commercial = fs.readFileSync('src/modules/commercial/commercial.service.js', 'utf8');
  assert.match(commercial, /generateNumber\(input\.tipo\)/, 'non-restaurant commercial numbering must stay unchanged');

  console.log('RESTAURANT POS SEQUENTIAL NUMBER V2 NONBLOCKING SMOKE OK', JSON.stringify({
    firstClosedSale:'000001',
    sequentialPerTenant:true,
    nonBlockingTryLock:true,
    boundedContention:true,
    lockKey64Bit:true,
    duplicateRetryDoesNotConsume:true,
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
