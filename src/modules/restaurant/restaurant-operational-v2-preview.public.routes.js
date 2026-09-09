'use strict';

const express = require('express');
const path = require('node:path');
const { restaurantV2TablesPublicRouter } = require('./restaurant-v2-tables.public.routes');
const { restaurantV2OrdersPublicRouter } = require('./restaurant-v2-orders.public.routes');
const { restaurantV2CashPublicRouter } = require('./restaurant-v2-cash.public.routes');
const { restaurantV2SplitPublicRouter } = require('./restaurant-v2-split.public.routes');

const MARKER = 'VANTIX_RESTAURANT_OPERATIONAL_UI_V2_P1';
const DESIGN_MARKER = 'VANTIX_RESTAURANT_V2_DESIGN_SYSTEM_V1';
const SDK_MARKER = 'VANTIX_RESTAURANT_V2_SDK_V1';
const HEADER_VALUE = 'p1-isolated-foundation-preview';
const webRoot = path.join(__dirname, '../../web');

const restaurantOperationalV2PreviewPublicRouter = express.Router();

// V2 public aggregator. Each operational module owns its own route and assets;
// all of them are resolved here before any legacy Restaurant response wrapper.
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2TablesPublicRouter);
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2OrdersPublicRouter);
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2CashPublicRouter);
restaurantOperationalV2PreviewPublicRouter.use(restaurantV2SplitPublicRouter);

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