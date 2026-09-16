const express = require('express');
const controller = require('./bike.controller');
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

module.exports = { bikeRouter: router };
