'use strict';

const express = require('express');
const { prisma } = require('../../config/prisma');
const { signAccessToken } = require('../../utils/jwt');
const { AppError } = require('../../utils/app-error');

const router = express.Router();
const DEMO_SUBDOMAIN = 'demo-restaurante';
const DEMO_ADMIN_EMAIL = 'admin@demo-restaurante.vantixgc.com';
const DEMO_AUTH_TYPE = 'PUBLIC_RESTAURANT_DEMO';

router.get('/demo-session', async (_req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: DEMO_SUBDOMAIN },
      select: {
        id: true,
        nombreEmpresa: true,
        subdomain: true,
        nicho: true,
        pais: true,
        moneda: true,
        activo: true
      }
    });
    if (!tenant?.activo) {
      throw new AppError(503, 'El demo real se está preparando. Intenta de nuevo en unos segundos.', 'RESTAURANT_PUBLIC_DEMO_NOT_READY');
    }

    const user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: DEMO_ADMIN_EMAIL } },
      select: { id: true, tenantId: true, nombre: true, email: true, rol: true, activo: true }
    });
    if (!user?.activo) {
      throw new AppError(503, 'El usuario demo no está disponible.', 'RESTAURANT_PUBLIC_DEMO_USER_NOT_READY');
    }

    const token = signAccessToken({
      userId: user.id,
      tenantId: tenant.id,
      rol: user.rol,
      authType: DEMO_AUTH_TYPE,
      expiresIn: '45m'
    });

    res.set('Cache-Control', 'no-store, max-age=0');
    res.json({
      ok: true,
      data: {
        token,
        subdomain: tenant.subdomain,
        demo: true,
        demoMode: 'PUBLIC_REAL_V2',
        tenant: {
          id: tenant.id,
          nombreEmpresa: tenant.nombreEmpresa,
          subdomain: tenant.subdomain,
          nicho: tenant.nicho,
          pais: tenant.pais,
          moneda: tenant.moneda
        },
        user: {
          id: user.id,
          tenantId: user.tenantId,
          nombre: 'Visitante Demo',
          email: user.email,
          rol: user.rol
        }
      }
    });
  } catch (error) { next(error); }
});

module.exports = {
  DEMO_SUBDOMAIN,
  DEMO_ADMIN_EMAIL,
  DEMO_AUTH_TYPE,
  restaurantPublicDemoAccessRouter: router
};
