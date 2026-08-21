const path = require('node:path');
const express = require('express');
const { z } = require('zod');
const { prisma } = require('../../config/prisma');
const service = require('./restaurant.service');
const identity = require('./restaurant-identity.service');
const notifications = require('../notifications/notifications.service');
const demoBootstrapState = require('./restaurant-demo-bootstrap-state');
const { AppError } = require('../../utils/app-error');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Autopedido inválido', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const orderSchema = z.object({
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.coerce.number().positive().max(999),
    notes: z.string().trim().max(300).optional().nullable()
  })).min(1).max(100),
  confirmedTotal: z.coerce.number().min(0),
  customerPhoneE164: z.string().trim().max(30).optional().nullable(),
  consentWhatsApp: z.boolean().optional().default(false),
  notes: z.string().trim().max(500).optional().nullable(),
  externalRequestId: z.string().trim().min(3).max(120).optional().nullable()
}).refine((x) => !x.consentWhatsApp || Boolean(x.customerPhoneE164), { message: 'El consentimiento WhatsApp requiere número celular', path: ['customerPhoneE164'] });

// Static assets belong to the Restaurant vertical. They are public code/style files and contain no tenant data or secrets.
router.get('/app/restaurant-theme.css', (_req, res) => res.type('text/css').sendFile(path.join(webRoot, 'restaurant-theme.css')));
router.get('/app/restaurant-theme.js', (_req, res) => res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-theme.js')));
router.get('/app/restaurant-ui.js', (_req, res) => res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-ui.js')));
router.get('/app/restaurant-qr-ui.js', (_req, res) => res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-qr-ui.js')));

router.get('/api/public/restaurante/build-marker', (_req, res) => {
  res.json({
    ok: true,
    data: {
      restaurantIdentity: 'LA_RIEL_CONNECTED_V1',
      demoAccessSeed: 'ROTATED_V2_2026_08_21',
      productionPromise: false
    }
  });
});

router.get('/api/public/restaurante/demo-readiness', async (_req, res, next) => {
  try {
    const bootstrap = demoBootstrapState.snapshot();
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: 'demo-restaurante' },
      select: { id: true, activo: true }
    });
    if (!tenant) {
      res.json({ ok: true, data: { ready: false, tenantFound: false, active: false, users: 0, tables: 0, menuItems: 0, recipes: 0, bootstrap } });
      return;
    }
    const [users, tables, menuItems, recipes] = await Promise.all([
      prisma.user.count({ where: { tenantId: tenant.id, activo: true, email: { in: [
        'admin@demo-restaurante.vantixgc.com',
        'mesero@demo-restaurante.vantixgc.com',
        'cocina@demo-restaurante.vantixgc.com',
        'barra@demo-restaurante.vantixgc.com',
        'postres@demo-restaurante.vantixgc.com',
        'cajero@demo-restaurante.vantixgc.com'
      ] } } }),
      prisma.restaurantTable.count({ where: { tenantId: tenant.id, active: true } }),
      prisma.restaurantMenuItem.count({ where: { tenantId: tenant.id, active: true } }),
      prisma.consumptionRecipe.count({ where: { tenantId: tenant.id, active: true } })
    ]);
    res.json({
      ok: true,
      data: {
        ready: Boolean(tenant.activo && users >= 6 && tables >= 6 && menuItems >= 4 && recipes >= 4),
        tenantFound: true,
        active: tenant.activo,
        users,
        tables,
        menuItems,
        recipes,
        bootstrap
      }
    });
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/qr/:token', async (req, res, next) => {
  try { res.json({ ok: true, data: await identity.publicQrContext(req.params.token) }); }
  catch (error) { next(error); }
});

router.post('/api/public/restaurante/qr/:token/pedidos', async (req, res, next) => {
  try {
    const input = parse(orderSchema, req.body);
    const order = await service.placeQrOrder(req.params.token, input);
    if (input.consentWhatsApp && input.customerPhoneE164) {
      await notifications.grantConsent(order.tenantId, null, {
        phoneE164: input.customerPhoneE164,
        scope: 'TRANSACTIONAL',
        source: 'RESTAURANT_QR',
        evidence: { orderId: order.id, explicitCheckbox: true, capturedAt: new Date().toISOString() }
      });
    }
    res.status(201).json({ ok: true, data: order });
  } catch (error) { next(error); }
});

module.exports = { restaurantPublicRouter: router };
