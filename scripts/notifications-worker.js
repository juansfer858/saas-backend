'use strict';

require('dotenv').config();
const { prisma } = require('../src/config/prisma');
const notifications = require('../src/modules/notifications/notifications.service');
const { startSingletonWorker } = require('../src/runtime/singleton-worker');

const intervalMs = Math.max(Number(process.env.NOTIFICATION_QUEUE_INTERVAL_MS) || 30000, 5000);
const runner = startSingletonWorker({
  name: 'notification-queue-v1',
  intervalMs,
  initialDelayMs: 500,
  task: async () => {
    const processed = await notifications.processQueue(Number(process.env.NOTIFICATION_QUEUE_BATCH_SIZE) || 25);
    if (processed.length) console.log(`NOTIFICATION_QUEUE processed=${processed.length}`);
  }
});

async function shutdown(signal) {
  console.log(`${signal} recibido. Cerrando Notifications worker...`);
  await runner.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
console.log('NOTIFICATION_WORKER_STARTED');
