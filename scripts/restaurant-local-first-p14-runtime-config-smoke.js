'use strict';

const assert = require('node:assert/strict');
const {
  P14_RUNTIME_CONTRACT,
  isPrivateIpv4,
  parsePrivateCidr,
  cidrContains,
  assertRestaurantP14RuntimeConfig
} = require('../lab/restaurant-p14/runtime-config');

const baseEnv = Object.freeze({
  RESTAURANT_LOCAL_FIRST_P14_ENABLED: 'true',
  P14_RUNTIME_ENABLED: 'true',
  P14_TENANT_SUBDOMAIN: 'demo-restaurante',
  P14_INSTALLATION_ID: 'HOME-PILOT-01',
  P14_RELEASE_CHANNEL: 'PILOT',
  P14_OPERATIONAL_MODE: 'LOCAL_FIRST',
  P14_HTTP_PORT: '8790',
  P14_LAN_ENABLED: 'false',
  P14_BIND_HOST: '127.0.0.1',
  P14_ADVERTISE_HOST: '127.0.0.1',
  P14_LAN_CIDR: '',
  DATABASE_URL: 'postgresql://vantix_p14:test-only@127.0.0.1:55432/vantix_p14_home_pilot',
  P14_JWT_SECRET: 'p14-test-only-jwt-secret-longer-than-32-characters',
  P14_ADMIN_PASSWORD: 'P14-Test-Only-Password',
  P14_CORE_URL: 'https://core.vantixgc.com',
  P14_SYNC_ENABLED: 'false'
});

function env(overrides = {}) {
  return { ...baseEnv, ...overrides };
}

function mustFail(overrides, expectedMessage) {
  assert.throws(
    () => assertRestaurantP14RuntimeConfig(env(overrides)),
    (error) => error instanceof Error && error.message.includes(expectedMessage)
  );
}

function main() {
  assert.equal(Object.isFrozen(P14_RUNTIME_CONTRACT), true);
  assert.equal(P14_RUNTIME_CONTRACT.httpPort, 8790);
  assert.equal(P14_RUNTIME_CONTRACT.productionEdgePort, 8788);
  assert.equal(P14_RUNTIME_CONTRACT.postgresPort, 55432);
  assert.equal(P14_RUNTIME_CONTRACT.postgresDatabase, 'vantix_p14_home_pilot');

  assert.equal(isPrivateIpv4('10.0.0.10'), true);
  assert.equal(isPrivateIpv4('172.16.1.10'), true);
  assert.equal(isPrivateIpv4('172.31.255.10'), true);
  assert.equal(isPrivateIpv4('192.168.1.50'), true);
  assert.equal(isPrivateIpv4('172.32.0.1'), false);
  assert.equal(isPrivateIpv4('8.8.8.8'), false);

  const cidr = parsePrivateCidr('192.168.1.0/24');
  assert.ok(cidr);
  assert.equal(cidrContains(cidr, '192.168.1.50'), true);
  assert.equal(cidrContains(cidr, '192.168.2.50'), false);
  assert.equal(parsePrivateCidr('8.8.8.0/24'), null);
  assert.equal(parsePrivateCidr('192.168.1.0/99'), null);

  const loopback = assertRestaurantP14RuntimeConfig(env());
  assert.equal(loopback.marker, 'VANTIX_RESTAURANT_LOCAL_FIRST_P14_HOME_PILOT');
  assert.equal(loopback.pilot.enabled, true);
  assert.equal(loopback.http.lanEnabled, false);
  assert.equal(loopback.http.bindHost, '127.0.0.1');
  assert.equal(loopback.http.localUrl, 'http://127.0.0.1:8790');
  assert.deepEqual(loopback.database, {
    host: '127.0.0.1',
    port: 55432,
    database: 'vantix_p14_home_pilot'
  });
  assert.deepEqual(loopback.security, {
    jwtSecretConfigured: true,
    adminPasswordConfigured: true
  });
  assert.equal('jwtSecret' in loopback.security, false);
  assert.equal('adminPassword' in loopback.security, false);
  assert.equal(loopback.core.syncEnabled, false);
  assert.equal(loopback.productionEdgePortUntouched, 8788);

  const lan = assertRestaurantP14RuntimeConfig(env({
    P14_LAN_ENABLED: 'true',
    P14_BIND_HOST: '0.0.0.0',
    P14_ADVERTISE_HOST: '192.168.1.50',
    P14_LAN_CIDR: '192.168.1.0/24'
  }));
  assert.equal(lan.http.lanEnabled, true);
  assert.equal(lan.http.bindHost, '0.0.0.0');
  assert.equal(lan.http.advertiseHost, '192.168.1.50');
  assert.equal(lan.http.localUrl, 'http://192.168.1.50:8790');
  assert.equal(lan.http.lanCidr.raw, '192.168.1.0/24');

  mustFail({ RESTAURANT_LOCAL_FIRST_P14_ENABLED: 'false' }, 'FEATURE_FLAG_DISABLED');
  mustFail({ P14_RUNTIME_ENABLED: 'false' }, 'P14_RUNTIME_ENABLED=true');
  mustFail({ P14_TENANT_SUBDOMAIN: 'demo-core' }, 'TENANT_NOT_ALLOWED');
  mustFail({ P14_TENANT_SUBDOMAIN: 'restaurante-real' }, 'TENANT_NOT_ALLOWED');
  mustFail({ P14_INSTALLATION_ID: 'RESTAURANTE-PROD-01' }, 'INSTALLATION_NOT_ALLOWED');
  mustFail({ P14_RELEASE_CHANNEL: 'STABLE' }, 'CHANNEL_NOT_ALLOWED');
  mustFail({ P14_OPERATIONAL_MODE: 'CLOUD_FIRST' }, 'MODE_NOT_ALLOWED');
  mustFail({ P14_HTTP_PORT: '8788' }, 'usa exclusivamente el puerto 8790');
  mustFail({ P14_HTTP_PORT: '3000' }, 'usa exclusivamente el puerto 8790');
  mustFail({ DATABASE_URL: 'postgresql://vantix:secret@10.0.0.5:55432/vantix_p14_home_pilot' }, 'PostgreSQL debe permanecer local');
  mustFail({ DATABASE_URL: 'postgresql://vantix:secret@127.0.0.1:5432/vantix_p14_home_pilot' }, 'PostgreSQL debe usar 55432');
  mustFail({ DATABASE_URL: 'postgresql://vantix:secret@127.0.0.1:55432/postgres' }, 'la base debe llamarse vantix_p14_home_pilot');
  mustFail({ P14_SYNC_ENABLED: 'true' }, 'debe permanecer false');
  mustFail({ P14_CORE_URL: 'https://otro-core.example.com' }, 'Core debe ser https://core.vantixgc.com');
  mustFail({ P14_JWT_SECRET: 'short' }, 'P14_JWT_SECRET debe tener al menos 32 caracteres');
  mustFail({ P14_ADMIN_PASSWORD: 'short' }, 'P14_ADMIN_PASSWORD debe tener al menos 12 caracteres');
  mustFail({ P14_LAN_ENABLED: 'true', P14_BIND_HOST: '127.0.0.1' }, 'P14_BIND_HOST debe ser 0.0.0.0');
  mustFail({
    P14_LAN_ENABLED: 'true',
    P14_BIND_HOST: '0.0.0.0',
    P14_ADVERTISE_HOST: '8.8.8.8',
    P14_LAN_CIDR: '192.168.1.0/24'
  }, 'P14_ADVERTISE_HOST debe ser una IPv4 privada');
  mustFail({
    P14_LAN_ENABLED: 'true',
    P14_BIND_HOST: '0.0.0.0',
    P14_ADVERTISE_HOST: '192.168.2.50',
    P14_LAN_CIDR: '192.168.1.0/24'
  }, 'no pertenece a la subred permitida');
  mustFail({
    P14_LAN_ENABLED: 'true',
    P14_BIND_HOST: '0.0.0.0',
    P14_ADVERTISE_HOST: '192.168.1.50',
    P14_LAN_CIDR: '8.8.8.0/24'
  }, 'P14_LAN_CIDR debe ser una subred IPv4 privada válida');

  console.log('P14_LOCAL_RUNTIME_CONFIG_OK');
}

main();
