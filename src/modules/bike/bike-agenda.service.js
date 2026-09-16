'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const ACTIVE_APPOINTMENT_STATES = ['PENDING', 'CONFIRMED', 'IN_PROGRESS'];

function localParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    year,
    month,
    day,
    hour,
    minute,
    dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    minuteOfDay: hour * 60 + minute,
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  };
}

function zonedLocalToUtc(dateKey, minuteOfDay, timeZone) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const desiredUtcLike = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = new Date(desiredUtcLike);
  for (let i = 0; i < 4; i += 1) {
    const parts = localParts(guess, timeZone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const delta = represented - desiredUtcLike;
    if (delta === 0) return guess;
    guess = new Date(guess.getTime() - delta);
  }
  return guess;
}

function dateKeyDayOfWeek(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function ruleValidForDate(rule, dateKey) {
  const from = rule.validFrom ? rule.validFrom.toISOString().slice(0, 10) : null;
  const until = rule.validUntil ? rule.validUntil.toISOString().slice(0, 10) : null;
  return (!from || dateKey >= from) && (!until || dateKey <= until);
}

async function assertUser(tenantId, userId, client = prisma) {
  const user = await client.user.findFirst({ where: { id: userId, tenantId, activo: true } });
  if (!user) throw new AppError(404, 'Mecánico/usuario no encontrado en esta empresa', 'BIKE_AGENDA_USER_NOT_FOUND');
  return user;
}

async function assertCustomer(tenantId, customerThirdPartyId, client = prisma) {
  const customer = await client.tercero.findFirst({ where: { id: customerThirdPartyId, tenantId, activo: true } });
  if (!customer) throw new AppError(404, 'Cliente no encontrado en esta empresa', 'BIKE_AGENDA_CUSTOMER_NOT_FOUND');
  return customer;
}

async function assertService(tenantId, serviceCatalogId, client = prisma) {
  const service = await client.bikeServiceCatalog.findFirst({ where: { id: serviceCatalogId, tenantId, active: true } });
  if (!service) throw new AppError(404, 'Servicio Bike no encontrado', 'BIKE_AGENDA_SERVICE_NOT_FOUND');
  return service;
}

async function assertBikeOwnership(tenantId, bikeId, customerThirdPartyId, client = prisma) {
  if (!bikeId) return null;
  const bike = await client.bikeAsset.findFirst({ where: { id: bikeId, tenantId } });
  if (!bike) throw new AppError(404, 'Bicicleta no encontrada', 'BIKE_NOT_FOUND');
  if (bike.customerThirdPartyId !== customerThirdPartyId) throw new AppError(409, 'La bicicleta no pertenece al cliente de la cita', 'BIKE_AGENDA_BIKE_OWNER_MISMATCH');
  return bike;
}

async function lockMechanic(tx, tenantId, userId) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${userId}))`;
}

async function createScheduleRule(tenantId, input) {
  await assertUser(tenantId, input.userId);
  const overlap = await prisma.bikeScheduleRule.findFirst({
    where: {
      tenantId,
      userId: input.userId,
      dayOfWeek: input.dayOfWeek,
      active: true,
      branchId: input.branchId || null,
      startMinute: { lt: input.endMinute },
      endMinute: { gt: input.startMinute }
    }
  });
  if (overlap) throw new AppError(409, 'El horario se cruza con otra regla activa del mecánico', 'BIKE_AGENDA_RULE_OVERLAP');
  return prisma.bikeScheduleRule.create({
    data: {
      tenantId,
      branchId: input.branchId || null,
      userId: input.userId,
      dayOfWeek: input.dayOfWeek,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      timeZone: input.timeZone,
      validFrom: input.validFrom || null,
      validUntil: input.validUntil || null,
      active: input.active !== false
    }
  });
}

async function listScheduleRules(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.userId) where.userId = filters.userId;
  if (filters.branchId) where.branchId = filters.branchId;
  if (filters.dayOfWeek !== undefined) where.dayOfWeek = Number(filters.dayOfWeek);
  if (filters.active !== undefined) where.active = filters.active;
  return prisma.bikeScheduleRule.findMany({ where, orderBy: [{ userId: 'asc' }, { dayOfWeek: 'asc' }, { startMinute: 'asc' }] });
}

async function deactivateScheduleRule(tenantId, id) {
  const current = await prisma.bikeScheduleRule.findFirst({ where: { id, tenantId } });
  if (!current) throw new AppError(404, 'Regla de horario no encontrada', 'BIKE_AGENDA_RULE_NOT_FOUND');
  return prisma.bikeScheduleRule.update({ where: { id }, data: { active: false } });
}

async function createScheduleBlock(tenantId, userId, actorUserId, input) {
  await assertUser(tenantId, userId);
  if (!(input.startsAt < input.endsAt)) throw new AppError(400, 'El bloqueo debe tener inicio anterior al fin', 'BIKE_AGENDA_BLOCK_RANGE_INVALID');
  return prisma.bikeScheduleBlock.create({
    data: {
      tenantId,
      branchId: input.branchId || null,
      userId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason || null,
      createdById: actorUserId || null
    }
  });
}

async function listScheduleBlocks(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.userId) where.userId = filters.userId;
  if (filters.branchId) where.branchId = filters.branchId;
  if (filters.from || filters.to) {
    where.AND = [];
    if (filters.to) where.AND.push({ startsAt: { lt: new Date(filters.to) } });
    if (filters.from) where.AND.push({ endsAt: { gt: new Date(filters.from) } });
  }
  return prisma.bikeScheduleBlock.findMany({ where, orderBy: { startsAt: 'asc' } });
}

async function ensureSlotAvailableInTx(tx, tenantId, params) {
  await assertUser(tenantId, params.assignedUserId, tx);
  const service = await assertService(tenantId, params.serviceCatalogId, tx);
  const startsAt = new Date(params.startsAt);
  const endsAt = new Date(startsAt.getTime() + service.estimatedMinutes * 60_000);
  if (!Number.isFinite(startsAt.getTime())) throw new AppError(400, 'Fecha de cita inválida', 'BIKE_AGENDA_INVALID_DATE');

  await lockMechanic(tx, tenantId, params.assignedUserId);

  const rules = await tx.bikeScheduleRule.findMany({
    where: {
      tenantId,
      userId: params.assignedUserId,
      active: true,
      OR: [{ branchId: params.branchId || null }, { branchId: null }]
    }
  });

  const covered = rules.some((rule) => {
    const startLocal = localParts(startsAt, rule.timeZone);
    const endLocal = localParts(endsAt, rule.timeZone);
    if (startLocal.dateKey !== endLocal.dateKey) return false;
    if (startLocal.dayOfWeek !== rule.dayOfWeek) return false;
    if (!ruleValidForDate(rule, startLocal.dateKey)) return false;
    return startLocal.minuteOfDay >= rule.startMinute && endLocal.minuteOfDay <= rule.endMinute;
  });
  if (!covered) throw new AppError(409, 'La cita queda fuera del horario disponible del mecánico', 'BIKE_AGENDA_OUTSIDE_SCHEDULE');

  const block = await tx.bikeScheduleBlock.findFirst({
    where: {
      tenantId,
      userId: params.assignedUserId,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt }
    }
  });
  if (block) throw new AppError(409, 'El mecánico está bloqueado/no disponible en ese horario', 'BIKE_AGENDA_MECHANIC_BLOCKED');

  const appointmentWhere = {
    tenantId,
    assignedUserId: params.assignedUserId,
    status: { in: ACTIVE_APPOINTMENT_STATES },
    startsAt: { lt: endsAt },
    endsAt: { gt: startsAt }
  };
  if (params.excludeAppointmentId) appointmentWhere.id = { not: params.excludeAppointmentId };
  const conflict = await tx.bikeAppointment.findFirst({ where: appointmentWhere });
  if (conflict) throw new AppError(409, 'Ese horario acaba de ser ocupado por otra cita', 'BIKE_AGENDA_SLOT_TAKEN', { appointmentId: conflict.id });

  return { service, startsAt, endsAt };
}

async function findAvailability(tenantId, input) {
  const service = await assertService(tenantId, input.serviceCatalogId);
  const dayOfWeek = dateKeyDayOfWeek(input.date);
  const where = { tenantId, active: true, dayOfWeek };
  if (input.assignedUserId) where.userId = input.assignedUserId;
  if (input.branchId) where.OR = [{ branchId: input.branchId }, { branchId: null }];
  const rules = await prisma.bikeScheduleRule.findMany({ where, orderBy: [{ userId: 'asc' }, { startMinute: 'asc' }] });
  if (!rules.length) return [];

  const validRules = rules.filter((rule) => ruleValidForDate(rule, input.date));
  const userIds = [...new Set(validRules.map((rule) => rule.userId))];
  const users = userIds.length ? await prisma.user.findMany({ where: { tenantId, id: { in: userIds }, activo: true }, select: { id: true, nombre: true } }) : [];
  const userById = new Map(users.map((user) => [user.id, user]));

  const ranges = validRules.map((rule) => ({
    rule,
    start: zonedLocalToUtc(input.date, rule.startMinute, rule.timeZone),
    end: zonedLocalToUtc(input.date, rule.endMinute, rule.timeZone)
  })).filter((range) => range.start < range.end && userById.has(range.rule.userId));
  if (!ranges.length) return [];

  const minStart = new Date(Math.min(...ranges.map((range) => range.start.getTime())));
  const maxEnd = new Date(Math.max(...ranges.map((range) => range.end.getTime())));
  const [appointments, blocks] = await Promise.all([
    prisma.bikeAppointment.findMany({
      where: {
        tenantId,
        assignedUserId: { in: userIds },
        status: { in: ACTIVE_APPOINTMENT_STATES },
        startsAt: { lt: maxEnd },
        endsAt: { gt: minStart }
      }
    }),
    prisma.bikeScheduleBlock.findMany({
      where: {
        tenantId,
        userId: { in: userIds },
        startsAt: { lt: maxEnd },
        endsAt: { gt: minStart }
      }
    })
  ]);

  const step = input.stepMinutes || 15;
  const now = new Date();
  const result = [];
  const seen = new Set();
  for (const { rule } of ranges) {
    for (let minute = rule.startMinute; minute + service.estimatedMinutes <= rule.endMinute; minute += step) {
      const startsAt = zonedLocalToUtc(input.date, minute, rule.timeZone);
      const endsAt = new Date(startsAt.getTime() + service.estimatedMinutes * 60_000);
      if (startsAt <= now) continue;
      const key = `${rule.userId}:${startsAt.toISOString()}`;
      if (seen.has(key)) continue;
      const occupied = appointments.some((item) => item.assignedUserId === rule.userId && overlaps(startsAt, endsAt, item.startsAt, item.endsAt));
      const blocked = blocks.some((item) => item.userId === rule.userId && overlaps(startsAt, endsAt, item.startsAt, item.endsAt));
      if (occupied || blocked) continue;
      seen.add(key);
      result.push({
        assignedUserId: rule.userId,
        mechanicName: userById.get(rule.userId)?.nombre || null,
        serviceCatalogId: service.id,
        serviceName: service.name,
        durationMinutes: service.estimatedMinutes,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        timeZone: rule.timeZone,
        branchId: input.branchId || rule.branchId || null
      });
    }
  }
  return result.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || String(a.mechanicName).localeCompare(String(b.mechanicName)));
}

async function createAppointment(tenantId, actorUserId, input) {
  return prisma.$transaction(async (tx) => {
    await assertCustomer(tenantId, input.customerThirdPartyId, tx);
    await assertBikeOwnership(tenantId, input.bikeId || null, input.customerThirdPartyId, tx);
    const slot = await ensureSlotAvailableInTx(tx, tenantId, input);
    const appointment = await tx.bikeAppointment.create({
      data: {
        tenantId,
        branchId: input.branchId || null,
        bikeId: input.bikeId || null,
        customerThirdPartyId: input.customerThirdPartyId,
        serviceCatalogId: input.serviceCatalogId,
        assignedUserId: input.assignedUserId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: input.status || 'PENDING',
        source: input.source || 'INTERNAL',
        customerNotes: input.customerNotes || null,
        internalNotes: input.internalNotes || null
      }
    });
    await tx.bikeAppointmentEvent.create({
      data: {
        tenantId,
        appointmentId: appointment.id,
        type: 'CREATED',
        actorUserId: actorUserId || null,
        source: appointment.source,
        data: { startsAt: slot.startsAt, endsAt: slot.endsAt, serviceCatalogId: input.serviceCatalogId }
      }
    });
    return appointment;
  });
}

async function listAppointments(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.userId) where.assignedUserId = filters.userId;
  if (filters.customerThirdPartyId) where.customerThirdPartyId = filters.customerThirdPartyId;
  if (filters.bikeId) where.bikeId = filters.bikeId;
  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) {
    where.AND = [];
    if (filters.to) where.AND.push({ startsAt: { lt: new Date(filters.to) } });
    if (filters.from) where.AND.push({ endsAt: { gt: new Date(filters.from) } });
  }
  return prisma.bikeAppointment.findMany({
    where,
    include: { bike: true, service: true },
    orderBy: { startsAt: 'asc' },
    take: Math.min(Number(filters.limit) || 200, 500)
  });
}

async function confirmAppointment(tenantId, actorUserId, id) {
  return prisma.$transaction(async (tx) => {
    const appointment = await tx.bikeAppointment.findFirst({ where: { id, tenantId } });
    if (!appointment) throw new AppError(404, 'Cita no encontrada', 'BIKE_APPOINTMENT_NOT_FOUND');
    if (appointment.status === 'CONFIRMED') return appointment;
    if (appointment.status !== 'PENDING') throw new AppError(409, 'Solo una cita pendiente puede confirmarse', 'BIKE_APPOINTMENT_NOT_CONFIRMABLE');
    const updated = await tx.bikeAppointment.update({ where: { id }, data: { status: 'CONFIRMED' } });
    await tx.bikeAppointmentEvent.create({ data: { tenantId, appointmentId: id, type: 'CONFIRMED', actorUserId: actorUserId || null, source: 'INTERNAL' } });
    return updated;
  });
}

async function cancelAppointment(tenantId, actorUserId, id, reason, source = 'INTERNAL') {
  return prisma.$transaction(async (tx) => {
    const appointment = await tx.bikeAppointment.findFirst({ where: { id, tenantId } });
    if (!appointment) throw new AppError(404, 'Cita no encontrada', 'BIKE_APPOINTMENT_NOT_FOUND');
    if (appointment.status === 'CANCELLED') return appointment;
    if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) throw new AppError(409, 'La cita ya está en ejecución o terminada', 'BIKE_APPOINTMENT_NOT_CANCELLABLE');
    await lockMechanic(tx, tenantId, appointment.assignedUserId);
    const updated = await tx.bikeAppointment.update({ where: { id }, data: { status: 'CANCELLED' } });
    await tx.bikeAppointmentEvent.create({ data: { tenantId, appointmentId: id, type: 'CANCELLED', actorUserId: actorUserId || null, source, data: { reason } } });
    return updated;
  });
}

async function rescheduleAppointment(tenantId, actorUserId, id, input) {
  return prisma.$transaction(async (tx) => {
    const appointment = await tx.bikeAppointment.findFirst({ where: { id, tenantId } });
    if (!appointment) throw new AppError(404, 'Cita no encontrada', 'BIKE_APPOINTMENT_NOT_FOUND');
    if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) throw new AppError(409, 'La cita ya no puede reprogramarse', 'BIKE_APPOINTMENT_NOT_RESCHEDULABLE');
    const assignedUserId = input.assignedUserId || appointment.assignedUserId;
    const serviceCatalogId = input.serviceCatalogId || appointment.serviceCatalogId;
    const branchId = Object.prototype.hasOwnProperty.call(input, 'branchId') ? input.branchId : appointment.branchId;
    const slot = await ensureSlotAvailableInTx(tx, tenantId, {
      assignedUserId,
      serviceCatalogId,
      branchId,
      startsAt: input.startsAt,
      excludeAppointmentId: id
    });
    const previous = { startsAt: appointment.startsAt, endsAt: appointment.endsAt, assignedUserId: appointment.assignedUserId };
    const updated = await tx.bikeAppointment.update({
      where: { id },
      data: { assignedUserId, serviceCatalogId, branchId: branchId || null, startsAt: slot.startsAt, endsAt: slot.endsAt }
    });
    await tx.bikeAppointmentEvent.create({ data: { tenantId, appointmentId: id, type: 'RESCHEDULED', actorUserId: actorUserId || null, source: 'INTERNAL', data: { previous, next: { startsAt: slot.startsAt, endsAt: slot.endsAt, assignedUserId } } } });
    return updated;
  });
}

function workOrderNumber() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `OT-BIKE-${day}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function convertAppointmentToWorkOrder(tenantId, actorUserId, id) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${`APPOINTMENT:${id}`}))`;
    const existingLink = await tx.bikeAppointmentWorkOrderLink.findUnique({ where: { appointmentId: id } });
    if (existingLink) {
      const existingOrder = await tx.bikeWorkOrder.findFirst({ where: { id: existingLink.workOrderId, tenantId } });
      if (existingOrder) return existingOrder;
    }

    const appointment = await tx.bikeAppointment.findFirst({ where: { id, tenantId } });
    if (!appointment) throw new AppError(404, 'Cita no encontrada', 'BIKE_APPOINTMENT_NOT_FOUND');
    if (appointment.status !== 'CONFIRMED') throw new AppError(409, 'La cita debe estar confirmada antes de ingresar al taller', 'BIKE_APPOINTMENT_NOT_CONFIRMED');
    if (!appointment.bikeId) throw new AppError(409, 'La cita debe tener una bicicleta asociada para crear la OT', 'BIKE_APPOINTMENT_BIKE_REQUIRED');
    const bike = await tx.bikeAsset.findFirst({ where: { id: appointment.bikeId, tenantId } });
    if (!bike) throw new AppError(404, 'Bicicleta no encontrada', 'BIKE_NOT_FOUND');
    const openOrder = await tx.bikeWorkOrder.findFirst({ where: { tenantId, bikeId: bike.id, status: { notIn: ['DELIVERED', 'CANCELLED'] } } });
    if (openOrder) throw new AppError(409, 'La bicicleta ya tiene una orden de taller abierta', 'BIKE_WORK_ORDER_ALREADY_OPEN', { workOrderId: openOrder.id });

    const order = await tx.bikeWorkOrder.create({
      data: {
        tenantId,
        branchId: appointment.branchId || bike.branchId || null,
        number: workOrderNumber(),
        bikeId: bike.id,
        customerThirdPartyId: appointment.customerThirdPartyId,
        assignedUserId: appointment.assignedUserId || null,
        customerRequest: appointment.customerNotes || null,
        intakeNotes: appointment.internalNotes || null,
        estimatedReadyAt: appointment.endsAt,
        createdByUserId: actorUserId
      }
    });
    await tx.bikeAsset.update({ where: { id: bike.id }, data: { status: 'IN_WORKSHOP' } });
    await tx.bikeAppointment.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
    await tx.bikeAppointmentWorkOrderLink.create({ data: { tenantId, appointmentId: id, workOrderId: order.id, createdById: actorUserId || null } });
    await tx.bikeAppointmentEvent.create({ data: { tenantId, appointmentId: id, type: 'CONVERTED_TO_WORK_ORDER', actorUserId: actorUserId || null, source: 'INTERNAL', data: { workOrderId: order.id, workOrderNumber: order.number } } });
    return order;
  });
}

module.exports = {
  localParts,
  zonedLocalToUtc,
  createScheduleRule,
  listScheduleRules,
  deactivateScheduleRule,
  createScheduleBlock,
  listScheduleBlocks,
  findAvailability,
  createAppointment,
  listAppointments,
  confirmAppointment,
  cancelAppointment,
  rescheduleAppointment,
  convertAppointmentToWorkOrder
};
