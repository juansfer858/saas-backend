'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const { prisma }=require('../src/config/prisma');
const { verifyAccessToken }=require('../src/utils/jwt');
const { app }=require('../src/app');
const waiterDevices=require('../src/modules/restaurant/restaurant-waiter-device.service');
const productionDevices=require('../src/modules/restaurant/restaurant-production-device-v63.service');
const { ensureRestaurantDemoTenant,SUBDOMAIN }=require('./ensure-restaurant-demo-tenant');

const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

async function withHttpServer(run){
  const server=await new Promise((resolve,reject)=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));instance.once('error',reject)});
  try{return await run(`http://127.0.0.1:${server.address().port}`)}finally{await new Promise(resolve=>server.close(resolve))}
}
async function requestJson(baseUrl,url,session,{method='GET',body=null,status=200}={}){
  const response=await fetch(`${baseUrl}${url}`,{method,cache:'no-store',headers:{Authorization:`Bearer ${session.token}`,'x-tenant-subdomain':session.subdomain,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let payload={};try{payload=await response.json()}catch{}
  assert.equal(response.status,status,`${method} ${url} esperaba ${status}: ${JSON.stringify(payload)}`);
  return {response,payload,data:payload.data};
}
async function publicText(baseUrl,url,status=200){const response=await fetch(`${baseUrl}${url}`,{cache:'no-store',redirect:'manual'});const text=await response.text();assert.equal(response.status,status,`${url} esperaba ${status}`);return{response,text}}
function rawPairToken(url){const value=new URL(url).searchParams.get('t');assert.ok(value&&value.length>=20,'token temporal faltante');return value}

async function main(){
  const publicRoot=read('src/modules/restaurant/restaurant.public.routes.js');
  const p8Router=read('src/modules/restaurant/restaurant-v2-device-pwa-p8.public.routes.js');
  const sdk=read('src/web/restaurant-v2-device-sdk-p8.js');
  const realtime=read('src/web/restaurant-v2-device-realtime-p8.js');
  const pwa=read('src/web/restaurant-v2-device-pwa-p8.js');
  const waiterHtml=read('src/web/restaurant-v2-waiter-p8.html');
  const productionHtml=read('src/web/restaurant-v2-production-p8.html');
  const waiterSw=read('src/web/restaurant-v2-waiter-sw-p8.js');
  const productionSw=read('src/web/restaurant-v2-production-sw-p8.js');
  const waiterManifest=JSON.parse(read('src/web/restaurant-v2-waiter-p8.webmanifest'));
  const productionManifest=JSON.parse(read('src/web/restaurant-v2-production-p8.webmanifest'));

  assert.match(publicRoot,/restaurantV2DevicePwaP8PublicRouter/);
  assert.match(p8Router,/\/app\/centro-de-control\/mesero-v2\//);
  assert.match(p8Router,/\/app\/produccion-v2\//);
  assert.equal(waiterManifest.scope,'/app/centro-de-control/mesero-v2/');
  assert.equal(waiterManifest.start_url,'/app/centro-de-control/mesero-v2/');
  assert.equal(productionManifest.scope,'/app/produccion-v2/');
  assert.equal(productionManifest.start_url,'/app/produccion-v2/');
  assert.notEqual(waiterManifest.scope,'/app/centro-de-control');
  assert.notEqual(productionManifest.scope,'/app/produccion');
  assert.match(waiterHtml,/data-vantix-device="waiter"/);
  assert.match(waiterHtml,/restaurant-v2-orders\.js/);
  assert.match(productionHtml,/data-vantix-device="production"/);
  assert.match(productionHtml,/restaurant-v2-kds\.js/);
  assert.match(productionHtml,/restaurant-v2-device-realtime-p8\.js/);
  assert.match(productionHtml,/restaurant-push-v65\.js/);
  assert.match(sdk,/vantixgc_core_session_v1/);
  assert.match(sdk,/vantixgc_restaurant_production_device_v63/);
  assert.match(sdk,/WAITER|waiter/);
  assert.match(sdk,/COCINA/);
  assert.match(realtime,/SSE\+PG_NOTIFY/);
  assert.match(realtime,/RestaurantV2\?\.readSession/);
  for(const source of [sdk,realtime,pwa]){assert.doesNotMatch(source,/MutationObserver|setInterval|POLL_MS/)}
  for(const sw of [waiterSw,productionSw]){assert.match(sw,/url\.pathname\.startsWith\('\/api\/'\)\)return/);assert.doesNotMatch(sw,/request\.method\s*!==\s*'GET'.*(POST|PUT|PATCH|DELETE)/s)}
  new Function(sdk);new Function(realtime);new Function(pwa);new Function(waiterSw);new Function(productionSw);

  const seeded=await ensureRestaurantDemoTenant();
  const tenant=await prisma.tenant.findUnique({where:{subdomain:SUBDOMAIN}});assert.ok(tenant?.id);
  const [admin,waiter,cook]=await Promise.all([
    prisma.user.findFirst({where:{tenantId:tenant.id,rol:'ADMIN',activo:true}}),
    prisma.user.findFirst({where:{tenantId:tenant.id,rol:'MESERO',activo:true}}),
    prisma.user.findFirst({where:{tenantId:tenant.id,rol:'COCINA',activo:true}})
  ]);
  assert.ok(admin?.id&&waiter?.id&&cook?.id,'usuarios demo incompletos');

  const waiterPair=await waiterDevices.createPairing(tenant.id,admin.id,{userId:waiter.id,deviceName:'P8 Mesero CI'});
  const waiterSession=(await waiterDevices.claimPairing(rawPairToken(waiterPair.url),{deviceName:'P8 Mesero CI',userAgent:'VantixGC-P8-CI'})).session;
  const productionPair=await productionDevices.createPairing(tenant.id,admin.id,{userId:cook.id,deviceName:'P8 Cocina CI'});
  const productionClaim=await productionDevices.claimPairing(rawPairToken(productionPair.url),{deviceName:'P8 Cocina CI',userAgent:'VantixGC-P8-CI'});
  const productionSession=productionClaim.session;

  const waiterJwt=verifyAccessToken(waiterSession.token);assert.equal(waiterJwt.authType,'WAITER_DEVICE');assert.equal(waiterJwt.deviceId,waiterPair.deviceId);
  const productionJwt=verifyAccessToken(productionSession.token);assert.equal(productionJwt.authType,'PRODUCTION_DEVICE');assert.equal(productionJwt.deviceId,productionPair.deviceId);
  assert.equal(productionClaim.station,'COCINA');

  const suffix=crypto.randomBytes(4).toString('hex').toUpperCase();
  const table=await prisma.restaurantTable.create({data:{tenantId:tenant.id,code:`P8-${suffix}`,name:`Mesa P8 ${suffix}`,seats:4,posX:10,posY:10,assignedWaiterId:waiter.id,active:true}});
  const kitchenMenu=await prisma.restaurantMenuItem.findFirst({where:{tenantId:tenant.id,station:'COCINA',active:true}});assert.ok(kitchenMenu?.id);

  await withHttpServer(async baseUrl=>{
    const waiterPage=await publicText(baseUrl,'/app/centro-de-control/mesero-v2/');
    assert.equal(waiterPage.response.headers.get('x-vantixgc-restaurant-v2-device'),'waiter-p8');
    assert.match(waiterPage.text,/RESTAURANTE V2 · MESERO P8/);
    const productionPage=await publicText(baseUrl,'/app/produccion-v2/');
    assert.equal(productionPage.response.headers.get('x-vantixgc-restaurant-v2-device'),'production-p8');
    assert.match(productionPage.text,/RESTAURANTE V2 · PRODUCCIÓN P8/);

    const legacyWaiter=await publicText(baseUrl,'/app/centro-de-control/mesero?view=mesero&pwa=1');
    assert.equal(legacyWaiter.response.headers.get('x-vantixgc-waiter-pwa'),'v14-review-hard-gate-persistent');
    const legacyProduction=await publicText(baseUrl,'/app/produccion');
    assert.equal(legacyProduction.response.headers.get('x-vantixgc-production-pwa'),'v71-installable');

    const waiterManifestHttp=await fetch(`${baseUrl}/app/centro-de-control/mesero-v2/manifest.webmanifest`,{cache:'no-store'});assert.equal(waiterManifestHttp.status,200);assert.equal((await waiterManifestHttp.json()).scope,waiterManifest.scope);
    const productionManifestHttp=await fetch(`${baseUrl}/app/produccion-v2/manifest.webmanifest`,{cache:'no-store'});assert.equal(productionManifestHttp.status,200);assert.equal((await productionManifestHttp.json()).scope,productionManifest.scope);
    const waiterSwHttp=await publicText(baseUrl,'/app/centro-de-control/mesero-v2/sw.js');assert.equal(waiterSwHttp.response.headers.get('service-worker-allowed'),'/app/centro-de-control/mesero-v2/');
    const productionSwHttp=await publicText(baseUrl,'/app/produccion-v2/sw.js');assert.equal(productionSwHttp.response.headers.get('service-worker-allowed'),'/app/produccion-v2/');

    const tablesResult=await requestJson(baseUrl,'/api/v1/restaurante/v2/mesas',waiterSession);assert.equal(tablesResult.response.status,200);assert.ok(tablesResult.data.some(row=>row.id===table.id),'P8 Mesero debe ver la mesa de prueba');
    const opened=(await requestJson(baseUrl,`/api/v1/restaurante/v2/mesas/${table.id}/abrir`,waiterSession,{method:'POST',body:{guestCount:2},status:201})).data;
    assert.ok(opened?.session?.id,'P8 Mesero debe abrir una sesión real');
    const sessionId=opened.session.id;
    await requestJson(baseUrl,`/api/v1/restaurante/v2/sesiones/${sessionId}/pedido/items/${kitchenMenu.id}`,waiterSession,{method:'PUT',body:{quantity:1,seatNumber:1}});
    const draft=(await requestJson(baseUrl,`/api/v1/restaurante/v2/sesiones/${sessionId}/pedido`,waiterSession)).data;assert.ok(draft?.order?.items?.length===1,'P8 Mesero debe construir pedido P3');
    await requestJson(baseUrl,`/api/v1/restaurante/v2/sesiones/${sessionId}/pedido/enviar`,waiterSession,{method:'POST',body:{}});

    const kds=(await requestJson(baseUrl,'/api/v1/restaurante/v2/kds?station=COCINA',productionSession)).data;
    const command=(kds.commands||[]).find(row=>row.order?.sessionId===sessionId||row.order?.session?.id===sessionId);
    assert.ok(command?.id,'P8 Producción debe recibir la comanda creada por P8 Mesero');
    assert.equal(command.state,'PENDIENTE');
    await requestJson(baseUrl,`/api/v1/restaurante/v2/kds/comandas/${command.id}`,productionSession,{method:'PATCH',body:{state:'EN_PREPARACION'}});

    const productionFloor=await requestJson(baseUrl,'/api/v1/restaurante/v2/mesas',productionSession,{status:403});assert.equal(productionFloor.response.status,403,'Producción no debe adquirir el piso de Mesero');
    const waiterKds=await requestJson(baseUrl,'/api/v1/restaurante/v2/kds?station=COCINA',waiterSession,{status:403});assert.equal(waiterKds.response.status,403,'Mesero no debe adquirir edición KDS');

    await productionDevices.revokeDevice(tenant.id,admin.id,productionPair.deviceId);
    await requestJson(baseUrl,'/api/v1/restaurante/v2/kds?station=COCINA',productionSession,{status:401});
    await waiterDevices.revokeDevice(tenant.id,admin.id,waiterPair.deviceId);
    await requestJson(baseUrl,'/api/v1/restaurante/v2/mesas',waiterSession,{status:401});
  });

  console.log(JSON.stringify({ok:true,phase:'P8_DEVICE_PWA',tenant:seeded.subdomain,waiterDeviceReuse:true,productionDeviceReuse:true,waiterEngine:'P3',productionEngine:'P6',realtime:'SSE+PG_NOTIFY',parallelScopes:true,v1Fallback:true,serverRevocation:true,crossRoleEscalation:false},null,2));
}

main().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>prisma.$disconnect());
