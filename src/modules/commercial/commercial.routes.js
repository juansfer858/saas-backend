const express = require('express');
const controller = require('./commercial.controller');
const purchaseController = require('./purchase.controller');
const fiscalSalesController = require('./sales-fiscal.controller');

const router = express.Router();

// API genérica de documentos comerciales.
router.get('/comprobantes', controller.listDocuments);
router.post('/comprobantes', controller.createDocument);
router.get('/comprobantes/:id', controller.getDocument);
router.patch('/comprobantes/:id', controller.updateDocument);
router.put('/comprobantes/:id', controller.updateDocument);
router.post('/comprobantes/:id/emitir', controller.emitDocument);
router.post('/comprobantes/:id/anular', controller.cancelDocument);
router.post('/comprobantes/:id/reemplazar', controller.replaceDocument);

// Ventas: creación/emisión fiscal-aware. Si DIAN está habilitado, la venta emitida y el outbox fiscal nacen juntos.
router.get('/ventas', controller.listSales);
router.post('/ventas', fiscalSalesController.create);
router.get('/ventas/:id', controller.getSale);
router.patch('/ventas/:id', controller.updateDocument);
router.put('/ventas/:id', controller.updateDocument);
router.post('/ventas/:id/emitir', fiscalSalesController.emit);
router.post('/ventas/:id/anular', controller.cancelDocument);
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
