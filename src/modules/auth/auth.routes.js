const express = require('express');
const authController = require('./auth.controller');
const { extractTenantBySubdomain } = require('../../middleware/extract-tenant-by-subdomain');
const { authMiddleware } = require('../../middleware/auth-middleware');

const router = express.Router();

router.post('/register-tenant', (req, res, next) => {
  if (String(process.env.PUBLIC_TENANT_REGISTRATION_ENABLED || '').toLowerCase() !== 'true') {
    res.status(403).json({
      ok: false,
      error: {
        code: 'PUBLIC_TENANT_REGISTRATION_DISABLED',
        message: 'El alta de empresas está administrada desde el Panel SaaS de VantixGC'
      }
    });
    return;
  }
  authController.registerTenant(req, res, next);
});
router.post('/login', extractTenantBySubdomain, authController.login);
router.get('/session', extractTenantBySubdomain, authMiddleware, authController.session);

module.exports = { authRouter: router };
