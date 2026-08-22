const fs = require('node:fs');
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

const sandboxWarmThemeBootstrap = `<style id="vantixgc-sandbox-warm-theme-v1">
:root{--bg:#fffaf5;--panel:#fffdfb;--panel2:#fff7ed;--text:#111827;--muted:#4b5563;--line:#d6d3d1;--shadow:0 1px 2px rgba(67,20,7,.06),0 10px 30px rgba(67,20,7,.07)}
.dark{--bg:#171311;--panel:#211b18;--panel2:#2b211c;--text:#fff7ed;--muted:#d6d3d1;--line:#57483f;--shadow:0 1px 2px rgba(0,0,0,.35),0 18px 42px rgba(0,0,0,.24)}
.pagehead h1,.card-head h3,.table-card h3,.product b,.metric-value,.total{color:var(--text)!important;font-weight:800!important}
.pagehead p,.activity-main span,.activity-side,.metric-label,.field label,.breadcrumb,.sandbox-note{color:var(--muted)!important;font-weight:550}
.card,.table-card,.product,.input,.select,.textarea,.btn,.icon-btn,.tenant-select,.user-pill{border-color:var(--line)!important}
.product,.table-card{background:var(--panel)!important;box-shadow:0 1px 2px rgba(67,20,7,.04)}
.product:hover,.table-card:hover{border-color:var(--accent)!important;box-shadow:0 8px 22px rgba(234,88,12,.10)}
.table th{color:#374151!important;font-weight:800!important}.dark .table th{color:#e7e5e4!important}
.table td{font-weight:550}.cart-line{padding:12px 0!important}.cart-line button{min-height:38px!important;min-width:38px!important;padding:0 12px!important;border-radius:9px!important;font-weight:800!important;touch-action:manipulation}
.qty{gap:7px!important}.qty button{width:38px!important;height:38px!important;background:#ffedd5!important;color:#9a3412!important;border:1px solid #fdba74!important;font-size:18px!important;line-height:1!important}
.dark .qty button{background:#431407!important;color:#fed7aa!important;border-color:#9a3412!important}
.cart-line .btn.danger,.cart-line button:last-child{background:#fff1f2!important;color:#b91c1c!important;border-color:#fecdd3!important}.dark .cart-line .btn.danger,.dark .cart-line button:last-child{background:#450a0a!important;color:#fecaca!important;border-color:#7f1d1d!important}
.btn.primary{box-shadow:0 6px 16px rgba(234,88,12,.16)}
</style><script id="vantixgc-sandbox-warm-theme-migration">(()=>{try{const key='vantixgc_ui_sandbox_theme';let theme=null;try{theme=JSON.parse(localStorage.getItem(key)||'null')}catch{}if(!theme||!theme.accent||String(theme.accent).toLowerCase()==='#2563eb'){localStorage.setItem(key,JSON.stringify({mode:theme?.mode||'light',accent:'#EA580C',soft:'#FFF7ED',font:theme?.font||'Inter,ui-sans-serif,system-ui,sans-serif'}))}}catch{}})();</script>`;

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

// The main tenant panel already loads this extension on every shell page. Restaurant
// augments that same asset with a permission-backed entrypoint, avoiding a parallel menu system.
router.get('/app/panel-integration-extras.js', async (_req, res, next) => {
  try {
    const [coreExtras, restaurantEntry] = await Promise.all([
      fs.promises.readFile(path.join(webRoot, 'panel-integration-extras.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'panel-restaurant-entry.js'), 'utf8')
    ]);
    res.type('application/javascript').send(`${coreExtras}\n;${restaurantEntry}`);
  } catch (error) { next(error); }
});

// Static assets belong to the Restaurant vertical. They are public code/style files and contain no tenant data or secrets.
router.get('/app/restaurant-theme.css', (_req, res) => res.type('text/css').sendFile(path.join(webRoot, 'restaurant-theme.css')));
router.get('/app/restaurant-theme.js', (_req, res) => res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-theme.js')));
router.get('/app/restaurant-ui.js', (_req, res) => res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-ui.js')));
router.get('/app/restaurant-qr-ui.js', (_req, res) => res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-qr-ui.js')));

// Isolated UI/UX sandbox. Self-contained: no CDN, no tenant API, no production writes.
router.get(['/app/v2-preview', '/app/sandbox'], async (_req, res, next) => {
  try {
    const html = await fs.promises.readFile(path.join(webRoot, 'ui-sandbox.html'), 'utf8');
    const rendered = html.includes('</head>') ? html.replace('</head>', `${sandboxWarmThemeBootstrap}</head>`) : `${sandboxWarmThemeBootstrap}${html}`;
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-UI-Sandbox', 'mock-local-v3-warm');
    res.set('X-VantixGC-UI-Sandbox-Runtime', 'self-contained');
    res.set('X-VantixGC-UI-Theme', 'restaurant-warm-v1');
    res.type('html').send(rendered);
  } catch (error) { next(error); }
});

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
