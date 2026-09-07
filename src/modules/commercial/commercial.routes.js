const fs = require('node:fs');
const express = require('express');
const path = require('node:path');
const controller = require('./commercial.controller');
const purchaseController = require('./purchase.controller');
const salesController = require('./sales.controller');
const productionStations = require('../platform/printing/printing-stations.service');

const router = express.Router();
const webRoot = path.join(__dirname, '../../web');

router.get('/ui-runtime/panel-integration-extras-core.js', async (_req, res, next) => {
  try {
    let source = await fs.promises.readFile(path.join(webRoot, 'panel-integration-extras-core.js'), 'utf8');
    source = source.replace(
      "api('/api/v1/tesoreria/pagos')",
      "api('/api/v1/tesoreria/recaudos-recientes')"
    );
    if (!source.includes("api('/api/v1/tesoreria/recaudos-recientes')")) {
      throw new Error('No fue posible aplicar el origen canónico de recaudos en Tesorería');
    }
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Treasury-Recent-Receipts', 'v43-movimiento-tesoreria');
    res.type('application/javascript').send(`/* VANTIX_TREASURY_RECENT_RECEIPTS_V43 */\n${source}`);
  } catch (error) { next(error); }
});

router.get('/ui-runtime/panel-printing-config.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(path.join(webRoot, 'panel-printing-config.js'));
});

// La identidad/configuración general del restaurante vive en Administración →
// Configuración avanzada. No se publica como runtime del KDS ni del Centro de control.

// Configuración propia del nicho KDS: crear, editar y retirar estaciones desde Ver KDS.
router.get('/ui-runtime/restaurant-kds-stations-admin.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-kds-stations-admin.js'));
});

router.get('/ui-runtime/restaurant-production-stations', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data: await productionStations.listStations(req.tenantId, { includeInactive: false }) });
  } catch (error) { next(error); }
});

router.get('/comprobantes', controller.listDocuments);
router.post('/comprobantes', controller.createDocument);
router.get('/comprobantes/:id', controller.getDocument);
router.patch('/comprobantes/:id', controller.updateDocument);
router.put('/comprobantes/:id', controller.updateDocument);
router.post('/comprobantes/:id/emitir', controller.emitDocument);
router.post('/comprobantes/:id/anular', controller.cancelDocument);
router.post('/comprobantes/:id/reemplazar', controller.replaceDocument);

router.get('/ventas', salesController.list);
router.get('/ventas/dashboard', salesController.dashboard);
router.get('/ventas/dashboard/exportar', salesController.exportDashboard);
router.post('/ventas', salesController.create);
router.get('/ventas/:id', salesController.get);
router.patch('/ventas/:id', salesController.update);
router.put('/ventas/:id', salesController.update);
router.post('/ventas/:id/emitir', salesController.emit);
router.post('/ventas/:id/anular', salesController.cancel);
router.post('/ventas/:id/reemplazar', controller.replaceDocument);

router.get('/compras', purchaseController.list);
router.post('/compras', purchaseController.createDraft);
router.get('/compras/:id', purchaseController.get);
router.patch('/compras/:id', purchaseController.updateDraft);
router.put('/compras/:id', purchaseController.updateDraft);
router.post('/compras/:id/emitir', purchaseController.emit);
router.post('/compras/:id/anular', purchaseController.cancel);

module.exports = { commercialRouter: router };
