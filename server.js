require('dotenv').config();

const { app } = require('./src/app');
const { prisma } = require('./src/config/prisma');
const dianTransmission = require('./src/modules/platform/dian/dian-transmission.service');
const notifications = require('./src/modules/notifications/notifications.service');
const { ensureRestaurantDemoTenant } = require('./scripts/ensure-restaurant-demo-tenant');

const PORT = process.env.PORT || 3000;
const DIAN_QUEUE_INTERVAL_MS = Math.max(Number(process.env.DIAN_QUEUE_INTERVAL_MS) || 60000, 10000);
const NOTIFICATION_QUEUE_INTERVAL_MS = Math.max(Number(process.env.NOTIFICATION_QUEUE_INTERVAL_MS) || 30000, 5000);
let dianWorkerBusy = false;
let notificationWorkerBusy = false;
let server = null;
let dianTimer = null;
let notificationTimer = null;

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

async function bootstrapRuntime() {
  if (String(process.env.DISABLE_RESTAURANT_DEMO_BOOTSTRAP || '').toLowerCase() !== 'true') {
    const demo = await ensureRestaurantDemoTenant();
    console.log(`RESTAURANT_DEMO_RUNTIME_READY subdomain=${demo.subdomain} tables=${demo.tables} menuItems=${demo.menuItems}`);
  }

  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
  });

  dianTimer = setInterval(runDianQueue, DIAN_QUEUE_INTERVAL_MS);
  dianTimer.unref?.();
  setTimeout(runDianQueue, 2000).unref?.();

  notificationTimer = setInterval(runNotificationQueue, NOTIFICATION_QUEUE_INTERVAL_MS);
  notificationTimer.unref?.();
  setTimeout(runNotificationQueue, 2500).unref?.();
}

async function shutdown(signal) {
  console.log(`${signal} recibido. Cerrando servidor...`);
  if (dianTimer) clearInterval(dianTimer);
  if (notificationTimer) clearInterval(notificationTimer);

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

bootstrapRuntime().catch(async (error) => {
  console.error(`RUNTIME_BOOTSTRAP_ERROR: ${error.stack || error.message}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
