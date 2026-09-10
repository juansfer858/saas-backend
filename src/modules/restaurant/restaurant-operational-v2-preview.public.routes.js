'use strict';

const express = require('express');
const path = require('node:path');
const { restaurantV1RetirementP11PublicRouter } = require('./restaurant-v1-retirement-p11.public.routes');
const { restaurantV2ControlCenterPublicRouter } = require('./restaurant-v2-control-center.public.routes');
const { restaurantV2TablesPublicRouter } = require('./restaurant-v2-tables.public.routes');
const { restaurantV2OrdersPublicRouter } = require('./restaurant-v2-orders.public.routes');
const { restaurantV2CashPublicRouter } = require('./restaurant-v2-cash.public.routes');
const { restaurantV2SplitPublicRouter } = require('./restaurant-v2-split.public.routes');
const { restaurantV2KdsPublicRouter } = require('./restaurant-v2-kds.public.routes');
const { restaurantV2ClientQrPublicRouter } = require('./restaurant-v2-client-qr.public.routes');
const { restaurantV2PilotPublicRouter } = require('./restaurant-v2-pilot.public.routes');
const { restaurantV2AdminParityPublicRouter } = require('./restaurant-v2-admin-parity.public.routes');
const { restaurantV2MenuPublicRouter } = require('./restaurant-v2-menu.public.routes');

const MARKER = 'VANTIX_RESTAURANT_OPERATIONAL_UI_V2_P1';
const DESIGN_MARKER = 'VANTIX_RESTAURANT_V2_DESIGN_SYSTEM_V1';
const SDK_MARKER = 'VANTIX_RESTAURANT_V2_SDK_V1';
const HEADER_VALUE = 'p1-isolated-foundation-preview';
const webRoot = path.join(__dirname, '../../web');

const restaurantOperationalV2PreviewPublicRouter = express.Router();

// P11 owns the canonical Control Center first. It serves only a tenant-aware
// launcher and a native V2 shell; no legacy Restaurant rewriting runs when P11
// answers. Tenants not retired are sent explicitly to the P10 compatibility alias.
restaurantOperationalV2PreviewPublicRouter.use(restaurantV1RetirementP11PublicRouter);
// V2 public aggregator. Each operational module owns its own route and assets;
// all of them are resolved here before any legacy Restaurant response wrapper.
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2ControlCenterPublicRouter);
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2TablesPublicRouter);
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2OrdersPublicRouter);
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2CashPublicRouter);
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2SplitPublicRouter);
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2KdsPublicRouter);
// Carta V2 is its own Restaurant surface. It reuses the Super Core product master,
// Inventory/Kardex, Recipes and the canonical OCR importer without embedding itself
// inside the administrative inventory screen.
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2MenuPublicRouter);
// Final admin parity reuses the proven QR/device APIs without rotating tokens or
// introducing a second pairing model.
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2AdminParityPublicRouter);
// P9 is a control-plane surface only; it never rewrites canonical V1 routes.
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2PilotPublicRouter);
// P7 owns the existing permanent physical QR path before V1. If this router is
// removed, src/app.js keeps serving restaurant-qr.html as the automatic fallback.
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2ClientQrPublicRouter);

function sendPreviewAsset(res, file, contentType = null) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-V2', HEADER_VALUE);
  if (contentType) res.type(contentType);
  return res.sendFile(path.join(webRoot, file));
}

restaurantOperationalV2PreviewPublicRouter.get('/app/restaurante-v2-preview', (_req, res) => {
  return sendPreviewAsset(res, 'restaurant-operational-v2-preview.html', 'html');
});

restaurantOperationalV2PreviewPublicRouter.get('/app/restaurant-v2-design-system.css', (_req, res) => {
  return sendPreviewAsset(res, 'restaurant-v2-design-system.css', 'text/css; charset=utf-8');
});

restaurantOperationalV2PreviewPublicRouter.get('/app/restaurant-v2-sdk.js', (_req, res) => {
  return sendPreviewAsset(res, 'restaurant-v2-sdk.js', 'application/javascript; charset=utf-8');
});

// V12 is intentionally a presentation/navigation layer. It never owns business
// state: Mesas, Caja, División, Carta and the QR continue using their canonical APIs.
restaurantOperationalV2PreviewPublicRouter.get('/app/restaurant-v2-operational-ux-v12.js', (_req, res) => {
  return sendPreviewAsset(res, 'restaurant-v2-operational-ux-v12.js', 'application/javascript; charset=utf-8');
});

restaurantOperationalV2PreviewPublicRouter.get('/app/restaurant-v2-client-ux-v12.js', (_req, res) => {
  return sendPreviewAsset(res, 'restaurant-v2-client-ux-v12.js', 'application/javascript; charset=utf-8');
});

restaurantOperationalV2PreviewPublicRouter.get('/app/restaurant-operational-v2-preview.js', (_req, res) => {
  return sendPreviewAsset(res, 'restaurant-operational-v2-preview.js', 'application/javascript; charset=utf-8');
});

restaurantOperationalV2PreviewPublicRouter.get('/app/restaurant-operational-v2-preview.css', (_req, res) => {
  return sendPreviewAsset(res, 'restaurant-operational-v2-preview.css', 'text/css; charset=utf-8');
});

module.exports = {
  MARKER,
  DESIGN_MARKER,
  SDK_MARKER,
  HEADER_VALUE,
  restaurantOperationalV2PreviewPublicRouter
};
