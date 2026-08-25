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
const panelRestaurantEntryPath = path.join(__dirname, 'web', 'panel-restaurant-entry.js');
const superCoreWorkspaceCssPath = path.join(__dirname, 'web', 'super-core-workspace-v6.css');
const notificationsConfigScriptPath = path.join(__dirname, 'web', 'notifications-config.js');
const salesHtmlPath = path.join(__dirname, 'web', 'sales.html');
const purchasesHtmlPath = path.join(__dirname, 'web', 'purchases.html');
const platformCoreConfigHtmlPath = path.join(__dirname, 'web', 'platform-core-config.html');
const platformAdminHtmlPath = path.join(__dirname, 'web', 'platform-admin.html');
const platformRestaurantFiscalGovernancePath = path.join(__dirname, 'web', 'platform-restaurant-fiscal-governance.js');
const edgeConfigHtmlPath = path.join(__dirname, 'web', 'edge-config.html');
const restaurantQrHtmlPath = path.join(__dirname, 'web', 'restaurant-qr.html');
const restaurantFiscalWarningPath = path.join(__dirname, 'web', 'restaurant-fiscal-warning.js');
const restaurantHtmlPath = path.join(__dirname, 'web', 'restaurant.html');
const restaurantThemeCssPath = path.join(__dirname, 'web', 'restaurant-theme.css');
const restaurantThemeJsPath = path.join(__dirname, 'web', 'restaurant-theme.js');
const restaurantUiPath = path.join(__dirname, 'web', 'restaurant-ui.js');
const restaurantControlCenterCssPath = path.join(__dirname, 'web', 'restaurant-control-center.css');
const restaurantControlCenterJsPath = path.join(__dirname, 'web', 'restaurant-control-center.js');

const TENANT_NAV_VERSION = 'core-nav-v7';
const TENANT_SIDEBAR_VERSION = 'core-sidebar-server-v1';
const SUPER_CORE_VISUAL_THEME = 'super-core-v5-silver-server';
const SIDEBAR_STABILITY_VERSION = 'tenant-card-server-slot-v1';
const lineIcon = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const tenantNavigationItems = Object.freeze([
  Object.freeze({ href: '/app/centro-de-control', label: 'Restaurante', subtitle: 'Operación principal', restaurantOnly: true, primaryVertical: true, icon: lineIcon('<path d="M6 3v8M9 3v8M6 7h3M7.5 11v10M15 3v8c0 2 1 3 3 3v7M18 3v11"/>') }),
  Object.freeze({ href: '/app/dashboard', label: 'Dashboard', icon: lineIcon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>') }),
  Object.freeze({ href: '/app/ventas', label: 'Ventas', icon: lineIcon('<circle cx="9" cy="20" r="1"/><circle cx="19" cy="20" r="1"/><path d="M3 4h2l2.5 11h10.8l2-7H7"/>') }),
  Object.freeze({ href: '/app/compras', label: 'Compras', icon: lineIcon('<path d="M4 7h16l-1 13H5L4 7Z"/><path d="M8 7a4 4 0 0 1 8 0"/>') }),
  Object.freeze({ href: '/app/inventario', label: 'Inventarios / Kardex', icon: lineIcon('<path d="M4 7 12 3l8 4-8 4-8-4Z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z"/>') }),
  Object.freeze({ href: '/app/tesoreria', label: 'Tesorería & Bancos', icon: lineIcon('<path d="M3 9h18M5 9v9M9 9v9M15 9v9M19 9v9M3 18h18M12 3l9 4H3l9-4Z"/>') }),
  Object.freeze({ href: '/app/cartera', label: 'Cartera', icon: lineIcon('<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>') }),
  Object.freeze({ href: '/app/terceros', label: 'Terceros', icon: lineIcon('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2-6 6-6s6 2 6 6M16 5c2 0 3 1 3 3s-1 3-3 3"/>') }),
  Object.freeze({ href: '/app/contabilidad', label: 'Contabilidad', financeStart: true, icon: lineIcon('<path d="M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V3Z"/><path d="M7 3v18M10 8h6M10 12h6M10 16h4"/>') }),
  Object.freeze({ href: '/app/configuracion', label: 'Parametrización Contable', icon: lineIcon('<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/>') }),
  Object.freeze({ href: '/app/configuracion-avanzada', label: 'Configuración avanzada', icon: lineIcon('<circle cx="12" cy="12" r="3"/><path d="M4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4"/>') })
]);

const tenantNavigationHeadTag = `<style id="core-nav-structural-style" data-core-visual-theme="${SUPER_CORE_VISUAL_THEME}">
.core-nav-restaurant{visibility:hidden}
html[data-core-restaurant-access="1"] .core-nav-restaurant{visibility:visible}
html[data-core-restaurant-access="0"] .core-nav-restaurant{display:none}
.core-tenant-sidebar{background:linear-gradient(145deg,#a8b0b5 0%,#7f888f 28%,#5f676d 62%,#90989e 100%)!important;color:#eef2f3!important;padding:18px 14px!important;position:sticky!important;top:0!important;height:100vh!important;overflow:auto!important;box-sizing:border-box!important;box-shadow:8px 0 28px rgba(37,43,47,.16)!important}
.core-tenant-sidebar .brand{display:flex!important;align-items:center!important;gap:11px!important;padding:4px 8px 14px!important;font-weight:850!important;font-size:18px!important;color:#fff!important}
.core-tenant-sidebar .core-brandmark{width:36px!important;height:36px!important;min-width:36px!important;border-radius:10px!important;background:#137a53!important;color:#fff!important;display:grid!important;place-items:center!important;font-weight:900!important;font-size:16px!important;box-shadow:0 8px 20px rgba(19,122,83,.25)!important}
.core-tenant-sidebar .brand small{display:block!important;color:#d7dde0!important;font-weight:700!important;font-size:10px!important;margin-top:2px!important;letter-spacing:.08em!important}
.core-v5-tenant{height:51px;min-height:51px;box-sizing:border-box;margin:0 5px 15px;padding:9px 12px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.07));box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 10px 22px rgba(20,24,27,.18);overflow:hidden}
.core-v5-tenant b{display:block;color:#fff;font-size:12px;line-height:1.25;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.core-v5-tenant span{display:block;margin-top:3px;color:#d0d7da;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.core-tenant-sidebar .nav-title,.core-v5-group-label{display:block!important;padding:8px 11px 5px!important;color:#d2d8db!important;font-size:9px!important;line-height:1.2!important;letter-spacing:.14em!important;text-transform:uppercase!important;font-weight:850!important}
.core-tenant-sidebar .nav{display:flex!important;flex-direction:column!important;gap:3px!important}
.core-tenant-sidebar .nav a{position:relative!important;display:flex!important;align-items:center!important;gap:10px!important;min-height:42px!important;margin:0!important;padding:9px 10px!important;border:1px solid rgba(255,255,255,.18)!important;border-radius:9px!important;background:rgba(243,246,248,.34)!important;color:#fff!important;text-decoration:none!important;font-size:12px!important;line-height:1.2!important;font-weight:700!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.10)!important;transition:background .15s ease,transform .15s ease,border-color .15s ease!important}
.core-tenant-sidebar .nav a:hover{background:rgba(247,249,250,.44)!important;color:#fff!important;transform:translateX(1px)!important}
.core-tenant-sidebar .nav a.active{background:linear-gradient(90deg,rgba(19,122,83,.40),rgba(255,255,255,.28))!important;color:#fff!important;border-color:rgba(255,255,255,.22)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.34),0 10px 22px rgba(20,24,27,.20)!important}
.core-tenant-sidebar .nav a.active:before{content:'';position:absolute;left:-5px;top:8px;bottom:8px;width:3px;border-radius:3px;background:#3bc88d}
.core-tenant-sidebar .nav .icon{display:grid!important;place-items:center!important;width:20px!important;min-width:20px!important;height:20px!important;color:inherit!important;text-align:center!important}.core-tenant-sidebar .nav .icon svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.core-tenant-sidebar .nav a.core-v5-primary-vertical{min-height:70px!important;margin:0 0 10px!important;padding:12px 11px!important;border-color:rgba(255,255,255,.28)!important;background:linear-gradient(135deg,rgba(247,249,250,.50),rgba(215,222,225,.30))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.32),0 12px 25px rgba(32,38,42,.18)!important}
.core-tenant-sidebar .nav a.core-v5-primary-vertical .icon{width:30px!important;min-width:30px!important;height:30px!important;border-radius:9px;background:rgba(19,122,83,.18);color:#fff}.core-tenant-sidebar .nav a.core-v5-primary-vertical .icon svg{width:21px;height:21px;stroke-width:1.8}
.core-v5-primary-copy{display:flex;min-width:0;flex-direction:column;gap:3px}.core-v5-primary-copy strong{font-size:15px;line-height:1.05;color:#fff;font-weight:900}.core-v5-primary-copy small{font-size:9px;color:#eef3f1;font-weight:750;letter-spacing:.04em}
.core-tenant-sidebar .nav a.core-v5-primary-vertical.active{background:linear-gradient(90deg,rgba(19,122,83,.52),rgba(255,255,255,.30))!important}
.core-tenant-sidebar,.core-tenant-sidebar *{font-family:"Segoe UI",Arial,sans-serif!important;text-shadow:none!important;filter:none!important;font-synthesis:none!important;-webkit-font-smoothing:auto!important}
.core-tenant-sidebar .brand{font-weight:700!important}.core-tenant-sidebar .brand small{font-weight:600!important;color:#eef2f3!important}.core-v5-tenant b{font-weight:700!important}.core-v5-tenant span{font-weight:500!important;color:#eef2f3!important}.core-tenant-sidebar .nav-title,.core-v5-group-label{font-weight:700!important;color:#f3f4f6!important}.core-tenant-sidebar .nav a{font-weight:600!important;color:#fff!important}.core-v5-primary-copy strong{font-weight:700!important}.core-v5-primary-copy small{font-weight:600!important;color:#fff!important}
/* Final sidebar colors are server-rendered before first paint. No runtime visual patching. */
.core-v5-tenant{background:linear-gradient(180deg,rgba(252,253,254,.72),rgba(235,240,243,.64))!important;border-color:rgba(255,255,255,.40)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.30),0 8px 18px rgba(20,24,27,.12)!important}
.core-v5-tenant b{color:#17212b!important;font-weight:700!important}.core-v5-tenant span{color:#46515a!important;font-weight:500!important}
.core-tenant-sidebar .nav a{background:rgba(250,252,253,.72)!important;color:#17212b!important;border-color:rgba(255,255,255,.38)!important;font-weight:600!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.25)!important}
.core-tenant-sidebar .nav a:hover{background:rgba(255,255,255,.86)!important;color:#17212b!important;border-color:rgba(255,255,255,.52)!important}
.core-tenant-sidebar .nav a.active{background:linear-gradient(90deg,rgba(210,237,229,.92),rgba(250,252,253,.84))!important;color:#17212b!important;border-color:rgba(255,255,255,.54)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.38),0 7px 16px rgba(20,24,27,.12)!important}
.core-tenant-sidebar .nav a .icon{color:#17212b!important}
.core-tenant-sidebar .nav a.core-v5-primary-vertical{background:linear-gradient(135deg,rgba(252,253,254,.84),rgba(235,240,243,.74))!important;color:#17212b!important;border-color:rgba(255,255,255,.52)!important}
.core-tenant-sidebar .nav a.core-v5-primary-vertical.active{background:linear-gradient(90deg,rgba(210,237,229,.95),rgba(250,252,253,.86))!important;color:#17212b!important}
.core-tenant-sidebar .nav a.core-v5-primary-vertical .icon{color:#17212b!important;background:rgba(19,122,83,.14)!important}
.core-v5-primary-copy strong{color:#17212b!important;font-weight:700!important}.core-v5-primary-copy small{color:#46515a!important;font-weight:600!important}
.core-tenant-sidebar .brand,.core-tenant-sidebar .brand small,.core-tenant-sidebar .nav-title,.core-v5-group-label{color:#f7f9fa!important}

@media(max-width:760px){.core-tenant-sidebar{position:fixed!important;z-index:40!important;width:250px!important;transform:translateX(-100%)!important;transition:.2s!important}.core-tenant-sidebar.open{transform:none!important}.core-v5-tenant{display:none}.core-tenant-sidebar .nav a.core-v5-primary-vertical{min-height:58px!important}}
</style><script id="core-tenant-identity-bootstrap">(()=>{const key='vantixgc_core_session_v1';const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}};const textName=()=>{const s=read();return s?.tenant?.nombreEmpresa||s?.subdomain||''};const textMeta=()=>{const s=read();if(!s?.subdomain)return '';return s.subdomain+(s.tenant?.pais?' · '+s.tenant.pais:'')};const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));window.VantixGCTenantIdentity=Object.freeze({nameText:textName,metaText:textMeta,nameHtml:()=>esc(textName()),metaHtml:()=>esc(textMeta())})})();</script><script id="core-nav-access-bootstrap">(()=>{try{const s=JSON.parse(localStorage.getItem('vantixgc_core_session_v1')||'null');if(!s?.subdomain)return;const u=s.user?.id||s.user?.email||s.user?.rol||'user';const v=sessionStorage.getItem('vantixgc_core_restaurant_access_v2:'+s.subdomain+':'+u);if(v==='1'||v==='0')document.documentElement.dataset.coreRestaurantAccess=v}catch{}})();</script>`;
const superCoreWorkspaceHeadTag = `<link rel="stylesheet" href="/app/super-core-workspace-v6.css?v=core-workspace-v6-static"><script>document.documentElement.dataset.superCoreWorkspace="super-core-workspace-v6";</script>`;
const tenantNavigationTag = `<script src="/app/panel-restaurant-entry.js?v=${TENANT_NAV_VERSION}"></script>`;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({
  limit: '8mb',
  verify: (req, _res, buf) => {
    if (String(req.originalUrl || '').startsWith('/webhooks/whatsapp')) req.rawBody = Buffer.from(buf);
  }
}));

function normalizeAppPath(value) {
  const clean = String(value || '/app/dashboard').split('?')[0].replace(/\/$/, '');
  return clean || '/app';
}

function canonicalTenantNavHtml(requestPath) {
  const current = normalizeAppPath(requestPath);
  const links = tenantNavigationItems.map((item) => {
    const active = current === item.href || current.startsWith(`${item.href}/`);
    const classes = [active ? 'active' : '', item.restaurantOnly ? 'core-nav-restaurant' : '', item.primaryVertical ? 'core-v5-primary-vertical' : ''].filter(Boolean).join(' ');
    const restaurantAttr = item.restaurantOnly ? ' data-restaurant-entry="true"' : '';
    const primaryAttr = item.primaryVertical ? ' data-core-vertical-primary="true"' : '';
    const label = item.primaryVertical
      ? `<span class="core-v5-primary-copy"><strong>${item.label}</strong><small>${item.subtitle || 'Operación principal'}</small></span>`
      : `<span>${item.label}</span>`;
    const group = item.financeStart ? '<div class="core-v5-group-label">Finanzas y sistema</div>' : '';
    return `${group}<a href="${item.href}" class="${classes}" data-core-full-route="true"${restaurantAttr}${primaryAttr}><span class="icon">${item.icon}</span>${label}</a>`;
  }).join('');
  return `<nav class="nav" data-core-navigation-version="${TENANT_NAV_VERSION}" data-core-navigation-structural="true" data-core-visual-theme="${SUPER_CORE_VISUAL_THEME}">${links}</nav>`;
}

function canonicalTenantSidebarHtml(requestPath, options = {}) {
  const dynamicTenant = options.dynamicTenant === true;
  const tenantName = dynamicTenant
    ? '${window.VantixGCTenantIdentity?.nameHtml?.() || ""}'
    : '';
  const tenantMeta = dynamicTenant
    ? '${window.VantixGCTenantIdentity?.metaHtml?.() || ""}'
    : '';
  return `<aside class="sidebar core-tenant-sidebar" id="sidebar" data-core-sidebar-version="${TENANT_SIDEBAR_VERSION}" data-core-visual-theme="${SUPER_CORE_VISUAL_THEME}" data-core-sidebar-stability="${SIDEBAR_STABILITY_VERSION}"><div class="brand"><div class="core-brandmark">V</div><div>VantixGC<br><small>Super Core</small></div></div><div class="core-v5-tenant" data-core-tenant-card="true"><b data-core-tenant-name="true">${tenantName}</b><span data-core-tenant-meta="true">${tenantMeta}</span></div><div class="nav-title">Principal</div>${canonicalTenantNavHtml(requestPath)}</aside>`;
}

function replaceLegacyTenantSidebar(html, requestPath) {
  const sidebarPattern = /<aside class=(['"])(?:sidebar|side)\1[^>]*>[\s\S]*?<\/aside>/g;
  return html.replace(sidebarPattern, (_match, _quote, offset) => {
    const before = html.slice(0, offset);
    const insideScript = before.lastIndexOf('<script') > before.lastIndexOf('</script>');
    return canonicalTenantSidebarHtml(requestPath, { dynamicTenant: insideScript });
  });
}

function injectBeforeHeadEnd(html, tags) {
  const markup = (tags || []).filter(Boolean).join('');
  if (!markup) return html;
  return html.includes('</head>') ? html.replace('</head>', `${markup}</head>`) : `${markup}${html}`;
}

function injectBeforeBody(html, tags) {
  const markup = (tags || []).filter(Boolean).join('');
  if (!markup) return html;
  return html.includes('</body>') ? html.replace('</body>', `${markup}</body>`) : `${html}${markup}`;
}

async function sendTenantHtml(filePath, req, res, next, bodyTags = [], headTags = [tenantNavigationHeadTag, superCoreWorkspaceHeadTag]) {
  try {
    const html = await fs.promises.readFile(filePath, 'utf8');
    const canonicalized = replaceLegacyTenantSidebar(html, req.path);
    const withHead = injectBeforeHeadEnd(canonicalized, headTags);
    res.set('X-VantixGC-Tenant-Nav', TENANT_NAV_VERSION);
    res.set('X-VantixGC-Tenant-Sidebar', TENANT_SIDEBAR_VERSION);
    res.set('X-VantixGC-Super-Core-Theme', SUPER_CORE_VISUAL_THEME);
    res.set('X-VantixGC-Sidebar-Stability', SIDEBAR_STABILITY_VERSION);
    res.type('html').send(injectBeforeBody(withHead, bodyTags));
  } catch (error) {
    next(error);
  }
}

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
    restaurantApp: '/app/centro-de-control',
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
app.get('/app/restaurant-theme.css', (_req, res) => {
  res.type('text/css').sendFile(restaurantThemeCssPath);
});
app.get('/app/restaurant-theme.js', (_req, res) => {
  res.type('application/javascript').sendFile(restaurantThemeJsPath);
});
app.get('/app/restaurant-ui.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(restaurantUiPath);
});
app.get('/app/restaurant-control-center.css', (_req, res) => {
  res.type('text/css').sendFile(restaurantControlCenterCssPath);
});
app.get('/app/restaurant-control-center.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(restaurantControlCenterJsPath);
});
app.get('/app/centro-de-control', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Vertical', 'RESTAURANT');
  res.sendFile(restaurantHtmlPath);
});
app.get('/app/restaurante', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Restaurant-Canonical', '/app/centro-de-control');
  res.redirect(302, '/app/centro-de-control');
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

app.get('/app/super-core-workspace-v6.css', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.type('text/css').sendFile(superCoreWorkspaceCssPath);
});

app.get('/app/panel-restaurant-entry.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(panelRestaurantEntryPath);
});

app.get('/app/notifications-config.js', (_req, res) => {
  res.type('application/javascript').sendFile(notificationsConfigScriptPath);
});

app.get('/app/ventas', (req, res, next) => {
  sendTenantHtml(salesHtmlPath, req, res, next, [tenantNavigationTag]);
});

app.get('/app/compras', (req, res, next) => {
  sendTenantHtml(purchasesHtmlPath, req, res, next, [tenantNavigationTag]);
});

app.get('/app/configuracion-avanzada', (req, res, next) => {
  const notificationsTag = '<script src="/app/notifications-config.js?v=notifications-core-v1"></script>';
  sendTenantHtml(platformCoreConfigHtmlPath, req, res, next, [notificationsTag, tenantNavigationTag]);
});

app.get('/app/edge', (_req, res) => {
  res.sendFile(edgeConfigHtmlPath);
});

app.get('/app/contabilidad', (req, res, next) => {
  const guardTag = '<script src="/app/accounting-runtime-guard.js?v=qa-blockers-v2"></script>';
  sendTenantHtml(accountingHtmlPath, req, res, next, [guardTag, tenantNavigationTag]);
});

app.use('/app', (req, res, next) => {
  const integrationTag = '<script src="/app/panel-integration-extras.js?v=core-accounting-integration-v1"></script>';
  sendTenantHtml(panelHtmlPath, req, res, next, [integrationTag, tenantNavigationTag]);
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
<a class="link" href="/app/dashboard">Panel tenant</a><a class="link" href="/app/centro-de-control">Restaurante</a><a class="link" href="/app/ventas">Ventas</a><a class="link" href="/app/compras">Compras</a><a class="link" href="/app/configuracion-avanzada">Configuración avanzada</a><a class="link" href="/app/edge">Edge Agents</a><a class="link" href="/platform">Panel SaaS</a></div>
<div class="muted">La excepción de Fase 2 destraba desarrollo funcional, no la promesa de “listo para vender de verdad”. Ver RESTAURANT_PHASE2_SIMULATED_V1.md y EDGE_FIELD_TEST_GATE_V1.md.</div></div></body></html>`);
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1', coreRouter);
app.use(errorHandler);

module.exports = { app };