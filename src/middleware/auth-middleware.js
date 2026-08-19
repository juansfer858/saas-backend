const { prisma } = require('../config/prisma');
const { AppError } = require('../utils/app-error');
const { verifyAccessToken } = require('../utils/jwt');

async function authMiddleware(req, _res, next) {
  try {
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

    if (req.tenantId && req.tenantId !== payload.tenantId) {
      throw new AppError(403, 'El token no pertenece a esta empresa', 'AUTH_TENANT_MISMATCH');
    }

    const user = await prisma.user.findFirst({
      where: {
        id: payload.userId,
        tenantId: payload.tenantId,
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

    req.tenantId = user.tenantId;
    req.userId = user.id;
    req.userRole = user.rol;
    req.user = user;

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { authMiddleware };
