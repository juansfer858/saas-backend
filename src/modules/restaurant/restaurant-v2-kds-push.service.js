'use strict';

const { prisma } = require('../../config/prisma');
const push = require('../notifications/push-v65.service');

const EVENT_CODE = 'RESTAURANT_COMMAND_NEW_V2';
const PRODUCTION_ROLES = Object.freeze(['COCINA','BARRA','POSTRES']);

function stationLabel(station) {
  return station === 'COCINA' ? 'Cocina' : station === 'BARRA' ? 'Barra' : station === 'POSTRES' ? 'Postres' : station;
}

function itemCount(order, station) {
  return (order?.items || []).filter((item) => !item.station || item.station === station).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function normalizedStations(profile) {
  return Array.isArray(profile?.stations) ? profile.stations.map((value) => String(value || '').toUpperCase()).filter(Boolean) : [];
}

function deviceMatchesStation(device, profile, station) {
  const role = String(device?.role || '').toUpperCase();
  const queue = String(station || '').toUpperCase();
  if (role === queue) return true;
  return Boolean(profile?.flexibleSupport) && normalizedStations(profile).includes(queue);
}

// La ronda autoritativa para Push es la última orden de la visita que ya tenga
// comandas persistidas. No depende del texto de estado ni del actor que la creó:
// puede provenir de Mesero, QR u otro flujo autorizado de refuerzo. Los borradores
// quedan excluidos naturalmente porque todavía no tienen comandas.
async function latestSentOrder(tenantId, sessionId) {
  return prisma.restaurantOrder.findFirst({
    where:{
      tenantId,
      sessionId,
      commands:{ some:{} }
    },
    orderBy:{ creadoEn:'desc' },
    include:{
      commands:true,
      items:true,
      session:{ include:{ table:{ select:{ id:true, code:true, name:true } } } }
    }
  });
}

async function deliveryExists(tenantId, pushDeviceId, deepLink) {
  return prisma.notificationPushDelivery.findFirst({
    where:{ tenantId, pushDeviceId, eventCode:EVENT_CODE, deepLink },
    select:{ id:true }
  });
}

async function productionPushTargets(tenantId, stations) {
  const devices = await prisma.notificationPushDevice.findMany({
    where:{ tenantId, state:'ACTIVE', permission:'granted', role:{ in:PRODUCTION_ROLES } },
    orderBy:{ lastSeenAt:'desc' }
  });
  const userIds = [...new Set(devices.map((device) => device.userId).filter(Boolean))];
  const profiles = userIds.length ? await prisma.restaurantEmployeeWorkProfile.findMany({
    where:{ tenantId, userId:{ in:userIds } },
    select:{ userId:true, stations:true, flexibleSupport:true }
  }) : [];
  const profileByUser = new Map(profiles.map((profile) => [profile.userId, profile]));
  return new Map(stations.map((station) => [
    station,
    devices.filter((device) => deviceMatchesStation(device, profileByUser.get(device.userId) || null, station))
  ]));
}

async function notifyLatestRound(tenantId, sessionId) {
  const order = await latestSentOrder(tenantId, sessionId);
  if (!order?.commands?.length) return { eventCode:EVENT_CODE, orderId:order?.id || null, attempted:0, sent:0, failed:0, deduplicated:0 };
  const stations = [...new Set(order.commands.map((command) => command.station).filter(Boolean))];
  const byStation = await productionPushTargets(tenantId, stations);
  let attempted=0,sent=0,failed=0,deduplicated=0;
  for (const command of order.commands) {
    const station = command.station;
    const table = order.session?.table;
    const deepLink = `/app/restaurante-v2/kds?station=${encodeURIComponent(station)}&command=${encodeURIComponent(command.id)}`;
    const body = `${table?.name || table?.code || 'Mesa'} · ${itemCount(order, station)} producto(s)`;
    for (const device of byStation.get(station) || []) {
      if (await deliveryExists(tenantId, device.id, deepLink)) { deduplicated += 1; continue; }
      attempted += 1;
      try {
        await push.sendDelivery(device, {
          eventCode:EVENT_CODE,
          title:`Nueva comanda · ${stationLabel(station)}`,
          body,
          deepLink
        });
        sent += 1;
      } catch { failed += 1; }
    }
  }
  return { eventCode:EVENT_CODE, orderId:order.id, stations, attempted, sent, failed, deduplicated };
}

module.exports = {
  EVENT_CODE,
  PRODUCTION_ROLES,
  deviceMatchesStation,
  productionPushTargets,
  latestSentOrder,
  notifyLatestRound
};
