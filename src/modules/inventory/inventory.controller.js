const service = require('./inventory.service');
const { productSchema, updateProductSchema } = require('./inventory.schemas');
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

async function deactivateProduct(req, res, next) {
  try {
    res.json({ ok: true, data: await service.deactivateProduct(req.tenantId, req.params.id) });
  } catch (error) { next(error); }
}

async function createMovement(_req, _res, next) {
  // Un movimiento manual de Kardex no puede saltarse Contabilidad. Las entradas
  // y salidas normales nacen en Compras/Ventas; los ajustes deben pasar por el
  // servicio integrado, que crea Kardex + AU + soporte dentro de una transacción.
  next(new AppError(
    409,
    'Los movimientos manuales de Kardex deben registrarse desde Ajuste de inventario para generar su asiento contable.',
    'INVENTORY_ACCOUNTING_INTEGRATION_REQUIRED',
    { endpoint: '/api/v1/integracion/inventario/ajustes' }
  ));
}

async function listMovements(req, res, next) {
  try {
    const data = await service.listMovements(req.tenantId, {
      productoId: req.query.productoId,
      tipo: req.query.tipo,
      desde: req.query.desde,
      hasta: req.query.hasta,
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
  deactivateProduct,
  createMovement,
  listMovements
};
