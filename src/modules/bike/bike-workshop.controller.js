const service = require('./bike-workshop.service');
const cancelService = require('./bike-workshop-cancel.service');
const schemas = require('./bike-workshop.schemas');

async function createWorkOrder(req, res, next) {
  try { res.status(201).json({ ok: true, data: await service.createWorkOrder(req.tenantId, req.userId, schemas.parse(schemas.createWorkOrderSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function listWorkOrders(req, res, next) {
  try {
    res.json({ ok: true, data: await service.listWorkOrders(req.tenantId, {
      status: req.query.status,
      bikeId: req.query.bikeId,
      customerThirdPartyId: req.query.customerThirdPartyId,
      assignedUserId: req.query.assignedUserId,
      limit: req.query.limit
    }) });
  } catch (error) { next(error); }
}

async function getWorkOrder(req, res, next) {
  try { res.json({ ok: true, data: await service.getWorkOrder(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
}

async function addFinding(req, res, next) {
  try { res.status(201).json({ ok: true, data: await service.addFinding(req.tenantId, req.userId, req.params.id, schemas.parse(schemas.findingSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function addItem(req, res, next) {
  try { res.status(201).json({ ok: true, data: await service.addItem(req.tenantId, req.params.id, schemas.parse(schemas.workOrderItemSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function authorizeItem(req, res, next) {
  try {
    const input = schemas.parse(schemas.authorizeItemSchema, req.body || {});
    res.json({ ok: true, data: await service.authorizeItem(req.tenantId, req.userId, req.params.id, req.params.itemId, input.authorizedBy) });
  } catch (error) { next(error); }
}

async function rejectItem(req, res, next) {
  try {
    const input = schemas.parse(schemas.rejectItemSchema, req.body);
    res.json({ ok: true, data: await service.rejectItem(req.tenantId, req.params.id, req.params.itemId, input.reason) });
  } catch (error) { next(error); }
}

async function startItem(req, res, next) {
  try { res.json({ ok: true, data: await service.startItem(req.tenantId, req.params.id, req.params.itemId) }); }
  catch (error) { next(error); }
}

async function completeItem(req, res, next) {
  try { res.json({ ok: true, data: await service.completeItem(req.tenantId, req.params.id, req.params.itemId) }); }
  catch (error) { next(error); }
}

async function installPart(req, res, next) {
  try { res.json({ ok: true, data: await service.installPart(req.tenantId, req.params.id, req.params.itemId) }); }
  catch (error) { next(error); }
}

async function finalTest(req, res, next) {
  try { res.status(201).json({ ok: true, data: await service.finalTest(req.tenantId, req.userId, req.params.id, schemas.parse(schemas.finalTestSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function createBillingDraft(req, res, next) {
  try { res.status(201).json({ ok: true, data: await service.createBillingDraft(req.tenantId, req.userId, req.params.id, schemas.parse(schemas.billingDraftSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function emitBilling(req, res, next) {
  try { res.json({ ok: true, data: await service.emitBilling(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
}

async function deliverWorkOrder(req, res, next) {
  try { res.json({ ok: true, data: await service.deliverWorkOrder(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
}

async function cancelWorkOrder(req, res, next) {
  try {
    const input = schemas.parse(schemas.cancelSchema, req.body);
    res.json({ ok: true, data: await cancelService.cancelWorkOrderSafe(req.tenantId, req.params.id, input.reason) });
  } catch (error) { next(error); }
}

module.exports = {
  createWorkOrder,
  listWorkOrders,
  getWorkOrder,
  addFinding,
  addItem,
  authorizeItem,
  rejectItem,
  startItem,
  completeItem,
  installPart,
  finalTest,
  createBillingDraft,
  emitBilling,
  deliverWorkOrder,
  cancelWorkOrder
};
