'use strict';

// Shared locks preserve parallel operation; the shift close uses an exclusive
// transaction lock for this tenant. PostgreSQL releases both on commit/rollback.
async function lockOperation(tx, tenantId, exclusive = false) {
  const key = `restaurant-shift-close-v111:${tenantId}`;
  if (exclusive) await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  else await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
}
module.exports = {lockOperation};
