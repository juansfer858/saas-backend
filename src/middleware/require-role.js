const { AppError } = require('../utils/app-error');

function requireRoles(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.userRole || !allowedRoles.includes(req.userRole)) {
      return next(new AppError(403, 'Permisos insuficientes', 'AUTH_ROLE_FORBIDDEN'));
    }
    next();
  };
}

module.exports = { requireRoles };
