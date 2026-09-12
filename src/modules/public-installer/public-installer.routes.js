const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { restaurantSelfServicePublicRouter } = require('../self-service/restaurant-self-service.routes');
const windowsInstaller = require('./windows-installer-v27.service');
const edgeRepairWindows = require('./edge-repair-windows.service');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const landingPath = path.join(webRoot, 'public-installer.html');
const restaurantLandingPath = path.join(webRoot, 'restaurant-public.html');
const restaurantDemoPath = path.join(webRoot, 'restaurant-public-demo.html');
const restaurantDemoModalPath = path.join(webRoot, 'restaurant-public-demo-modal.js');
const restaurantHeroImagePath = path.join(webRoot, 'restaurant-public-hero-customer-order-v1.webp');
const restaurantSignupPath = path.join(webRoot, 'restaurant-signup.html');
const restaurantOnboardingPath = path.join(webRoot, 'restaurant-onboarding.html');
const restaurantPublicThemePath = path.join(webRoot, 'restaurant-public-theme.css');
const restaurantPublicResponsivePath = path.join(webRoot, 'restaurant-public-responsive-v1.css');
const restaurantPublicAutopedidoPath = path.join(webRoot, 'restaurant-public-autopedido-v1.js');
const restaurantPublicMembershipJsPath = path.join(webRoot, 'restaurant-public-membership-v1.js');
const restaurantPublicMembershipCssPath = path.join(webRoot, 'restaurant-public-membership-v1.css');
const edgeReleaseRoot = path.resolve(__dirname, '..', '..', '..', 'public', 'edge-releases');
const edgeManifestPath = path.join(edgeReleaseRoot, 'manifest.json');

router.use('/api/public/restaurantes', restaurantSelfServicePublicRouter);

function publicBaseUrl(req) {
  const configured = String(process.env.CORE_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwarded || req.protocol || 'https';
  return `${protocol}://${req.get('host')}`;
}

function applyRestaurantLandingMarketingCopy(html) {
  return html
    .replace(
      'El mesero toma el pedido, Producción recibe la comanda, Caja cobra y el resto del negocio se actualiza desde la misma plataforma.',
      'El pedido puede nacer con el mesero o por autoatención desde la mesa. Producción recibe la comanda, Caja gestiona el cobro y el resto del negocio se actualiza desde la misma plataforma.'
    )
    .replace(
      '<article class="feature"><div class="n">04</div><h3>Gestión completa</h3><p>Carta, inventario, empleados, domicilios, reportes y administración conectados.</p></article>',
      '<article class="feature"><div class="n">04</div><h3>Autoatención del cliente</h3><p>El cliente consulta la carta, hace su pedido y gestiona el pago desde la mesa, reduciendo esperas, filas y carga operativa del personal.</p></article>'
    )
    .replace('<li>QR de mesas</li>', '<li>Autoatención: pedido y pago desde la mesa</li>')
    .replace('<td>Clientes, crédito y QR</td>', '<td>Clientes, crédito y autoatención</td>')
    .replace(
      'Profesional agrega gestión, inventario, domicilios, división, clientes, QR y reportes;',
      'Profesional agrega gestión, inventario, domicilios, división, clientes, autoatención desde la mesa y reportes;'
    );
}

async function readEdgeManifest() {
  const raw = await fs.promises.readFile(edgeManifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (!manifest || typeof manifest !== 'object' || !manifest.releases || typeof manifest.releases !== 'object') {
    throw new Error('El manifiesto Edge local no tiene un formato válido.');
  }
  return manifest;
}

async function sendRestaurantPublicHtml(filePath, res, next) {
  try {
    const rawHtml = await fs.promises.readFile(filePath, 'utf8');
    const html = filePath === restaurantLandingPath ? applyRestaurantLandingMarketingCopy(rawHtml) : rawHtml;
    const themeTag = '<link rel="stylesheet" href="/restaurantes/theme-v1.css">';
    const responsiveTag = '<link rel="stylesheet" href="/restaurantes/responsive-v1.css">';
    const membershipTag = filePath === restaurantLandingPath ? '<link rel="stylesheet" href="/restaurantes/membership-v1.css">' : '';
    let themed = (html.includes('</head>') ? html.replace('</head>', `${themeTag}${responsiveTag}${membershipTag}</head>`) : `${themeTag}${responsiveTag}${membershipTag}${html}`)
      .replace(/<meta\s+name=(['"])viewport\1\s+content=(['"])[^'"]*\2\s*\/?\s*>/i, '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">')
      .replace(/<body(\s[^>]*)?>/i, (match, attrs = '') => {
        if (/class\s*=/.test(attrs)) return match.replace(/class=(['"])(.*?)\1/i, (_m, q, classes) => `class=${q}${classes} vr-public-theme${q}`);
        return `<body${attrs} class="vr-public-theme">`;
      });
    if (filePath === restaurantLandingPath) {
      const publicScripts = '<script src="/restaurantes/autopedido-v1.js" defer></script><script src="/restaurantes/membership-v1.js" defer></script><script src="/restaurantes/demo-modal-v1.js" defer></script>';
      themed = themed.includes('</body>') ? themed.replace('</body>', `${publicScripts}</body>`) : `${themed}${publicScripts}`;
    }
    res.set('Cache-Control', 'no-store, max-age=0');
    res.type('html').send(themed);
  } catch (error) { next(error); }
}

router.get('/restaurantes/theme-v1.css', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('text/css').sendFile(restaurantPublicThemePath);
});

router.get('/restaurantes/responsive-v1.css', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('text/css').sendFile(restaurantPublicResponsivePath);
});

router.get('/restaurantes/autopedido-v1.js', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('application/javascript').sendFile(restaurantPublicAutopedidoPath);
});

router.get('/restaurantes/membership-v1.css', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('text/css').sendFile(restaurantPublicMembershipCssPath);
});

router.get('/restaurantes/membership-v1.js', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('application/javascript').sendFile(restaurantPublicMembershipJsPath);
});

router.get('/restaurantes/demo-modal-v1.js', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('application/javascript').sendFile(restaurantDemoModalPath);
});

router.get('/restaurantes/hero-cliente-pedido-v1.webp', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400, immutable');
  res.type('image/webp').sendFile(restaurantHeroImagePath);
});

router.get('/restaurantes', (_req, res, next) => sendRestaurantPublicHtml(restaurantLandingPath, res, next));
router.get('/restaurantes/demo', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
  res.set('X-VantixGC-Restaurant-Demo-Isolation', 'standalone-commercial-v1');
  res.type('html').sendFile(restaurantDemoPath);
});
router.get('/restaurantes/crear', (_req, res, next) => sendRestaurantPublicHtml(restaurantSignupPath, res, next));
router.get('/app/onboarding', (_req, res, next) => sendRestaurantPublicHtml(restaurantOnboardingPath, res, next));

router.get('/edge-releases/:file', async (req, res, next) => {
  try {
    const requested = String(req.params.file || '').trim();
    if (requested === 'manifest.json') {
      const manifest = await readEdgeManifest();
      res.set('Cache-Control', 'no-store, max-age=0');
      res.set('X-VantixGC-Edge-Manifest', 'installer-core-v1');
      return res.json(manifest);
    }

    if (!/^vantixgc-edge-[0-9A-Za-z._-]+\.zip$/.test(requested) || path.basename(requested) !== requested) {
      return res.status(404).json({ ok:false, error:{ code:'EDGE_INSTALL_ARTIFACT_NOT_FOUND', message:'Artifact Edge no disponible' } });
    }

    const manifest = await readEdgeManifest();
    const declared = Object.values(manifest.releases || {}).find((release) => release && release.file === requested);
    if (!declared || !/^[a-f0-9]{64}$/.test(String(declared.sha256 || ''))) {
      return res.status(404).json({ ok:false, error:{ code:'EDGE_INSTALL_ARTIFACT_NOT_FOUND', message:'Artifact Edge no disponible' } });
    }

    const filePath = path.resolve(edgeReleaseRoot, requested);
    if (path.dirname(filePath) !== edgeReleaseRoot) {
      return res.status(404).json({ ok:false, error:{ code:'EDGE_INSTALL_ARTIFACT_NOT_FOUND', message:'Artifact Edge no disponible' } });
    }
    const stat = await fs.promises.stat(filePath).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat?.isFile()) {
      return res.status(404).json({ ok:false, error:{ code:'EDGE_INSTALL_ARTIFACT_NOT_FOUND', message:'Artifact Edge no disponible' } });
    }

    res.set('Cache-Control', 'public, max-age=300, immutable');
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${requested}"`);
    res.set('X-VantixGC-Edge-Artifact', 'installer-core-local-v1');
    res.set('X-VantixGC-Edge-SHA256', String(declared.sha256));
    return res.sendFile(filePath);
  } catch (error) { return next(error); }
});

router.get('/instalar', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('html').sendFile(landingPath);
});

router.get('/instalar/windows.cmd', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Content-Disposition', 'attachment; filename="INSTALAR_VANTIXGC_RESTAURANTES.cmd"');
  res.type('text/plain').send(windowsInstaller.genericInstallerCmd(publicBaseUrl(req)));
});

router.get('/instalar/windows.ps1', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('text/plain').send(windowsInstaller.genericInstallerPowerShell(publicBaseUrl(req)));
});

router.get('/reparar-edge/windows.cmd', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Content-Disposition', 'attachment; filename="REPARAR_VANTIXGC_EDGE.cmd"');
  res.type('text/plain').send(edgeRepairWindows.windowsRepairCmd(publicBaseUrl(req)));
});

router.get('/reparar-edge/windows.ps1', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Content-Disposition', 'attachment; filename="REPARAR_VANTIXGC_EDGE.ps1"');
  res.type('text/plain').send(edgeRepairWindows.windowsRepairPowerShell(publicBaseUrl(req)));
});

router.get('/instalar-restaurantes', (_req, res) => res.redirect(302, '/restaurantes'));
router.get('/demo-restaurantes', (_req, res) => res.redirect(302, '/restaurantes/demo'));

module.exports = { publicInstallerRouter: router };
