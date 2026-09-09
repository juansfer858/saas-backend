'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const { signAccessToken } = require('../src/utils/jwt');
const { app } = require('../src/app');
const pilot = require('../src/modules/restaurant/restaurant-v2-pilot.service');
const { ensureRestaurantDemoTenant, SUBDOMAIN } = require('./ensure-restaurant-demo-tenant');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function withServer(run) {
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
function sessionFor(user, tenant) {
  return { token: signAccessToken({ userId: user.id, tenantId: tenant.id, rol: user.rol }), subdomain: tenant.subdomain };
}
async function api(base, url, session, { method = 'GET', body = null, status = 200 } = {}) {
  const response = await fetch(`${base}${url}`, {
    method,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${session.token}`, 'x-tenant-subdomain': session.subdomain, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  assert.equal(response.status, status, `${method} ${url} esperaba ${status}: ${JSON.stringify(payload)}`);
  return { response, payload, data: payload.data };
}
async function publicGet(base, url, status = 200) {
  const response = await fetch(`${base}${url}`, { cache: 'no-store', redirect: 'manual' });
  const text = await response.text();
  assert.equal(response.status, status, `${url} esperaba ${status}`);
  return { response, text };
}
function qrMap(rows) { return Object.fromEntries(rows.map((row) => [row.id, row.qrToken])); }

async function main() {
  const serviceSource = read('src/modules/restaurant/restaurant-v2-pilot.service.js');
  const routeSource = read('src/modules/restaurant/restaurant-v2-pilot.routes.js');
  const publicSource = read('src/modules/restaurant/restaurant-v2-pilot.public.routes.js');
  const html = read('src/web/restaurant-v2-pilot.html');
  const js = read('src/web/restaurant-v2-pilot.js');
  const css = read('src/web/restaurant-v2-pilot.css');
  const bridge = read('src/web/restaurant-v2-control-center-bridge.js');
  const core = read('src/routes/core.routes.js');
  const aggregator = read('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js');

  assert.match(serviceSource, /VANTIX_RESTAURANT_V2_PILOT_P9/);
  assert.match(serviceSource, /restaurantV2Pilot/);
  assert.match(serviceSource, /PARALLEL_NO_REDIRECT/);
  assert.match(serviceSource, /DIAN_PUSH_IMPRESORA_ESTACIONES_Y_DISPOSITIVOS_NO_BLOQUEAN_ACTIVACION/);
  assert.match(serviceSource, /cashiers/);
  assert.match(serviceSource, /cashAccounts/);
  assert.match(serviceSource, /RESTAURANT_V2_PILOT/);
  assert.doesNotMatch(serviceSource, /qrToken\s*:/);
  assert.match(routeSource, /requireRoles\('ADMIN', 'SUPER_ADMIN'\)/);
  assert.match(routeSource, /patch\('\/v2\/piloto'/);
  assert.match(publicSource, /\/app\/restaurante-v2\/piloto/);
  assert.match(core, /restaurantV2PilotRouter/);
  assert.match(aggregator, /restaurantV2PilotPublicRouter/);
  assert.match(bridge, /pilot:\s*'\/app\/restaurante-v2\/piloto'/);
  assert.match(bridge, /canSeePilot/);
  assert.match(bridge, /ADMIN/);
  assert.match(html, /RESTAURANTE V2 · PILOTO P9/);
  assert.match(html, /ACTIVAR PILOTO V2/);
  assert.match(html, /DESACTIVAR \/ VOLVER A V1/);
  assert.match(js, /VANTIX_RESTAURANT_V2_PILOT_P9/);
  assert.match(css, /VANTIX_RESTAURANT_V2_PILOT_P9/);
  for (const source of [js, serviceSource, routeSource, publicSource]) assert.doesNotMatch(source, /MutationObserver|setInterval|POLL_MS/);
  new Function(js);
  new Function(bridge);

  const seeded = await ensureRestaurantDemoTenant();
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: SUBDOMAIN } });
  assert.ok(tenant?.id);
  const [admin, waiter] = await Promise.all([
    prisma.user.findFirst({ where: { tenantId: tenant.id, activo: true, rol: { in: ['ADMIN', 'SUPER_ADMIN'] } } }),
    prisma.user.findFirst({ where: { tenantId: tenant.id, activo: true, rol: 'MESERO' } })
  ]);
  assert.ok(admin?.id && waiter?.id, 'tenant demo requiere ADMIN y MESERO');

  const config = await prisma.restaurantConfig.upsert({ where: { tenantId: tenant.id }, create: { tenantId: tenant.id }, update: {} });
  const priorTheme = config.themeData && typeof config.themeData === 'object' && !Array.isArray(config.themeData) ? config.themeData : {};
  const sentinel = { preserved: true, value: 'P9_THEME_SENTINEL' };
  await prisma.restaurantConfig.update({ where: { tenantId: tenant.id }, data: { dianRealEnabled: false, physicalPrinterFieldPass: false, themeData: { ...priorTheme, p9Sentinel: sentinel } } });

  const beforeTables = await prisma.restaurantTable.findMany({ where: { tenantId: tenant.id, active: true }, select: { id: true, qrToken: true } });
  assert.ok(beforeTables.length > 0, 'piloto necesita al menos una mesa activa');
  const beforeQr = qrMap(beforeTables);
  const auditBefore = await prisma.auditoriaContable.count({ where: { tenantId: tenant.id, entidad: 'RESTAURANT_V2_PILOT' } });
  const directBefore = await pilot.getPilot(tenant.id);
  assert.equal(directBefore.pilot.enabled, false);
  assert.equal(directBefore.readiness.ready, true);
  assert.equal(directBefore.readiness.required.find((row) => row.key === 'waiters').ok, true);
  assert.equal(directBefore.readiness.required.find((row) => row.key === 'productionUsers').ok, true);
  assert.equal(directBefore.readiness.required.find((row) => row.key === 'cashiers').ok, true);
  assert.equal(directBefore.readiness.required.find((row) => row.key === 'cashAccounts').ok, true);
  assert.equal(directBefore.readiness.notGates.dian, true);
  assert.equal(directBefore.readiness.notGates.push, true);
  assert.equal(directBefore.readiness.notGates.manualStations, true);
  assert.equal(directBefore.readiness.notGates.printer, true);
  assert.equal(directBefore.readiness.notGates.devicePairing, true);

  const adminSession = sessionFor(admin, tenant);
  const waiterSession = sessionFor(waiter, tenant);

  await withServer(async (base) => {
    const pilotPage = await publicGet(base, '/app/restaurante-v2/piloto');
    assert.equal(pilotPage.response.headers.get('x-vantixgc-restaurant-v2-pilot'), 'p9-controlled-pilot');
    assert.match(pilotPage.text, /RESTAURANTE V2 · PILOTO P9/);

    const legacy = await publicGet(base, '/app/restaurante');
    assert.equal(legacy.response.headers.get('location'), null, 'P9 no debe redirigir la entrada V1');
    const waiterV2 = await publicGet(base, '/app/centro-de-control/mesero-v2/');
    assert.equal(waiterV2.response.headers.get('x-vantixgc-restaurant-v2-device'), 'waiter-p8');
    const productionV2 = await publicGet(base, '/app/produccion-v2/');
    assert.equal(productionV2.response.headers.get('x-vantixgc-restaurant-v2-device'), 'production-p8');
    const clientQr = await publicGet(base, `/r/${beforeTables[0].qrToken}`);
    assert.equal(clientQr.response.headers.get('x-vantixgc-restaurant-v2-client-qr'), 'p7-permanent-qr-client');

    const initial = await api(base, '/api/v1/restaurante/v2/piloto', adminSession);
    assert.equal(initial.response.headers.get('x-vantixgc-restaurant-v2-pilot'), 'p9-control-plane');
    assert.equal(initial.data.pilot.enabled, false);
    assert.equal(initial.data.safety.changesCanonicalRoutes, false);
    assert.equal(initial.data.safety.rotatesQrTokens, false);
    assert.equal(initial.data.safety.requiresDian, false);
    assert.equal(initial.data.safety.requiresPrinter, false);
    await api(base, '/api/v1/restaurante/v2/piloto', waiterSession, { status: 403 });
    await api(base, '/api/v1/restaurante/v2/piloto', waiterSession, { method: 'PATCH', body: { enabled: true }, status: 403 });

    const enabled = await api(base, '/api/v1/restaurante/v2/piloto', adminSession, { method: 'PATCH', body: { enabled: true, notes: 'Piloto P9 CI sin DIAN, FCM ni impresora de campo' } });
    assert.equal(enabled.data.pilot.enabled, true);
    assert.equal(enabled.data.pilot.mode, 'PILOT');
    assert.equal(enabled.data.pilot.routingMode, 'PARALLEL_NO_REDIRECT');
    assert.equal(enabled.data.readiness.ready, true);
    assert.equal(enabled.data.readiness.optional.find((row) => row.key === 'dian').ok, false);
    assert.equal(enabled.data.readiness.optional.find((row) => row.key === 'printer').ok, false);
    assert.equal(enabled.data.readiness.notGates.dian, true);
    assert.equal(enabled.data.readiness.notGates.push, true);

    const storedEnabled = await prisma.restaurantConfig.findUnique({ where: { tenantId: tenant.id } });
    assert.deepEqual(storedEnabled.themeData.p9Sentinel, sentinel, 'P9 debe preservar otras claves de themeData');
    assert.equal(storedEnabled.themeData.restaurantV2Pilot.enabled, true);

    const disabled = await api(base, '/api/v1/restaurante/v2/piloto', adminSession, { method: 'PATCH', body: { enabled: false, notes: 'Rollback P9 CI' } });
    assert.equal(disabled.data.pilot.enabled, false);
    assert.equal(disabled.data.pilot.mode, 'OFF');
    assert.equal(disabled.data.pilot.rollbackPath, '/app/restaurante');
  });

  const storedAfter = await prisma.restaurantConfig.findUnique({ where: { tenantId: tenant.id } });
  assert.deepEqual(storedAfter.themeData.p9Sentinel, sentinel, 'rollback debe preservar themeData ajeno');
  assert.equal(storedAfter.themeData.restaurantV2Pilot.enabled, false);
  const afterTables = await prisma.restaurantTable.findMany({ where: { tenantId: tenant.id, active: true }, select: { id: true, qrToken: true } });
  assert.deepEqual(qrMap(afterTables), beforeQr, 'activar/desactivar piloto no puede rotar qrToken');
  const auditAfter = await prisma.auditoriaContable.count({ where: { tenantId: tenant.id, entidad: 'RESTAURANT_V2_PILOT' } });
  assert.equal(auditAfter - auditBefore, 2, 'activar y rollback deben dejar dos auditorías');
  const latestAudit = await prisma.auditoriaContable.findFirst({ where: { tenantId: tenant.id, entidad: 'RESTAURANT_V2_PILOT' }, orderBy: { creadoEn: 'desc' } });
  assert.equal(latestAudit.userId, admin.id);
  assert.equal(latestAudit.metadata.after.enabled, false);
  assert.equal(latestAudit.metadata.marker, 'VANTIX_RESTAURANT_V2_PILOT_P9');

  console.log(JSON.stringify({
    ok: true,
    phase: 'P9_CONTROLLED_PILOT',
    tenant: seeded.subdomain,
    configStorage: 'RestaurantConfig.themeData.restaurantV2Pilot',
    audit: 'RESTAURANT_V2_PILOT',
    adminOnly: true,
    canonicalRedirects: false,
    qrTokensRotated: false,
    requiredGates: ['tenant','admin','tables','menu','waiters','productionUsers','cashiers','cashAccounts'],
    dianGate: false,
    pushGate: false,
    printerGate: false,
    manualStationGate: false,
    devicePairingGate: false,
    rollback: '/app/restaurante',
    previousPhasesStillLive: ['P7_CLIENT_QR', 'P8_WAITER_PWA', 'P8_PRODUCTION_PWA']
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
