'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const work = require('../src/modules/restaurant/restaurant-employee-work.service');
const printingStations = require('../src/modules/platform/printing/printing-stations.service');
const push = require('../src/modules/notifications/push-v65.service');
const kds = require('../src/modules/restaurant/restaurant-v2-kds.service');
const kdsPush = require('../src/modules/restaurant/restaurant-v2-kds-push.service');
const realtimeRoutes = require('../src/modules/realtime/tenant-realtime.routes');
const { V2_OPTIONS } = require('../src/modules/restaurant/restaurant-v2-orders.routes');

async function main() {
  const core = fs.readFileSync('src/routes/core.routes.js', 'utf8');
  const aggregator = fs.readFileSync('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js', 'utf8');
  const routes = fs.readFileSync('src/modules/restaurant/restaurant-v2-kds.routes.js', 'utf8');
  const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-v2-kds.public.routes.js', 'utf8');
  const service = fs.readFileSync('src/modules/restaurant/restaurant-v2-kds.service.js', 'utf8');
  const pushService = fs.readFileSync('src/modules/restaurant/restaurant-v2-kds-push.service.js', 'utf8');
  const p3Routes = fs.readFileSync('src/modules/restaurant/restaurant-v2-orders.routes.js', 'utf8');
  const html = fs.readFileSync('src/web/restaurant-v2-kds.html', 'utf8');
  const ui = fs.readFileSync('src/web/restaurant-v2-kds.js', 'utf8');
  const css = fs.readFileSync('src/web/restaurant-v2-kds.css', 'utf8');

  assert.match(core, /restaurantV2KdsRouter/);
  assert.match(core, /router\.use\('\/restaurante', restaurantV2KdsRouter\)/);
  assert.match(aggregator, /restaurantV2KdsPublicRouter/);
  assert.match(routes, /\/v2\/kds/);
  assert.match(routes, /\/v2\/kds\/comandas\/:id/);
  assert.match(publicRoutes, /\/app\/restaurante-v2\/kds/);
  assert.match(publicRoutes, /restaurant-v2-realtime\.js/);
  assert.match(service, /TENANT_REALTIME_V1/);
  assert.match(service, /FCM_V65_BEST_EFFORT/);
  assert.match(service, /NEXT_STATE/);
  assert.match(pushService, /RESTAURANT_COMMAND_NEW_V2/);
  assert.match(pushService, /notificationPushDelivery/);
  assert.match(pushService, /flexibleSupport/);
  assert.match(pushService, /restaurantEmployeeWorkProfile/);
  assert.match(p3Routes, /void kdsPush\.notifyLatestRound/);
  assert.match(p3Routes, /sharedFloor:true,optionalSeat:true/);
  assert.match(html, /COCINA\/KDS\/PUSH P6/);
  assert.match(html, /restaurant-v2-realtime\.js/);
  assert.match(html, /restaurant-push-v65\.js/);
  assert.match(ui, /VANTIX_RESTAURANT_V2_KDS_P6/);
  assert.match(css, /VANTIX_RESTAURANT_V2_KDS_P6/);
  assert.doesNotMatch(ui, /MutationObserver|setInterval|POLL_MS|originalSend|res\.send\s*=/);

  const sendTopics = realtimeRoutes.topicsForPath('/api/v1/restaurante/v2/sesiones/11111111-1111-1111-1111-111111111111/pedido/enviar');
  assert.ok(sendTopics.includes('restaurant.order'), 'confirmar pedido V2 debe publicar restaurant.order');
  assert.ok(sendTopics.includes('restaurant.command'), 'confirmar pedido V2 debe despertar KDS en tiempo real');
  const commandTopics = realtimeRoutes.topicsForPath('/api/v1/restaurante/v2/kds/comandas/11111111-1111-1111-1111-111111111111');
  assert.ok(commandTopics.includes('restaurant.command'), 'cambio de estado KDS debe publicar restaurant.command');

  const demo = await ensureRestaurantDemoTenant();
  const [admin, waiter, cook] = await Promise.all([
    prisma.user.findUnique({ where:{ id:demo.users.ADMIN } }),
    prisma.user.findUnique({ where:{ id:demo.users.MESERO } }),
    prisma.user.findUnique({ where:{ id:demo.users.COCINA } })
  ]);
  assert.ok(admin && waiter && cook, 'el demo necesita ADMIN, MESERO y COCINA');

  const suffix = crypto.randomBytes(4).toString('hex');
  const [zone, kitchenMenuItem, barMenuItem] = await Promise.all([
    prisma.restaurantZone.create({ data:{ tenantId:demo.tenantId, name:`KDS P6 ${suffix}`, sortOrder:995 } }),
    prisma.restaurantMenuItem.findFirst({ where:{ tenantId:demo.tenantId, active:true, station:'COCINA' }, orderBy:{ sortOrder:'asc' } }),
    prisma.restaurantMenuItem.findFirst({ where:{ tenantId:demo.tenantId, active:true, station:'BARRA' }, orderBy:{ sortOrder:'asc' } })
  ]);
  assert.ok(kitchenMenuItem && barMenuItem, 'el demo necesita productos reales de COCINA y BARRA');
  const table = await prisma.restaurantTable.create({
    data:{ tenantId:demo.tenantId, zoneId:zone.id, code:`P6-${suffix}`, name:`Mesa KDS P6 ${suffix}`, seats:4, assignedWaiterId:waiter.id }
  });

  const [manualKitchen, manualBar] = await Promise.all([
    printingStations.createStation(demo.tenantId, admin.id, {
      name:`Cocina principal P6 ${suffix}`,
      queue:'COCINA', mode:'KDS', active:true, sortOrder:10
    }),
    printingStations.createStation(demo.tenantId, admin.id, {
      name:`Barra apoyo P6 ${suffix}`,
      queue:'BARRA', mode:'KDS', active:true, sortOrder:20
    })
  ]);
  assert.equal(manualKitchen.mode, 'KDS');
  assert.equal(manualBar.mode, 'KDS');
  await work.saveProfile(demo.tenantId, admin.id, cook.id, { stations:['COCINA','BARRA'] });

  const opened = await restaurant.openTable(demo.tenantId, waiter, table.id, { guestCount:2 }, V2_OPTIONS);
  const draft = await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, kitchenMenuItem.id, 2, 1, V2_OPTIONS);
  assert.ok(draft?.order?.id, 'P3 debe crear sólo el borrador del pedido');
  assert.equal(await prisma.restaurantCommand.count({ where:{ tenantId:demo.tenantId, orderId:draft.order.id } }), 0, 'agregar productos no puede crear comandas');

  const sent = await identity.sendWaiterDraft(demo.tenantId, waiter, opened.session.id, V2_OPTIONS);
  const command = await prisma.restaurantCommand.findFirst({
    where:{ tenantId:demo.tenantId, orderId:sent.order.id, station:'COCINA' },
    include:{ order:true }
  });
  assert.ok(command, 'confirmar pedido debe crear la comanda real');
  assert.equal(command.state, 'PENDIENTE');
  assert.equal(await prisma.restaurantCommand.count({ where:{ tenantId:demo.tenantId, orderId:sent.order.id } }), 1, 'la ronda de un solo módulo crea una comanda');

  const workspace = await kds.workspace(demo.tenantId, cook, { station:'COCINA' });
  assert.equal(workspace.marker, 'VANTIX_RESTAURANT_V2_KDS_P6');
  assert.equal(workspace.transport, 'TENANT_REALTIME_V1');
  assert.equal(workspace.push, 'FCM_V65_BEST_EFFORT');
  assert.equal(workspace.selectedStation, 'COCINA');
  assert.equal(workspace.commands.some((row) => row.id === command.id), true, 'KDS P6 debe mostrar la comanda real pendiente');
  const kitchenQueue = workspace.queues.find((row) => row.queue === 'COCINA');
  assert.equal(kitchenQueue.configured, true, 'la estación manual KDS debe ser autoritativa');
  assert.equal(kitchenQueue.stations.some((row) => row.id === manualKitchen.id && row.name === manualKitchen.name), true, 'KDS debe usar el nombre configurado por el restaurante');
  assert.equal(kitchenQueue.preferred, true, 'la asignación del empleado prioriza su estación');

  await assert.rejects(
    () => kds.updateState(demo.tenantId, cook, command.id, 'LISTA'),
    (error) => error?.statusCode === 409 || error?.status === 409 || error?.code === 'RESTAURANT_V2_KDS_TRANSITION_INVALID',
    'P6 no puede saltar PENDIENTE → LISTA'
  );
  await kds.updateState(demo.tenantId, cook, command.id, 'EN_PREPARACION');
  let state = await prisma.restaurantCommand.findUnique({ where:{ id:command.id } });
  assert.equal(state.state, 'EN_PREPARACION');
  assert.ok(state.startedAt);
  await kds.updateState(demo.tenantId, cook, command.id, 'LISTA');
  state = await prisma.restaurantCommand.findUnique({ where:{ id:command.id } });
  assert.equal(state.state, 'LISTA');
  assert.ok(state.readyAt);

  // A real registered production Push device is targeted. CI intentionally has no FCM
  // credentials, so provider delivery fails fast but the durable delivery record proves
  // event routing; the second dispatch must deduplicate it.
  const token = `P6-${crypto.randomBytes(32).toString('base64url')}`;
  const pushDevice = await push.registerDevice({
    tenantId:demo.tenantId,
    userId:cook.id,
    role:'COCINA',
    authType:'PRODUCTION_DEVICE',
    deviceId:null
  }, {
    token,
    platform:'WEB',
    deviceLabel:`Cocina P6 ${suffix}`,
    permission:'granted',
    userAgent:'P6-CI'
  });
  assert.equal(pushDevice.role, 'COCINA');
  const firstPush = await kdsPush.notifyLatestRound(demo.tenantId, opened.session.id, waiter.id);
  assert.equal(firstPush.orderId, sent.order.id);
  assert.equal(firstPush.attempted, 1, 'la comanda debe dirigirse al dispositivo COCINA activo');
  assert.equal(firstPush.sent + firstPush.failed, 1, 'Push es best-effort pero debe intentar exactamente una entrega');
  const deliveriesAfterFirst = await prisma.notificationPushDelivery.count({
    where:{ tenantId:demo.tenantId, pushDeviceId:pushDevice.id, eventCode:kdsPush.EVENT_CODE }
  });
  assert.equal(deliveriesAfterFirst, 1, 'el evento Push debe dejar trazabilidad durable');
  const secondPush = await kdsPush.notifyLatestRound(demo.tenantId, opened.session.id, waiter.id);
  assert.equal(secondPush.attempted, 0, 'reintentar la misma ronda no reenvía al mismo dispositivo');
  assert.equal(secondPush.deduplicated, 1);

  await kds.updateState(demo.tenantId, cook, command.id, 'ENTREGADA');
  state = await prisma.restaurantCommand.findUnique({ where:{ id:command.id } });
  assert.equal(state.state, 'ENTREGADA');
  assert.ok(state.deliveredAt);
  const afterDelivery = await kds.workspace(demo.tenantId, cook, { station:'COCINA' });
  assert.equal(afterDelivery.commands.some((row) => row.id === command.id), false, 'ENTREGADA deja de ocupar el tablero activo');

  // Same employee/device has base role COCINA but BARRA is an assigned flexible module.
  // A second real round proves both KDS reinforcement and Push targeting by work profile.
  const barDraft = await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, barMenuItem.id, 1, null, V2_OPTIONS);
  assert.ok(barDraft?.order?.id && barDraft.order.id !== sent.order.id, 'una nueva ronda debe usar un nuevo borrador');
  assert.equal(await prisma.restaurantCommand.count({ where:{ tenantId:demo.tenantId, orderId:barDraft.order.id } }), 0);
  const barSent = await identity.sendWaiterDraft(demo.tenantId, waiter, opened.session.id, V2_OPTIONS);
  const barCommand = await prisma.restaurantCommand.findFirst({ where:{ tenantId:demo.tenantId, orderId:barSent.order.id, station:'BARRA' } });
  assert.ok(barCommand && barCommand.state === 'PENDIENTE', 'la segunda ronda debe crear una comanda BARRA real');
  const barWorkspace = await kds.workspace(demo.tenantId, cook, { station:'BARRA' });
  assert.equal(barWorkspace.commands.some((row) => row.id === barCommand.id), true, 'COCINA puede reforzar BARRA según el contrato flexible');
  const barQueue = barWorkspace.queues.find((row) => row.queue === 'BARRA');
  assert.equal(barQueue.preferred, true, 'BARRA debe figurar como módulo asignado al empleado COCINA');
  assert.equal(barQueue.stations.some((row) => row.id === manualBar.id), true);

  const flexiblePush = await kdsPush.notifyLatestRound(demo.tenantId, opened.session.id, waiter.id);
  assert.equal(flexiblePush.orderId, barSent.order.id);
  assert.equal(flexiblePush.attempted, 1, 'el dispositivo COCINA debe recibir BARRA porque el perfil la tiene asignada');
  assert.equal(flexiblePush.sent + flexiblePush.failed, 1);
  assert.equal(await prisma.notificationPushDelivery.count({ where:{ tenantId:demo.tenantId, pushDeviceId:pushDevice.id, eventCode:kdsPush.EVENT_CODE } }), 2, 'cada ronda/estación tiene una entrega durable distinta');
  const flexibleRetry = await kdsPush.notifyLatestRound(demo.tenantId, opened.session.id, waiter.id);
  assert.equal(flexibleRetry.attempted, 0);
  assert.equal(flexibleRetry.deduplicated, 1);

  await kds.updateState(demo.tenantId, cook, barCommand.id, 'EN_PREPARACION');
  await kds.updateState(demo.tenantId, cook, barCommand.id, 'LISTA');
  await kds.updateState(demo.tenantId, cook, barCommand.id, 'ENTREGADA');
  const finalBar = await prisma.restaurantCommand.findUnique({ where:{ id:barCommand.id } });
  assert.equal(finalBar.state, 'ENTREGADA');
  assert.ok(finalBar.startedAt && finalBar.readyAt && finalBar.deliveredAt);

  console.log(JSON.stringify({
    ok:true,
    module:'KDS_PUSH_V2_P6',
    realPostgres:true,
    draftCreatesNoCommand:true,
    confirmationCreatesCommand:true,
    manualStations:true,
    flexiblePriority:true,
    flexibleReinforcement:true,
    strictTransitions:true,
    realtimeOnOrderSend:true,
    noPolling:true,
    pushBestEffort:true,
    pushRoleTarget:true,
    pushFlexibleTarget:true,
    pushDeduplicated:true,
    legacyCommandEngineReused:true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
