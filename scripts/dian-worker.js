'use strict';

require('dotenv').config();
const { prisma } = require('../src/config/prisma');
const dianTransmission = require('../src/modules/platform/dian/dian-transmission.service');
const { startSingletonWorker } = require('../src/runtime/singleton-worker');

const intervalMs = Math.max(Number(process.env.DIAN_QUEUE_INTERVAL_MS) || 60000, 10000);
const runner = startSingletonWorker({
  name: 'dian-queue-v1',
  intervalMs,
  initialDelayMs: 500,
  task: async () => {
    const processed = await dianTransmission.processQueue(Number(process.env.DIAN_QUEUE_BATCH_SIZE) || 25);
    if (processed.length) console.log(`DIAN_QUEUE processed=${processed.length}`);
  }
});

async function shutdown(signal) {
  console.log(`${signal} recibido. Cerrando DIAN worker...`);
  await runner.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
console.log('DIAN_WORKER_STARTED');
