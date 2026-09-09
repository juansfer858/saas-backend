'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const { signAccessToken } = require('../src/utils/jwt');
const { app } = require('../src/app');
const pilot = require('../src/modules/restaurant/restaurant-v2-pilot.service');
const cutover = require('../src/modules/restaurant/restaurant-v2-cutover.service');
const { ensureRestaurantDemoTenant, SUBDOMAIN } = require('./ensure-restaurant-demo-tenant');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
function sessionFor(user, tenant) { return { token: signAccessToken({ userId:user.id, tenantId:tenant.id, rol:user.rol }), subdomain:tenant.subdomain }; }
function qrMap(rows) { return Object.fromEntries(rows.map((row) => [row.id, row.qrToken])); }
async function withServer(run) {
  const server = await new Promise((resolve, reject) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); instance.once('error', reject); });
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
async function api(base, url, session, { method='GET', body=null, status=200 } = {}) {
  const response = await fetch(`${base}${url}`, { method, cache:'no-store', headers:{ Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain, ...(body ? {'Content-Type':'application/json'} : {}) }, ...(body ? { body:JSON.stringify(body) } : {}) });
  let payload={}; try { payload=await response.json(); } catch {}
  assert.equal(response.status, status, `${method} ${url} esperaba ${status}: ${JSON.stringify(payload)}`);
  return { response, payload, data:payload.data };
}
async function publicGet(base, url, status=200) {
  const response = await fetch(`${base}${url}`, { cache:'no-store', redirect:'manual' });
  const text = await response.text();
  assert.equal(response.status, status, `${url} esperaba ${status}`);
  return { response, text };
}

async function main() {
  const serviceSource = read('src/modules/restaurant/restaurant-v2-cutover.service.js');
  const routeSource = read('src/modules/restaurant/restaurant-v2-cutover.routes.js');
  const publicSource = read('src/modules/restaurant/restaurant-v2-cutover.public.routes.js');
  const launchSource = read('src/web/restaurant-v2-cutover-launch.js');
  const uiSource = read('src/web/restaurant-v2-cutover.js');
  const html = read('src/web/restaurant-v2-cutover.html');
  const bridge = read('src/web/restaurant-v2-control-center-bridge.js');
  const core = read('src/routes/core.routes.js');
  const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');

  assert.match(serviceSource, /VANTIX_RESTAURANT_V2_CUTOVER_P10/);
  assert.match(serviceSource, /restaurantV2CutoverHistory/);
  assert.match(serviceSource, /V2_DEFAULT/);
  assert.match(serviceSource, /V1_DEFAULT/);
  assert.match(serviceSource, /qrTokensImmutableByCutover:\s*true/);
  assert.match(serviceSource, /dianGate:\s*false/);
  assert.match(serviceSource, /PILOT_REQUIRED/);
  assert.doesNotMatch(serviceSource, /qrToken\s*:/);
  assert.match(routeSource, /\/v2\/cutover\/launch/);
  assert.match(routeSource, /RESTAURANTE\.VER/);
  assert.match(routeSource, /RESTAURANTE\.ADMINISTRAR/);
  assert.match(publicSource, /\/app\/centro-de-control\/mesero-v1/);
  assert.match(publicSource, /\/app\/produccion-v1/);
  assert.match(publicSource, /X-VantixGC-Restaurant-V2-Cutover-Launcher/);
  assert.match(launchSource, /vantixgc_restaurant_v2_cutover_p10/);
  assert.match(launchSource, /\/app\/centro-de-control\/mesero-v2\//);
  assert.match(launchSource, /\/app\/produccion-v2\//);
  assert.match(html, /RESTAURANTE V2 · P10/);
  assert.match(html, /ACTIVAR V2 COMO PRINCIPAL/);
  assert.match(uiSource, /\/api\/v1\/restaurante\/v2\/cutover/);
  assert.match(bridge, /migration:\s*'\/app\/restaurante-v2\/migracion'/);
  assert.match(bridge, /\/api\/v1\/restaurante\/v2\/cutover\/launch/);
  assert.match(bridge, /defaultModuleForRole/);
  assert.match(core, /restaurantV2CutoverRouter/);
  assert.match(publicRoot, /restaurantV2CutoverPublicRouter/);
  for (const source of [serviceSource, routeSource, publicSource, launchSource, uiSource]) assert.doesNotMatch(source, /MutationObserver|setInterval|POLL_MS/);
  new Function(launchSource); new Function(uiSource); new Function(bridge);

  await ensureRestaurantDemoTenant();
  const tenant = await prisma.tenant.findUnique({ where:{ subdomain:SUBDOMAIN } });
  assert.ok(tenant?.id);
  const [admin, waiter] = await Promise.all([
    prisma.user.findFirst({ where:{ tenantId:tenant.id, activo:true, rol:{ in:['ADMIN','SUPER_ADMIN'] } } }),
    prisma.user.findFirst({ where:{ tenantId:tenant.id, activo:true, rol:'MESERO' } })
  ]);
  assert.ok(admin?.id && waiter?.id);

  const config = await prisma.restaurantConfig.upsert({ where:{ tenantId:tenant.id }, create:{ tenantId:tenant.id }, update:{} });
  const priorTheme = config.themeData && typeof config.themeData === 'object' && !Array.isArray(config.themeData) ? config.themeData : {};
  const sentinel = { preserved:true, value:'P10_THEME_SENTINEL' };
  await prisma.restaurantConfig.update({
    where:{ tenantId:tenant.id },
    data:{
      dianRealEnabled:false,
      physicalPrinterFieldPass:false,
      themeData:{ ...priorTheme, p10Sentinel:sentinel, restaurantV2Cutover:{ enabled:false }, restaurantV2CutoverHistory:[], restaurantV2Pilot:{ enabled:false }, restaurantV2PilotHistory:[] }
    }
  });

  const beforeTables = await prisma.restaurantTable.findMany({ where:{ tenantId:tenant.id, active:true }, select:{ id:true, qrToken:true } });
  assert.ok(beforeTables.length > 0);
  const beforeQr = qrMap(beforeTables);
  const auditBefore = await prisma.auditoriaContable.count({ where:{ tenantId:tenant.id, entidad:'RESTAURANT_V2_CUTOVER' } });
  const initialDirect = await cutover.getCutover(tenant.id);
  assert.equal(initialDirect.cutover.enabled, false);
  assert.equal(initialDirect.canActivate, false, 'sin piloto P10 no debe activar');
  assert.ok(initialDirect.blockers.includes('pilot'));
  assert.equal(initialDirect.safety.dianDoesNotBlock, true);
  assert.equal(initialDirect.safety.qrTokensUnchanged, true);
  assert.equal((await cutover.launchDecision(tenant.id)).enabled, false);

  const adminSession = sessionFor(admin, tenant);
  const waiterSession = sessionFor(waiter, tenant);
  await withServer(async(base) => {
    const migration = await publicGet(base, '/app/restaurante-v2/migracion');
    assert.equal(migration.response.headers.get('x-vantixgc-restaurant-v2-cutover'), 'p10-tenant-cutover');
    assert.match(migration.text, /RESTAURANTE V2 · P10/);

    const waiterCanonical = await publicGet(base, '/app/centro-de-control/mesero');
    assert.equal(waiterCanonical.response.headers.get('x-vantixgc-restaurant-v2-cutover-launcher'), 'waiter');
    assert.match(waiterCanonical.text, /restaurant-v2-cutover-launch\.js/);
    const waiterRollback = await publicGet(base, '/app/centro-de-control/mesero-v1');
    assert.equal(waiterRollback.response.headers.get('x-vantixgc-restaurant-v2-cutover-rollback'), 'waiter-v1-direct');

    const productionCanonical = await publicGet(base, '/app/produccion');
    assert.equal(productionCanonical.response.headers.get('x-vantixgc-restaurant-v2-cutover-launcher'), 'production');
    const productionRollback = await publicGet(base, '/app/produccion-v1');
    assert.equal(productionRollback.response.headers.get('x-vantixgc-restaurant-v2-cutover-rollback'), 'production-v1-direct');

    const mainRollback = await publicGet(base, '/app/restaurante-v1');
    assert.equal(mainRollback.response.headers.get('x-vantixgc-restaurant-v2-pilot-rollback'), 'v1-direct-shell');
    assert.equal((await publicGet(base, '/app/centro-de-control/mesero-v2/')).response.headers.get('x-vantixgc-restaurant-v2-device'), 'waiter-p8');
    assert.equal((await publicGet(base, '/app/produccion-v2/')).response.headers.get('x-vantixgc-restaurant-v2-device'), 'production-p8');

    const initial = await api(base, '/api/v1/restaurante/v2/cutover', adminSession);
    assert.equal(initial.data.cutover.enabled, false);
    assert.equal(initial.data.canActivate, false);
    await api(base, '/api/v1/restaurante/v2/cutover', waiterSession, { status:403 });
    const waiterLaunchBefore = await api(base, '/api/v1/restaurante/v2/cutover/launch', waiterSession);
    assert.equal(waiterLaunchBefore.data.enabled, false);

    await api(base, '/api/v1/restaurante/v2/cutover', adminSession, { method:'PATCH', body:{ enabled:true }, status:409 });

    const pilotEnabled = await api(base, '/api/v1/restaurante/v2/piloto', adminSession, { method:'PATCH', body:{ enabled:true, notes:'P10 smoke pilot' } });
    assert.equal(pilotEnabled.data.pilot.enabled, true);
    assert.equal(pilotEnabled.data.readiness.ready, true);
    const ready = await api(base, '/api/v1/restaurante/v2/cutover', adminSession);
    assert.equal(ready.data.canActivate, true);
    assert.deepEqual(ready.data.blockers, []);

    const enabled = await api(base, '/api/v1/restaurante/v2/cutover', adminSession, { method:'PATCH', body:{ enabled:true, notes:'P10 smoke V2 default' } });
    assert.equal(enabled.data.cutover.enabled, true);
    assert.equal(enabled.data.cutover.mode, 'V2_DEFAULT');
    assert.equal(enabled.data.cutover.dianGate, false);
    assert.equal(enabled.data.cutover.qrTokensImmutableByCutover, true);
    assert.equal(enabled.data.audit.operational, 'RECORDED');
    assert.ok(enabled.data.audit.operationalEventId);

    const waiterLaunchAfter = await api(base, '/api/v1/restaurante/v2/cutover/launch', waiterSession);
    assert.equal(waiterLaunchAfter.data.enabled, true);
    assert.equal(waiterLaunchAfter.data.targets.waiter, '/app/centro-de-control/mesero-v2/');
    assert.equal(waiterLaunchAfter.data.targets.production, '/app/produccion-v2/');

    const disabled = await api(base, '/api/v1/restaurante/v2/cutover', adminSession, { method:'PATCH', body:{ enabled:false, notes:'P10 smoke rollback' } });
    assert.equal(disabled.data.cutover.enabled, false);
    assert.equal(disabled.data.cutover.mode, 'V1_DEFAULT');
    const waiterLaunchRollback = await api(base, '/api/v1/restaurante/v2/cutover/launch', waiterSession);
    assert.equal(waiterLaunchRollback.data.enabled, false);
    assert.equal(waiterLaunchRollback.data.targets.waiter, '/app/centro-de-control/mesero-v1');

    const pilotDisabled = await api(base, '/api/v1/restaurante/v2/piloto', adminSession, { method:'PATCH', body:{ enabled:false, notes:'P10 smoke cleanup' } });
    assert.equal(pilotDisabled.data.pilot.enabled, false);
  });

  const stored = await prisma.restaurantConfig.findUnique({ where:{ tenantId:tenant.id } });
  assert.deepEqual(stored.themeData.p10Sentinel, sentinel, 'P10 debe preservar themeData ajeno');
  assert.equal(stored.themeData.restaurantV2Cutover.enabled, false);
  assert.ok(Array.isArray(stored.themeData.restaurantV2CutoverHistory));
  assert.equal(stored.themeData.restaurantV2CutoverHistory.length, 2);
  assert.equal(stored.themeData.restaurantV2CutoverHistory[0].action, 'ACTIVATE_V2_DEFAULT');
  assert.equal(stored.themeData.restaurantV2CutoverHistory[1].action, 'ROLLBACK_V1_DEFAULT');

  const afterTables = await prisma.restaurantTable.findMany({ where:{ tenantId:tenant.id, active:true }, select:{ id:true, qrToken:true } });
  assert.deepEqual(qrMap(afterTables), beforeQr, 'P10 no puede rotar QR físicos');
  const auditAfter = await prisma.auditoriaContable.count({ where:{ tenantId:tenant.id, entidad:'RESTAURANT_V2_CUTOVER' } });
  assert.equal(auditAfter - auditBefore, 2, 'activar y rollback P10 deben auditarse');

  console.log('RESTAURANT V2 CUTOVER P10 DB SMOKE OK', JSON.stringify({ tenant:tenant.subdomain, tables:afterTables.length, qrStable:true, auditEvents:2, rollback:true }));
}

main().catch((error)=>{console.error('RESTAURANT V2 CUTOVER P10 DB SMOKE ERROR', error);process.exitCode=1;}).finally(async()=>prisma.$disconnect());
