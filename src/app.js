const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { prisma } = require('./config/prisma');
const { authRouter } = require('./modules/auth/auth.routes');
const { coreRouter } = require('./routes/core.routes');
const { platformPublicRouter, platformAdminRouter } = require('./modules/platform/saas/platform.routes');
const { edgePublicRouter } = require('./modules/edge/edge.routes');
const { notificationsPublicRouter } = require('./modules/notifications/notifications.public.routes');
const { restaurantPublicRouter } = require('./modules/restaurant/restaurant.public.routes');
const { errorHandler } = require('./middleware/error-handler');

const app = express();
const accountingHtmlPath = path.join(__dirname, 'web', 'accounting.html');
const accountingGuardPath = path.join(__dirname, 'web', 'accounting-runtime-guard.js');
const panelHtmlPath = path.join(__dirname, 'web', 'panel.html');
const panelIntegrationExtrasPath = path.join(__dirname, 'web', 'panel-integration-extras.js');
const notificationsConfigScriptPath = path.join(__dirname, 'web', 'notifications-config.js');
const salesHtmlPath = path.join(__dirname, 'web', 'sales.html');
const purchasesHtmlPath = path.join(__dirname, 'web', 'purchases.html');
const platformCoreConfigHtmlPath = path.join(__dirname, 'web', 'platform-core-config.html');
const platformAdminHtmlPath = path.join(__dirname, 'web', 'platform-admin.html');
const platformRestaurantFiscalGovernancePath = path.join(__dirname, 'web', 'platform-restaurant-fiscal-governance.js');
const edgeConfigHtmlPath = path.join(__dirname, 'web', 'edge-config.html');
const restaurantHtmlPath = path.join(__dirname, 'web', 'restaurant.html');
const restaurantQrHtmlPath = path.join(__dirname, 'web', 'restaurant-qr.html');
const restaurantFiscalWarningPath = path.join(__dirname, 'web', 'restaurant-fiscal-warning.js');

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({
  limit: '8mb',
  verify: (req, _res, buf) => {
    if (String(req.originalUrl || '').startsWith('/webhooks/whatsapp')) req.rawBody = Buffer.from(buf);
  }
}));

// Public webhook, magic-link and Restaurant QR surfaces. These routes never require a human tenant JWT.
app.use('/', notificationsPublicRouter);
app.use('/', restaurantPublicRouter);

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'VantixGC Super Core',
    api: '/api/v1',
    statusPage: '/status',
    adminApp: '/app/dashboard',
    restaurantApp: '/app/restaurante',
    restaurantQrPath: '/r/:token',
    advancedConfigApp: '/app/configuracion-avanzada',
    edgeConfigApp: '/app/edge',
    edgeAgentApi: '/edge/api/v1',
    trackingPublicPath: '/seguimiento/:token',
    whatsappWebhook: '/webhooks/whatsapp',
    platformAdminApp: '/platform',
    demoApp: '/app/demo',
    salesApp: '/app/ventas',
    purchasesApp: '/app/compras',
    accountingApp: '/app/contabilidad'
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'saas-backend' });
});

async function sendPlatformAdmin(_req, res, next) {
  try {
    const html = await fs.promises.readFile(platformAdminHtmlPath, 'utf8');
    const script = '<script src="/platform/restaurant-fiscal-governance.js?v=platform-only-v1"></script>';
    const rendered = html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : `${html}${script}`;
    res.type('html').send(rendered);
  } catch (error) { next(error); }
}

app.get('/platform/restaurant-fiscal-governance.js', (_req, res) => {
  res.type('application/javascript').sendFile(platformRestaurantFiscalGovernancePath);
});
app.get('/platform', sendPlatformAdmin);
app.get('/platform/admin', sendPlatformAdmin);
app.use('/platform/api/auth', platformPublicRouter);
app.use('/platform/api', platformAdminRouter);

// Edge Agents authenticate with device credentials, never with a human tenant JWT.
app.use('/edge/api/v1', edgePublicRouter);

app.get('/r/:token', (_req, res) => res.sendFile(restaurantQrHtmlPath));
app.get('/app/restaurant-fiscal-warning.js', (_req, res) => {
  res.type('application/javascript').sendFile(restaurantFiscalWarningPath);
});
app.get('/app/restaurante', async (_req, res, next) => {
  try {
    const html = await fs.promises.readFile(restaurantHtmlPath, 'utf8');
    const script = '<script src="/app/restaurant-fiscal-warning.js?v=platform-only-v1"></script>';
    const rendered = html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : `${html}${script}`;
    res.type('html').send(rendered);
  } catch (error) { next(error); }
});

app.get('/app/demo', (_req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'demo.html'));
});

app.get('/app/accounting-runtime-guard.js', (_req, res) => {
  res.type('application/javascript').sendFile(accountingGuardPath);
});

app.get('/app/panel-integration-extras.js', (_req, res) => {
  res.type('application/javascript').sendFile(panelIntegrationExtrasPath);
});

app.get('/app/notifications-config.js', (_req, res) => {
  res.type('application/javascript').sendFile(notificationsConfigScriptPath);
});

app.get('/app/ventas', (_req, res) => {
  res.sendFile(salesHtmlPath);
});

app.get('/app/compras', (_req, res) => {
  res.sendFile(purchasesHtmlPath);
});

app.get('/app/configuracion-avanzada', async (_req, res, next) => {
  try {
    const html = await fs.promises.readFile(platformCoreConfigHtmlPath, 'utf8');
    const script = '<script src="/app/notifications-config.js?v=notifications-core-v1"></script>';
    const rendered = html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : `${html}${script}`;
    res.type('html').send(rendered);
  } catch (error) { next(error); }
});

app.get('/app/edge', (_req, res) => {
  res.sendFile(edgeConfigHtmlPath);
});

app.get('/app/contabilidad', async (_req, res, next) => {
  try {
    const html = await fs.promises.readFile(accountingHtmlPath, 'utf8');
    const guardTag = '<script src="/app/accounting-runtime-guard.js?v=qa-blockers-v2"></script>';
    const rendered = html.includes('</body>')
      ? html.replace('</body>', `${guardTag}</body>`)
      : `${html}${guardTag}`;
    res.type('html').send(rendered);
  } catch (error) {
    next(error);
  }
});

app.use('/app', async (_req, res, next) => {
  try {
    const html = await fs.promises.readFile(panelHtmlPath, 'utf8');
    const integrationTag = '<script src="/app/panel-integration-extras.js?v=core-accounting-integration-v1"></script>';
    const rendered = html.includes('</body>')
      ? html.replace('</body>', `${integrationTag}</body>`)
      : `${html}${integrationTag}`;
    res.type('html').send(rendered);
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/status', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      ok: true,
      core: 'VantixGC Super Core',
      database: 'OK',
      modules: {
        auth: 'READY',
        thirdParties: 'READY',
        inventory: 'READY',
        treasury: 'READY',
        payments: 'READY',
        receivablesPayables: 'READY',
        commercialLifecycle: 'READY',
        accounting: 'READY',
        accountingSuite: 'V2',
        financialStatements: 'READY',
        accountingGovernance: 'READY',
        taxes: 'READY',
        fixedAssets: 'READY',
        bankReconciliation: 'READY',
        adminPanel: 'READY',
        demoPanel: 'READY',
        salesUi: 'OPERATIONAL_V1',
        purchasesUi: 'OPERATIONAL_V1',
        crossModuleAccounting: 'V1',
        consumptionProductionEngine: 'V1',
        restaurantVertical: 'PHASE2_FUNCTIONAL_SIMULATED_PRINT_PRODUCTION_BLOCKED',
        restaurantSimulatedCommandDestination: 'PDF_SCREEN_RECORD',
        restaurantProductionGate: 'PHYSICAL_PRINTER_AND_META_AND_FISCAL_DECISION_REQUIRED',
        restaurantSimulatedFiscalGovernance: 'PLATFORM_SUPERADMIN_ONLY_AUDITED_IMMUTABLE_HISTORY',
        dianCore: 'V1_REAL_HKA_ADAPTER_CODED_EXTERNAL_CREDENTIALS_AND_DIAN_HABILITATION_REQUIRED',
        electronicPayrollCore: 'V1_PROVIDER_NEUTRAL_PT_ADAPTER_REQUIRED_FOR_REAL_TRANSMISSION',
        tenantRbac: 'V1_RESTAURANT_ROLES',
        printingConfiguration: 'V1',
        localEscPosSpooler: 'V1_CI_APPROVED_PHYSICAL_FIELD_PENDING',
        edgeOfflineFirstCore: 'V1_DEVICE_QUEUE_RECONCILIATION',
        notificationsCore: 'V1_META_EMBEDDED_SIGNUP_TENANT_QUEUE_CONSENT_TRACKING',
        magicLinkTracking: 'V1_PUBLIC_READ_ONLY',
        saasPlatformAdmin: 'V1'
      }
    });
  } catch (_error) {
    res.status(503).json({ ok: false, core: 'VantixGC Super Core', database: 'ERROR' });
  }
});

app.get('/status', async (_req, res) => {
  let database = 'ERROR';
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = 'OK';
  } catch (_error) {}

  const ready = database === 'OK';
  res.status(ready ? 200 : 503).type('html').send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VantixGC Super Core</title><style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f4f4f5;color:#18221d;margin:0;padding:32px}.wrap{max-width:900px;margin:auto}.card{background:#fff;border:1px solid #e4e4e7;border-radius:18px;padding:24px;margin:16px 0}.ok{color:#118a57;font-weight:700}.warn{color:#b54708;font-weight:700}.bad{color:#b91c1c;font-weight:700}h1{margin:0 0 6px}.grid{display:grid;grid-template-columns:1fr auto;gap:12px;border-top:1px solid #eee;padding:12px 0}.muted{color:#61706a}.link{display:inline-block;margin:14px 8px 0 0;padding:10px 14px;border-radius:10px;background:#0d6b43;color:white;text-decoration:none;font-weight:700}.gate{background:#fff7ed;border:1px solid #f5c06a;border-radius:12px;padding:12px;margin-top:12px}</style></head>
<body><div class="wrap"><h1>VantixGC Super Core</h1><div class="muted">Núcleo universal SaaS multitenant ERP/Contable</div>
<div class="gate"><b>Restaurante: FUNCIONAL — VALIDADO CON IMPRESIÓN SIMULADA (PDF/PANTALLA)</b><br><span class="bad">PRODUCCIÓN REAL BLOQUEADA</span><div class="muted">Faltan los gates de impresora térmica física, revisión Meta business_management y habilitación/decisión fiscal documentada. La aceptación fiscal simulada, si se usa, solo puede ser autorizada y auditada desde el Panel SaaS.</div></div>
<div class="card"><div class="grid"><span>PostgreSQL</span><span class="${ready ? 'ok' : 'bad'}">${database}</span></div>
<div class="grid"><span>Auth & Multitenancy</span><span class="ok">READY</span></div>
<div class="grid"><span>Terceros</span><span class="ok">READY</span></div>
<div class="grid"><span>Inventario / Kardex</span><span class="ok">READY</span></div>
<div class="grid"><span>Tesorería / Cartera</span><span class="ok">READY</span></div>
<div class="grid"><span>Ventas operativas</span><span class="ok">V1</span></div>
<div class="grid"><span>Compras operativas</span><span class="ok">V1</span></div>
<div class="grid"><span>Motor consumo/producción</span><span class="ok">V1 · INTEGRADO A RESTAURANTE</span></div>
<div class="grid"><span>Restaurante Fase 2</span><span class="warn">FUNCIONAL SIMULADO · NO PRODUCCIÓN</span></div>
<div class="grid"><span>Gobernanza fiscal simulada Restaurante</span><span class="warn">SOLO SUPER-ADMIN · AUDITADA</span></div>
<div class="grid"><span>Contabilidad V2 + integración AU</span><span class="ok">READY</span></div>
<div class="grid"><span>Núcleo DIAN + adaptador real HKA</span><span class="warn">CÓDIGO V1 · CREDENCIALES/HABILITACIÓN EXTERNAS PENDIENTES</span></div>
<div class="grid"><span>Edge Offline-First</span><span class="ok">V1 · COLA LOCAL + RECONCILIACIÓN</span></div>
<div class="grid"><span>Notificaciones por tenant + Magic Link</span><span class="ok">V1 · META CLOUD + COLA + CONSENTIMIENTO</span></div>
<div class="grid"><span>Nómina electrónica mínima + AU</span><span class="warn">V1 · PT REAL PENDIENTE</span></div>
<div class="grid"><span>Roles Restaurante Mesero/Cocina/Barra/Cajero</span><span class="ok">RBAC CORE</span></div>
<div class="grid"><span>Impresión 58/80/Carta + agente ESC/POS LAN</span><span class="warn">CI OK · PRUEBA FÍSICA PENDIENTE</span></div>
<div class="grid"><span>Panel Super-Administración SaaS</span><span class="ok">V1</span></div>
<a class="link" href="/app/dashboard">Panel tenant</a><a class="link" href="/app/restaurante">Restaurante</a><a class="link" href="/app/ventas">Ventas</a><a class="link" href="/app/compras">Compras</a><a class="link" href="/app/configuracion-avanzada">Configuración avanzada</a><a class="link" href="/app/edge">Edge Agents</a><a class="link" href="/platform">Panel SaaS</a></div>
<div class="muted">La excepción de Fase 2 destraba desarrollo funcional, no la promesa de “listo para vender de verdad”. Ver RESTAURANT_PHASE2_SIMULATED_V1.md y EDGE_FIELD_TEST_GATE_V1.md.</div></div></body></html>`);
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1', coreRouter);
app.use(errorHandler);

module.exports = { app };
