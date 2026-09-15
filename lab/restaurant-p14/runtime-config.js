'use strict';

const net = require('node:net');
const {
  assertRestaurantLocalFirstP14
} = require('../../src/modules/restaurant/restaurant-local-first-p14-gate');

const P14_RUNTIME_CONTRACT = Object.freeze({
  marker: 'VANTIX_RESTAURANT_LOCAL_FIRST_P14_HOME_PILOT',
  httpPort: 8790,
  productionEdgePort: 8788,
  postgresPort: 55432,
  postgresDatabase: 'vantix_p14_home_pilot',
  tenantSubdomain: 'demo-restaurante',
  installationId: 'HOME-PILOT-01',
  releaseChannel: 'PILOT',
  operationalMode: 'LOCAL_FIRST',
  coreUrl: 'https://core.vantixgc.com'
});

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const LAN_BIND_HOST = '0.0.0.0';

function normalize(value) {
  return String(value || '').trim();
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalize(value).toLowerCase());
}

function isPrivateIpv4(value) {
  if (net.isIP(value) !== 4) return false;
  const parts = value.split('.').map(Number);
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return parts[0] === 192 && parts[1] === 168;
}

function parsePrivateCidr(value) {
  const raw = normalize(value);
  const match = raw.match(/^([^/]+)\/(\d{1,2})$/);
  if (!match) return null;
  const prefix = Number(match[2]);
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 32) return null;
  if (!isPrivateIpv4(match[1])) return null;
  return Object.freeze({ raw, network: match[1], prefix });
}

function parseLocalDatabase(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(normalize(databaseUrl));
  } catch {
    throw new Error('P14 bloqueado: DATABASE_URL no es una URL PostgreSQL válida.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('P14 bloqueado: DATABASE_URL debe usar PostgreSQL.');
  }

  const host = normalize(parsed.hostname).toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`P14 bloqueado: PostgreSQL debe permanecer local; recibido ${host || '(vacío)'}.`);
  }

  const port = Number(parsed.port || 5432);
  if (port !== P14_RUNTIME_CONTRACT.postgresPort) {
    throw new Error(`P14 bloqueado: PostgreSQL debe usar ${P14_RUNTIME_CONTRACT.postgresPort}; recibido ${port}.`);
  }

  const database = decodeURIComponent(normalize(parsed.pathname).replace(/^\//, '')).split('/')[0];
  if (database !== P14_RUNTIME_CONTRACT.postgresDatabase) {
    throw new Error(`P14 bloqueado: la base debe llamarse ${P14_RUNTIME_CONTRACT.postgresDatabase}; recibido ${database || '(vacío)'}.`);
  }

  return Object.freeze({ host, port, database });
}

function assertRuntimeSecrets(env) {
  const jwtSecret = normalize(env.P14_JWT_SECRET);
  if (jwtSecret.length < 32) {
    throw new Error('P14 bloqueado: P14_JWT_SECRET debe tener al menos 32 caracteres.');
  }

  const adminPassword = normalize(env.P14_ADMIN_PASSWORD);
  if (adminPassword.length < 12) {
    throw new Error('P14 bloqueado: P14_ADMIN_PASSWORD debe tener al menos 12 caracteres.');
  }

  return Object.freeze({ jwtSecret, adminPassword });
}

function assertRestaurantP14RuntimeConfig(env = process.env) {
  if (!truthy(env.P14_RUNTIME_ENABLED)) {
    throw new Error('P14 bloqueado: define P14_RUNTIME_ENABLED=true para iniciar el piloto local.');
  }

  const pilot = assertRestaurantLocalFirstP14({
    tenantSubdomain: env.P14_TENANT_SUBDOMAIN,
    installationId: env.P14_INSTALLATION_ID,
    releaseChannel: env.P14_RELEASE_CHANNEL,
    operationalMode: env.P14_OPERATIONAL_MODE
  }, env);

  const httpPort = Number(env.P14_HTTP_PORT || P14_RUNTIME_CONTRACT.httpPort);
  if (!Number.isInteger(httpPort) || httpPort !== P14_RUNTIME_CONTRACT.httpPort) {
    throw new Error(`P14 bloqueado: el piloto usa exclusivamente el puerto ${P14_RUNTIME_CONTRACT.httpPort}; recibido ${httpPort}.`);
  }
  if (httpPort === P14_RUNTIME_CONTRACT.productionEdgePort) {
    throw new Error('P14 bloqueado: el puerto productivo 8788 no puede utilizarse.');
  }

  const lanEnabled = truthy(env.P14_LAN_ENABLED);
  const bindHost = normalize(env.P14_BIND_HOST || (lanEnabled ? LAN_BIND_HOST : '127.0.0.1')).toLowerCase();
  let advertiseHost = normalize(env.P14_ADVERTISE_HOST || '127.0.0.1').toLowerCase();
  let lanCidr = null;

  if (lanEnabled) {
    if (bindHost !== LAN_BIND_HOST) {
      throw new Error('P14 bloqueado: con LAN activa, P14_BIND_HOST debe ser 0.0.0.0 y el firewall debe limitar la subred privada.');
    }
    if (!isPrivateIpv4(advertiseHost)) {
      throw new Error(`P14 bloqueado: P14_ADVERTISE_HOST debe ser una IPv4 privada; recibido ${advertiseHost || '(vacío)'}.`);
    }
    lanCidr = parsePrivateCidr(env.P14_LAN_CIDR);
    if (!lanCidr) {
      throw new Error('P14 bloqueado: P14_LAN_CIDR debe ser una subred IPv4 privada válida, por ejemplo 192.168.1.0/24.');
    }
  } else {
    if (!LOOPBACK_HOSTS.has(bindHost)) {
      throw new Error(`P14 bloqueado: sin LAN activa, P14_BIND_HOST debe ser loopback; recibido ${bindHost}.`);
    }
    advertiseHost = '127.0.0.1';
  }

  if (truthy(env.P14_SYNC_ENABLED)) {
    throw new Error('P14 bloqueado: P14_SYNC_ENABLED debe permanecer false hasta completar la frontera P14-3.');
  }

  const coreUrl = normalize(env.P14_CORE_URL || P14_RUNTIME_CONTRACT.coreUrl).replace(/\/$/, '');
  if (coreUrl !== P14_RUNTIME_CONTRACT.coreUrl) {
    throw new Error(`P14 bloqueado: Core debe ser ${P14_RUNTIME_CONTRACT.coreUrl}; recibido ${coreUrl || '(vacío)'}.`);
  }

  const database = parseLocalDatabase(env.DATABASE_URL);
  const secrets = assertRuntimeSecrets(env);

  return Object.freeze({
    marker: P14_RUNTIME_CONTRACT.marker,
    pilot,
    tenantSubdomain: P14_RUNTIME_CONTRACT.tenantSubdomain,
    installationId: P14_RUNTIME_CONTRACT.installationId,
    releaseChannel: P14_RUNTIME_CONTRACT.releaseChannel,
    operationalMode: P14_RUNTIME_CONTRACT.operationalMode,
    http: Object.freeze({
      port: httpPort,
      bindHost,
      advertiseHost,
      lanEnabled,
      lanCidr,
      localUrl: `http://${advertiseHost}:${httpPort}`
    }),
    database,
    core: Object.freeze({ url: coreUrl, syncEnabled: false }),
    secrets,
    productionEdgePortUntouched: P14_RUNTIME_CONTRACT.productionEdgePort
  });
}

module.exports = {
  P14_RUNTIME_CONTRACT,
  LOOPBACK_HOSTS,
  LAN_BIND_HOST,
  truthy,
  isPrivateIpv4,
  parsePrivateCidr,
  parseLocalDatabase,
  assertRestaurantP14RuntimeConfig
};
