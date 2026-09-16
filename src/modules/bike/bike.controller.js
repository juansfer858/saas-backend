const service = require('./bike.service');
const schemas = require('./bike.schemas');

async function foundationStatus(req, res, next) {
  try {
    res.json(await service.foundationStatus(req.tenantId));
  } catch (error) {
    next(error);
  }
}

async function createBike(req, res, next) {
  try {
    const input = schemas.parse(schemas.createBikeSchema, req.body);
    res.status(201).json(await service.createBike(req.tenantId, input));
  } catch (error) {
    next(error);
  }
}

async function listBikes(req, res, next) {
  try {
    const filters = {
      customerThirdPartyId: req.query.customerThirdPartyId || undefined,
      branchId: req.query.branchId || undefined,
      status: req.query.status || undefined,
      q: req.query.q || undefined,
      limit: req.query.limit || undefined
    };
    res.json(await service.listBikes(req.tenantId, filters));
  } catch (error) {
    next(error);
  }
}

async function getBike(req, res, next) {
  try {
    res.json(await service.getBike(req.tenantId, req.params.id));
  } catch (error) {
    next(error);
  }
}

async function updateBike(req, res, next) {
  try {
    const input = schemas.parse(schemas.updateBikeSchema, req.body);
    res.json(await service.updateBike(req.tenantId, req.params.id, input));
  } catch (error) {
    next(error);
  }
}

async function createServiceCatalogItem(req, res, next) {
  try {
    const input = schemas.parse(schemas.createServiceSchema, req.body);
    res.status(201).json(await service.createServiceCatalogItem(req.tenantId, input));
  } catch (error) {
    next(error);
  }
}

async function listServiceCatalog(req, res, next) {
  try {
    const filters = {
      active: req.query.active === undefined ? undefined : req.query.active === 'true',
      category: req.query.category || undefined,
      q: req.query.q || undefined,
      limit: req.query.limit || undefined
    };
    res.json(await service.listServiceCatalog(req.tenantId, filters));
  } catch (error) {
    next(error);
  }
}

async function updateServiceCatalogItem(req, res, next) {
  try {
    const input = schemas.parse(schemas.updateServiceSchema, req.body);
    res.json(await service.updateServiceCatalogItem(req.tenantId, req.params.id, input));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  foundationStatus,
  createBike,
  listBikes,
  getBike,
  updateBike,
  createServiceCatalogItem,
  listServiceCatalog,
  updateServiceCatalogItem
};
