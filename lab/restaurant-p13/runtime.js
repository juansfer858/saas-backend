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
    throw new Error(`P13 usa exclusivamente el puerto ${DEFAULT_PORT} durante el laboratorio aislado; recibido ${port}.`);
  }
  if (truthy(env.P13_MUTATIONS_ENABLED)) {
    throw new Error('P13 bloqueado: P13_MUTATIONS_ENABLED debe permanecer false; las fronteras se abren explícitamente una a una.');
  }

  const tenantSubdomain = String(env.P13_TENANT_SUBDOMAIN || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenantSubdomain)) {
    throw new Error('P13 bloqueado: P13_TENANT_SUBDOMAIN es obligatorio y debe identificar un único tenant local.');
  }
  const jwtSecret = String(env.P13_JWT_SECRET || '');
  if (jwtSecret.length < 32) {
    throw new Error('P13 bloqueado: P13_JWT_SECRET debe tener al menos 32 caracteres y ser exclusivo del laboratorio.');
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

  return { host, port, tenantSubdomain, jwtSecret, dbHost: database.hostname, dbPort, dbName };
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

function tenantHeader(req) {
  return String(req.headers['x-tenant-subdomain'] || '').trim().toLowerCase();
}

function mutationBoundaryForRequest(method, rawPath) {
  const verb = String(method || '').toUpperCase();
  const pathname = String(rawPath || '').split('?')[0];

  if (verb === 'POST' && pathname === '/api/v1/auth/login') return 'AUTH_LOGIN';
  if (verb === 'POST' && pathname === '/api/v1/usuarios') return 'IDENTITY_USERS';
  if (verb === 'PATCH' && /^\/api\/v1\/usuarios\/[^/]+$/.test(pathname)) return 'IDENTITY_USERS';
  if (verb === 'POST' && pathname === '/api/v1/seguridad/roles') return 'IDENTITY_RBAC';
  if (verb === 'PUT' && /^\/api\/v1\/seguridad\/roles\/[^/]+\/permisos$/.test(pathname)) return 'IDENTITY_RBAC';
  if (verb === 'PUT' && /^\/api\/v1\/seguridad\/usuarios\/[^/]+\/(?:roles|permisos)$/.test(pathname)) return 'IDENTITY_RBAC';
  if (verb === 'POST' && /^\/api\/v1\/restaurante\/mesas\/[^/]+\/abrir$/.test(pathname)) return 'RESTAURANT_TABLE_VISIT';
  if (verb === 'PATCH' && /^\/api\/v1\/restaurante\/sesiones\/[^/]+\/servicio$/.test(pathname)) return 'RESTAURANT_ORDER_PERSON';
  if (verb === 'PUT' && /^\/api\/v1\/restaurante\/sesiones\/[^/]+\/pedido-borrador\/items\/[^/]+$/.test(pathname)) return 'RESTAURANT_ORDER_DRAFT';
  if (verb === 'PATCH' && /^\/api\/v1\/restaurante\/sesiones\/[^/]+\/items\/[^/]+$/.test(pathname)) return 'RESTAURANT_ORDER_ITEM_META';
  if (verb === 'POST' && /^\/api\/v1\/restaurante\/sesiones\/[^/]+\/pedido-borrador\/enviar$/.test(pathname)) return 'RESTAURANT_ORDER_SEND';
  return null;
}

async function start() {
  const config = assertLabConfig(process.env);

  process.env.JWT_SECRET = config.jwtSecret;
  process.env.DIAN_EMBEDDED_WORKER_ENABLED = 'false';
  process.env.NOTIFICATION_EMBEDDED_WORKER_ENABLED = 'false';
  process.env.DISABLE_RESTAURANT_DEMO_BOOTSTRAP = 'true';
  process.env.PUBLIC_TENANT_REGISTRATION_ENABLED = 'false';
  installOutboundNetworkGuard();

  // El runtime local monta exactamente el mismo grafo canónico que Core.
  // P13 sólo controla qué fronteras pueden mutar durante cada etapa aislada.
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
      phase: 'P13-E3',
      mutationMode: 'IDENTITY_TABLE_VISIT_AND_ORDER_DRAFT',
      mutationBoundaries: [
        'AUTH_LOGIN',
        'IDENTITY_USERS',
        'IDENTITY_RBAC',
        'RESTAURANT_TABLE_VISIT',
        'RESTAURANT_ORDER_PERSON',
        'RESTAURANT_ORDER_DRAFT',
        'RESTAURANT_ORDER_ITEM_META',
        'RESTAURANT_ORDER_SEND'
      ],
      allOtherBusinessMutations: 'LOCKED',
      canonicalCoreApp: true,
      tenantSubdomain: config.tenantSubdomain,
      host: config.host,
      port: config.port,
      database: { host: config.dbHost, port: config.dbPort, name: config.dbName },
      productionEdgePortUntouched: 8788,
      publicQrPolicy: 'CLOUD_HYBRID_UNCHANGED'
    });
  });

  lab.use((req, res, next) => {
    res.set('X-VantixGC-P13-Lab', LAB_MARKER);
    res.set('X-VantixGC-P13-Tenant', config.tenantSubdomain);

    const requestedTenant = tenantHeader(req);
    if (requestedTenant && requestedTenant !== config.tenantSubdomain) {
      return res.status(403).json({
        ok: false,
        code: 'P13_TENANT_LOCK_MISMATCH',
        message: 'Este runtime local pertenece a otro tenant.'
      });
    }

    if (req.path === '/platform' || req.path.startsWith('/platform/') || req.path.startsWith('/edge/api/')) {
      return res.status(404).json({ ok: false, code: 'P13_CONTROL_PLANE_NOT_LOCAL', message: 'Ruta central fuera del runtime local del restaurante.' });
    }
    if (req.path.startsWith('/r/')) {
      return res.status(409).json({ ok: false, code: 'P13_PUBLIC_QR_HYBRID_UNCHANGED', message: 'El QR público permanece en Core y no se mueve al runtime local.' });
    }

    if (isReadOnlyMethod(req.method)) return next();

    const boundary = mutationBoundaryForRequest(req.method, req.path);
    if (boundary) {
      if (!requestedTenant) {
        return res.status(400).json({ ok: false, code: 'P13_TENANT_HEADER_REQUIRED', message: 'Falta el tenant local.' });
      }
      res.set('X-VantixGC-P13-Mutation-Boundary', boundary);
      return next();
    }

    return res.status(423).json({
      ok: false,
      code: 'P13_BOUNDARY_LOCKED',
      message: 'Esta frontera de negocio todavía no está habilitada en el laboratorio Full Local.'
    });
  });

  lab.use(canonicalCoreApp);

  const server = await new Promise((resolve, reject) => {
    const instance = lab.listen(config.port, config.host, () => resolve(instance));
    instance.once('error', reject);
  });

  console.log(`P13_E3_RUNTIME_READY marker=${LAB_MARKER} tenant=${config.tenantSubdomain} url=http://${config.host}:${config.port}`);

  const shutdown = async (signal) => {
    console.log(`P13_E3_RUNTIME_STOP signal=${signal}`);
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
    console.error(`P13_E3_RUNTIME_FAILED: ${error.message}`);
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
  tenantHeader,
  mutationBoundaryForRequest,
  start
};