const express = require('express');
const authController = require('./auth.controller');
const { extractTenantBySubdomain } = require('../../middleware/extract-tenant-by-subdomain');
const { verifyTenant } = require('../../middleware/verify-tenant');

const router = express.Router();

router.post('/register-tenant', authController.registerTenant);
router.post('/login', extractTenantBySubdomain, authController.login);
router.get('/session', extractTenantBySubdomain, verifyTenant, authController.session);

module.exports = { authRouter: router };
