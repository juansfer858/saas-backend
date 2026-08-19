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
router.post('/kardex', controller.createMovement);

module.exports = { inventoryRouter: router };
