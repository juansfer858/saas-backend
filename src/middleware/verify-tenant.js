const { prisma } = require('../config/prisma');
const { AppError } = require('../utils/app-error');
const { verifyAccessToken } = require('../utils/jwt');

async function verifyTenant(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!req.tenantId) throw new AppError(500, 'Contexto de empresa ausente', 'TENANT_CONTEXT_MISSING');
    if (!token) throw new AppError(401, 'Autenticación requerida', 'AUTH_REQUIRED');

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (_error) {
      throw new AppError(401, 'Sesión no válida', 'AUTH_INVALID');
    }

    if (payload.tenantId !== req.tenantId) {
      throw new AppError(403, 'Acceso denegado para esta empresa', 'AUTH_TENANT_MISMATCH');
    }

    const user = await prisma.user.findFirst({
      where: { id: payload.userId, tenantId: req.tenantId },
      select: { id: true, tenantId: true, nombre: true, email: true, rol: true }
    });

    if (!user) throw new AppError(401, 'Sesión no válida', 'AUTH_INVALID');

    req.userId = user.id;
    req.userRole = user.rol;
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { verifyTenant };
