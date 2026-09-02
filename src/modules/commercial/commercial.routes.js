const express = require('express');
const path = require('node:path');
const controller = require('./commercial.controller');
const purchaseController = require('./purchase.controller');
const salesController = require('./sales.controller');
const productionStations = require('../platform/printing/printing-stations.service');

const router = express.Router();
const webRoot = path.join(__dirname, '../../web');

// Runtime de integración para módulos operativos del panel genérico.
// El Dashboard no depende de este runtime: su render, eventos y exportación viven
// en panel-restaurant-entry.js como única fuente de verdad.
router.get('/ui-runtime/panel-integration-extras-core.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(path.join(webRoot, 'panel-integration-extras-core.js'));
});

// Capa operativa de impresoras para la Configuración normal del administrador.
// Reutiliza el Printing Core existente y permanece desacoplada de DIAN.
router.get('/ui-runtime/panel-printing-config.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(path.join(webRoot, 'panel-printing-config.js'));
});

// Configuración nativa del restaurante dentro del Centro de control.
// Aquí quedan impresoras y opciones generales; la creación de KDS vive dentro de Ver KDS.
router.get('/ui-runtime/restaurant-admin-config-ui.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-admin-config-ui.js'));
});

// Gestión de estaciones propia de la superficie KDS.
router.get('/ui-runtime/restaurant-kds-stations-admin.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-kds-stations-admin.js'));
});

// Runtime de lectura para la interfaz Restaurante. Está bajo ui-runtime para que
// un rol operativo pueda saber qué KDS/áreas creó el administrador sin adquirir
// permisos de edición de Configuración.
router.get('/ui-runtime/restaurant-production-stations', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data: await productionStations.listStations(req.tenantId, { includeInactive: false }) });
  } catch (error) { next(error); }
});

// API genérica de documentos comerciales.
router.get('/comprobantes', controller.listDocuments);
router.post('/comprobantes', controller.createDocument);
router.get('/comprobantes/:id', controller.getDocument);
router.patch('/comprobantes/:id', controller.updateDocument);
router.put('/comprobantes/:id', controller.updateDocument);
router.post('/comprobantes/:id/emitir', controller.emitDocument);
router.post('/comprobantes/:id/anular', controller.cancelDocument);
router.post('/comprobantes/:id/reemplazar', controller.replaceDocument);

// Ventas operativas: borrador -> emisión atómica AU + Kardex/recetas + Cartera/Tesorería + outbox DIAN.
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

// Compras: controlador operativo especializado sobre el mismo motor comercial.
router.get('/compras', purchaseController.list);
router.post('/compras', purchaseController.createDraft);
router.get('/compras/:id', purchaseController.get);
router.patch('/compras/:id', purchaseController.updateDraft);
router.put('/compras/:id', purchaseController.updateDraft);
router.post('/compras/:id/emitir', purchaseController.emit);
router.post('/compras/:id/anular', purchaseController.cancel);

module.exports = { commercialRouter: router };
