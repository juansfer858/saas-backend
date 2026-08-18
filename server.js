require('dotenv').config();

const { app } = require('./src/app');
const { prisma } = require('./src/config/prisma');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});

async function shutdown(signal) {
  console.log(`${signal} recibido. Cerrando servidor...`);

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
