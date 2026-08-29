'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const theme = require('../src/modules/restaurant/restaurant-theme.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const { ensureRestaurantDemoTenant, SUBDOMAIN } = require('./ensure-restaurant-demo-tenant');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

async function main() {
  const center = source('src/web/restaurant-control-center.js');
  const qrUi = source('src/web/restaurant-qr-ui.js');
  const routes = source('src/modules/restaurant/restaurant.routes.js');
  const themeSource = source('src/modules/restaurant/restaurant-theme.service.js');

  assert.match(center, /Vista cliente publicada/);
  assert.match(center, /Publicar \/ editar/);
  assert.match(center, /clientSpotlight/);
  assert.match(center, /Misma carta · mismo precio/);
  assert.match(qrUi, /data-client-spotlight/);
  assert.match(qrUi, /AGREGAR AL PEDIDO/);
  assert.match(qrUi, /data-spotlight-add/);
  assert.match(routes, /clientSpotlight/);
  assert.match(themeSource, /RESTAURANT_CLIENT_SPOTLIGHT/);

  await ensureRestaurantDemoTenant();
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: SUBDOMAIN } });
  assert.ok(tenant, 'tenant demo faltante');
  const admin = await prisma.user.findFirst({ where: { tenantId: tenant.id, rol: 'ADMIN', activo: true } });
  assert.ok(admin, 'admin demo faltante');
  const menu = await prisma.restaurantMenuItem.findFirst({
    where: { tenantId: tenant.id, active: true, category: 'FUERTES' },
    orderBy: { sortOrder: 'asc' }
  });
  assert.ok(menu, 'menu fuerte faltante');
  const product = await prisma.producto.findFirst({ where: { id: menu.productId, tenantId: tenant.id, activo: true } });
  assert.ok(product, 'producto real faltante');
  const table = await prisma.restaurantTable.findFirst({ where: { tenantId: tenant.id, active: true } });
  assert.ok(table?.qrToken, 'QR permanente faltante');

  const saved = await theme.saveTheme(tenant.id, admin.id, {
    clientSpotlight: {
      active: true,
      kind: 'PROMO_DIA',
      menuItemId: menu.id,
      label: 'Promo del día',
      description: 'Selección especial para pedir desde la mesa'
    }
  });
  assert.equal(saved.clientSpotlight.active, true);
  assert.equal(saved.clientSpotlight.kind, 'PROMO_DIA');
  assert.equal(saved.clientSpotlight.menuItemId, menu.id);

  const publicContext = await identity.publicQrContext(table.qrToken);
  assert.equal(publicContext.theme.clientSpotlight.active, true);
  assert.equal(publicContext.theme.clientSpotlight.menuItemId, menu.id);
  const publishedItem = publicContext.menu.find((row) => row.id === menu.id);
  assert.ok(publishedItem?.available, 'el destacado debe ser vendible');
  assert.equal(String(publishedItem.product.price), String(product.precio1), 'QR debe conservar precio real del producto');

  const themeOnlyChange = await theme.saveTheme(tenant.id, admin.id, { tokens: { ember: '#AA5500' } });
  assert.equal(themeOnlyChange.clientSpotlight.active, true, 'editar tema no debe borrar la publicación');
  assert.equal(themeOnlyChange.clientSpotlight.menuItemId, menu.id, 'editar tema debe preservar menuItemId');

  const audit = await prisma.auditoriaContable.findFirst({
    where: { tenantId: tenant.id, userId: admin.id, entidad: 'RESTAURANT_CLIENT_SPOTLIGHT' },
    orderBy: { creadoEn: 'desc' }
  });
  assert.ok(audit, 'publicación debe quedar auditada');

  const disabled = await theme.saveTheme(tenant.id, admin.id, {
    clientSpotlight: {
      active: false,
      kind: 'PROMO_DIA',
      menuItemId: menu.id,
      label: 'Promo del día',
      description: null
    }
  });
  assert.equal(disabled.clientSpotlight.active, false);

  console.log(JSON.stringify({
    ok: true,
    tenant: tenant.subdomain,
    menuItemId: menu.id,
    product: product.nombre,
    price: String(product.precio1),
    publicQrUsesSameMenuItem: true,
    themePreservesSpotlight: true,
    audit: true
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
