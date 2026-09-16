'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const bike = require('../src/modules/bike/bike-workshop.service');
const inventory = require('../src/modules/inventory/inventory.service');
const reservations = require('../src/modules/inventory/inventory-reservation.service');

async function main() {
  const suffix = Date.now().toString(36);
  const tenant = await prisma.tenant.create({ data: { nombreEmpresa: `Bike Smoke ${suffix}`, subdomain: `bike-smoke-${suffix}`, nicho: 'BIKE' } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, nombre: 'Admin Bike', email: `bike-${suffix}@test.local`, password: 'x', rol: 'ADMIN' } });
  const customer = await prisma.tercero.create({ data: { tenantId: tenant.id, tipo: 'CLIENTE', tipoDocumento: 'CC', identificacion: `C-${suffix}`, nombre: 'Cliente Bike', telefono: '3000000000' } });
  const serviceProduct = await prisma.producto.create({ data: { tenantId: tenant.id, tipo: 'SERVICIO', sku: `SERV-${suffix}`, nombre: 'Mantenimiento general', controlaInventario: false, precio1: 100000, stockActual: 0 } });
  const part = await prisma.producto.create({ data: { tenantId: tenant.id, tipo: 'PRODUCTO', sku: `PART-${suffix}`, nombre: 'Cadena Shimano', controlaInventario: true, precio1: 80000, costoPromedio: 40000, stockActual: 2 } });
  const service = await prisma.bikeServiceCatalog.create({ data: { tenantId: tenant.id, productId: serviceProduct.id, code: `MANT-${suffix}`, name: 'Mantenimiento general', category: 'MANTENIMIENTO', estimatedMinutes: 90, basePrice: 100000 } });
  const asset = await prisma.bikeAsset.create({ data: { tenantId: tenant.id, customerThirdPartyId: customer.id, code: `BIKE-${suffix}`, brand: 'Trek', model: 'Marlin 7' } });

  const order = await bike.createWorkOrder(tenant.id, user.id, { bikeId: asset.id, customerRequest: 'Revisión completa' });
  assert.equal(order.status, 'RECEIVED');

  await bike.addFinding(tenant.id, user.id, order.id, { system: 'TRANSMISION', condition: 'DESGASTE', severity: 'HIGH', finding: 'Cadena al 0.75%', recommendation: 'Cambiar cadena', visibleToRider: true });
  const serviceLine = await bike.addItem(tenant.id, order.id, { type: 'SERVICE', serviceCatalogId: service.id, quantity: 1 });
  const partLine = await bike.addItem(tenant.id, order.id, { type: 'PART', productId: part.id, quantity: 1 });

  await bike.authorizeItem(tenant.id, user.id, order.id, serviceLine.id, 'CUSTOMER_TEST');
  await bike.authorizeItem(tenant.id, user.id, order.id, partLine.id, 'CUSTOMER_TEST');

  const availableAfterReserve = await reservations.availability(tenant.id, part.id);
  assert.equal(availableAfterReserve.physical.toString(), '2');
  assert.equal(availableAfterReserve.reserved.toString(), '1');
  assert.equal(availableAfterReserve.available.toString(), '1');

  await assert.rejects(
    () => prisma.$transaction((tx) => inventory.applyMovement(tx, { tenantId: tenant.id, productoId: part.id, tipo: 'VENTA', cantidad: 2, referencia: 'OTHER-SALE' })),
    (error) => error?.code === 'INVENTORY_INSUFFICIENT_AVAILABLE_STOCK'
  );

  await bike.startItem(tenant.id, order.id, serviceLine.id);
  await bike.completeItem(tenant.id, order.id, serviceLine.id);
  await bike.installPart(tenant.id, order.id, partLine.id);

  const partAfterInstall = await prisma.producto.findUnique({ where: { id: part.id } });
  assert.equal(Number(partAfterInstall.stockActual), 2, 'Instalar no debe descontar stock físico antes de facturar');
  const reservationAfterInstall = await prisma.inventoryReservation.findUnique({ where: { tenantId_sourceType_sourceLineId: { tenantId: tenant.id, sourceType: 'BIKE_WORK_ORDER', sourceLineId: partLine.id } } });
  assert.equal(reservationAfterInstall.state, 'ACTIVE');

  await bike.finalTest(tenant.id, user.id, order.id, { checklist: { brakes: true, shifting: true, torque: true }, approved: true, notes: 'Prueba aprobada' });
  const ready = await bike.getWorkOrder(tenant.id, order.id);
  assert.equal(ready.status, 'READY');

  const saleDraft = await bike.createBillingDraft(tenant.id, user.id, order.id, { formaPago: 'CREDITO', documentType: 'DOCUMENTO_EQUIVALENTE_POS', notas: 'Smoke Bike' });
  assert.equal(saleDraft.tipo, 'FACTURA_VENTA');
  assert.equal(saleDraft.estado, 'BORRADOR');
  assert.equal(saleDraft.detalles.length, 2);
  const stored = await bike.getWorkOrder(tenant.id, order.id);
  assert.equal(stored.commercialDocumentId, saleDraft.id);

  const finalStock = await prisma.producto.findUnique({ where: { id: part.id } });
  assert.equal(Number(finalStock.stockActual), 2, 'El borrador comercial tampoco debe descontar stock');

  console.log('BIKE_WORKSHOP_INVENTORY_BRIDGE_OK', JSON.stringify({ tenantId: tenant.id, orderId: order.id, saleDraftId: saleDraft.id }));
}

main().catch((error) => {
  console.error('BIKE_WORKSHOP_INVENTORY_BRIDGE_ERROR', error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
