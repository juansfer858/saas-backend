require('dotenv').config();

const { app } = require('./src/app');
const { prisma } = require('./src/config/prisma');
const dianTransmission = require('./src/modules/platform/dian/dian-transmission.service');
const notifications = require('./src/modules/notifications/notifications.service');
const { ensureRestaurantDemoTenant } = require('./scripts/ensure-restaurant-demo-tenant');
const { ensureRestaurantRuntimeSchema } = require('./scripts/ensure-restaurant-runtime-schema');
const { ensureEdgeRuntimeSchema } = require('./scripts/ensure-edge-runtime-schema');
const { ensureSelfServiceRuntimeSchema } = require('./scripts/ensure-self-service-runtime-schema');
const demoBootstrapState = require('./src/modules/restaurant/restaurant-demo-bootstrap-state');
const runtimeState = require('./src/runtime/runtime-state');
const { startSingletonWorker } = require('./src/runtime/singleton-worker');

const PORT = process.env.PORT || 3000;
const DIAN_QUEUE_INTERVAL_MS = Math.max(Number(process.env.DIAN_QUEUE_INTERVAL_MS) || 60000, 10000);
const NOTIFICATION_QUEUE_INTERVAL_MS = Math.max(Number(process.env.NOTIFICATION_QUEUE_INTERVAL_MS) || 30000, 5000);
const RESTAURANT_DEMO_RETRY_MS = Math.max(Number(process.env.RESTAURANT_DEMO_RETRY_MS) || 5000, 1000);
const RESTAURANT_DEMO_MAX_ATTEMPTS = Math.max(Number(process.env.RESTAURANT_DEMO_MAX_ATTEMPTS) || 12, 1);
const RESTAURANT_SCHEMA_STARTUP_RETRY_MS = Math.max(Number(process.env.RESTAURANT_SCHEMA_STARTUP_RETRY_MS) || 3000, 500);
const RESTAURANT_SCHEMA_STARTUP_MAX_ATTEMPTS = Math.max(Number(process.env.RESTAURANT_SCHEMA_STARTUP_MAX_ATTEMPTS) || 12, 1);
const EDGE_SCHEMA_RETRY_MS = Math.max(Number(process.env.EDGE_SCHEMA_RETRY_MS) || 5000, 1000);
const EDGE_SCHEMA_MAX_ATTEMPTS = Math.max(Number(process.env.EDGE_SCHEMA_MAX_ATTEMPTS) || 12, 1);
const SELF_SERVICE_SCHEMA_RETRY_MS = Math.max(Number(process.env.SELF_SERVICE_SCHEMA_RETRY_MS) || 5000, 1000);
const SELF_SERVICE_SCHEMA_MAX_ATTEMPTS = Math.max(Number(process.env.SELF_SERVICE_SCHEMA_MAX_ATTEMPTS) || 12, 1);

let server = null;
let restaurantDemoTimer = null;
let edgeSchemaTimer = null;
let selfServiceSchemaTimer = null;
let dianWorker = null;
let notificationWorker = null;
let shuttingDown = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envEnabled(name, fallback = true) {
  if (process.env[name] === undefined) return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(process.env[name]).trim().toLowerCase());
}

async function ensureRestaurantSchemaBeforeListen() {
  runtimeState.setPhase('PREPARING_RESTAURANT_SCHEMA');
  for (let attempt = 1; attempt <= RESTAURANT_SCHEMA_STARTUP_MAX_ATTEMPTS; attempt += 1) {
    try {
      const schema = await ensureRestaurantRuntimeSchema();
      if (schema.changed) console.log('RESTAURANT_SCHEMA_SYNC_APPLIED');
      console.log(`RESTAURANT_SCHEMA_STARTUP_READY attempt=${attempt}`);
      return schema;
    } catch (error) {
      const terminal = attempt >= RESTAURANT_SCHEMA_STARTUP_MAX_ATTEMPTS;
      runtimeState.setPhase('WAITING_FOR_RESTAURANT_SCHEMA', { attempt, error: error.message });
      console.error(`RESTAURANT_SCHEMA_STARTUP_RETRY attempt=${attempt} error=${error.message}`);
      if (terminal) throw error;
      await wait(RESTAURANT_SCHEMA_STARTUP_RETRY_MS);
    }
  }
  throw new Error('No fue posible preparar el esquema Restaurante antes de publicar el servidor');
}

async function ensureEdgeSchemaInBackground(attempt = 1) {
  try {
    const schema = await ensureEdgeRuntimeSchema();
    if (schema.changed) console.log('EDGE_SCHEMA_SYNC_APPLIED');
    console.log(`EDGE_SCHEMA_RUNTIME_READY attempt=${attempt}`);
  } catch (error) {
    const terminal = attempt >= EDGE_SCHEMA_MAX_ATTEMPTS;
    console.error(`EDGE_SCHEMA_RUNTIME_RETRY attempt=${attempt} error=${error.message}`);
    if (!terminal) {
      edgeSchemaTimer = setTimeout(() => ensureEdgeSchemaInBackground(attempt + 1), EDGE_SCHEMA_RETRY_MS);
      edgeSchemaTimer.unref?.();
    } else {
      console.error(`EDGE_SCHEMA_RUNTIME_FAILED attempts=${attempt}`);
    }
  }
}

async function ensureSelfServiceSchemaInBackground(attempt = 1) {
  try {
    const schema = await ensureSelfServiceRuntimeSchema();
    if (schema.changed) console.log('SELF_SERVICE_SCHEMA_SYNC_APPLIED');
    console.log(`SELF_SERVICE_SCHEMA_RUNTIME_READY attempt=${attempt}`);
  } catch (error) {
    const terminal = attempt >= SELF_SERVICE_SCHEMA_MAX_ATTEMPTS;
    console.error(`SELF_SERVICE_SCHEMA_RUNTIME_RETRY attempt=${attempt} error=${error.message}`);
    if (!terminal) {
      selfServiceSchemaTimer = setTimeout(() => ensureSelfServiceSchemaInBackground(attempt + 1), SELF_SERVICE_SCHEMA_RETRY_MS);
      selfServiceSchemaTimer.unref?.();
    } else {
      console.error(`SELF_SERVICE_SCHEMA_RUNTIME_FAILED attempts=${attempt}`);
    }
  }
}

async function ensureRestaurantDemoInBackground(attempt = 1) {
  const disabled = String(process.env.DISABLE_RESTAURANT_DEMO_BOOTSTRAP || '').toLowerCase() === 'true';
  demoBootstrapState.setEnabled(!disabled);
  if (disabled) {
    console.warn('RESTAURANT_DEMO_RUNTIME_DISABLED');
    return;
  }

  demoBootstrapState.markStart(attempt);
  try {
    const demo = await ensureRestaurantDemoTenant();
    demoBootstrapState.markReady();
    console.log(`RESTAURANT_DEMO_RUNTIME_READY subdomain=${demo.subdomain} tables=${demo.tables} menuItems=${demo.menuItems} attempt=${attempt}`);
  } catch (error) {
    const terminal = attempt >= RESTAURANT_DEMO_MAX_ATTEMPTS;
    demoBootstrapState.markError(error, terminal);
    console.error(`RESTAURANT_DEMO_RUNTIME_RETRY attempt=${attempt} error=${error.message}`);
    if (!terminal) {
      restaurantDemoTimer = setTimeout(() => ensureRestaurantDemoInBackground(attempt + 1), RESTAURANT_DEMO_RETRY_MS);
      restaurantDemoTimer.unref?.();
    } else {
      console.error(`RESTAURANT_DEMO_RUNTIME_FAILED attempts=${attempt}`);
    }
  }
}

function startEmbeddedWorkers() {
  if (envEnabled('DIAN_EMBEDDED_WORKER_ENABLED', true)) {
    dianWorker = startSingletonWorker({
      name: 'dian-queue-v1',
      intervalMs: DIAN_QUEUE_INTERVAL_MS,
      initialDelayMs: 2000,
      task: async () => {
        const processed = await dianTransmission.processQueue(Number(process.env.DIAN_QUEUE_BATCH_SIZE) || 25);
        if (processed.length) console.log(`DIAN_QUEUE processed=${processed.length}`);
      }
    });
  } else {
    console.log('DIAN_EMBEDDED_WORKER_DISABLED');
  }

  if (envEnabled('NOTIFICATION_EMBEDDED_WORKER_ENABLED', true)) {
    notificationWorker = startSingletonWorker({
      name: 'notification-queue-v1',
      intervalMs: NOTIFICATION_QUEUE_INTERVAL_MS,
      initialDelayMs: 2500,
      task: async () => {
        const processed = await notifications.processQueue(Number(process.env.NOTIFICATION_QUEUE_BATCH_SIZE) || 25);
        if (processed.length) console.log(`NOTIFICATION_QUEUE processed=${processed.length}`);
      }
    });
  } else {
    console.log('NOTIFICATION_EMBEDDED_WORKER_DISABLED');
  }
}

app.get('/healthz', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, status: 'alive', runtime: runtimeState.snapshot() });
});

app.get('/readyz', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const runtime = runtimeState.snapshot();
  if (!runtime.ready) return res.status(503).json({ ok: false, status: 'not_ready', runtime });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({ ok: true, status: 'ready', database: 'OK', runtime });
  } catch (error) {
    return res.status(503).json({ ok: false, status: 'not_ready', database: 'ERROR', error: error.message, runtime });
  }
});

app.get('/api/public/runtime-info', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, data: runtimeState.snapshot() });
});

async function startRuntime() {
  runtimeState.markNotReady('BOOTING');

  // Restaurante is a user-facing critical surface. Do not accept HTTP traffic until
  // its runtime schema is present; otherwise the first requests after a deploy can
  // hit Prisma before the schema is ready and surface transient HTTP 500 errors.
  await ensureRestaurantSchemaBeforeListen();

  runtimeState.setPhase('STARTING_HTTP');
  await new Promise((resolve, reject) => {
    server = app.listen(PORT, '0.0.0.0', () => {
      runtimeState.markReady();
      console.log(`Servidor activo en el puerto ${PORT}`);
      console.log(`CORE_RUNTIME_READY ${JSON.stringify(runtimeState.snapshot())}`);
      resolve();
    });
    server.once('error', reject);
  });

  startEmbeddedWorkers();

  edgeSchemaTimer = setTimeout(() => ensureEdgeSchemaInBackground(1), 0);
  edgeSchemaTimer.unref?.();

  selfServiceSchemaTimer = setTimeout(() => ensureSelfServiceSchemaInBackground(1), 0);
  selfServiceSchemaTimer.unref?.();

  // Demo data stays non-blocking. Only the schema required by real Restaurant traffic
  // is a startup gate.
  restaurantDemoTimer = setTimeout(() => ensureRestaurantDemoInBackground(1), 0);
  restaurantDemoTimer.unref?.();
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  runtimeState.markNotReady('SHUTTING_DOWN', { signal });
  console.log(`${signal} recibido. Cerrando servidor...`);

  if (restaurantDemoTimer) clearTimeout(restaurantDemoTimer);
  if (edgeSchemaTimer) clearTimeout(edgeSchemaTimer);
  if (selfServiceSchemaTimer) clearTimeout(selfServiceSchemaTimer);

  await Promise.allSettled([
    dianWorker?.stop?.(),
    notificationWorker?.stop?.()
  ]);

  if (!server) {
    await prisma.$disconnect();
    process.exit(0);
    return;
  }

  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startRuntime().catch(async (error) => {
  runtimeState.markNotReady('STARTUP_FAILED', { error: error.message });
  console.error(`CORE_STARTUP_FAILED: ${error.message}`);
  try { await dianWorker?.stop?.(); } catch {}
  try { await notificationWorker?.stop?.(); } catch {}
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
