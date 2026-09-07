'use strict';

const express = require('express');
const { AppError } = require('../../utils/app-error');
const workspace = require('./edge-workspace.service');
const verticalEntitlements = require('../platform/verticals/vertical-entitlement.service');

const router = express.Router();

router.post('/agents/:id/local-access-grant', async (req, res, next) => {
  try {
    if (!(await verticalEntitlements.hasVertical(req.tenantId, 'RESTAURANT'))) {
      throw new AppError(403, 'Este tenant no tiene activo VantixGC Restaurantes', 'RESTAURANT_VERTICAL_REQUIRED');
    }
    const returnOrigin = typeof req.body?.returnOrigin === 'string' ? req.body.returnOrigin.trim() : null;
    const data = await workspace.createLocalAccessGrant(req.tenantId, req.user, req.params.id, { returnOrigin });
    res.status(201).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

module.exports = { edgeHybridLocalOriginV53Router: router };
