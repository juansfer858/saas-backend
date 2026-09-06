'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const numbers = require('../src/modules/restaurant/restaurant-pos-number.service');

async function main() {
  let signalLocked;
  let releaseHolder;
  const locked = new Promise((resolve) => { signalLocked = resolve; });
  const release = new Promise((resolve) => { releaseHolder = resolve; });
  const tenantKey = `ci-lock-${Date.now()}`;

  const holder = prisma.$transaction(async (tx) => {
    const acquired = await numbers.lockTenantSequence(tx, tenantKey, { attempts:1, retryMs:0 });
    assert.equal(acquired.locked, true);
    signalLocked();
    await release;
  });

  await locked;

  const started = Date.now();
  await prisma.$transaction(async (tx) => {
    await assert.rejects(
      () => numbers.lockTenantSequence(tx, tenantKey, { attempts:3, retryMs:20 }),
      (error) => error?.code === 'RESTAURANT_POS_SEQUENCE_BUSY' && error?.statusCode === 409
    );
  });
  const elapsedMs = Date.now() - started;
  assert.ok(elapsedMs < 1000, `contended lock must fail fast, elapsed=${elapsedMs}ms`);

  releaseHolder();
  await holder;

  await prisma.$transaction(async (tx) => {
    const acquired = await numbers.lockTenantSequence(tx, tenantKey, { attempts:1, retryMs:0 });
    assert.equal(acquired.locked, true, 'lock must be available immediately after holder transaction closes');
  });

  console.log('RESTAURANT POS POSTGRES NONBLOCKING LOCK SMOKE OK', JSON.stringify({
    realPostgres:true,
    contentionFailsFast:true,
    elapsedMs,
    lockReleasedWithTransaction:true
  }));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
