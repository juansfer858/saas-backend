const express = require('express');
const controller = require('./inventory.controller');

const router = express.Router();

router.get('/productos', controller.listProducts);
router.post('/productos', controller.createProduct);
router.get('/productos/:id', controller.getProduct);
router.patch('/productos/:id', controller.updateProduct);
router.put('/productos/:id', controller.updateProduct);
router.delete('/productos/:id', controller.deactivateProduct);

router.get('/kardex', controller.listMovements);
// Compatibilidad interna/QA. Los ajustes de usuario deben usar /ajustes para
// garantizar justificación + asiento AU en la misma transacción.
router.post('/kardex', controller.createMovement);
router.post('/ajustes', controller.createAccountedAdjustment);

module.exports = { inventoryRouter: router };
