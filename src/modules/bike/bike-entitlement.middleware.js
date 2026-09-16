const { AppError } = require('../../utils/app-error');
const verticalEntitlements = require('../platform/verticals/vertical-entitlement.service');

async function requireBikeEntitlement(req, _res, next) {
  try {
    const allowed = await verticalEntitlements.hasVertical(req.tenantId, 'BIKE');
    if (!allowed) {
      return next(new AppError(
        403,
        'El vertical Bike no está activo para esta empresa',
        'BIKE_VERTICAL_NOT_ENTITLED'
      ));
    }
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireBikeEntitlement };
