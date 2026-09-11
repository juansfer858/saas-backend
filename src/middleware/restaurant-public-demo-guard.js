'use strict';

const { AppError } = require('../utils/app-error');
const { DEMO_AUTH_TYPE, DEMO_ADMIN_EMAIL } = require('../modules/restaurant/restaurant-public-demo-access.public.routes');

const SAFE_MUTATION_PATTERNS = Object.freeze([
  /^\/api\/v1\/restaurante\/v2\/(?:mesas|sesiones|caja|division|kds)(?:\/|$)/,
  /^\/api\/v1\/restaurante\/(?:zonas|mesas|menu|sesiones|pedidos|llamadas-mesero)(?:\/|$)/
]);

function isSafeDemoMutation(req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  const url = String(req.originalUrl || req.url || '').split('?')[0];
  if (url === '/api/v1/restaurante/v2/caja/recibo/imprimir') return false;
  return SAFE_MUTATION_PATTERNS.some((pattern) => pattern.test(url));
}

function restaurantPublicDemoGuard(req, _res, next) {
  try {
    if (req.authType !== DEMO_AUTH_TYPE) return next();
    if (req.user?.email !== DEMO_ADMIN_EMAIL) {
      throw new AppError(403, 'Sesión demo inválida', 'RESTAURANT_PUBLIC_DEMO_INVALID');
    }
    if (!isSafeDemoMutation(req)) {
      throw new AppError(
        403,
        'Esta acción está bloqueada en el demo público. Puedes recorrer la interfaz y probar la operación de mesas, pedidos, KDS y caja sin cambiar la configuración del sistema.',
        'RESTAURANT_PUBLIC_DEMO_WRITE_BLOCKED'
      );
    }
    next();
  } catch (error) { next(error); }
}

module.exports = { SAFE_MUTATION_PATTERNS, isSafeDemoMutation, restaurantPublicDemoGuard };
