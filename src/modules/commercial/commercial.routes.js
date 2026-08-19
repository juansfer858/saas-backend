const express = require('express');
const controller = require('./commercial.controller');

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

// Ventas: mismo motor, tipo fijo FACTURA_VENTA.
router.get('/ventas', controller.listSales);
router.post('/ventas', controller.createSale);
router.get('/ventas/:id', controller.getSale);
router.patch('/ventas/:id', controller.updateDocument);
router.put('/ventas/:id', controller.updateDocument);
router.post('/ventas/:id/emitir', controller.emitDocument);
router.post('/ventas/:id/anular', controller.cancelDocument);
router.post('/ventas/:id/reemplazar', controller.replaceDocument);

// Compras: mismo motor, tipo fijo COMPRA.
router.get('/compras', controller.listPurchases);
router.post('/compras', controller.createPurchase);
router.get('/compras/:id', controller.getPurchase);
router.patch('/compras/:id', controller.updateDocument);
router.put('/compras/:id', controller.updateDocument);
router.post('/compras/:id/emitir', controller.emitDocument);
router.post('/compras/:id/anular', controller.cancelDocument);
router.post('/compras/:id/reemplazar', controller.replaceDocument);

module.exports = { commercialRouter: router };
