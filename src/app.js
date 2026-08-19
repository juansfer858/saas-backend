const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { prisma } = require('./config/prisma');
const { authRouter } = require('./modules/auth/auth.routes');
const { coreRouter } = require('./routes/core.routes');
const { errorHandler } = require('./middleware/error-handler');

const app = express();
const accountingHtmlPath = path.join(__dirname, 'web', 'accounting.html');
const accountingGuardPath = path.join(__dirname, 'web', 'accounting-runtime-guard.js');
const panelHtmlPath = path.join(__dirname, 'web', 'panel.html');
const coreIntegrationUiPath = path.join(__dirname, 'web', 'core-integration-v3.js');

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '8mb' }));

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'VantixGC Super Core',
    api: '/api/v1',
    statusPage: '/status',
    adminApp: '/app/dashboard',
    demoApp: '/app/demo',
    salesApp: '/app/ventas',
    accountingApp: '/app/contabilidad'
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'saas-backend' });
});

app.get('/app/demo', (_req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'demo.html'));
});

app.get('/app/accounting-runtime-guard.js', (_req, res) => {
  res.type('application/javascript').sendFile(accountingGuardPath);
});

app.get('/app/core-integration-v3.js', (_req, res) => {
  res.type('application/javascript').sendFile(coreIntegrationUiPath);
});

app.get('/app/contabilidad', async (_req, res, next) => {
  try {
    const html = await fs.promises.readFile(accountingHtmlPath, 'utf8');
    const guardTag = '<script src="/app/accounting-runtime-guard.js?v=qa-blockers-v2"></script>';
    const rendered = html.includes('</body>') ? html.replace('</body>', `${guardTag}</body>`) : `${html}${guardTag}`;
    res.type('html').send(rendered);
  } catch (error) { next(error); }
});

app.use('/app', async (_req, res, next) => {
  try {
    const html = await fs.promises.readFile(panelHtmlPath, 'utf8');
    const integrationTag = '<script src="/app/core-integration-v3.js?v=3"></script>';
    const rendered = html.includes('</body>') ? html.replace('</body>', `${integrationTag}</body>`) : `${html}${integrationTag}`;
    res.type('html').send(rendered);
  } catch (error) { next(error); }
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
        coreAccountingIntegration: 'V3',
        financialStatements: 'READY',
        accountingGovernance: 'READY',
        taxes: 'READY',
        fixedAssets: 'READY',
        bankReconciliation: 'READY',
        adminPanel: 'READY',
        demoPanel: 'READY',
        salesUi: 'READY',
        purchasesUi: 'READY',
        treasuryUi: 'READY',
        carteraUi: 'READY',
        inventoryUi: 'READY'
      }
    });
  } catch (_error) {
    res.status(503).json({ ok: false, core: 'VantixGC Super Core', database: 'ERROR' });
  }
});

app.get('/status', async (_req, res) => {
  let database = 'ERROR';
  try { await prisma.$queryRaw`SELECT 1`; database = 'OK'; } catch (_error) {}
  const ready = database === 'OK';
  res.status(ready ? 200 : 503).type('html').send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VantixGC Super Core</title><style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f4f4f5;color:#18221d;margin:0;padding:32px}.wrap{max-width:760px;margin:auto}.card{background:#fff;border:1px solid #e4e4e7;border-radius:18px;padding:24px;margin:16px 0}.ok{color:#118a57;font-weight:700}.bad{color:#b91c1c;font-weight:700}h1{margin:0 0 6px}.grid{display:grid;grid-template-columns:1fr auto;gap:12px;border-top:1px solid #eee;padding:12px 0}.muted{color:#61706a}.link{display:inline-block;margin:14px 8px 0 0;padding:10px 14px;border-radius:10px;background:#0d6b43;color:white;text-decoration:none;font-weight:700}</style></head>
<body><div class="wrap"><h1>VantixGC Super Core</h1><div class="muted">Núcleo universal SaaS multitenant ERP/Contable</div>
<div class="card"><div class="grid"><span>PostgreSQL</span><span class="${ready ? 'ok' : 'bad'}">${database}</span></div>
<div class="grid"><span>Auth & Multitenancy</span><span class="ok">READY</span></div>
<div class="grid"><span>Terceros compartidos</span><span class="ok">READY</span></div>
<div class="grid"><span>Inventario / Kardex · Promedio + PEPS</span><span class="ok">READY</span></div>
<div class="grid"><span>Tesorería / Cartera / Aplicaciones</span><span class="ok">READY</span></div>
<div class="grid"><span>Ventas / Compras → Contabilidad AU</span><span class="ok">READY</span></div>
<div class="grid"><span>Reversos / periodos / trazabilidad</span><span class="ok">READY</span></div>
<div class="grid"><span>Contabilidad V2 — PUC + Diario + Mayor + Estados + Cierres + Impuestos</span><span class="ok">READY</span></div>
<div class="grid"><span>Integración contable transversal</span><span class="ok">V3</span></div>
<a class="link" href="/app/demo">Ver estructura sin ingresar</a><a class="link" href="/app/dashboard">Abrir Panel Web</a><a class="link" href="/app/ventas">Abrir Ventas</a><a class="link" href="/app/compras">Abrir Compras</a><a class="link" href="/app/contabilidad">Abrir Contabilidad</a></div>
<div class="muted">Despliegue automático GitHub → Coolify</div></div></body></html>`);
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1', coreRouter);
app.use(errorHandler);

module.exports = { app };
