const express = require('express');
const cors = require('cors');
const { prisma } = require('./config/prisma');
const { authRouter } = require('./modules/auth/auth.routes');
const { errorHandler } = require('./middleware/error-handler');

const app = express();

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'API funcionando correctamente' });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'saas-backend' });
});

app.get('/db-test', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'success', message: 'Conexión a PostgreSQL EXITOSA' });
  } catch (error) {
    console.error('DB TEST ERROR:', error);
    res.status(500).json({ status: 'error', error: error.message });
  }
});

app.use('/api/v1/auth', authRouter);
app.use(errorHandler);

module.exports = { app };
