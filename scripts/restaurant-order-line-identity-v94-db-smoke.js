'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { money } = require('../src/utils/decimal');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const delivery = require('../src/modules/restaurant/restaurant-delivery.service');
const treasury = require('../src/modules/treasury/treasury.service');

async function main() {
  assert.notEqual(String(process.env.NODE_ENV || '').toLowerCase(), 'production', 'Este smoke no puede ejecutarse en producción');
  const demo = await ensureRestaurantDemoTenant();
  const admin = await prisma.user.findUnique({ where:{ id:demo.users.ADMIN } });
  assert.ok(admin, 'ADMIN demo faltante');

  const menu = await prisma.restaurantMenuItem.findFirst({
    where:{ tenantId:demo.tenantId, active:true },
    orderBy:[{ sortOrder:'asc' }, { creadoEn:'asc' }]
  });
  assert.ok(menu, 'Se requiere un producto activo de Carta');
  const product = await prisma.producto.findFirst({ where:{ tenantId:demo.tenantId, id:menu.productId, activo:true } });
  assert.ok(product, 'Producto de Carta faltante');
  const base = money(product.precio1 || 0);
  const override = money(base.plus(1000));

  let row = await delivery.createDelivery(demo.tenantId, admin, {
    customerName:'Cliente Precio V94',
    customerPhone:`301${String(Date.now()).slice(-7)}`,
    address:'Carrera 20 #14-22',
    neighborhood:'Centro',
    deliveryReference:'QA V94',
    deliveryFee:0,
    promisedAt:new Date(Date.now() + 45 * 60000).toISOString(),
    channel:'MANUAL',
    items:[
      { menuItemId:menu.id, quantity:1, appliedUnitPrice:Number(base), notes:null },
      { menuItemId:menu.id, quantity:1, appliedUnitPrice:Number(base), notes:null },
      { menuItemId:menu.id, quantity:1, appliedUnitPrice:Number(override), notes:'CON HIELO' }
    ]
  });

  assert.equal(row.state, 'NUEVO');
  assert.equal(row.items.length, 2, 'Persistencia debe consolidar sólo las dos líneas equivalentes');
  assert.equal(row.operationalItems.length, 2);
  const normal = row.items.find((item) => !item.notes);
  const special = row.items.find((item) => item.notes === 'CON HIELO');
  assert.ok(normal && special, 'Deben existir grupo normal y grupo con instrucción');
  assert.ok(money(normal.quantity).eq(2));
  assert.ok(money(normal.unitPrice).eq(base));
  assert.ok(money(special.quantity).eq(1));
  assert.ok(money(special.unitPrice).eq(override));

  const [masterAfterCreate, saleDraft, details] = await Promise.all([
    prisma.producto.findUnique({ where:{ id:product.id } }),
    prisma.comprobanteComercial.findUnique({ where:{ id:row.saleId } }),
    prisma.detalleComprobante.findMany({ where:{ tenantId:demo.tenantId, comprobanteId:row.saleId, productoId:product.id }, orderBy:{ precioUnitario:'asc' } })
  ]);
  assert.ok(money(masterAfterCreate.precio1).eq(base), 'Crear domicilio no puede modificar Producto.precio1');
  assert.equal(details.length, 2, 'El documento comercial debe conservar líneas por precio/nota operacional');
  assert.ok(money(details[0].precioUnitario).eq(base));
  assert.ok(money(details[1].precioUnitario).eq(override));
  const persistedTotal = money(details.reduce((sum, detail) => sum.plus(detail.totalLinea), money(0)));
  assert.ok(money(saleDraft.total).eq(persistedTotal), 'Total del documento debe salir del precio aplicado persistido');
  assert.ok(money(row.total).eq(persistedTotal), 'Total del domicilio debe coincidir con el documento');

  const meta = JSON.parse(saleDraft.observaciones || '{}');
  assert.equal(meta.deliveryPricing?.version, 'V94');
  assert.equal(meta.deliveryPricing?.manualOverride, true);
  assert.ok(meta.deliveryPricing.lines.some((line) => line.baseUnitPrice === base.toFixed(2) && line.appliedUnitPrice === override.toFixed(2) && line.manuallyOverridden === true));

  row = await delivery.acceptDelivery(demo.tenantId, admin, row.id);
  assert.equal(row.state, 'CONFIRMADO');
  assert.ok(row.commands.length >= 1, 'Aceptar debe enviar a Producción/KDS');
  const ownCommands = await delivery.listKdsCommands(demo.tenantId, admin, { station:menu.station });
  const kds = ownCommands.find((command) => command.order?.delivery?.id === row.id);
  assert.ok(kds, 'Domicilio debe llegar al KDS de su estación');
  assert.equal(kds.order.items.length, 2, 'KDS no debe recombinar precio/nota diferentes');
  assert.ok(kds.order.items.some((item) => item.notes === 'CON HIELO' && money(item.unitPrice).eq(override)));

  for (const command of row.commands) {
    await delivery.updateDeliveryCommandState(demo.tenantId, admin, command.id, 'EN_PREPARACION');
    await delivery.updateDeliveryCommandState(demo.tenantId, admin, command.id, 'LISTA');
  }
  row = await delivery.loadDelivery(demo.tenantId, row.id);
  assert.equal(row.state, 'LISTO');
  row = await delivery.markOnRoute(demo.tenantId, admin, row.id, { courierName:'QA V94' });
  row = await delivery.markDelivered(demo.tenantId, admin, row.id);
  assert.equal(row.state, 'ENTREGADO');

  // Se ejerce el contrato existente de liquidación sin modificar su código: debe consumir
  // exactamente el total ya persistido en las líneas del domicilio.
  const box = await prisma.cajaBanco.create({ data:{ tenantId:demo.tenantId, tipo:'CAJA', nombre:`Caja V94 ${Date.now()}`, saldoActual:0 } });
  await treasury.openCashSession(demo.tenantId, admin.id, box.id, { saldoInicial:0 });
  row = await delivery.registerDeliveryPayment(demo.tenantId, admin, row.id, {
    metodoPago:'EFECTIVO',
    cajaBancoId:box.id,
    referencia:'QA V94 precio aplicado'
  });
  assert.equal(row.paymentStatus, 'PAGADO');

  const [saleAfterPayment, detailsAfterPayment, masterAfterPayment, payment] = await Promise.all([
    prisma.comprobanteComercial.findUnique({ where:{ id:row.saleId } }),
    prisma.detalleComprobante.findMany({ where:{ tenantId:demo.tenantId, comprobanteId:row.saleId, productoId:product.id }, orderBy:{ precioUnitario:'asc' } }),
    prisma.producto.findUnique({ where:{ id:product.id } }),
    prisma.pago.findFirst({ where:{ tenantId:demo.tenantId, documentoId:row.saleId }, orderBy:{ creadoEn:'desc' } })
  ]);
  assert.equal(saleAfterPayment.estado, 'PAGADO_TOTAL');
  assert.ok(money(saleAfterPayment.total).eq(persistedTotal), 'Liquidación debe conservar el total de precio aplicado');
  assert.equal(detailsAfterPayment.length, 2);
  assert.ok(money(detailsAfterPayment[0].precioUnitario).eq(base));
  assert.ok(money(detailsAfterPayment[1].precioUnitario).eq(override));
  assert.ok(money(masterAfterPayment.precio1).eq(base), 'Ni entrega ni liquidación pueden modificar precio maestro de Carta');
  assert.ok(payment && money(payment.monto).eq(persistedTotal), 'Pago debe usar exactamente el total persistido, sin recalcular precio de Carta');

  console.log(JSON.stringify({
    ok:true,
    marker:'VANTIX_RESTAURANT_ORDER_LINE_IDENTITY_V94_DB',
    deliveryId:row.id,
    baseUnitPrice:base.toString(),
    appliedUnitPrice:override.toString(),
    persistedGroups:detailsAfterPayment.length,
    total:persistedTotal.toString(),
    masterPriceUnchanged:true,
    liquidationUsesPersistedTotal:true
  }));
}

main().finally(() => prisma.$disconnect());
