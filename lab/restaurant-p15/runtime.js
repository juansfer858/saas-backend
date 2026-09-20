'use strict';

const path = require('node:path');
const express = require('express');
const { assertConfig, addressInCidr } = require('./runtime-config');

if (require.main === module) {
  require('dotenv').config({ path: process.env.P15_ENV_FILE || path.join(__dirname, '.env') });
}

function normalize(value) { return String(value ?? '').trim(); }

function tenantHeader(req) {
  return normalize(req?.headers?.['x-tenant-subdomain']).toLowerCase();
}

function clientBoundary(config) {
  return (req, res, next) => {
    const remote = normalize(req?.socket?.remoteAddress || req?.ip).replace(/^::ffff:/, '');
    if (!config.http.lanEnabled || addressInCidr(remote, config.http.lanCidr)) return next();
    return res.status(403).json({ ok: false, code: 'P15_LAN_CLIENT_DENIED', message: 'Dispositivo fuera de la LAN autorizada.' });
  };
}

function tenantBoundary(config) {
  return (req, res, next) => {
    res.set('X-VantixGC-P15', config.marker);
    res.set('X-VantixGC-P15-Installation', config.installationId);
    const requested = tenantHeader(req);
    if (requested && requested !== config.tenantSubdomain) {
      return res.status(403).json({ ok: false, code: 'P15_TENANT_LOCK_MISMATCH', message: 'Esta instalación pertenece a otro restaurante.' });
    }
    if (req.path.startsWith('/platform') || req.path.startsWith('/edge/api')) {
      return res.status(404).json({ ok: false, code: 'P15_CONTROL_PLANE_CLOUD_ONLY', message: 'El plano SaaS permanece fuera del servidor operativo local.' });
    }
    return next();
  };
}

async function start(env = process.env) {
  const config = assertConfig(env);

  process.env.JWT_SECRET = normalize(env.P15_JWT_SECRET || env.JWT_SECRET);
  if (!process.env.JWT_SECRET) throw new Error('P15_JWT_SECRET es obligatorio.');
  process.env.DIAN_EMBEDDED_WORKER_ENABLED = 'false';
  process.env.NOTIFICATION_EMBEDDED_WORKER_ENABLED = 'false';
  process.env.DISABLE_RESTAURANT_DEMO_BOOTSTRAP = 'true';
  process.env.PUBLIC_TENANT_REGISTRATION_ENABLED = 'false';
  process.env.VANTIX_P15_LOCAL_RUNTIME = 'true';

  const { app: canonicalApp } = require('../../src/app');
  const { prisma } = require('../../src/config/prisma');

  const local = express();
  local.disable('x-powered-by');
  local.use(clientBoundary(config));
  local.get('/__p15/status', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      marker: config.marker,
      installationId: config.installationId,
      tenantSubdomain: config.tenantSubdomain,
      authority: 'LOCAL_PRIMARY',
      internetRequiredForOperations: false,
      http: config.http,
      database: config.database,
      print: config.print,
      backup: { enabled: config.backup.enabled, uploadConfigured: Boolean(config.backup.uploadUrl) },
      services: ['SERVER','POSTGRESQL','PRINT','BACKUP']
    });
  });
  local.get('/', (_req, res) => res.redirect(302, '/app/centro-de-control-v2'));
  local.use(tenantBoundary(config));
  local.use(canonicalApp);

  const server = await new Promise((resolve, reject) => {
    const instance = local.listen(config.http.port, config.http.bindHost, () => resolve(instance));
    instance.once('error', reject);
  });

  console.log(`P15_RUNTIME_READY tenant=${config.tenantSubdomain} installation=${config.installationId} url=${config.http.localUrl}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`P15_RUNTIME_STOP signal=${signal}`);
    const force = setTimeout(() => process.exit(1), 15000);
    force.unref();
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('uncaughtException', (error) => {
    console.error('P15_UNCAUGHT_EXCEPTION', error?.stack || error);
    process.exitCode = 1;
  });
  process.once('unhandledRejection', (error) => {
    console.error('P15_UNHANDLED_REJECTION', error?.stack || error);
    process.exitCode = 1;
  });

  return { server, config };
}

if (require.main === module) {
  start(process.env).catch((error) => {
    console.error(`P15_RUNTIME_FAILED: ${error?.stack || error?.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = { start, clientBoundary, tenantBoundary };
