'use strict';

const audit = require('../modules/restaurant/restaurant-business-audit-c85.service');

function restaurantBusinessAuditC85(req, res, next) {
  const classification = audit.classifyMutation(req.method, req.path);
  if (!classification) return next();

  let responseBody = null;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return;
    setImmediate(() => {
      audit.recordMutation({
        req,
        responseBody,
        statusCode: res.statusCode,
        classification
      }).catch((error) => {
        console.error('[RESTAURANT_BUSINESS_AUDIT_C85] no se pudo guardar auditoría', {
          tenantId: req.tenantId || null,
          userId: req.userId || null,
          method: req.method,
          path: req.path,
          message: error?.message || String(error)
        });
      });
    });
  });

  return next();
}

module.exports = { restaurantBusinessAuditC85 };
