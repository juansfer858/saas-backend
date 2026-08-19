require('dotenv').config();

const { app } = require('./src/app');
const { prisma } = require('./src/config/prisma');
const dianTransmission = require('./src/modules/platform/dian/dian-transmission.service');

const PORT = process.env.PORT || 3000;
const DIAN_QUEUE_INTERVAL_MS = Math.max(Number(process.env.DIAN_QUEUE_INTERVAL_MS) || 60000, 10000);
let dianWorkerBusy = false;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});

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

const dianTimer = setInterval(runDianQueue, DIAN_QUEUE_INTERVAL_MS);
dianTimer.unref?.();
setTimeout(runDianQueue, 2000).unref?.();

async function shutdown(signal) {
  console.log(`${signal} recibido. Cerrando servidor...`);
  clearInterval(dianTimer);

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
