'use strict';

const express = require('express');
const { requireRoles } = require('../../middleware/require-role');
const pilot = require('./restaurant-v2-pilot.service');

const router = express.Router();
const adminOnly = requireRoles('ADMIN', 'SUPER_ADMIN');

router.get('/v2/piloto', adminOnly, async (req, res, next) => {
  try {
    const data = await pilot.getPilot(req.tenantId);
    res.set('X-VantixGC-Restaurant-V2-Pilot', 'p9-control-plane');
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

router.patch('/v2/piloto', adminOnly, async (req, res, next) => {
  try {
    const data = await pilot.setPilot(req.tenantId, req.user.id, req.body || {});
    res.set('X-VantixGC-Restaurant-V2-Pilot', 'p9-control-plane');
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

module.exports = { restaurantV2PilotRouter: router };
