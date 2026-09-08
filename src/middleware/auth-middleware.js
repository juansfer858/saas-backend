const { prisma } = require('../config/prisma');
const { AppError } = require('../utils/app-error');
const { verifyAccessToken } = require('../utils/jwt');

const RESTAURANT_SHARED_WAITER_ROLE = 'MESERO_OPERATIVO_COMPARTIDO';
const RESTAURANT_PRODUCTION_ROLES = new Set(['COCINA', 'BARRA', 'POSTRES']);

function isRestaurantOperationalRequest(req) {
  const url = String(req.originalUrl || req.url || '').split('?')[0];
  return /^\/api\/v1\/restaurante\/(?:zonas|mesas|menu|sesiones|pedidos|llamadas-mesero)(?:\/|$)/.test(url);
}

function runtimeUserForRequest(req, user) {
  if (user?.rol !== 'MESERO' || !isRestaurantOperationalRequest(req)) return user;
  return {
    ...user,
    rol: RESTAURANT_SHARED_WAITER_ROLE,
    securityRole: 'MESERO'
  };
}

/**
 * Middleware de autenticación del Super Core.
 *
 * Regla absoluta: el tenant debe haberse resuelto antes por el host/subdominio.
 * El JWT nunca puede cambiar el tenant activo de la petición; únicamente puede
 * demostrar que el usuario autenticado pertenece al mismo tenant.
 *
 * En el flujo de salón del Restaurante, MESERO usa un actor operacional
 * compartido. Esto evita que assignedWaiterId se convierta en una barrera de
 * acceso: todos los meseros ven todas las zonas/mesas y pueden reforzar una
 * atención iniciada por otro. La identidad y los permisos de seguridad siguen
 * siendo MESERO mediante req.userRole. El resto de módulos conserva el rol
 * original sin cambios.
 *
 * V63 agrega PRODUCTION_DEVICE: tablets persistentes ligadas a COCINA/BARRA/
 * POSTRES. El JWT no basta: en cada request se comprueba que el dispositivo siga
 * ACTIVE, que no haya sido revocado y que el rol actual coincida con la estación
 * con la que fue vinculado.
 */
async function authMiddleware(req, _res, next) {
  try {
    if (!req.tenantId) {
      throw new AppError(
        400,
        'No existe contexto de empresa para autenticar la solicitud',
        'TENANT_CONTEXT_REQUIRED'
      );
    }

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!token) {
      throw new AppError(401, 'Autenticación requerida', 'AUTH_REQUIRED');
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (_error) {
      throw new AppError(401, 'Sesión no válida', 'AUTH_INVALID');
    }

    if (!payload || !payload.userId || !payload.tenantId) {
      throw new AppError(401, 'Sesión no válida', 'AUTH_INVALID');
    }

    if (req.tenantId !== payload.tenantId) {
      throw new AppError(403, 'El token no pertenece a esta empresa', 'AUTH_TENANT_MISMATCH');
    }

    const user = await prisma.user.findFirst({
      where: {
        id: payload.userId,
        tenantId: req.tenantId,
        activo: true
      },
      select: {
        id: true,
        tenantId: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true
      }
    });

    if (!user) {
      throw new AppError(401, 'Sesión no válida', 'AUTH_INVALID');
    }

    if (payload.authType === 'WAITER_DEVICE') {
      if (!payload.deviceId || user.rol !== 'MESERO') {
        throw new AppError(401, 'La autorización de este dispositivo Mesero ya no es válida', 'RESTAURANT_WAITER_DEVICE_INVALID');
      }
      const { assertActiveDevice } = require('../modules/restaurant/restaurant-waiter-device.service');
      await assertActiveDevice(payload.deviceId, req.tenantId, user.id);
    }

    if (payload.authType === 'PRODUCTION_DEVICE') {
      if (!payload.deviceId || !RESTAURANT_PRODUCTION_ROLES.has(user.rol)) {
        throw new AppError(401, 'La autorización de esta tablet de producción ya no es válida', 'RESTAURANT_PRODUCTION_DEVICE_INVALID');
      }
      const { assertActiveDevice } = require('../modules/restaurant/restaurant-production-device-v63.service');
      await assertActiveDevice(payload.deviceId, req.tenantId, user.id, user.rol);
    }

    req.userId = user.id;
    req.userRole = user.rol;
    req.user = runtimeUserForRequest(req, user);
    req.authType = payload.authType || 'USER';
    req.deviceId = payload.deviceId || null;
    req.restaurantWaiterSharedFloor = req.user.rol === RESTAURANT_SHARED_WAITER_ROLE;
    req.restaurantProductionDevice = payload.authType === 'PRODUCTION_DEVICE';

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  RESTAURANT_SHARED_WAITER_ROLE,
  RESTAURANT_PRODUCTION_ROLES,
  isRestaurantOperationalRequest,
  runtimeUserForRequest,
  authMiddleware
};
