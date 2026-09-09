'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { prisma } = require('../src/config/prisma');
const { app } = require('../src/app');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const visits = require('../src/modules/restaurant/restaurant-visit-payments.service');
const openRequests = require('../src/modules/restaurant/restaurant-v2-table-open-request.service');
const waiterDevices = require('../src/modules/restaurant/restaurant-waiter-device.service');
const { decimal, money, pct, qty } = require('../src/utils/decimal');

function rawPairToken(url) {
  const token = new URL(url).searchParams.get('t');
  assert.ok(token && token.length >= 20, 'Falta token de vinculación');
  return token;
}

function visitCode(session) {
  const secret = String(process.env.RESTAURANT_QR_VISIT_SECRET || process.env.JWT_SECRET || '');
  assert.ok(secret.length >= 32, 'Se requiere secreto de visita QR');
  const digest = crypto.createHmac('sha256', secret).update(`restaurant-visit|${session.id}|${session.qrVisitNonce}`).digest();
  return String(digest.readUInt32BE(0) % 10000).padStart(4, '0');
}

function confirmedLineTotal(menuItem, quantity) {
  const q = qty(quantity);
  const price = money(menuItem.product.precio1 || 0);
  const subtotal = money(q.mul(price));
  const iva = money(subtotal.mul(pct(menuItem.product.ivaPct || 0)).div(100));
  const impoconsumo = money(subtotal.mul(pct(menuItem.product.impoconsumoPct || 0)).div(100));
  return money(decimal(subtotal).plus(iva).plus(impoconsumo));
}

async function withServer(run) {
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function json(base, path, session = null, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    cache:'no-store',
    headers:{
      Accept:'application/json',
      ...(session ? { Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain } : {}),
      ...(options.body !== undefined ? { 'Content-Type':'application/json' } : {})
    },
    ...(options.body !== undefined ? { body:JSON.stringify(options.body) } : {})
  });
  let body = {};
  try { body = await response.json(); } catch {}
  assert.equal(response.status, options.status || 200, `${options.method || 'GET'} ${path}: ${JSON.stringify(body)}`);
  return body.data;
}

async function browserSdkContract(waiterSession) {
  const source = fs.readFileSync('src/web/restaurant-v2-device-sdk-p8.js', 'utf8');
  assert.match(source, /VANTIX_RESTAURANT_V2_DEVICE_PERSISTENCE_P10_FIX/);
  assert.match(source, /sessionPreservedOnForbidden:true/);
  assert.match(source, /explicitRevocationOnly:true/);
  assert.match(source, /RESTAURANT_WAITER_DEVICE_REVOKED/);
  assert.doesNotMatch(source, /response\.status===401\|\|response\.status===403\)\{\s*localStorage\.removeItem/);

  const store = new Map();
  store.set('vantixgc_core_session_v1', JSON.stringify(waiterSession));
  const localStorage = {
    getItem:key => store.has(key) ? store.get(key) : null,
    setItem:(key,value) => store.set(key,String(value)),
    removeItem:key => store.delete(key)
  };
  let next = { status:403, code:'RESTAURANT_WAITER_TABLE_FORBIDDEN', message:'Mesa no permitida' };
  const sandbox = {
    localStorage,
    document:{ body:{ dataset:{ vantixDevice:'waiter' } }, documentElement:{ dataset:{} } },
    window:{ dispatchEvent(){} },
    CustomEvent:function CustomEvent(name, init){ this.type=name; this.detail=init?.detail; },
    fetch:async()=>({
      ok:next.status >= 200 && next.status < 300,
      status:next.status,
      json:async()=>next.status >= 400 ? { error:{ code:next.code, message:next.message } } : { data:{ ok:true } }
    }),
    Intl,
    console
  };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(source, sandbox, { filename:'restaurant-v2-device-sdk-p8.js' });
  assert.ok(sandbox.window.RestaurantV2, 'SDK P8 no inició en browser simulado');

  await assert.rejects(() => sandbox.window.RestaurantV2.api('/api/v1/restaurante/v2/mesas'), /Mesa no permitida/);
  assert.ok(store.has('vantixgc_core_session_v1'), 'Un 403 de negocio no puede borrar el vínculo principal');
  assert.ok(store.has('vantixgc_waiter_device_session_v26'), 'Un 403 de negocio debe conservar respaldo persistente');

  next = { status:200 };
  await sandbox.window.RestaurantV2.api('/api/v1/restaurante/v2/mesas');
  assert.ok(store.has('vantixgc_core_session_v1'), 'La sesión debe seguir utilizable después del 403');

  next = { status:401, code:'RESTAURANT_WAITER_DEVICE_REVOKED', message:'Dispositivo desautorizado' };
  await assert.rejects(() => sandbox.window.RestaurantV2.api('/api/v1/restaurante/v2/mesas'), /desautorizado/i);
  assert.equal(store.has('vantixgc_core_session_v1'), false, 'Revocación real debe borrar la sesión principal');
  assert.equal(store.has('vantixgc_waiter_device_session_v26'), false, 'Revocación real debe borrar el respaldo');
}

async function main() {
  const qrAddon = fs.readFileSync('src/web/restaurant-v2-client-qr-open-request.js','utf8');
  const qrHtml = fs.readFileSync('src/web/restaurant-v2-client-qr.html','utf8');
  const tablesJs = fs.readFileSync('src/web/restaurant-v2-tables.js','utf8');
  const tablesHtml = fs.readFileSync('src/web/restaurant-v2-tables.html','utf8');
  const ordersJs = fs.readFileSync('src/web/restaurant-v2-orders.js','utf8');
  const ordersHtml = fs.readFileSync('src/web/restaurant-v2-orders.html','utf8');
  const waiterHtml = fs.readFileSync('src/web/restaurant-v2-waiter-p8.html','utf8');
  const waiterSw = fs.readFileSync('src/web/restaurant-v2-waiter-sw-p8.js','utf8');

  assert.match(qrHtml, /restaurant-v2-client-qr-open-request\.js/);
  assert.match(qrAddon, /\/solicitar-apertura/);
  assert.match(qrAddon, /EventSource/);
  assert.match(qrAddon, /opensTableAutomatically:false/);
  assert.doesNotMatch(qrAddon, /MutationObserver|setInterval|POLL_MS/);
  assert.match(tablesJs, /SOLICITA APERTURA/);
  assert.match(tablesJs, /v2\/solicitudes-apertura/);
  assert.match(tablesHtml, /vantix-tenant-realtime\.js/);
  assert.match(ordersJs, /ABRIR MESA · CLIENTE ESPERANDO/);
  assert.match(ordersJs, /v2\/solicitudes-apertura/);
  assert.match(ordersHtml, /vantix-tenant-realtime\.js/);
  assert.match(waiterHtml, /restaurant-v2-device-realtime-p8\.js/);
  assert.match(waiterSw, /restaurant-v2-device-realtime-p8\.js/);
  for (const source of [tablesJs, ordersJs, qrAddon]) assert.doesNotMatch(source, /MutationObserver|setInterval|POLL_MS/);
  new Function(qrAddon); new Function(tablesJs); new Function(ordersJs); new Function(waiterSw);

  const demo = await ensureRestaurantDemoTenant();
  const [admin, waiter] = await Promise.all([
    prisma.user.findUnique({ where:{ id:demo.users.ADMIN } }),
    prisma.user.findUnique({ where:{ id:demo.users.MESERO } })
  ]);
  assert.ok(admin?.id && waiter?.id, 'Demo necesita ADMIN y MESERO');

  const pair = await waiterDevices.createPairing(demo.tenantId, admin.id, { userId:waiter.id, deviceName:'Mesero P10 Fix CI' });
  const waiterSession = (await waiterDevices.claimPairing(rawPairToken(pair.url), { deviceName:'Mesero P10 Fix CI', userAgent:'P10-FIX-CI' })).session;
  await browserSdkContract(waiterSession);

  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const zone = await prisma.restaurantZone.create({ data:{ tenantId:demo.tenantId, name:`P10 FIX ${suffix}`, sortOrder:999 } });
  const table = await prisma.restaurantTable.create({
    data:{ tenantId:demo.tenantId, zoneId:zone.id, code:`FX-${suffix}`, name:`Mesa Fix ${suffix}`, seats:4, assignedWaiterId:waiter.id, active:true }
  });
  const qrBefore = table.qrToken;
  const menu = (await restaurant.listMenu(demo.tenantId)).filter(row => !row.warning && row.product && row.active !== false);
  const menuItem = menu.find(row => row.station === 'COCINA') || menu[0];
  assert.ok(menuItem?.id, 'Falta producto vendible');

  assert.equal(await prisma.restaurantTableSession.count({ where:{ tenantId:demo.tenantId, tableId:table.id, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } } }), 0);
  const request1 = await openRequests.createRequest(qrBefore);
  const request2 = await openRequests.createRequest(qrBefore);
  assert.equal(request1.requested, true);
  assert.equal(request2.id, request1.id, 'Repetir Enviar no debe duplicar la solicitud');
  assert.equal(request2.alreadyPending, true);
  assert.equal(await prisma.restaurantTableSession.count({ where:{ tenantId:demo.tenantId, tableId:table.id, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } } }), 0, 'QR no puede abrir mesa automáticamente');
  assert.equal(await prisma.comprobanteComercial.count({ where:{ tenantId:demo.tenantId, sourceId:{ contains:table.id } } }), 0, 'Solicitar apertura no debe crear venta');
  const pending = await openRequests.listPending(demo.tenantId);
  assert.ok(pending.requests.some(row => row.id === request1.id && row.table.id === table.id));

  await withServer(async base => {
    const publicRequest = await json(base, `/api/public/restaurante/qr/${encodeURIComponent(qrBefore)}/solicitar-apertura`, null, { method:'POST', body:{}, status:202 });
    assert.equal(publicRequest.id, request1.id, 'Endpoint público debe ser idempotente');

    const list = await json(base, '/api/v1/restaurante/v2/solicitudes-apertura', waiterSession);
    assert.ok(list.requests.some(row => row.id === request1.id));
    const opened = await json(base, `/api/v1/restaurante/v2/solicitudes-apertura/${encodeURIComponent(request1.id)}/abrir`, waiterSession, { method:'POST', body:{ guestCount:2 }, status:201 });
    assert.ok(opened.session?.id, 'Mesero V2 debe abrir la sesión real');
    assert.equal(Number(opened.session.guestCount), 2);

    const afterOpen = await json(base, '/api/v1/restaurante/v2/solicitudes-apertura', waiterSession);
    assert.equal(afterOpen.requests.some(row => row.id === request1.id), false, 'Solicitud debe desaparecer al abrir');

    const session = await prisma.restaurantTableSession.findFirst({ where:{ tenantId:demo.tenantId, tableId:table.id, state:'ABIERTA' } });
    assert.ok(session?.id);
    const auth = await visits.authorizeVisit(qrBefore, visitCode(session), 1);
    const expectedTotal = confirmedLineTotal(menuItem, 1);
    const order = await visits.placeAuthorizedQrOrder(qrBefore, auth.visitToken, {
      items:[{ menuItemId:menuItem.id, quantity:1, notes:'P10 FIX QR' }],
      confirmedTotal:Number(expectedTotal.toString()),
      externalRequestId:`P10-FIX-${suffix}`
    });
    const commands = await prisma.restaurantCommand.findMany({ where:{ tenantId:demo.tenantId, orderId:order.id } });
    assert.ok(commands.length >= 1, 'Pedido QR autorizado debe crear comanda real');

    // Reproduce el 403 real que antes hacía que el browser P8 borrara su localStorage:
    // Mesero puede leer las comandas pero no cambiar el estado de Producción.
    await json(base, `/api/v1/restaurante/v2/kds/comandas/${encodeURIComponent(commands[0].id)}`, waiterSession, { method:'PATCH', body:{ state:'LISTA' }, status:403 });
    const floorStillValid = await json(base, '/api/v1/restaurante/v2/mesas', waiterSession);
    assert.ok(floorStillValid.some(row => row.id === table.id), 'El mismo vínculo Mesero debe seguir válido después del 403');
  });

  const tableAfter = await prisma.restaurantTable.findUnique({ where:{ id:table.id } });
  assert.equal(tableAfter.qrToken, qrBefore, 'El QR físico no cambia durante solicitud/apertura');

  console.log(JSON.stringify({
    ok:true,
    marker:'RESTAURANT_V2_PILOT_BLOCKERS_P10_FIXED',
    qrFreeTableRequest:true,
    qrRequestIdempotent:true,
    qrDoesNotAutoOpen:true,
    staffApprovalRequired:true,
    physicalQrPreserved:true,
    qrOrderCreatesCommand:true,
    waiterBusiness403KeepsPairing:true,
    explicitRevocationClearsPairing:true,
    waiterRealtime:true,
    eventDriven:true
  }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async()=>prisma.$disconnect());
