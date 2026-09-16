const express = require('express');
const controller = require('./bike.controller');
const workshop = require('./bike-workshop.controller');
const { requirePermission } = require('../../middleware/require-permission');
const { requireBikeEntitlement } = require('./bike-entitlement.middleware');

const router = express.Router();

router.use(requireBikeEntitlement);

router.get('/status', requirePermission('BIKE.VER'), controller.foundationStatus);

router.get('/bicicletas', requirePermission('BIKE.VER'), controller.listBikes);
router.post('/bicicletas', requirePermission('BIKE.CREAR'), controller.createBike);
router.get('/bicicletas/:id', requirePermission('BIKE.VER'), controller.getBike);
router.patch('/bicicletas/:id', requirePermission('BIKE.EDITAR'), controller.updateBike);
router.put('/bicicletas/:id', requirePermission('BIKE.EDITAR'), controller.updateBike);

router.get('/servicios', requirePermission('BIKE_TALLER.VER'), controller.listServiceCatalog);
router.post('/servicios', requirePermission('BIKE_TALLER.ADMINISTRAR'), controller.createServiceCatalogItem);
router.patch('/servicios/:id', requirePermission('BIKE_TALLER.ADMINISTRAR'), controller.updateServiceCatalogItem);
router.put('/servicios/:id', requirePermission('BIKE_TALLER.ADMINISTRAR'), controller.updateServiceCatalogItem);

router.get('/ordenes', requirePermission('BIKE_TALLER.VER'), workshop.listWorkOrders);
router.post('/ordenes', requirePermission('BIKE_TALLER.CREAR'), workshop.createWorkOrder);
router.get('/ordenes/:id', requirePermission('BIKE_TALLER.VER'), workshop.getWorkOrder);
router.post('/ordenes/:id/hallazgos', requirePermission('BIKE_TALLER.EDITAR'), workshop.addFinding);
router.post('/ordenes/:id/items', requirePermission('BIKE_TALLER.EDITAR'), workshop.addItem);
router.post('/ordenes/:id/items/:itemId/autorizar', requirePermission('BIKE_TALLER.EDITAR'), workshop.authorizeItem);
router.post('/ordenes/:id/items/:itemId/rechazar', requirePermission('BIKE_TALLER.EDITAR'), workshop.rejectItem);
router.post('/ordenes/:id/items/:itemId/iniciar', requirePermission('BIKE_TALLER.EDITAR'), workshop.startItem);
router.post('/ordenes/:id/items/:itemId/completar', requirePermission('BIKE_TALLER.EDITAR'), workshop.completeItem);
router.post('/ordenes/:id/items/:itemId/instalar', requirePermission('BIKE_TALLER.EDITAR'), workshop.installPart);
router.post('/ordenes/:id/prueba-final', requirePermission('BIKE_TALLER.EDITAR'), workshop.finalTest);
router.post('/ordenes/:id/factura-borrador', requirePermission('VENTAS.CREAR'), workshop.createBillingDraft);
router.post('/ordenes/:id/emitir-factura', requirePermission('VENTAS.EMITIR'), workshop.emitBilling);
router.post('/ordenes/:id/entregar', requirePermission('BIKE_TALLER.CERRAR'), workshop.deliverWorkOrder);
router.post('/ordenes/:id/cancelar', requirePermission('BIKE_TALLER.ANULAR'), workshop.cancelWorkOrder);

module.exports = { bikeRouter: router };
