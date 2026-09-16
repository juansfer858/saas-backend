'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const agenda = require('../src/modules/bike/bike-agenda.service');

async function main() {
  const suffix = Date.now().toString(36);
  const tenant = await prisma.tenant.create({ data: { nombreEmpresa: `Bike Agenda ${suffix}`, subdomain: `bike-agenda-${suffix}`, nicho: 'BIKE' } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, nombre: 'Admin Agenda', email: `admin-agenda-${suffix}@test.local`, password: 'x', rol: 'ADMIN' } });
  const mechanic = await prisma.user.create({ data: { tenantId: tenant.id, nombre: 'Mecánico Uno', email: `mecanico-${suffix}@test.local`, password: 'x', rol: 'BIKE_MECANICO' } });
  const customer = await prisma.tercero.create({ data: { tenantId: tenant.id, tipo: 'CLIENTE', tipoDocumento: 'CC', identificacion: `AG-${suffix}`, nombre: 'Cliente Agenda', telefono: '3001112233' } });
  const serviceProduct = await prisma.producto.create({ data: { tenantId: tenant.id, tipo: 'SERVICIO', sku: `AG-SERV-${suffix}`, nombre: 'Ajuste transmisión', controlaInventario: false, precio1: 50000, stockActual: 0 } });
  const service = await prisma.bikeServiceCatalog.create({ data: { tenantId: tenant.id, productId: serviceProduct.id, code: `AJUSTE-${suffix}`, name: 'Ajuste transmisión', category: 'TRANSMISION', estimatedMinutes: 60, basePrice: 50000 } });
  const bike = await prisma.bikeAsset.create({ data: { tenantId: tenant.id, customerThirdPartyId: customer.id, code: `AG-BIKE-${suffix}`, brand: 'Specialized', model: 'Rockhopper' } });

  // 2030-01-07 es lunes. Horario local Colombia: 09:00-12:00.
  await agenda.createScheduleRule(tenant.id, {
    userId: mechanic.id,
    branchId: null,
    dayOfWeek: 1,
    startMinute: 9 * 60,
    endMinute: 12 * 60,
    timeZone: 'America/Bogota',
    validFrom: null,
    validUntil: null,
    active: true
  });

  const common = {
    customerThirdPartyId: customer.id,
    bikeId: bike.id,
    serviceCatalogId: service.id,
    assignedUserId: mechanic.id,
    branchId: null,
    startsAt: new Date('2030-01-07T09:00:00-05:00'),
    source: 'RIDER_PORTAL'
  };

  const competing = await Promise.allSettled([
    agenda.createAppointment(tenant.id, admin.id, common),
    agenda.createAppointment(tenant.id, admin.id, common)
  ]);
  const wins = competing.filter((result) => result.status === 'fulfilled');
  const losses = competing.filter((result) => result.status === 'rejected');
  assert.equal(wins.length, 1, 'Solo una cita concurrente puede tomar el horario');
  assert.equal(losses.length, 1, 'La segunda cita concurrente debe ser rechazada');
  assert.equal(losses[0].reason?.code, 'BIKE_AGENDA_SLOT_TAKEN');
  const first = wins[0].value;

  await agenda.createScheduleBlock(tenant.id, mechanic.id, admin.id, {
    branchId: null,
    startsAt: new Date('2030-01-07T10:00:00-05:00'),
    endsAt: new Date('2030-01-07T11:00:00-05:00'),
    reason: 'Capacitación'
  });

  let available = await agenda.findAvailability(tenant.id, {
    date: '2030-01-07',
    serviceCatalogId: service.id,
    assignedUserId: mechanic.id,
    stepMinutes: 15
  });
  assert.equal(available.some((slot) => slot.startsAt === new Date('2030-01-07T09:00:00-05:00').toISOString()), false, 'El cupo ocupado no debe anunciarse');
  assert.equal(available.some((slot) => slot.startsAt === new Date('2030-01-07T10:00:00-05:00').toISOString()), false, 'El bloqueo del mecánico debe excluir el cupo');
  assert.equal(available.some((slot) => slot.startsAt === new Date('2030-01-07T11:00:00-05:00').toISOString()), true, '11:00 debe quedar libre');

  await agenda.cancelAppointment(tenant.id, admin.id, first.id, 'Cliente solicita mover la cita', 'RIDER_PORTAL');
  available = await agenda.findAvailability(tenant.id, {
    date: '2030-01-07',
    serviceCatalogId: service.id,
    assignedUserId: mechanic.id,
    stepMinutes: 15
  });
  assert.equal(available.some((slot) => slot.startsAt === new Date('2030-01-07T09:00:00-05:00').toISOString()), true, 'Cancelar debe liberar inmediatamente el horario');

  const second = await agenda.createAppointment(tenant.id, admin.id, { ...common, source: 'INTERNAL' });
  await agenda.confirmAppointment(tenant.id, admin.id, second.id);
  const moved = await agenda.rescheduleAppointment(tenant.id, admin.id, second.id, { startsAt: new Date('2030-01-07T11:00:00-05:00') });
  assert.equal(moved.startsAt.toISOString(), new Date('2030-01-07T11:00:00-05:00').toISOString());

  await assert.rejects(
    () => agenda.createAppointment(tenant.id, admin.id, { ...common, startsAt: new Date('2030-01-07T12:00:00-05:00') }),
    (error) => error?.code === 'BIKE_AGENDA_OUTSIDE_SCHEDULE'
  );

  const workOrder = await agenda.convertAppointmentToWorkOrder(tenant.id, admin.id, second.id);
  assert.equal(workOrder.bikeId, bike.id);
  assert.equal(workOrder.assignedUserId, mechanic.id);
  assert.equal(workOrder.status, 'RECEIVED');

  const link = await prisma.bikeAppointmentWorkOrderLink.findUnique({ where: { appointmentId: second.id } });
  assert.equal(link.workOrderId, workOrder.id);
  const convertedAppointment = await prisma.bikeAppointment.findUnique({ where: { id: second.id } });
  assert.equal(convertedAppointment.status, 'IN_PROGRESS');
  const asset = await prisma.bikeAsset.findUnique({ where: { id: bike.id } });
  assert.equal(asset.status, 'IN_WORKSHOP');

  const events = await prisma.bikeAppointmentEvent.findMany({ where: { tenantId: tenant.id, appointmentId: second.id } });
  assert.equal(events.some((event) => event.type === 'RESCHEDULED'), true);
  assert.equal(events.some((event) => event.type === 'CONVERTED_TO_WORK_ORDER'), true);

  console.log('BIKE_SMART_AGENDA_OK', JSON.stringify({ tenantId: tenant.id, appointmentId: second.id, workOrderId: workOrder.id, concurrencyProtected: true }));
}

main().catch((error) => {
  console.error('BIKE_SMART_AGENDA_ERROR', error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
