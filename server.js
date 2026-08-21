require('dotenv').config();

const { app } = require('./src/app');
const { prisma } = require('./src/config/prisma');
const dianTransmission = require('./src/modules/platform/dian/dian-transmission.service');
const notifications = require('./src/modules/notifications/notifications.service');
const { ensureRestaurantDemoTenant } = require('./scripts/ensure-restaurant-demo-tenant');
const demoBootstrapState = require('./src/modules/restaurant/restaurant-demo-bootstrap-state');

const PORT = process.env.PORT || 3000;
const DIAN_QUEUE_INTERVAL_MS = Math.max(Number(process.env.DIAN_QUEUE_INTERVAL_MS) || 60000, 10000);
const NOTIFICATION_QUEUE_INTERVAL_MS = Math.max(Number(process.env.NOTIFICATION_QUEUE_INTERVAL_MS) || 30000, 5000);
const RESTAURANT_DEMO_RETRY_MS = Math.max(Number(process.env.RESTAURANT_DEMO_RETRY_MS) || 5000, 1000);
const RESTAURANT_DEMO_MAX_ATTEMPTS = Math.max(Number(process.env.RESTAURANT_DEMO_MAX_ATTEMPTS) || 12, 1);
let dianWorkerBusy = false;
let notificationWorkerBusy = false;
let server = null;
let dianTimer = null;
let notificationTimer = null;
let restaurantDemoTimer = null;

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

  restaurantDemoTimer = setTimeout(() => ensureRestaurantDemoInBackground(1), 0);
  restaurantDemoTimer.unref?.();
}

async function shutdown(signal) {
  console.log(`${signal} recibido. Cerrando servidor...`);
  if (dianTimer) clearInterval(dianTimer);
  if (notificationTimer) clearInterval(notificationTimer);
  if (restaurantDemoTimer) clearTimeout(restaurantDemoTimer);

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
