'use strict';

const express = require('express');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-shift-close-history-c86.runtime');

const router = express.Router();

function options(req) {
  return {
    tzOffsetMinutes: req.query?.tzOffsetMinutes,
    from: req.query?.from,
    to: req.query?.to,
    limit: req.query?.limit
  };
}

function safeFileName(value) {
  return String(value || 'cierre').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'cierre';
}

function sendExport(res, output) {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', output.mime);
  res.set('Content-Disposition', `attachment; filename="${safeFileName(output.title)}.${output.extension}"`);
  return res.send(output.buffer);
}

router.get('/cierres', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data: await service.listClosures(req.tenantId, options(req)) });
  } catch (error) { next(error); }
});

router.get('/cierres/dia/:date', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data: await service.getDay(req.tenantId, req.user.id, req.params.date, options(req)) });
  } catch (error) { next(error); }
});

router.get('/cierres/dia/:date/exportar', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const output = await service.exportDay(req.tenantId, req.user.id, req.params.date, req.query.formato, options(req));
    sendExport(res, output);
  } catch (error) { next(error); }
});

router.get('/cierres/:shiftId', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data: await service.getClosure(req.tenantId, req.user.id, req.params.shiftId, options(req)) });
  } catch (error) { next(error); }
});

router.post('/cierres/:shiftId/imprimir', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const data = await service.queuePrint(req.tenantId, req.user.id, req.params.shiftId, {
      ...options(req),
      origin: String(req.body?.origin || 'HISTORY').slice(0, 40)
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
});

router.get('/cierres/:shiftId/exportar', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const output = await service.exportClosure(req.tenantId, req.user.id, req.params.shiftId, req.query.formato, options(req));
    sendExport(res, output);
  } catch (error) { next(error); }
});

module.exports = { restaurantShiftCloseHistoryC86Router: router };
