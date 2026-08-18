const express = require('express');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

// Endpoint raíz
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'API funcionando correctamente' });
});

// Endpoint de diagnóstico para verificar DB
app.get('/db-test', async (req, res) => {
  try {
    await prisma.$connect();
    res.json({ status: 'success', message: 'Conexión a PostgreSQL EXITOSA' });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Capturar errores no controlados para que Node NO SE APAGUE
process.on('uncaughtException', (err) => {
  console.error('Error no capturado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promesa rechazada no capturada:', reason);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
