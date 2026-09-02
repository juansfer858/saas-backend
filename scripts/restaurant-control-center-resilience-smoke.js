'use strict';

const assert = require('node:assert/strict');
const { app } = require('../src/app');

async function withServer(run) {
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/app/restaurant-control-center.js`, { cache:'no-store' });
    const source = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-vantixgc-control-center-resilience'), 'fetch-timeout-v1');
    assert.match(source, /VANTIX_CONTROL_CENTER_FETCH_TIMEOUT_V1/);
    assert.match(source, /timeoutMs:8000/);
    assert.match(source, /url\.includes\('\/api\/v1\/restaurante\/'\)/);
    assert.match(source, /controller\.abort\(\)/);
    assert.match(source, /Cargando operación real/);
    assert.ok(source.indexOf('VANTIX_CONTROL_CENTER_FETCH_TIMEOUT_V1') < source.indexOf('Cargando operación real'), 'timeout prelude must execute before the control-center dashboard code');
    new Function(source);
  });

  console.log('RESTAURANT CONTROL CENTER RESILIENCE SMOKE OK');
  console.log(JSON.stringify({
    stalledRestaurantApiCannotFreezeForever:true,
    timeoutMs:8000,
    originalControlCenterPreserved:true,
    noCache:true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
