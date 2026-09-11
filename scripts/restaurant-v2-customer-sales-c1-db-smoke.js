'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const { seedPlatformDefaults } = require('../src/services/platform-seed.service');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const customerSaleLink = require('../src/modules/restaurant/restaurant-customer-sale-link.service');

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: `Restaurant Customer Sales C1 ${stamp}`,
      subdomain: `rest-customer-c1-${stamp}`,
      nicho: 'RESTAURANTE_QA',
      pais: 'CO',
      moneda: 'COP'
    }
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Cajero Cliente C1 QA',
      email: `customer-c1-${stamp}@example.com`,
      password: 'not-login',
      rol: 'ADMIN',
      activo: true
    }
  });

  await prisma.$transaction(async (tx) => {
    await seedTenantDefaults(tx, tenant);
    await seedPlatformDefaults(tx, tenant, user);
  });

  const table = await restaurant.createTable(tenant.id, {
    code: `C1${String(stamp).slice(-5)}`,
    name: 'Mesa Cliente C1',
    seats: 4,
    posX: 20,
    posY: 20
  });
  const opened = await restaurant.openTable(tenant.id, user, table.id, { guestCount: 2 });
  const before = await prisma.comprobanteComercial.findUnique({ where: { id: opened.sale.id } });
  assert.ok(before, 'la mesa debe tener una venta borrador del Super Core');
  assert.equal(before.tipo, 'FACTURA_VENTA');
  assert.equal(before.estado, 'BORRADOR');

  const customer = await prisma.tercero.create({
    data: {
      tenantId: tenant.id,
      tipo: 'CLIENTE',
      tipoDocumento: 'NIT',
      identificacion: `901${String(stamp).slice(-9)}`,
      nombre: 'Restaurante Cliente C1 QA',
      razonSocial: 'Restaurante Cliente C1 QA S.A.S.',
      direccion: 'Calle QA 123',
      telefono: '3000000000',
      email: `cliente-c1-${stamp}@example.com`,
      activo: true
    }
  });

  const staged = await customerSaleLink.stageIdentifiedCustomerForTable(tenant.id, table.id, customer.id);
  assert.equal(staged.customer.id, customer.id);
  assert.equal(staged.customer.razonSocial, 'Restaurante Cliente C1 QA S.A.S.');
  assert.equal(staged.customer.direccion, 'Calle QA 123');

  const linked = await prisma.comprobanteComercial.findUnique({ where: { id: opened.sale.id } });
  assert.equal(linked.terceroId, customer.id, 'la venta POS debe quedar vinculada al Tercero central');

  const restored = await customerSaleLink.restoreIdentifiedCustomerIfDraft(staged);
  assert.equal(restored, true, 'el rollback debe restaurar el tercero anterior mientras la venta siga en borrador');
  const afterRollback = await prisma.comprobanteComercial.findUnique({ where: { id: opened.sale.id } });
  assert.equal(afterRollback.terceroId, before.terceroId || null);

  const provider = await prisma.tercero.create({
    data: {
      tenantId: tenant.id,
      tipo: 'PROVEEDOR',
      tipoDocumento: 'NIT',
      identificacion: `902${String(stamp).slice(-9)}`,
      nombre: 'Proveedor C1 QA',
      activo: true
    }
  });
  let providerError = null;
  try {
    await customerSaleLink.stageIdentifiedCustomerForTable(tenant.id, table.id, provider.id);
  } catch (error) {
    providerError = error;
  }
  assert.equal(providerError?.code, 'RESTAURANT_CUSTOMER_INVALID', 'un proveedor puro no puede identificarse como cliente de la venta');

  const generic = await prisma.tercero.findFirst({
    where: {
      tenantId: tenant.id,
      identificacion: customerSaleLink.GENERIC_CUSTOMER_IDENTIFICATION,
      activo: true
    }
  });
  if (generic) {
    let genericError = null;
    try {
      await customerSaleLink.stageIdentifiedCustomerForTable(tenant.id, table.id, generic.id);
    } catch (error) {
      genericError = error;
    }
    assert.equal(genericError?.code, 'RESTAURANT_CUSTOMER_INVALID', 'el cliente genérico no debe tratarse como cliente identificado');
  }

  console.log('RESTAURANT V2 CUSTOMER SALES C1 DB SMOKE OK');
  console.log(JSON.stringify({
    sharedThirdPartyMaster: true,
    saleUsesComprobanteComercial: true,
    identifiedCustomerLinked: true,
    customerBillingFieldsReturned: true,
    supplierRejected: true,
    genericCustomerRemainsFastPath: true,
    rollbackRestoresPreviousCustomer: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
