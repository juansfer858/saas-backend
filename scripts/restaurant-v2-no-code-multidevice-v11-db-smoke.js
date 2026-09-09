'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { app } = require('../src/app');
const { verifyAccessToken } = require('../src/utils/jwt');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const waiterDevices = require('../src/modules/restaurant/restaurant-waiter-device.service');
const { money, pct, qty, decimal } = require('../src/utils/decimal');

function rawPairToken(url) {
  const value = new URL(url).searchParams.get('t');
  assert.ok(value && value.length >= 20, 'Falta token QR de Mesero');
  return value;
}
function lineTotal(menuItem, quantity) {
  const q = qty(quantity);
  const price = money(menuItem.product.precio1 || 0);
  const subtotal = money(q.mul(price));
  const iva = money(subtotal.mul(pct(menuItem.product.ivaPct || 0)).div(100));
  const impoconsumo = money(subtotal.mul(pct(menuItem.product.impoconsumoPct || 0)).div(100));
  return money(decimal(subtotal).plus(iva).plus(impoconsumo));
}
async function withServer(run) {
  const server = await new Promise((resolve,reject)=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));instance.once('error',reject)});
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve=>server.close(resolve)); }
}
async function request(base, path, { session=null, visitToken='', method='GET', body, status=200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    cache:'no-store',
    headers:{
      Accept:'application/json',
      ...(session ? { Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain } : {}),
      ...(visitToken ? { 'x-vantix-restaurant-visit':visitToken } : {}),
      ...(body !== undefined ? { 'Content-Type':'application/json' } : {})
    },
    ...(body !== undefined ? { body:JSON.stringify(body) } : {})
  });
  let payload={}; try { payload=await response.json(); } catch {}
  assert.equal(response.status,status,`${method} ${path} esperaba ${status}: ${JSON.stringify(payload)}`);
  return payload.data;
}

async function main() {
  const addon = fs.readFileSync('src/web/restaurant-v2-client-qr-open-request.js','utf8');
  const qrHtml = fs.readFileSync('src/web/restaurant-v2-client-qr.html','utf8');
  const pairHtml = fs.readFileSync('src/web/restaurant-waiter-pair.html','utf8');
  const adminJs = fs.readFileSync('src/web/restaurant-waiter-device-admin.js','utf8');
  const visitRoutes = fs.readFileSync('src/modules/restaurant/restaurant-visit.public.routes.js','utf8');
  const noCodeService = fs.readFileSync('src/modules/restaurant/restaurant-v2-qr-no-code.service.js','utf8');
  const waiterService = fs.readFileSync('src/modules/restaurant/restaurant-waiter-device.service.js','utf8');

  assert.match(addon,/VANTIX_RESTAURANT_V2_QR_NO_CODE_V11/);
  assert.match(qrHtml,/VANTIX_RESTAURANT_V2_QR_NO_CODE_V11/);
  assert.match(addon,/\/iniciar-visita/);
  assert.doesNotMatch(addon,/\/autorizar/);
  assert.match(addon,/visibleAccessCode:false/);
  assert.match(addon,/automaticSendAfterOpening:true/);
  assert.match(addon,/solicitar-apertura/);
  assert.doesNotMatch(addon,/MutationObserver|setInterval|POLL_MS/);
  assert.match(visitRoutes,/\/iniciar-visita/);
  assert.match(noCodeService,/noCode:true/);
  assert.match(waiterService,/RESTAURANT_WAITER_ENROLLMENT_V2/);
  assert.match(waiterService,/MAX_ACTIVE_DEVICES_PER_WAITER/);
  assert.match(pairHtml,/mismo QR/);
  assert.match(adminJs,/QR reutilizable/);
  new Function(addon);
  new Function(adminJs);

  const demo = await ensureRestaurantDemoTenant();
  const [admin, waiter] = await Promise.all([
    prisma.user.findUnique({ where:{ id:demo.users.ADMIN } }),
    prisma.user.findUnique({ where:{ id:demo.users.MESERO } })
  ]);
  assert.ok(admin?.id && waiter?.id, 'Demo necesita ADMIN y MESERO');

  const pair = await waiterDevices.createPairing(demo.tenantId, admin.id, { userId:waiter.id, deviceName:'Tablet Mesero V11' });
  assert.equal(pair.reusable,true);
  assert.equal(pair.multipleDevices,true);
  assert.equal(pair.expiresAt,null);
  const pairToken = rawPairToken(pair.url);
  const inspection = await waiterDevices.inspectPairing(pairToken);
  assert.equal(inspection.reusable,true);

  const claimA = await waiterDevices.claimPairing(pairToken,{ deviceName:'Tablet A', userAgent:'V11-A' });
  const jwtA = verifyAccessToken(claimA.session.token);
  assert.equal(jwtA.deviceId,pair.deviceId,'Primer claim conserva compatibilidad deviceId');
  const claimB = await waiterDevices.claimPairing(pairToken,{ deviceName:'Tablet B', userAgent:'V11-B' });
  assert.notEqual(claimB.deviceId,claimA.deviceId,'Mismo QR debe crear dispositivo B independiente');
  await waiterDevices.assertActiveDevice(claimA.deviceId,demo.tenantId,waiter.id);
  await waiterDevices.assertActiveDevice(claimB.deviceId,demo.tenantId,waiter.id);
  const listed = await waiterDevices.listDevices(demo.tenantId);
  assert.ok(listed.some(row=>row.id===claimA.deviceId&&row.active));
  assert.ok(listed.some(row=>row.id===claimB.deviceId&&row.active));

  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const zone = await prisma.restaurantZone.create({ data:{ tenantId:demo.tenantId, name:`V11 ${suffix}`, sortOrder:998 } });
  const table = await prisma.restaurantTable.create({ data:{ tenantId:demo.tenantId, zoneId:zone.id, code:`V11-${suffix}`, name:`Mesa V11 ${suffix}`, seats:4, assignedWaiterId:waiter.id, active:true } });
  const qrBefore = table.qrToken;
  const menu = (await restaurant.listMenu(demo.tenantId)).filter(row=>!row.warning&&row.product&&row.active!==false);
  const menuItem = menu.find(row=>row.station==='COCINA') || menu[0];
  assert.ok(menuItem?.id,'Falta producto vendible para V11');
  const confirmedTotal = Number(lineTotal(menuItem,1).toString());

  await withServer(async base=>{
    const openRequest = await request(base,`/api/public/restaurante/qr/${encodeURIComponent(qrBefore)}/solicitar-apertura`,{method:'POST',body:{},status:202});
    assert.equal(openRequest.requested,true);
    assert.equal(await prisma.restaurantTableSession.count({where:{tenantId:demo.tenantId,tableId:table.id,state:{in:['ABIERTA','CUENTA_PEDIDA']}}}),0,'QR cliente no abre mesa');

    await request(base,`/api/public/restaurante/qr/${encodeURIComponent(qrBefore)}/iniciar-visita`,{method:'POST',body:{seatNumber:1},status:409});
    const pending = await request(base,'/api/v1/restaurante/v2/solicitudes-apertura',{session:claimA.session});
    const row = pending.requests.find(item=>item.id===openRequest.id);
    assert.ok(row,'Mesero V2 debe ver solicitud de apertura');
    const opened = await request(base,`/api/v1/restaurante/v2/solicitudes-apertura/${encodeURIComponent(row.id)}/abrir`,{session:claimA.session,method:'POST',body:{guestCount:2},status:201});
    assert.ok(opened.session?.id,'Personal debe abrir mesa real');

    const visit = await request(base,`/api/public/restaurante/qr/${encodeURIComponent(qrBefore)}/iniciar-visita`,{method:'POST',body:{seatNumber:1}});
    assert.ok(visit.visitToken,'Inicio sin código debe devolver token opaco');
    assert.equal(visit.noCode,true);
    const externalRequestId=`V11-${suffix}`;
    const order = await request(base,`/api/public/restaurante/qr/${encodeURIComponent(qrBefore)}/pedidos`,{
      method:'POST',
      visitToken:visit.visitToken,
      body:{ items:[{menuItemId:menuItem.id,quantity:1,notes:'SIN CÓDIGO V11'}], confirmedTotal, externalRequestId },
      status:201
    });
    assert.equal(order.source,'QR');
    assert.equal(order.sessionId,opened.session.id);
    const commands = await prisma.restaurantCommand.findMany({where:{tenantId:demo.tenantId,orderId:order.id}});
    assert.ok(commands.length>=1,'Pedido QR sin código debe crear comanda real');

    const reused = await request(base,`/api/public/restaurante/qr/${encodeURIComponent(qrBefore)}/iniciar-visita`,{method:'POST',visitToken:visit.visitToken,body:{seatNumber:1}});
    assert.equal(reused.visitToken,visit.visitToken,'Token de la misma visita debe reutilizarse');
    assert.equal(reused.reused,true);
  });

  const after = await prisma.restaurantTable.findUnique({where:{id:table.id}});
  assert.equal(after.qrToken,qrBefore,'QR físico de la mesa no cambia');

  await waiterDevices.revokeDevice(demo.tenantId,admin.id,claimA.deviceId);
  await assert.rejects(()=>waiterDevices.assertActiveDevice(claimA.deviceId,demo.tenantId,waiter.id),/desautorizado/i);
  await waiterDevices.assertActiveDevice(claimB.deviceId,demo.tenantId,waiter.id);
  const claimC = await waiterDevices.claimPairing(pairToken,{deviceName:'Tablet C',userAgent:'V11-C'});
  assert.notEqual(claimC.deviceId,claimA.deviceId);
  assert.notEqual(claimC.deviceId,claimB.deviceId);
  await waiterDevices.assertActiveDevice(claimC.deviceId,demo.tenantId,waiter.id);
  const pairAgain = await waiterDevices.createPairing(demo.tenantId,admin.id,{userId:waiter.id,deviceName:'Otra tablet'});
  assert.equal(rawPairToken(pairAgain.url),pairToken,'Administración debe recuperar el mismo QR reutilizable');

  console.log(JSON.stringify({
    ok:true,
    marker:'RESTAURANT_V2_NO_CODE_MULTI_DEVICE_V11_OK',
    clientVisibleCode:false,
    staffOpeningRequired:true,
    automaticSendAfterOpening:true,
    permanentTableQrPreserved:true,
    realQrCommand:true,
    reusableWaiterQr:true,
    multipleTabletsSameWaiter:true,
    independentRevocation:true,
    legacyFirstDeviceCompatibility:true
  },null,2));
}

main().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>prisma.$disconnect());
