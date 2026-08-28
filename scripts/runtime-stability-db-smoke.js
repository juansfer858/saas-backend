const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { acquireLease } = require('../src/runtime/singleton-worker');

const PORT = 31888;
const BASE = `http://127.0.0.1:${PORT}`;

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForHttp(path, attempts = 80) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(BASE + path);
      if (response.status < 500) return response;
    } catch (error) { lastError = error; }
    await wait(100);
  }
  throw lastError || new Error(`Timeout waiting for ${path}`);
}

async function main() {
  const leaseName = `runtime-stability-${Date.now()}`;
  const first = await acquireLease(leaseName);
  assert.ok(first, 'first process must acquire singleton worker lease');
  const second = await acquireLease(leaseName);
  assert.equal(second, null, 'second process must remain standby while lease is held');
  await first.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [leaseName]);
  await first.end();
  const third = await acquireLease(leaseName);
  assert.ok(third, 'lease must become available after owner releases it');
  await third.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [leaseName]);
  await third.end();

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      DISABLE_RESTAURANT_DEMO_BOOTSTRAP: 'true',
      DIAN_EMBEDDED_WORKER_ENABLED: 'false',
      NOTIFICATION_EMBEDDED_WORKER_ENABLED: 'false',
      SOURCE_COMMIT: 'runtime-stability-ci'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    const health = await waitForHttp('/healthz');
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.ok, true);
    assert.equal(healthBody.runtime.commit, 'runtime-stability-ci');

    const ready = await waitForHttp('/readyz');
    assert.equal(ready.status, 200);
    const readyBody = await ready.json();
    assert.equal(readyBody.ok, true);
    assert.equal(readyBody.database, 'OK');
    assert.equal(readyBody.runtime.ready, true);

    const info = await fetch(BASE + '/api/public/runtime-info');
    assert.equal(info.status, 200);
    const infoBody = await info.json();
    assert.equal(infoBody.data.commit, 'runtime-stability-ci');
    assert.equal(infoBody.data.phase, 'READY');
    assert.match(output, /CORE_RUNTIME_READY/);

    console.log('SAAS RUNTIME STABILITY POSTGRESQL SMOKE OK');
    console.log(JSON.stringify({ singletonWorkerLease: true, liveness: true, readiness: true, databaseReadiness: true, buildIdentity: true }, null, 2));
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      wait(5000).then(() => child.kill('SIGKILL'))
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
