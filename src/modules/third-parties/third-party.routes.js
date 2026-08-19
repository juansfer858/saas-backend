const express = require('express');
const controller = require('./third-party.controller');

const router = express.Router();

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getById);
router.patch('/:id', controller.update);
router.put('/:id', controller.update);
router.delete('/:id', controller.deactivate);

module.exports = { thirdPartyRouter: router };
