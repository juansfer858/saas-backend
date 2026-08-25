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

const PORT = process.env.PORT || 3000;
const DIAN_QUEUE_INTERVAL_MS = Math.max(Number(process.env.DIAN_QUEUE_INTERVAL_MS) || 60000, 10000);
const NOTIFICATION_QUEUE_INTERVAL_MS = Math.max(Number(process.env.NOTIFICATION_QUEUE_INTERVAL_MS) || 30000, 5000);
const RESTAURANT_DEMO_RETRY_MS = Math.max(Number(process.env.RESTAURANT_DEMO_RETRY_MS) || 5000, 1000);
const RESTAURANT_DEMO_MAX_ATTEMPTS = Math.max(Number(process.env.RESTAURANT_DEMO_MAX_ATTEMPTS) || 12, 1);
const EDGE_SCHEMA_RETRY_MS = Math.max(Number(process.env.EDGE_SCHEMA_RETRY_MS) || 5000, 1000);
const EDGE_SCHEMA_MAX_ATTEMPTS = Math.max(Number(process.env.EDGE_SCHEMA_MAX_ATTEMPTS) || 12, 1);
const SELF_SERVICE_SCHEMA_RETRY_MS = Math.max(Number(process.env.SELF_SERVICE_SCHEMA_RETRY_MS) || 5000, 1000);
const SELF_SERVICE_SCHEMA_MAX_ATTEMPTS = Math.max(Number(process.env.SELF_SERVICE_SCHEMA_MAX_ATTEMPTS) || 12, 1);
let dianWorkerBusy = false;
let notificationWorkerBusy = false;
let server = null;
let dianTimer = null;
let notificationTimer = null;
let restaurantDemoTimer = null;
let edgeSchemaTimer = null;
let selfServiceSchemaTimer = null;

async function runDianQueue() {
  if (dianWorkerBusy) return;
  dianWorkerBusy = true;
  try {
    const processed = await dianTransmission.processQueue(Number(process.env.DIAN_QUEUE_BATCH_SIZE) || 25);
    if (processed.length) console.log(`DIAN_QUEUE processed=${processed.length}`);
  } catch (error) {
    console.error(`DIAN_QUEUE_ERROR: ${error.message}`);
  } finally {
    dianWorkerBusy = false;
  }
}

async function runNotificationQueue() {
  if (notificationWorkerBusy) return;
  notificationWorkerBusy = true;
  try {
    const processed = await notifications.processQueue(Number(process.env.NOTIFICATION_QUEUE_BATCH_SIZE) || 25);
    if (processed.length) console.log(`NOTIFICATION_QUEUE processed=${processed.length}`);
  } catch (error) {
    console.error(`NOTIFICATION_QUEUE_ERROR: ${error.message}`);
  } finally {
    notificationWorkerBusy = false;
  }
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
    const schema = await ensureRestaurantRuntimeSchema();
    if (schema.changed) console.log('RESTAURANT_SCHEMA_SYNC_APPLIED');
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

function startRuntime() {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
  });

  dianTimer = setInterval(runDianQueue, DIAN_QUEUE_INTERVAL_MS);
  dianTimer.unref?.();
  setTimeout(runDianQueue, 2000).unref?.();

  notificationTimer = setInterval(runNotificationQueue, NOTIFICATION_QUEUE_INTERVAL_MS);
  notificationTimer.unref?.();
  setTimeout(runNotificationQueue, 2500).unref?.();

  edgeSchemaTimer = setTimeout(() => ensureEdgeSchemaInBackground(1), 0);
  edgeSchemaTimer.unref?.();

  selfServiceSchemaTimer = setTimeout(() => ensureSelfServiceSchemaInBackground(1), 0);
  selfServiceSchemaTimer.unref?.();

  restaurantDemoTimer = setTimeout(() => ensureRestaurantDemoInBackground(1), 0);
  restaurantDemoTimer.unref?.();
}

async function shutdown(signal) {
  console.log(`${signal} recibido. Cerrando servidor...`);
  if (dianTimer) clearInterval(dianTimer);
  if (notificationTimer) clearInterval(notificationTimer);
  if (restaurantDemoTimer) clearTimeout(restaurantDemoTimer);
  if (edgeSchemaTimer) clearTimeout(edgeSchemaTimer);
  if (selfServiceSchemaTimer) clearTimeout(selfServiceSchemaTimer);

  if (!server) {
    await prisma.$disconnect();
    process.exit(0);
    return;
  }

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startRuntime();
