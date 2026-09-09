'use strict';

const { prisma } = require('../../config/prisma');
const push = require('../notifications/push-v65.service');

const EVENT_CODE = 'RESTAURANT_COMMAND_NEW_V2';

function stationLabel(station) {
  return station === 'COCINA' ? 'Cocina' : station === 'BARRA' ? 'Barra' : station === 'POSTRES' ? 'Postres' : station;
}

function itemCount(order, station) {
  return (order?.items || []).filter((item) => !item.station || item.station === station).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

async function latestSentOrder(tenantId, sessionId, createdByUserId = null) {
  return prisma.restaurantOrder.findFirst({
    where:{ tenantId, sessionId, state:'ENVIADO', ...(createdByUserId ? { createdByUserId } : {}) },
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

async function notifyLatestRound(tenantId, sessionId, createdByUserId = null) {
  const order = await latestSentOrder(tenantId, sessionId, createdByUserId);
  if (!order?.commands?.length) return { eventCode:EVENT_CODE, orderId:order?.id || null, attempted:0, sent:0, failed:0, deduplicated:0 };
  const stations = [...new Set(order.commands.map((command) => command.station).filter(Boolean))];
  const devices = await prisma.notificationPushDevice.findMany({
    where:{ tenantId, state:'ACTIVE', permission:'granted', role:{ in:stations } },
    orderBy:{ lastSeenAt:'desc' }
  });
  const byStation = new Map(stations.map((station) => [station, devices.filter((device) => String(device.role || '').toUpperCase() === station)]));
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

module.exports = { EVENT_CODE, latestSentOrder, notifyLatestRound };
