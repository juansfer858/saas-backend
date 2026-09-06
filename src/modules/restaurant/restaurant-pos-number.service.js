'use strict';

const { AppError } = require('../../utils/app-error');

const POS_NUMBER_WIDTH = 6;
const POS_NUMBER_RE = /^\d{6,}$/;
const POS_LOCK_ATTEMPTS = 25;
const POS_LOCK_RETRY_MS = 40;

function isFinalPosNumber(value) {
  return POS_NUMBER_RE.test(String(value || '').trim());
}

function formatPosNumber(value) {
  const number = BigInt(value);
  if (number < 1n) throw new AppError(500, 'Consecutivo POS inválido', 'RESTAURANT_POS_NUMBER_INVALID');
  return number.toString().padStart(POS_NUMBER_WIDTH, '0');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lockTenantSequence(tx, tenantId, options = {}) {
  if (typeof tx?.$queryRawUnsafe !== 'function') {
    throw new AppError(500, 'El motor transaccional no soporta bloqueo de consecutivo POS', 'RESTAURANT_POS_SEQUENCE_LOCK_UNAVAILABLE');
  }
  const attempts = Math.max(Number(options.attempts || POS_LOCK_ATTEMPTS), 1);
  const retryMs = Math.max(Number(options.retryMs ?? POS_LOCK_RETRY_MS), 0);
  const key = `vantixgc:restaurant-pos:v2:${tenantId}`;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const rows = await tx.$queryRawUnsafe(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS "locked"',
      key
    );
    if (rows?.[0]?.locked === true) return { locked: true, attempt, key };
    if (attempt < attempts && retryMs > 0) await delay(retryMs);
  }

  throw new AppError(
    409,
    'Otro cobro está asignando el consecutivo POS. Intenta confirmar nuevamente.',
    'RESTAURANT_POS_SEQUENCE_BUSY'
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

async function loadRestaurantSale(tx, tenantId, saleId) {
  const sale = await tx.comprobanteComercial.findFirst({
    where: { id: saleId, tenantId, tipo: 'FACTURA_VENTA' },
    select: { id: true, numero: true, sourceId: true }
  });
  if (!sale) throw new AppError(404, 'Venta POS no encontrada', 'RESTAURANT_POS_SALE_NOT_FOUND');
  if (!String(sale.sourceId || '').startsWith('REST-TABLE-')) {
    throw new AppError(409, 'La venta no pertenece al flujo POS de restaurante', 'RESTAURANT_POS_NUMBER_SOURCE_INVALID');
  }
  return sale;
}

async function assignRestaurantPosNumberInTx(tx, tenantId, saleId) {
  if (!tenantId || !saleId) throw new AppError(400, 'Venta y empresa son obligatorias para numerar POS', 'RESTAURANT_POS_NUMBER_INPUT_REQUIRED');

  let sale = await loadRestaurantSale(tx, tenantId, saleId);
  if (isFinalPosNumber(sale.numero)) return sale;

  await lockTenantSequence(tx, tenantId);

  // Un segundo cobro puede haber esperado mientras el primero terminaba. Volvemos
  // a leer después del lock para no consumir otro número en reintentos/doble clic.
  sale = await loadRestaurantSale(tx, tenantId, saleId);
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
  POS_LOCK_ATTEMPTS,
  POS_LOCK_RETRY_MS,
  isFinalPosNumber,
  formatPosNumber,
  lockTenantSequence,
  assignRestaurantPosNumberInTx
};
