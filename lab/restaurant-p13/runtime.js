'use strict';

const path = require('node:path');
const express = require('express');

const LAB_MARKER = 'VANTIX_RESTAURANT_FULL_LOCAL_P13_A';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8790;
const REQUIRED_DB_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const REQUIRED_DB_PORT = 55432;
const REQUIRED_DB_NAME = 'vantix_p13_lab';

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function assertLabConfig(env = process.env) {
  if (!truthy(env.VANTIX_P13_LAB_ENABLED)) {
    throw new Error('P13 bloqueado: define VANTIX_P13_LAB_ENABLED=true para iniciar el laboratorio.');
  }
  if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    throw new Error('P13 bloqueado: el laboratorio no puede arrancar con NODE_ENV=production.');
  }

  const host = String(env.P13_HOST || DEFAULT_HOST).trim();
  const port = Number(env.P13_PORT || DEFAULT_PORT);
  if (!['127.0.0.1', '::1'].includes(host)) {
    throw new Error(`P13 bloqueado: P13_HOST debe ser loopback, recibido ${host}.`);
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 8788 || port === 3000) {
    throw new Error(`P13 bloqueado: puerto local inválido o reservado (${port}).`);
  }
  if (port !== DEFAULT_PORT) {
    throw new Error(`P13-A usa exclusivamente el puerto ${DEFAULT_PORT}; recibido ${port}.`);
  }
  if (truthy(env.P13_MUTATIONS_ENABLED)) {
    throw new Error('P13-A es solo lectura: P13_MUTATIONS_ENABLED debe permanecer false.');
  }

  if (!env.DATABASE_URL) throw new Error('P13 bloqueado: DATABASE_URL local es obligatoria.');
  let database;
  try { database = new URL(String(env.DATABASE_URL)); }
  catch { throw new Error('P13 bloqueado: DATABASE_URL no es una URL PostgreSQL válida.'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) {
    throw new Error('P13 bloqueado: DATABASE_URL debe usar PostgreSQL.');
  }
  if (!REQUIRED_DB_HOSTS.has(String(database.hostname || '').toLowerCase())) {
    throw new Error(`P13 bloqueado: la base debe ser local; recibido ${database.hostname}.`);
  }
  const dbPort = Number(database.port || 5432);
  if (dbPort !== REQUIRED_DB_PORT) {
    throw new Error(`P13 bloqueado: la base del laboratorio debe usar ${REQUIRED_DB_PORT}; recibido ${dbPort}.`);
  }
  const dbName = decodeURIComponent(String(database.pathname || '').replace(/^\//, '')).split('/')[0];
  if (dbName !== REQUIRED_DB_NAME) {
    throw new Error(`P13 bloqueado: la base debe llamarse ${REQUIRED_DB_NAME}; recibido ${dbName || '(vacío)'}.`);
  }

  return { host, port, dbHost: database.hostname, dbPort, dbName };
}

function installOutboundNetworkGuard() {
  if (typeof globalThis.fetch !== 'function' || globalThis.fetch.__vantixP13Guard) return;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const guardedFetch = async (input, init) => {
    let raw;
    if (typeof input === 'string' || input instanceof URL) raw = String(input);
    else raw = String(input?.url || '');
    let target;
    try { target = new URL(raw); }
    catch { throw new Error(`P13_OUTBOUND_BLOCKED: URL no válida ${raw}`); }
    const host = String(target.hostname || '').toLowerCase();
    if (!REQUIRED_DB_HOSTS.has(host)) {
      throw new Error(`P13_OUTBOUND_BLOCKED: ${target.origin}`);
    }
    return nativeFetch(input, init);
  };
  guardedFetch.__vantixP13Guard = true;
  globalThis.fetch = guardedFetch;
}

function isReadOnlyMethod(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
}

async function start() {
  const config = assertLabConfig(process.env);

  // P13-A must not run cloud workers, demo bootstraps or outbound provider calls.
  process.env.DIAN_EMBEDDED_WORKER_ENABLED = 'false';
  process.env.NOTIFICATION_EMBEDDED_WORKER_ENABLED = 'false';
  process.env.DISABLE_RESTAURANT_DEMO_BOOTSTRAP = 'true';
  process.env.PUBLIC_TENANT_REGISTRATION_ENABLED = 'false';
  installOutboundNetworkGuard();

  // This is the key P13 contract: use the exact same Core application graph and
  // checked-in Restaurant/Super Core assets. No Edge-only workspace is imported.
  const { app: canonicalCoreApp } = require('../../src/app');
  const { prisma } = require('../../src/config/prisma');

  const lab = express();
  lab.disable('x-powered-by');

  lab.get('/__p13/status', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-P13-Lab', LAB_MARKER);
    res.json({
      ok: true,
      marker: LAB_MARKER,
      phase: 'P13-A',
      readOnly: true,
      canonicalCoreApp: true,
      host: config.host,
      port: config.port,
      database: { host: config.dbHost, port: config.dbPort, name: config.dbName },
      productionEdgePortUntouched: 8788,
      publicQrPolicy: 'CLOUD_HYBRID_UNCHANGED'
    });
  });

  lab.use((req, res, next) => {
    res.set('X-VantixGC-P13-Lab', LAB_MARKER);

    // Global SaaS/platform control plane is intentionally not part of a restaurant
    // single-tenant runtime. Public QR also stays on its existing hybrid path.
    if (req.path === '/platform' || req.path.startsWith('/platform/') || req.path.startsWith('/edge/api/')) {
      return res.status(404).json({ ok: false, code: 'P13_CONTROL_PLANE_NOT_LOCAL', message: 'Ruta central fuera del runtime local del restaurante.' });
    }
    if (req.path.startsWith('/r/')) {
      return res.status(409).json({ ok: false, code: 'P13_PUBLIC_QR_HYBRID_UNCHANGED', message: 'El QR público no se mueve al laboratorio P13-A.' });
    }

    if (isReadOnlyMethod(req.method)) return next();

    // Login is the only POST allowed in P13-A and it authenticates solely against
    // the PostgreSQL local forced by assertLabConfig(). Every business mutation is locked.
    if (req.method === 'POST' && req.path === '/api/v1/auth/login') return next();

    return res.status(423).json({
      ok: false,
      code: 'P13_A_READ_ONLY',
      message: 'P13-A sirve el mismo Super Core/Restaurante en modo laboratorio, sin mutaciones.'
    });
  });

  lab.use(canonicalCoreApp);

  const server = await new Promise((resolve, reject) => {
    const instance = lab.listen(config.port, config.host, () => resolve(instance));
    instance.once('error', reject);
  });

  console.log(`P13_A_RUNTIME_READY marker=${LAB_MARKER} url=http://${config.host}:${config.port}`);

  const shutdown = async (signal) => {
    console.log(`P13_A_RUNTIME_STOP signal=${signal}`);
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return { server, config };
}

if (require.main === module) {
  require('dotenv').config({ path: process.env.P13_ENV_FILE || path.join(__dirname, '.env') });
  start().catch((error) => {
    console.error(`P13_A_RUNTIME_FAILED: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  LAB_MARKER,
  DEFAULT_HOST,
  DEFAULT_PORT,
  REQUIRED_DB_PORT,
  REQUIRED_DB_NAME,
  assertLabConfig,
  installOutboundNetworkGuard,
  start
};
