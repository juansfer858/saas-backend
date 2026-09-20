const service = require('./bike-agenda.service');
const mechanics = require('./bike-agenda-mechanics.service');
const schemas = require('./bike-agenda.schemas');

async function listMechanics(req, res, next) {
  try { res.json({ ok: true, data: await mechanics.listMechanics(req.tenantId) }); }
  catch (error) { next(error); }
}

async function createScheduleRule(req, res, next) {
  try { res.status(201).json({ ok: true, data: await service.createScheduleRule(req.tenantId, schemas.parse(schemas.scheduleRuleSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function listScheduleRules(req, res, next) {
  try {
    res.json({ ok: true, data: await service.listScheduleRules(req.tenantId, {
      userId: req.query.userId,
      branchId: req.query.branchId,
      dayOfWeek: req.query.dayOfWeek,
      active: req.query.active === undefined ? undefined : req.query.active === 'true'
    }) });
  } catch (error) { next(error); }
}

async function deactivateScheduleRule(req, res, next) {
  try { res.json({ ok: true, data: await service.deactivateScheduleRule(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
}

async function createScheduleBlock(req, res, next) {
  try {
    const input = schemas.parse(schemas.scheduleBlockSchema, req.body);
    res.status(201).json({ ok: true, data: await service.createScheduleBlock(req.tenantId, input.userId, req.userId, input) });
  } catch (error) { next(error); }
}

async function listScheduleBlocks(req, res, next) {
  try {
    res.json({ ok: true, data: await service.listScheduleBlocks(req.tenantId, {
      userId: req.query.userId,
      branchId: req.query.branchId,
      from: req.query.from,
      to: req.query.to
    }) });
  } catch (error) { next(error); }
}

async function findAvailability(req, res, next) {
  try { res.json({ ok: true, data: await service.findAvailability(req.tenantId, schemas.parse(schemas.availabilitySchema, req.query)) }); }
  catch (error) { next(error); }
}

async function createAppointment(req, res, next) {
  try { res.status(201).json({ ok: true, data: await service.createAppointment(req.tenantId, req.userId, schemas.parse(schemas.appointmentSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function listAppointments(req, res, next) {
  try {
    res.json({ ok: true, data: await service.listAppointments(req.tenantId, {
      userId: req.query.userId,
      customerThirdPartyId: req.query.customerThirdPartyId,
      bikeId: req.query.bikeId,
      status: req.query.status,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit
    }) });
  } catch (error) { next(error); }
}

async function confirmAppointment(req, res, next) {
  try { res.json({ ok: true, data: await service.confirmAppointment(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
}

async function cancelAppointment(req, res, next) {
  try {
    const input = schemas.parse(schemas.cancelSchema, req.body);
    res.json({ ok: true, data: await service.cancelAppointment(req.tenantId, req.userId, req.params.id, input.reason, input.source) });
  } catch (error) { next(error); }
}

async function rescheduleAppointment(req, res, next) {
  try { res.json({ ok: true, data: await service.rescheduleAppointment(req.tenantId, req.userId, req.params.id, schemas.parse(schemas.rescheduleSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function convertAppointmentToWorkOrder(req, res, next) {
  try { res.status(201).json({ ok: true, data: await service.convertAppointmentToWorkOrder(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
}

module.exports = {
  listMechanics,
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
