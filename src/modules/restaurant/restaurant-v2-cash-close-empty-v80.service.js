'use strict';

const { AppError } = require('../../utils/app-error');
const liveDetail = require('./restaurant-table-live-detail-v67.service');

const MARKER = 'VANTIX_RESTAURANT_V2_CASH_CLOSE_EMPTY_V80_1';
const CASHIER_ROLES = new Set(['CAJERO', 'ADMIN', 'SUPER_ADMIN']);

function assertCashierRole(user) {
  const role = String(user?.rol || '').trim().toUpperCase();
  if (!CASHIER_ROLES.has(role)) {
    throw new AppError(403, 'Este usuario no puede cerrar una mesa vacía desde Caja.', 'RESTAURANT_CASH_EMPTY_CLOSE_FORBIDDEN');
  }
}

async function closeEmptyFromCash(tenantId, user, tableId) {
  assertCashierRole(user);

  // Reutiliza el motor transaccional V21. La autorización externa de Caja ya fue
  // validada con RESTAURANTE.CERRAR; sólo adaptamos el rol para no otorgar al cajero
  // MESAS.EDITAR ni acceso a las demás operaciones del Centro de control.
  const result = await liveDetail.closeEmptyFromControlCenter(
    tenantId,
    { ...user, rol: 'ADMIN' },
    tableId
  );

  return {
    ...result,
    marker: MARKER,
    closedFrom: 'CAJA_V2',
    actorUserId: user.id,
    actorRole: user.rol
  };
}

module.exports = { MARKER, CASHIER_ROLES, closeEmptyFromCash };
