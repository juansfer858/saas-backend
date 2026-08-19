const express = require('express');
const controller = require('./commercial.controller');

const router = express.Router();

router.get('/comprobantes', controller.listDocuments);
router.post('/comprobantes', controller.createDocument);
router.get('/comprobantes/:id', controller.getDocument);

module.exports = { commercialRouter: router };
