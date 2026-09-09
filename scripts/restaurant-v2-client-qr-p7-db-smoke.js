'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const visits = require('../src/modules/restaurant/restaurant-visit-payments.service');
const qr = require('../src/modules/restaurant/restaurant-qr.service');
const theme = require('../src/modules/restaurant/restaurant-theme.service');
const waiterCalls = require('../src/modules/restaurant/restaurant-waiter-call.service');
const accountRequests = require('../src/modules/restaurant/restaurant-account-request.service');
const { trackingSnapshot } = require('../src/modules/restaurant/restaurant-client-tracking.public.routes');
const { presenceSnapshot } = require('../src/modules/restaurant/restaurant-qr-presence-realtime.public.routes');
const { moveTableVisit } = require('../src/modules/restaurant/restaurant-v2-table-move.service');
const { decimal, money, pct, qty } = require('../src/utils/decimal');
const { app } = require('../src/app');

const BRANCH_MARKER = 'VANTIX_RESTAURANT_V2_CLIENT_QR_P7';

function visitCode(session) {
  const secret = String(process.env.RESTAURANT_QR_VISIT_SECRET || process.env.JWT_SECRET || '');
  assert.ok(secret.length >= 32, 'El smoke necesita RESTAURANT_QR_VISIT_SECRET/JWT_SECRET');
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

async function withServer(fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  try { return await fn(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function main() {
  const aggregator = fs.readFileSync('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js','utf8');
  const publicRoot = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js','utf8');
  const appSource = fs.readFileSync('src/app.js','utf8');
  const html = fs.readFileSync('src/web/restaurant-v2-client-qr.html','utf8');
  const js = fs.readFileSync('src/web/restaurant-v2-client-qr.js','utf8');
  const css = fs.readFileSync('src/web/restaurant-v2-client-qr.css','utf8');
  const routeSource = fs.readFileSync('src/modules/restaurant/restaurant-v2-client-qr.public.routes.js','utf8');

  assert.match(aggregator, /restaurantV2ClientQrPublicRouter/);
  assert.match(aggregator, /use\(restaurantV2ClientQrPublicRouter\)/);
  assert.ok(publicRoot.indexOf('restaurantOperationalV2PreviewPublicRouter') < publicRoot.indexOf('legacyRestaurantPublicRouter'), 'V2 debe resolverse antes de V1');
  assert.match(appSource, /app\.get\('\/r\/:token'.*restaurantQrHtmlPath/);
  assert.match(routeSource, /router\.get\('\/r\/:token'/);
  assert.match(routeSource, /p7-permanent-qr-client/);
  assert.match(html, new RegExp(BRANCH_MARKER));
  assert.match(js, new RegExp(BRANCH_MARKER));
  assert.match(css, new RegExp(BRANCH_MARKER));
  assert.doesNotMatch(js, /MutationObserver|setInterval|POLL_MS|\.replace\([^\n]*restaurant-qr|source rewriting/i);
  assert.match(js, /\/autorizar/);
  assert.match(js, /\/pedidos/);
  assert.match(js, /\/mis-pedidos\/stream/);
  assert.match(js, /\/llamar-mesero\/stream/);
  assert.match(js, /\/pedir-cuenta/);
  assert.match(js, /\/visita\/realtime/);
  assert.match(js, /data-note/);

  const demo = await ensureRestaurantDemoTenant();
  const [admin, waiter] = await Promise.all([
    prisma.user.findUnique({ where:{ id:demo.users.ADMIN } }),
    prisma.user.findUnique({ where:{ id:demo.users.MESERO } })
  ]);
  assert.ok(admin && waiter, 'El demo necesita ADMIN y MESERO');

  const suffix = crypto.randomBytes(5).toString('hex');
  const zone = await prisma.restaurantZone.create({ data:{ tenantId:demo.tenantId, name:`P7 ${suffix}`, sortOrder:997 } });
  const source = await prisma.restaurantTable.create({
    data:{ tenantId:demo.tenantId, zoneId:zone.id, code:`P7-S-${suffix}`, name:`Mesa QR P7 ${suffix}`, seats:4, assignedWaiterId:waiter.id }
  });
  const destination = await prisma.restaurantTable.create({
    data:{ tenantId:demo.tenantId, zoneId:zone.id, code:`P7-D-${suffix}`, name:`Mesa Destino P7 ${suffix}`, seats:4, assignedWaiterId:waiter.id }
  });
  assert.ok(source.qrToken && destination.qrToken && source.qrToken !== destination.qrToken);
  const sourceQrBefore = source.qrToken;
  const destinationQrBefore = destination.qrToken;
  const sourcePublicUrl = new URL(qr.buildPublicTableUrl(sourceQrBefore));
  assert.equal(sourcePublicUrl.pathname, `/r/${sourceQrBefore}`);

  const menu = (await restaurant.listMenu(demo.tenantId)).filter((row) => !row.warning && row.product && row.active !== false);
  const menuItem = menu.find((row) => row.station === 'COCINA') || menu[0];
  assert.ok(menuItem?.product, 'P7 necesita un producto vendible');
  await theme.saveTheme(demo.tenantId, admin.id, {
    clientSpotlight:{ active:true, kind:'PLATO_DIA', menuItemId:menuItem.id, label:'Especial P7', description:'Prueba cliente V2' }
  });

  let ctx = await identity.publicQrContext(sourceQrBefore);
  assert.equal(ctx.table.id, source.id);
  assert.equal(ctx.open, false);
  assert.ok(ctx.menu.some((row) => row.id === menuItem.id));
  assert.equal(ctx.theme.clientSpotlight.active, true);
  assert.equal(ctx.theme.clientSpotlight.menuItemId, menuItem.id);
  assert.equal(await prisma.restaurantOrder.count({ where:{ tenantId:demo.tenantId, session:{ tableId:source.id } } }), 0);

  const opened = await restaurant.openTable(demo.tenantId, waiter, source.id, { guestCount:3 });
  assert.ok(opened.session.qrVisitNonce);
  let described = await visits.describeVisit(sourceQrBefore, '');
  assert.equal(described.open, true);
  assert.equal(described.authorized, false);
  assert.equal(described.guestCount, 3);

  const authorized = await visits.authorizeVisit(sourceQrBefore, visitCode(opened.session), 2);
  assert.ok(authorized.visitToken);
  assert.equal(authorized.seatNumber, 2);
  assert.equal(authorized.guestCount, 3);
  assert.equal(await prisma.restaurantOrder.count({ where:{ tenantId:demo.tenantId, sessionId:opened.session.id } }), 0, 'Autorizar no debe crear pedido');

  const moved = await moveTableVisit(demo.tenantId, waiter, source.id, destination.id);
  assert.equal(moved.sessionId, opened.session.id);
  described = await visits.describeVisit(sourceQrBefore, authorized.visitToken);
  assert.equal(described.authorized, true);
  assert.equal(described.relocated, true);
  assert.equal(described.sourceTable.id, source.id);
  assert.equal(described.currentTable.id, destination.id);
  assert.equal(described.relocatedToPath, `/r/${encodeURIComponent(destinationQrBefore)}`);

  const expectedTotal = confirmedLineTotal(menuItem, 1);
  const order = await visits.placeAuthorizedQrOrder(sourceQrBefore, authorized.visitToken, {
    items:[{ menuItemId:menuItem.id, quantity:1, notes:'SIN CEBOLLA P7' }],
    confirmedTotal:Number(expectedTotal.toString()),
    externalRequestId:`P7-${suffix}`
  });
  assert.equal(order.sessionId, opened.session.id);
  assert.equal(order.source, 'QR');
  assert.equal(Number(order.items[0].seatNumber), 2);

  const [dbOrder, dbItem, commands] = await Promise.all([
    prisma.restaurantOrder.findUnique({ where:{ id:order.id } }),
    prisma.restaurantOrderItem.findFirst({ where:{ tenantId:demo.tenantId, orderId:order.id } }),
    prisma.restaurantCommand.findMany({ where:{ tenantId:demo.tenantId, orderId:order.id } })
  ]);
  assert.ok(dbOrder.qrVisitDeviceId, 'La orden persistida debe quedar ligada al dispositivo QR');
  assert.equal(dbItem.notes, 'SIN CEBOLLA P7');
  assert.equal(Number(dbItem.seatNumber), 2);
  assert.ok(commands.length >= 1, 'El pedido QR confirmado debe crear comanda real');
  assert.ok(commands.every((row) => row.state === 'PENDIENTE'));

  const tracking = await trackingSnapshot(sourceQrBefore, authorized.visitToken);
  assert.equal(tracking.sessionId, opened.session.id);
  assert.equal(tracking.table.id, destination.id);
  assert.equal(tracking.seatNumber, 2);
  assert.equal(tracking.orders.some((row) => row.id === order.id), true);
  assert.equal(tracking.orders.find((row) => row.id === order.id).stations.length, commands.length);

  const call = await waiterCalls.createCall(sourceQrBefore, authorized.visitToken);
  assert.equal(call.active, true);
  assert.ok(call.call?.id);

  const account = await accountRequests.createRequest(sourceQrBefore, authorized.visitToken);
  assert.equal(account.state, 'REQUESTED');
  assert.equal(account.requested, true);
  assert.equal(account.table.id, destination.id);

  const presence = await presenceSnapshot({ id:destination.id, tenantId:demo.tenantId });
  assert.equal(presence.currentSessionId, opened.session.id);
  assert.equal(presence.publicState.open, true);
  assert.equal(presence.publicState.guestCount, 3);

  const [sourceAfter, destinationAfter] = await Promise.all([
    prisma.restaurantTable.findUnique({ where:{ id:source.id } }),
    prisma.restaurantTable.findUnique({ where:{ id:destination.id } })
  ]);
  assert.equal(sourceAfter.qrToken, sourceQrBefore);
  assert.equal(destinationAfter.qrToken, destinationQrBefore);
  assert.equal(new URL(qr.buildPublicTableUrl(sourceAfter.qrToken)).pathname, `/r/${sourceQrBefore}`);

  await withServer(async (base) => {
    const [page, asset, context] = await Promise.all([
      fetch(`${base}/r/${encodeURIComponent(sourceQrBefore)}`),
      fetch(`${base}/app/restaurant-v2-client-qr.js`),
      fetch(`${base}/api/public/restaurante/qr/${encodeURIComponent(sourceQrBefore)}`)
    ]);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-vantixgc-restaurant-v2-client-qr'), 'p7-permanent-qr-client');
    assert.match(await page.text(), new RegExp(BRANCH_MARKER));
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('x-vantixgc-restaurant-v2-client-qr'), 'p7-permanent-qr-client');
    assert.match(await asset.text(), new RegExp(BRANCH_MARKER));
    assert.equal(context.status, 200);
    const body = await context.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.table.id, source.id, 'El contexto sin token sigue representando el QR físico origen');
  });

  console.log(JSON.stringify({
    ok:true,
    marker:'RESTAURANT_V2_CLIENT_QR_P7_OK',
    realPostgres:true,
    permanentQrPreserved:true,
    browseBeforeAuthorization:true,
    deferredAuthorization:true,
    seatAuthorization:true,
    tableMoveContinuity:true,
    samePhysicalQrAfterMove:true,
    realQrOrder:true,
    productNotes:true,
    commandsCreated:true,
    tracking:true,
    waiterCall:true,
    accountRequest:true,
    presenceRealtimeContract:true,
    legacyFallbackRetainedInApp:true,
    p7OwnsPhysicalPathFirst:true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
