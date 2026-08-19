const service = require('./inventory.service');
const { productSchema, updateProductSchema, movementSchema } = require('./inventory.schemas');
const { AppError } = require('../../utils/app-error');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de inventario inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

async function createProduct(req, res, next) {
  try {
    const data = await service.createProduct(req.tenantId, parse(productSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function listProducts(req, res, next) {
  try {
    const data = await service.listProducts(req.tenantId, {
      tipo: req.query.tipo,
      q: req.query.q,
      limit: req.query.limit,
      activo: req.query.activo === undefined ? undefined : req.query.activo === 'true'
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function getProduct(req, res, next) {
  try {
    res.json({ ok: true, data: await service.getProduct(req.tenantId, req.params.id) });
  } catch (error) { next(error); }
}

async function updateProduct(req, res, next) {
  try {
    const data = await service.updateProduct(req.tenantId, req.params.id, parse(updateProductSchema, req.body));
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function createMovement(req, res, next) {
  try {
    const data = await service.createManualMovement(req.tenantId, parse(movementSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function listMovements(req, res, next) {
  try {
    const data = await service.listMovements(req.tenantId, {
      productoId: req.query.productoId,
      limit: req.query.limit
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

module.exports = {
  createProduct,
  listProducts,
  getProduct,
  updateProduct,
  createMovement,
  listMovements
};
