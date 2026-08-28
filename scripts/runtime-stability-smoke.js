const assert = require('node:assert/strict');
const fs = require('node:fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const server = fs.readFileSync('server.js', 'utf8');
const runtimeState = fs.readFileSync('src/runtime/runtime-state.js', 'utf8');
const singletonWorker = fs.readFileSync('src/runtime/singleton-worker.js', 'utf8');
const restaurantHtml = fs.readFileSync('src/web/restaurant.html', 'utf8');

assert.equal(pkg.scripts.start, 'node server.js', 'web start must not run tenant seeds or db push');
assert.ok(pkg.scripts.release.includes('prisma db push'), 'schema/data preparation must have an explicit release command while migrations baseline is pending');
assert.ok(pkg.scripts['worker:dian']);
assert.ok(pkg.scripts['worker:notifications']);

for (const token of [
  "app.get('/healthz'",
  "app.get('/readyz'",
  "app.get('/api/public/runtime-info'",
  'runtimeState.markReady()',
  "runtimeState.markNotReady('SHUTTING_DOWN'",
  'CORE_RUNTIME_READY',
  'DIAN_EMBEDDED_WORKER_ENABLED',
  'NOTIFICATION_EMBEDDED_WORKER_ENABLED',
  "name: 'dian-queue-v1'",
  "name: 'notification-queue-v1'"
]) assert.ok(server.includes(token), `runtime stabilization must contain ${token}`);

assert.ok(server.indexOf('await ensureRestaurantSchemaBeforeListen()') < server.indexOf('app.listen(PORT'), 'critical Restaurant schema must be checked before HTTP is published');
assert.ok(runtimeState.includes('SOURCE_COMMIT'));
assert.ok(runtimeState.includes('uptimeSeconds'));
assert.ok(singletonWorker.includes('pg_try_advisory_lock'));
assert.ok(singletonWorker.includes('pg_advisory_unlock'));

assert.ok(restaurantHtml.includes('Resilience layer: only retries idempotent Restaurant GETs'));
assert.ok(restaurantHtml.includes("new Set([429,500,502,503,504])"));
assert.ok(restaurantHtml.includes("method!=='GET'&&method!=='HEAD'"), 'mutations must never be automatically replayed');
assert.ok(restaurantHtml.includes('vantixgc:api-final-unavailable'));
assert.ok(restaurantHtml.includes('Reconectando con VantixGC'));

console.log('SAAS RUNTIME STABILITY V1 SMOKE OK');
console.log(JSON.stringify({
  webStartSeparatedFromRelease: true,
  livenessReadiness: true,
  buildIdentity: true,
  singletonWorkerLease: true,
  workersCanBeSeparated: true,
  restaurantReadRetryOnly: true,
  mutationsNeverRetried: true
}, null, 2));
