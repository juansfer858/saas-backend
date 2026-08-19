const express = require('express');
const authController = require('./auth.controller');
const { extractTenantBySubdomain } = require('../../middleware/extract-tenant-by-subdomain');
const { authMiddleware } = require('../../middleware/auth-middleware');

const router = express.Router();

router.post('/register-tenant', authController.registerTenant);
router.post('/login', extractTenantBySubdomain, authController.login);
router.get('/session', extractTenantBySubdomain, authMiddleware, authController.session);

module.exports = { authRouter: router };
