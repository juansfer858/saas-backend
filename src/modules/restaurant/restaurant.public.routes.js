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

const sandboxPosImpactBootstrap = `<style id="vantixgc-sandbox-pos-impact-v1">
:root{--bg:#f8fafc;--panel:#ffffff;--panel2:#f8fafc;--text:#111827;--muted:#475569;--line:#cbd5e1;--shadow:0 2px 4px rgba(15,23,42,.07),0 12px 30px rgba(15,23,42,.10)}
.dark{--bg:#0b1120;--panel:#111827;--panel2:#172033;--text:#f8fafc;--muted:#cbd5e1;--line:#475569;--shadow:0 2px 5px rgba(0,0,0,.34),0 20px 46px rgba(0,0,0,.34)}
body{background:var(--bg)!important}
.sidebar{background:#0f172a!important;border-right:2px solid #1e293b!important;color:#fff!important;box-shadow:10px 0 28px rgba(15,23,42,.10)}
.sidebar .brandtext b{color:#fff!important;font-weight:900!important}.sidebar .brandtext span,.sidebar .section-title{color:#cbd5e1!important;font-weight:700!important}
.sidebar .brandmark{background:#f97316!important;box-shadow:0 8px 22px rgba(249,115,22,.32)!important}
.sidebar .nav button{position:relative;color:#e2e8f0!important;border-radius:11px!important;font-weight:800!important;transition:background .15s ease,color .15s ease,transform .15s ease}
.sidebar .nav button:hover{background:#172033!important;color:#fff!important;transform:translateX(1px)}
.sidebar .nav button.active{background:rgba(249,115,22,.16)!important;color:#fb923c!important}
.sidebar .nav button.active:before{content:'';position:absolute;left:-12px;top:7px;bottom:7px;width:5px;border-radius:0 6px 6px 0;background:#f97316;box-shadow:0 0 16px rgba(249,115,22,.82)}
.sidebar .sidebar-foot{border-color:#334155!important}.sidebar .sidebar-foot button{color:#cbd5e1!important;font-weight:800!important}.sidebar .sidebar-foot button:hover{background:#172033!important;color:#fff!important}
.topbar{background:rgba(255,255,255,.96)!important;border-bottom:2px solid #e2e8f0!important;box-shadow:0 2px 8px rgba(15,23,42,.05)}.dark .topbar{background:rgba(17,24,39,.96)!important;border-bottom-color:#475569!important}
.card{background:var(--panel)!important;border:2px solid var(--line)!important;border-radius:18px!important;box-shadow:var(--shadow)!important;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}.card:hover{border-color:#fdba74!important;box-shadow:0 16px 38px rgba(15,23,42,.14)!important}.dark .card:hover{box-shadow:0 18px 42px rgba(0,0,0,.34)!important}
.metric{padding:20px!important}.metric-icon{width:48px!important;height:48px!important;border-radius:50%!important;font-size:20px!important;font-weight:900!important;box-shadow:inset 0 0 0 1px rgba(15,23,42,.05)}.grid4>.metric:nth-child(1) .metric-icon{background:#ffedd5!important;color:#ea580c!important}.grid4>.metric:nth-child(2) .metric-icon{background:#dcfce7!important;color:#16a34a!important}.grid4>.metric:nth-child(3) .metric-icon{background:#d1fae5!important;color:#059669!important}.grid4>.metric:nth-child(4) .metric-icon{background:#ffe4e6!important;color:#e11d48!important}.dark .grid4>.metric:nth-child(1) .metric-icon{background:#431407!important;color:#fdba74!important}.dark .grid4>.metric:nth-child(2) .metric-icon{background:#052e16!important;color:#86efac!important}.dark .grid4>.metric:nth-child(3) .metric-icon{background:#022c22!important;color:#6ee7b7!important}.dark .grid4>.metric:nth-child(4) .metric-icon{background:#4c0519!important;color:#fda4af!important}
.metric-label{font-size:12px!important;color:#334155!important;font-weight:800!important}.dark .metric-label{color:#cbd5e1!important}.metric-value{font-size:28px!important;line-height:1.1!important;font-weight:950!important;letter-spacing:-.03em!important;color:var(--text)!important}.metric-trend{font-weight:900!important}
.pagehead h1,.card-head h3,.table-card h3,.product b,.total,.activity-main b,.cart-line b{color:var(--text)!important;font-weight:900!important}.pagehead p,.activity-main span,.activity-side,.field label,.breadcrumb,.sandbox-note{color:#334155!important;font-weight:700!important}.dark .pagehead p,.dark .activity-main span,.dark .activity-side,.dark .field label,.dark .breadcrumb,.dark .sandbox-note{color:#cbd5e1!important;font-weight:700!important}
.table{border-collapse:separate!important;border-spacing:0!important}.table th{color:#0f172a!important;background:#f1f5f9!important;font-weight:900!important;border-bottom:2px solid #cbd5e1!important}.dark .table th{color:#f8fafc!important;background:#172033!important;border-bottom-color:#475569!important}.table td{font-weight:750!important;color:var(--text)!important;border-bottom:1px solid #cbd5e1!important;transition:background .12s ease}.dark .table td{border-bottom-color:#334155!important}.table tbody tr:nth-child(even) td{background:rgba(241,245,249,.8)}.dark .table tbody tr:nth-child(even) td{background:rgba(30,41,59,.42)}.table tbody tr:hover td{background:#ffedd5!important}.dark .table tbody tr:hover td{background:#431407!important}
.badge{gap:6px!important;align-items:center!important;font-weight:900!important;border:1px solid currentColor!important}.badge:before{content:'';width:7px;height:7px;border-radius:999px;background:currentColor;box-shadow:0 0 0 0 currentColor;animation:posStatusPulse 1.8s ease-out infinite}.badge.bad:before{animation:none}.badge.info:before{animation:posStatusPulse 2.1s ease-out infinite}@keyframes posStatusPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,currentColor 45%,transparent)}70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
.product,.table-card,.input,.select,.textarea,.btn,.icon-btn,.tenant-select,.user-pill{border:2px solid var(--line)!important}.table-card{background:var(--panel)!important;box-shadow:0 4px 12px rgba(15,23,42,.08)}.table-card:hover{border-color:#f97316!important;box-shadow:0 14px 28px rgba(249,115,22,.16)!important;transform:translateY(-2px)}
.product{position:relative!important;overflow:hidden!important;background:var(--panel)!important;box-shadow:0 5px 14px rgba(15,23,42,.08)!important;padding:50px 15px 16px!important;min-height:154px!important;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease!important}.product:hover{border-color:#f97316!important;box-shadow:0 16px 30px rgba(249,115,22,.20)!important;transform:translateY(-3px)!important}.product:before{position:absolute;left:-2px;right:-2px;top:-2px;height:38px;display:flex;align-items:center;padding:0 14px;color:#fff;font-size:10px;font-weight:950;letter-spacing:.09em;text-transform:uppercase}.product:nth-child(1):before,.product:nth-child(2):before{content:'FUERTES';background:#ea580c}.product:nth-child(3):before{content:'ACOMPAÑANTES';background:#16a34a}.product:nth-child(4):before,.product:nth-child(5):before{content:'BEBIDAS';background:#2563eb}.product:nth-child(6):before{content:'POSTRES';background:#7c3aed}.product b{display:block!important;font-size:14px!important;line-height:1.25!important;color:#0f172a!important;font-weight:950!important}.dark .product b{color:#f8fafc!important}.product span{display:none!important}.product strong{display:inline-flex!important;align-items:center!important;margin-top:12px!important;padding:7px 11px!important;border-radius:999px!important;background:#0f172a!important;color:#fff!important;font-size:13px!important;font-weight:950!important;box-shadow:0 5px 12px rgba(15,23,42,.18)!important}.dark .product strong{background:#f8fafc!important;color:#0f172a!important}
.btn{font-weight:850!important}.btn.primary{background:#ea580c!important;border:2px solid #c2410c!important;color:#fff!important;font-weight:950!important;box-shadow:0 9px 22px rgba(234,88,12,.28)!important}.btn.primary:hover{background:#c2410c!important;border-color:#9a3412!important;transform:translateY(-1px)}.order-layout>.card .btn.primary:last-child{min-height:58px!important;width:100%!important;justify-content:center!important;margin-top:16px!important;font-size:16px!important;letter-spacing:.01em!important;background:#ea580c!important;color:#fff!important;border-color:#c2410c!important;box-shadow:0 14px 30px rgba(234,88,12,.34)!important}.order-layout>.card .btn.primary:last-child:hover{background:#c2410c!important;box-shadow:0 16px 34px rgba(234,88,12,.42)!important}.input:focus,.select:focus,.textarea:focus{border-color:#f97316!important;box-shadow:0 0 0 4px rgba(249,115,22,.16)!important}
.cart-line{padding:14px 0!important;border-bottom:2px solid #e2e8f0!important}.dark .cart-line{border-bottom-color:#334155!important}.cart-line button{min-height:44px!important;min-width:44px!important;padding:0 14px!important;border-radius:10px!important;font-weight:950!important;touch-action:manipulation;box-shadow:0 4px 10px rgba(15,23,42,.12)!important}.qty{gap:8px!important}.qty button{width:44px!important;height:44px!important;background:#0f172a!important;color:#fff!important;border:2px solid #020617!important;font-size:20px!important;line-height:1!important}.qty button:hover{background:#334155!important}.dark .qty button{background:#f8fafc!important;color:#0f172a!important;border-color:#cbd5e1!important}.cart-line .btn.danger,.cart-line button:last-child{background:#dc2626!important;color:#fff!important;border:2px solid #b91c1c!important;font-weight:950!important;box-shadow:0 5px 12px rgba(220,38,38,.22)!important}.cart-line .btn.danger:hover,.cart-line button:last-child:hover{background:#b91c1c!important;border-color:#991b1b!important}
</style><script id="vantixgc-sandbox-pos-impact-migration">(()=>{try{const key='vantixgc_ui_sandbox_theme';let theme=null;try{theme=JSON.parse(localStorage.getItem(key)||'null')}catch{}const old=['#2563eb','#ea580c','#f97316'];if(!theme||!theme.accent||old.includes(String(theme.accent).toLowerCase()))localStorage.setItem(key,JSON.stringify({mode:theme?.mode||'light',accent:'#EA580C',soft:'#FFF7ED',font:theme?.font||'Inter,ui-sans-serif,system-ui,sans-serif'}))}catch{}})();</script>`;

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
router.get('/app/restaurant-control-center.css', (_req, res) => res.type('text/css').sendFile(path.join(webRoot, 'restaurant-control-center.css')));
router.get('/app/restaurant-control-center.js', (_req, res) => res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-control-center.js')));

// Operational Control Center. It reuses restaurant-ui.js as the proven write engine,
// while the new shell owns navigation and presentation. The classic route remains untouched.
router.get('/app/centro-de-control', async (_req, res, next) => {
  try {
    const html = await fs.promises.readFile(path.join(webRoot, 'restaurant.html'), 'utf8');
    const rendered = html
      .replace('<title>VantixGC Restaurante</title>', '<title>VantixGC Restaurante · Centro de control</title>')
      .replace('</head>', '  <link rel="stylesheet" href="/app/restaurant-control-center.css?v=operational-v1">\n</head>')
      .replace('</body>', '  <script src="/app/restaurant-control-center.js?v=operational-v1"></script>\n</body>');
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Restaurant-Control', 'operational-shell-v1');
    res.set('X-VantixGC-Restaurant-Control-Engine', 'restaurant-ui-v1');
    res.set('X-VantixGC-Restaurant-Control-Fallback', '/app/restaurante');
    res.type('html').send(rendered);
  } catch (error) { next(error); }
});

// Authenticated-in-browser, read-only preview on top of the real Restaurant tenant session.
router.get('/app/centro-de-control-preview', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Restaurant-Control-Preview', 'real-readonly-v1');
  res.set('X-VantixGC-Restaurant-Control-Writes', 'disabled');
  res.type('html').sendFile(path.join(webRoot, 'restaurant-control-preview.html'));
});

// Isolated UI/UX sandbox. Self-contained: no CDN, no tenant API, no production writes.
router.get(['/app/v2-preview', '/app/v2-preview/dashboard', '/app/v2-preview/ventas', '/app/sandbox'], async (req, res, next) => {
  try {
    const html = await fs.promises.readFile(path.join(webRoot, 'ui-sandbox.html'), 'utf8');
    const initialView = req.path.endsWith('/ventas') ? 'ventas' : 'dashboard';
    const withView = html
      .replace("const defaults={view:'dashboard'", `const defaults={view:'${initialView}'`)
      .replace('Confirmar visualmente', 'Confirmar / Cobrar');
    const rendered = withView.includes('</head>') ? withView.replace('</head>', `${sandboxPosImpactBootstrap}</head>`) : `${sandboxPosImpactBootstrap}${withView}`;
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-UI-Sandbox', 'mock-local-v5-solid-pos');
    res.set('X-VantixGC-UI-Sandbox-Runtime', 'self-contained');
    res.set('X-VantixGC-UI-Theme', 'restaurant-solid-pos-v1');
    res.set('X-VantixGC-UI-Style', 'solid-robust-v1');
    res.set('X-VantixGC-UI-Preview-View', initialView);
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