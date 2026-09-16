const { AppError } = require('../../utils/app-error');

async function lockProductRow(client, tenantId, productId) {
  const rows = await client.$queryRawUnsafe(
    'SELECT "id" FROM "Producto" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE',
    productId,
    tenantId
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new AppError(404, 'Producto no encontrado', 'PRODUCT_NOT_FOUND');
  }
  return rows[0];
}

module.exports = { lockProductRow };
