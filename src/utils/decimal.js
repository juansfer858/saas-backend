const { Prisma } = require('@prisma/client');

function decimal(value = 0) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value ?? 0);
}

function money(value = 0) {
  return decimal(value).toDecimalPlaces(2);
}

function qty(value = 0) {
  return decimal(value).toDecimalPlaces(4);
}

function pct(value = 0) {
  return decimal(value).toDecimalPlaces(4);
}

function assertNonNegative(value, field) {
  if (decimal(value).lt(0)) {
    const error = new Error(`${field} no puede ser negativo`);
    error.code = 'NEGATIVE_VALUE';
    throw error;
  }
}

module.exports = {
  decimal,
  money,
  qty,
  pct,
  assertNonNegative
};
