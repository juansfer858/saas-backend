'use strict';

const { AppError } = require('../../utils/app-error');

const POS_NUMBER_WIDTH = 6;
const POS_NUMBER_RE = /^\d{6,}$/;

function isFinalPosNumber(value) {
  return POS_NUMBER_RE.test(String(value || '').trim());
}

function formatPosNumber(value) {
  const number = BigInt(value);
  if (number < 1n) throw new AppError(500, 'Consecutivo POS inválido', 'RESTAURANT_POS_NUMBER_INVALID');
  return number.toString().padStart(POS_NUMBER_WIDTH, '0');
}

async function lockTenantSequence(tx, tenantId) {
  if (typeof tx?.$queryRawUnsafe !== 'function') {
    throw new AppError(500, 'El motor transaccional no soporta bloqueo de consecutivo POS', 'RESTAURANT_POS_SEQUENCE_LOCK_UNAVAILABLE');
  }
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    `vantixgc:restaurant-pos:${tenantId}`
  );
}

async function maxAssignedNumber(tx, tenantId) {
  const rows = await tx.$queryRawUnsafe(
    `SELECT COALESCE(MAX(CAST("numero" AS BIGINT)), 0)::text AS "maxNumber"
       FROM "ComprobanteComercial"
      WHERE "tenantId" = $1
        AND "tipo" = 'FACTURA_VENTA'
        AND "numero" ~ '^[0-9]{6,}$'`,
    tenantId
  );
  return BigInt(rows?.[0]?.maxNumber || '0');
}

async function assignRestaurantPosNumberInTx(tx, tenantId, saleId) {
  if (!tenantId || !saleId) throw new AppError(400, 'Venta y empresa son obligatorias para numerar POS', 'RESTAURANT_POS_NUMBER_INPUT_REQUIRED');
  await lockTenantSequence(tx, tenantId);

  const sale = await tx.comprobanteComercial.findFirst({
    where: { id: saleId, tenantId, tipo: 'FACTURA_VENTA' },
    select: { id: true, numero: true, sourceId: true }
  });
  if (!sale) throw new AppError(404, 'Venta POS no encontrada', 'RESTAURANT_POS_SALE_NOT_FOUND');
  if (!String(sale.sourceId || '').startsWith('REST-TABLE-')) {
    throw new AppError(409, 'La venta no pertenece al flujo POS de restaurante', 'RESTAURANT_POS_NUMBER_SOURCE_INVALID');
  }
  if (isFinalPosNumber(sale.numero)) return sale;

  const nextNumber = formatPosNumber((await maxAssignedNumber(tx, tenantId)) + 1n);
  return tx.comprobanteComercial.update({
    where: { id: sale.id },
    data: { numero: nextNumber },
    select: { id: true, numero: true, sourceId: true }
  });
}

module.exports = {
  POS_NUMBER_WIDTH,
  POS_NUMBER_RE,
  isFinalPosNumber,
  formatPosNumber,
  assignRestaurantPosNumberInTx
};
