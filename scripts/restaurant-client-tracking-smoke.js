'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const visitPayments = require('../src/modules/restaurant/restaurant-visit-payments.service');
const { trackingSnapshot } = require('../src/modules/restaurant/restaurant-client-tracking.public.routes');
const { ensureRestaurantDemoTenant, SUBDOMAIN } = require('./ensure-restaurant-demo-tenant');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const publicRouter = read('src/modules/restaurant/restaurant.public.routes.js');
const visitRoutes = read('src/modules/restaurant/restaurant-visit.public.routes.js');
const trackingRoutes = read('src/modules/restaurant/restaurant-client-tracking.public.routes.js');
const trackingUi = read('src/web/restaurant-qr-tracking-ui.js');
const qrUi = read('src/web/restaurant-qr-ui.js');

assert.match(publicRouter, /restaurantClientTrackingPublicRouter/);
assert.match(publicRouter, /router\.use\(restaurantClientTrackingPublicRouter\)/);
assert.match(visitRoutes, /restaurant-qr-tracking-ui\.js/);
assert.match(visitRoutes, /trackingUi/);

for (const token of [
  "'/api/public/restaurante/qr/:token/mis-pedidos'",
  "'/api/public/restaurante/qr/:token/mis-pedidos/stream'",
  'visitPayments.verifyVisit',
  "qrVisitDeviceId === deviceId",
  "'Content-Type': 'text/event-stream; charset=utf-8'",
  "'X-Accel-Buffering': 'no'",
  'WATCH_INTERVAL_MS = 1800',
  'DEVICE_REVOKED',
  'TABLE_CLOSED'
]) assert.ok(trackingRoutes.includes(token), `Tracking backend must contain ${token}`);

for (const token of [
  'MI PEDIDO ·',
  'VER SEGUIMIENTO',
  'EN PREPARACIÓN',
  'LISTO PARA SERVIR',
  '/mis-pedidos/stream',
  'TextDecoder',
  'AbortController',
  'AGREGAR OTRO PEDIDO'
]) assert.ok(trackingUi.includes(token), `Tracking UI must contain ${token}`);

assert.ok(!trackingRoutes.includes('setInterval'), 'Tracking backend must not use setInterval');
assert.ok(!trackingUi.includes('setInterval'), 'Tracking UI must not use setInterval');
assert.ok(!trackingUi.includes('MutationObserver'), 'Tracking UI must not use MutationObserver');
assert.match(qrUi, /ENVIAR PEDIDO A COCINA/);
assert.doesNotMatch(qrUi, /WhatsApp opcional/);
assert.doesNotMatch(qrUi, /consentWhatsApp/);
new Function(trackingUi);

function lineTotal(menuItem) {
  const price = Number(menuItem.product?.price || 0);
  const iva = Number(menuItem.product?.ivaPct || 0);
  const impoconsumo = Number(menuItem.product?.impoconsumoPct || 0);
  return Math.round((price + price * iva / 100 + price * impoconsumo / 100) * 100) / 100;
}

async function main() {
  await ensureRestaurantDemoTenant();
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: SUBDOMAIN } });
  assert.ok(tenant, 'tenant demo faltante');
  const admin = await prisma.user.findFirst({ where: { tenantId: tenant.id, rol: 'ADMIN', activo: true } });
  assert.ok(admin, 'admin demo faltante');

  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const table = await restaurant.createTable(tenant.id, { code: `TRK-${suffix}`, name: `Tracking ${suffix}`, seats: 2 });
  const opened = await restaurant.openTable(tenant.id, admin, table.id, { guestCount: 2, billingMode: 'CONJUNTA' });
  const code = visitPayments.visitCode(opened.session);

  const firstDevice = await visitPayments.authorizeVisit(table.qrToken, code, 1);
  const secondDevice = await visitPayments.authorizeVisit(table.qrToken, code, 2);
  const context = await identity.publicQrContext(table.qrToken);
  const menuItem = context.menu.find((row) => row.available && row.product);
  assert.ok(menuItem, 'producto vendible faltante para seguimiento');

  const placed = await visitPayments.placeAuthorizedQrOrder(table.qrToken, firstDevice.visitToken, {
    items: [{ menuItemId: menuItem.id, quantity: 1 }],
    confirmedTotal: lineTotal(menuItem),
    externalRequestId: `TRACK-${crypto.randomUUID()}`
  });
  assert.ok(placed.id, 'pedido QR no creado');

  let snapshot = await trackingSnapshot(table.qrToken, firstDevice.visitToken);
  assert.equal(snapshot.orders.length, 1);
  assert.equal(snapshot.orders[0].id, placed.id);
  assert.equal(snapshot.orders[0].state, 'ENVIADO');
  assert.equal(snapshot.seatNumber, 1);

  const isolated = await trackingSnapshot(table.qrToken, secondDevice.visitToken);
  assert.equal(isolated.orders.length, 0, 'un teléfono no debe ver pedidos del otro dispositivo');

  const commands = await prisma.restaurantCommand.findMany({ where: { tenantId: tenant.id, orderId: placed.id } });
  assert.ok(commands.length > 0, 'pedido sin comandas para seguimiento');
  for (const command of commands) await restaurant.updateCommandState(tenant.id, admin, command.id, 'EN_PREPARACION');
  snapshot = await trackingSnapshot(table.qrToken, firstDevice.visitToken);
  assert.equal(snapshot.orders[0].state, 'EN_PREPARACION');
  assert.ok(snapshot.orders[0].stations.every((station) => station.state === 'EN_PREPARACION'));

  for (const command of commands) await restaurant.updateCommandState(tenant.id, admin, command.id, 'LISTA');
  snapshot = await trackingSnapshot(table.qrToken, firstDevice.visitToken);
  assert.equal(snapshot.orders[0].state, 'LISTO');
  assert.ok(snapshot.orders[0].stations.every((station) => station.state === 'LISTA'));

  for (const command of commands) await restaurant.updateCommandState(tenant.id, admin, command.id, 'ENTREGADA');
  snapshot = await trackingSnapshot(table.qrToken, firstDevice.visitToken);
  assert.equal(snapshot.orders[0].state, 'ENTREGADO');
  assert.ok(snapshot.orders[0].stations.every((station) => station.state === 'ENTREGADA'));

  console.log(JSON.stringify({
    ok: true,
    deviceIsolation: true,
    states: ['ENVIADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO'],
    sse: true,
    browserPolling: false,
    setInterval: false
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
