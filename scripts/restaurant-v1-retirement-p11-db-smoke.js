'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const { signAccessToken } = require('../src/utils/jwt');
const { app } = require('../src/app');
const pilot = require('../src/modules/restaurant/restaurant-v2-pilot.service');
const cutover = require('../src/modules/restaurant/restaurant-v2-cutover.service');
const retirement = require('../src/modules/restaurant/restaurant-v1-retirement-p11.service');
const { ensureRestaurantDemoTenant, SUBDOMAIN } = require('./ensure-restaurant-demo-tenant');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const qrMap = (rows) => Object.fromEntries(rows.map((row) => [row.id, row.qrToken]));
function sessionFor(user, tenant) {
  return { token:signAccessToken({ userId:user.id, tenantId:tenant.id, rol:user.rol }), subdomain:tenant.subdomain };
}
async function withServer(run) {
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
async function api(base, url, session, { method='GET', body=null, status=200 } = {}) {
  const response = await fetch(`${base}${url}`, {
    method,
    cache:'no-store',
    headers:{ Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain, ...(body ? {'Content-Type':'application/json'} : {}) },
    ...(body ? { body:JSON.stringify(body) } : {})
  });
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
function assertV2Redirect(result, target) {
  assert.equal(result.response.status, 307);
  assert.equal(result.response.headers.get('x-vantixgc-restaurant-v1-runtime'), 'disabled');
  assert.ok(String(result.response.headers.get('location') || '').startsWith(target), `redirect esperado a ${target}`);
}
async function operationalCounts(tenantId) {
  const [sales, sessions, orders, sessionPayments] = await Promise.all([
    prisma.comprobanteComercial.count({ where:{ tenantId } }),
    prisma.restaurantTableSession.count({ where:{ tenantId } }),
    prisma.restaurantOrder.count({ where:{ tenantId } }),
    prisma.restaurantSessionPayment.count({ where:{ tenantId } })
  ]);
  return { sales, sessions, orders, sessionPayments };
}

async function main() {
  const serviceSource = read('src/modules/restaurant/restaurant-v1-retirement-p11.service.js');
  const routeSource = read('src/modules/restaurant/restaurant-v1-retirement-p11.routes.js');
  const publicSource = read('src/modules/restaurant/restaurant-v1-retirement-p11.public.routes.js');
  const p12Source = read('src/modules/restaurant/restaurant-v2-only-p12.public.routes.js');
  const launcherHtml = read('src/web/restaurant-v1-retirement-p11-launch.html');
  const launcherJs = read('src/web/restaurant-v1-retirement-p11-launch.js');
  const nativeHtml = read('src/web/restaurant-v2-native-control-p11.html');
  const nativeJs = read('src/web/restaurant-v2-native-control-p11.js');
  const panelHtml = read('src/web/restaurant-v1-retirement-p11.html');
  const panelJs = read('src/web/restaurant-v1-retirement-p11.js');
  const core = read('src/routes/core.routes.js');
  const aggregator = read('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js');
  const p10Public = read('src/modules/restaurant/restaurant-v2-control-center.public.routes.js');

  assert.match(serviceSource, /VANTIX_RESTAURANT_V1_RETIREMENT_P11/);
  assert.match(serviceSource, /restaurantV1RetirementHistory/);
  assert.match(serviceSource, /V2_ONLY_NORMAL_OPERATION/);
  assert.match(serviceSource, /P10_COMPATIBILITY/);
  assert.match(serviceSource, /v1CodeNotDeleted:\s*true/);
  assert.match(serviceSource, /qrTokensUnchanged:\s*true/);
  assert.match(serviceSource, /dianDoesNotBlock:\s*true/);
  assert.doesNotMatch(serviceSource, /qrToken\s*:/);
  assert.match(routeSource, /\/v2\/retiro-v1\/launch/);
  assert.match(routeSource, /RESTAURANT_V2_ONLY_P12_ROLLBACK_DISABLED/);
  assert.match(publicSource, /\/app\/centro-de-control-v2/);
  assert.match(publicSource, /\/app\/restaurante-v2\/empleados/);
  assert.match(publicSource, /\/app\/restaurante-v2\/domicilios/);
  assert.match(p10Public, /\/app\/centro-de-control-p10/);
  assert.match(p12Source, /p12-v2-only-runtime/);
  assert.match(p12Source, /\/app\/restaurante-v1/);
  assert.match(p12Source, /\/app\/centro-de-control\/mesero-v1/);
  assert.match(p12Source, /\/app\/produccion-v1/);
  const p12Mount = aggregator.indexOf('restaurantOperationalV2PreviewPublicRouter.use(restaurantV2OnlyP12PublicRouter)');
  const p11Mount = aggregator.indexOf('restaurantOperationalV2PreviewPublicRouter.use(restaurantV1RetirementP11PublicRouter)');
  const p10Mount = aggregator.indexOf('restaurantOperationalV2PreviewPublicRouter.use(restaurantV2ControlCenterPublicRouter)');
  assert.ok(p12Mount >= 0 && p12Mount < p11Mount && p11Mount < p10Mount, 'P12 debe resolver antes de P11 y P10');
  assert.match(core, /restaurantV1RetirementCutoverGuard/);
  assert.match(core, /restaurantV1RetirementP11Router/);
  assert.match(launcherHtml, /VANTIXGC RESTAURANTES · P11/);
  assert.match(launcherJs, /\/api\/v1\/restaurante\/v2\/retiro-v1\/launch/);
  assert.match(nativeHtml, /data-v2-native-control="p11"/);
  assert.match(nativeJs, /VANTIX_RESTAURANT_V2_NATIVE_CONTROL_P11/);
  assert.match(nativeJs, /\/app\/restaurante-v2\/mesas/);
  assert.match(nativeJs, /\/app\/restaurante-v2\/empleados/);
  assert.match(nativeJs, /\/app\/restaurante-v2\/domicilios/);
  assert.match(panelHtml, /Retiro operativo de V1/);
  assert.match(panelJs, /RETIRAR V1 DE LA OPERACIÓN NORMAL/);
  for (const source of [serviceSource, routeSource, publicSource, launcherJs, nativeJs, panelJs]) assert.doesNotMatch(source, /MutationObserver|setInterval|POLL_MS/);
  for (const source of [launcherHtml, nativeHtml, nativeJs]) assert.doesNotMatch(source, /restaurant-ui\.js|restaurant-control-center\.js|restaurant\.html/);
  new Function(launcherJs); new Function(nativeJs); new Function(panelJs);

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
  const sentinel = { preserved:true, value:'P11_THEME_SENTINEL' };
  await prisma.restaurantConfig.update({
    where:{ tenantId:tenant.id },
    data:{
      dianRealEnabled:false,
      physicalPrinterFieldPass:false,
      themeData:{
        ...priorTheme,
        p11Sentinel:sentinel,
        restaurantV1Retirement:{ enabled:false },
        restaurantV1RetirementHistory:[],
        restaurantV2Cutover:{ enabled:false },
        restaurantV2CutoverHistory:[],
        restaurantV2Pilot:{ enabled:false },
        restaurantV2PilotHistory:[]
      }
    }
  });

  const tablesBefore = await prisma.restaurantTable.findMany({ where:{ tenantId:tenant.id, active:true }, select:{ id:true, qrToken:true } });
  assert.ok(tablesBefore.length > 0);
  const beforeQr = qrMap(tablesBefore);
  const adminSession = sessionFor(admin, tenant);
  const waiterSession = sessionFor(waiter, tenant);

  // Preserve P11 service-state coverage even though P12 owns the public runtime.
  const pilotOn = await pilot.setPilot(tenant.id, admin.id, { enabled:true, notes:'P11 smoke pilot' });
  assert.equal(pilotOn.pilot.enabled, true);
  assert.equal(pilotOn.readiness.ready, true);
  const cutoverOn = await cutover.setCutover(tenant.id, admin.id, { enabled:true, notes:'P11 smoke cutover' });
  assert.equal(cutoverOn.cutover.enabled, true);

  const countsBeforeP11 = await operationalCounts(tenant.id);
  const launchBefore = await retirement.launchDecision(tenant.id);
  assert.equal(launchBefore.enabled, false);
  assert.equal(launchBefore.target, '/app/centro-de-control-p10');
  const stateBefore = await retirement.getState(tenant.id);
  assert.equal(stateBefore.canActivate, true);
  assert.deepEqual(stateBefore.blockers, []);

  const forcedAuditFailure = { auditoriaContable:{ create:async() => { throw Object.assign(new Error('FORCED_P11_AUDIT_FAILURE'), { code:'FORCED_P11_AUDIT_FAILURE' }); } } };
  const enabled = await retirement.setState(tenant.id, admin.id, { enabled:true, notes:'P11 retire V1 normal operation' }, prisma, { auditClient:forcedAuditFailure });
  assert.equal(enabled.retirement.enabled, true);
  assert.equal(enabled.retirement.mode, 'V2_ONLY_NORMAL_OPERATION');
  assert.equal(enabled.audit.operational, 'RECORDED');
  assert.equal(enabled.audit.accountingMirror, 'FAILED');
  assert.ok(enabled.audit.operationalEventId);

  const launchAfter = await retirement.launchDecision(tenant.id);
  assert.equal(launchAfter.enabled, true);
  assert.equal(launchAfter.target, '/app/centro-de-control-v2');
  assert.equal(launchAfter.v1HiddenFromNormalOperation, true);
  assert.equal(launchAfter.v1CodeDeleted, false);
  assert.equal(launchAfter.dianGate, false);

  await withServer(async(base) => {
    const canonical = await publicGet(base, '/app/centro-de-control', 307);
    assertV2Redirect(canonical, '/app/centro-de-control-v2');

    const native = await publicGet(base, '/app/centro-de-control-v2');
    assert.equal(native.response.headers.get('x-vantixgc-restaurant-v1-retirement'), 'p11-v1-retirement');
    assert.match(native.text, /data-v2-native-control="p11"/);
    assert.doesNotMatch(native.text, /restaurant-ui\.js|restaurant-control-center\.js|restaurant\.html|MutationObserver/);

    const p10 = await publicGet(base, '/app/centro-de-control-p10', 307);
    assertV2Redirect(p10, '/app/centro-de-control-v2');

    const employees = await publicGet(base, '/app/restaurante-v2/empleados');
    assert.match(employees.text, /data-p11-module-host="employees"/);
    assert.doesNotMatch(employees.text, /restaurant-ui\.js/);
    const deliveries = await publicGet(base, '/app/restaurante-v2/domicilios');
    assert.match(deliveries.text, /data-p11-module-host="delivery"/);
    assert.doesNotMatch(deliveries.text, /restaurant-ui\.js/);
    assert.equal((await publicGet(base, '/app/restaurant-delivery-ui.js')).response.status, 200);
    assert.equal((await publicGet(base, '/app/restaurant-employees-ui.js')).response.status, 200);
    assert.equal((await publicGet(base, '/app/restaurant-waiter-device-admin.js')).response.status, 200);

    const panel = await publicGet(base, '/app/restaurante-v2/retiro-v1', 307);
    assertV2Redirect(panel, '/app/centro-de-control-v2');

    const restaurantRollback = await publicGet(base, '/app/restaurante-v1', 307);
    assertV2Redirect(restaurantRollback, '/app/centro-de-control-v2');
    const waiterRollback = await publicGet(base, '/app/centro-de-control/mesero-v1', 307);
    assertV2Redirect(waiterRollback, '/app/centro-de-control/mesero-v2/');
    const productionRollback = await publicGet(base, '/app/produccion-v1', 307);
    assertV2Redirect(productionRollback, '/app/produccion-v2/');

    assert.equal((await publicGet(base, '/app/centro-de-control/mesero-v2/')).response.headers.get('x-vantixgc-restaurant-v2-device'), 'waiter-p8');
    assert.equal((await publicGet(base, '/app/produccion-v2/')).response.headers.get('x-vantixgc-restaurant-v2-device'), 'production-p8');

    const state = await api(base, '/api/v1/restaurante/v2/retiro-v1', adminSession);
    assert.equal(state.data.retirement.enabled, true);
    assert.equal(state.data.safety.v1CodeNotDeleted, true);
    await api(base, '/api/v1/restaurante/v2/retiro-v1', waiterSession, { status:403 });
    const waiterLaunch = await api(base, '/api/v1/restaurante/v2/retiro-v1/launch', waiterSession);
    assert.equal(waiterLaunch.data.target, '/app/centro-de-control-v2');

    // P12 blocks every operator-accessible route back to V1.
    const blockedCutover = await api(base, '/api/v1/restaurante/v2/cutover', adminSession, { method:'PATCH', body:{ enabled:false }, status:409 });
    assert.equal(blockedCutover.payload?.error?.code, 'RESTAURANT_V2_ONLY_P12_ROLLBACK_DISABLED');
    const blockedRetirement = await api(base, '/api/v1/restaurante/v2/retiro-v1', adminSession, { method:'PATCH', body:{ enabled:false }, status:409 });
    assert.equal(blockedRetirement.payload?.error?.code, 'RESTAURANT_V2_ONLY_P12_ROLLBACK_DISABLED');
    const blockedPilot = await api(base, '/api/v1/restaurante/v2/piloto', adminSession, { method:'PATCH', body:{ enabled:false }, status:409 });
    assert.equal(blockedPilot.payload?.error?.code, 'RESTAURANT_V2_ONLY_P12_ROLLBACK_DISABLED');
  });

  assert.deepEqual(await operationalCounts(tenant.id), countsBeforeP11, 'P12/P11 no puede crear/modificar ventas, sesiones, pedidos ni pagos por activación');
  assert.deepEqual(qrMap(await prisma.restaurantTable.findMany({ where:{ tenantId:tenant.id, active:true }, select:{ id:true, qrToken:true } })), beforeQr, 'P12/P11 no puede rotar QR físicos');

  // Direct service calls are retained only for isolated test cleanup and code-level rollback.
  const disabled = await retirement.setState(tenant.id, admin.id, { enabled:false, notes:'P11 smoke internal cleanup' }, prisma, { auditClient:forcedAuditFailure });
  assert.equal(disabled.retirement.enabled, false);
  assert.equal(disabled.retirement.mode, 'P10_COMPATIBILITY');
  assert.equal((await retirement.launchDecision(tenant.id)).target, '/app/centro-de-control-p10');
  assert.deepEqual(await operationalCounts(tenant.id), countsBeforeP11, 'cleanup interno tampoco puede afectar operación financiera');
  assert.deepEqual(qrMap(await prisma.restaurantTable.findMany({ where:{ tenantId:tenant.id, active:true }, select:{ id:true, qrToken:true } })), beforeQr, 'cleanup interno no puede rotar QR físicos');

  const stored = await prisma.restaurantConfig.findUnique({ where:{ tenantId:tenant.id } });
  assert.deepEqual(stored.themeData.p11Sentinel, sentinel, 'P11 debe preservar themeData ajeno');
  assert.equal(stored.themeData.restaurantV1Retirement.enabled, false);
  assert.ok(Array.isArray(stored.themeData.restaurantV1RetirementHistory));
  assert.equal(stored.themeData.restaurantV1RetirementHistory.length, 2);
  assert.equal(stored.themeData.restaurantV1RetirementHistory[0].action, 'RETIRE_V1_NORMAL_OPERATION');
  assert.equal(stored.themeData.restaurantV1RetirementHistory[1].action, 'RESTORE_P10_COMPATIBILITY');

  const cutoverOff = await cutover.setCutover(tenant.id, admin.id, { enabled:false, notes:'P11 smoke cleanup cutover' });
  assert.equal(cutoverOff.cutover.enabled, false);
  const pilotOff = await pilot.setPilot(tenant.id, admin.id, { enabled:false, notes:'P11 smoke cleanup pilot' });
  assert.equal(pilotOff.pilot.enabled, false);

  console.log('RESTAURANT V1 RETIREMENT P11/P12 DB SMOKE OK', JSON.stringify({ tenant:tenant.subdomain, tables:tablesBefore.length, qrStable:true, financialStable:true, nativeControl:true, p10Runtime:false, v1Runtime:false, sourceRollbackPreserved:true, historyEvents:2 }));
}

main().catch((error) => { console.error('RESTAURANT V1 RETIREMENT P11/P12 DB SMOKE ERROR', error); process.exitCode=1; }).finally(async() => prisma.$disconnect());
