'use strict';

const net = require('node:net');

const CONTRACT = Object.freeze({
  marker: 'VANTIX_RESTAURANT_STANDALONE_P15_LAB',
  installationId: 'HOME-PILOT-P15',
  tenantSubdomain: 'demo-restaurante',
  httpPort: 8815,
  postgresHost: '127.0.0.1',
  postgresPort: 55435,
  database: 'vantix_restaurant_p15_lab',
  installDir: String.raw`C:\ProgramData\VantixGC\Restaurant-P15-Lab`,
  printPort: 18815,
  reserved: Object.freeze({ edgeHttp: 8788, p13Http: 8790, p13Pg: 55432, p14Http: 8791, p14Pg: 55433 })
});

function text(value) { return String(value ?? '').trim(); }
function truthy(value) { return ['1','true','yes','on'].includes(text(value).toLowerCase()); }

function privateIpv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a,b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
}

function parseCidr(cidr) {
  const match = /^([^/]+)\/(\d{1,2})$/.exec(text(cidr));
  if (!match || net.isIP(match[1]) !== 4) return null;
  const prefix = Number(match[2]);
  if (prefix < 8 || prefix > 32) return null;
  const parts = match[1].split('.').map(Number);
  const n = (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: n & mask, mask };
}

function addressInCidr(address, cidr) {
  if (address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1') return true;
  const normalized = text(address).replace(/^::ffff:/, '');
  if (net.isIP(normalized) !== 4) return false;
  const parsed = parseCidr(cidr);
  if (!parsed) return false;
  const p = normalized.split('.').map(Number);
  const n = (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
  return (n & parsed.mask) === parsed.network;
}

function assertConfig(env = process.env) {
  if (!truthy(env.P15_ENABLED)) throw new Error('P15_ENABLED=true es obligatorio.');
  const installationId = text(env.P15_INSTALLATION_ID || CONTRACT.installationId);
  const tenantSubdomain = text(env.P15_TENANT_SUBDOMAIN || CONTRACT.tenantSubdomain).toLowerCase();
  const httpPort = Number(env.P15_HTTP_PORT || CONTRACT.httpPort);
  const bindHost = text(env.P15_BIND_HOST || '127.0.0.1');
  const advertiseHost = text(env.P15_ADVERTISE_HOST || bindHost);
  const lanEnabled = truthy(env.P15_LAN_ENABLED);
  const lanCidr = text(env.P15_LAN_CIDR || '');
  const databaseUrl = text(env.DATABASE_URL);

  if (installationId !== CONTRACT.installationId) throw new Error(`P15 installationId inválido: ${installationId}`);
  if (tenantSubdomain !== CONTRACT.tenantSubdomain) throw new Error(`P15 tenant inválido: ${tenantSubdomain}`);
  if (httpPort !== CONTRACT.httpPort) throw new Error(`P15 HTTP debe usar ${CONTRACT.httpPort}.`);
  if (!databaseUrl) throw new Error('DATABASE_URL es obligatorio.');
  const db = new URL(databaseUrl);
  if (db.hostname !== CONTRACT.postgresHost || Number(db.port) !== CONTRACT.postgresPort || db.pathname.replace(/^\//,'') !== CONTRACT.database) {
    throw new Error('DATABASE_URL no cumple el aislamiento P15 127.0.0.1:55435/vantix_restaurant_p15_lab.');
  }
  if (lanEnabled) {
    if (bindHost !== '0.0.0.0') throw new Error('P15 LAN requiere P15_BIND_HOST=0.0.0.0.');
    if (!privateIpv4(advertiseHost) || advertiseHost === '127.0.0.1') throw new Error('P15_ADVERTISE_HOST debe ser una IPv4 privada LAN.');
    if (!parseCidr(lanCidr) || !addressInCidr(advertiseHost, lanCidr)) throw new Error('P15_LAN_CIDR inválido o no contiene la IP anunciada.');
  }

  return Object.freeze({
    marker: CONTRACT.marker,
    installationId,
    tenantSubdomain,
    http: Object.freeze({ port: httpPort, bindHost, advertiseHost, lanEnabled, lanCidr, localUrl: `http://${advertiseHost}:${httpPort}` }),
    database: Object.freeze({ host: CONTRACT.postgresHost, port: CONTRACT.postgresPort, name: CONTRACT.database }),
    print: Object.freeze({ port: Number(env.P15_PRINT_PORT || CONTRACT.printPort) }),
    backup: Object.freeze({ uploadUrl: text(env.P15_BACKUP_UPLOAD_URL), enabled: truthy(env.P15_BACKUP_ENABLED ?? 'true') })
  });
}

module.exports = { CONTRACT, assertConfig, addressInCidr, privateIpv4, truthy };
