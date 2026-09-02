'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'web', 'restaurant.html'), 'utf8');
const publicTheme = fs.readFileSync(path.join(root, 'src', 'web', 'restaurant-public-theme.css'), 'utf8');
const adminTheme = fs.readFileSync(path.join(root, 'src', 'web', 'restaurant-theme.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end);
  assert.ok(a >= 0 && b > a, `No se encontró bloque ${start}`);
  return source.slice(a, b + end.length);
}

const cssV1 = between(html, 'WAITER_ADAPTIVE_TOUCH_V1_START', 'WAITER_ADAPTIVE_TOUCH_V1_END');
const runtime = between(html, 'WAITER_ADAPTIVE_RUNTIME_V1_START', 'WAITER_ADAPTIVE_RUNTIME_V1_END');
const visualV29 = between(publicTheme, 'WAITER_ADAPTIVE_VISUAL_V29_START', 'WAITER_ADAPTIVE_VISUAL_V29_END');

assert.match(html, /width=device-width,initial-scale=1,viewport-fit=cover/);
assert.match(cssV1, /orientation:landscape/);
assert.match(cssV1, /orientation:portrait/);
assert.match(cssV1, /100dvh/);
assert.match(cssV1, /waiter-order-toggle/);
assert.match(cssV1, /waiter-order-open/);
assert.match(cssV1, /waiter-history-open/);

// V29: exact approved Restaurant palette; no café/brown visual layer.
assert.match(visualV29, /--waiter-v29-navy:#122b4a/);
assert.match(visualV29, /--waiter-v29-orange:#ff6b2c/);
assert.match(visualV29, /--waiter-v29-teal:#10867f/);
assert.match(visualV29, /--waiter-v29-bg:#eef3f8/);
assert.match(visualV29, /--waiter-v29-panel:#ffffff/);
assert.match(visualV29, /--waiter-v29-gold:#f0a93a/);
assert.match(visualV29, /--waiter-v29-red:#d45656/);
assert.doesNotMatch(visualV29, /#7a4d34|#5b3726|#cd7a52|#a56f4f/i, 'V29 no debe reintroducir la paleta café del boceto descartado');

// Tablet horizontal: two-pane workspace, catalog left + sticky order/detail right.
assert.match(visualV29, /min-width:960px[^}]*orientation:landscape/);
assert.match(visualV29, /grid-template-columns:minmax\(0,1\.68fr\) minmax\(300px,\.72fr\)/);
assert.match(visualV29, /position:sticky!important/);
assert.match(visualV29, /max-height:calc\(100dvh - 16px\)/);

// Tablet portrait: one column and order/detail bottom sheet.
assert.match(visualV29, /min-width:700px[^}]*max-width:959px[^}]*orientation:portrait/);
assert.match(visualV29, /#view \.waiter-workspace\{display:block!important\}/);
assert.match(visualV29, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(visualV29, /html\.waiter-order-open #view \.waiter-order-panel/);
assert.match(visualV29, /bottom:max\(8px,env\(safe-area-inset-bottom\)\)/);

// Smaller landscape tablets still get a split workspace instead of a stretched portrait UI.
assert.match(visualV29, /min-width:700px[^}]*max-width:959px[^}]*orientation:landscape/);
assert.match(visualV29, /grid-template-columns:minmax\(0,1\.62fr\) minmax\(270px,\.78fr\)/);

// Mobile remains a safe fallback.
assert.match(visualV29, /max-width:699px/);
assert.match(visualV29, /min-height:44px/);

// Compactness: the old oversized 160-168px product cards are overridden.
assert.match(visualV29, /min-height:136px!important/);
assert.match(visualV29, /min-height:128px!important/);
assert.match(visualV29, /min-height:132px!important/);
assert.match(visualV29, /min-height:124px!important/);

// Admin waiter header: never show the same selected table twice.
// One table => keep the summary and hide the redundant table chip.
// Multiple tables => keep the selectable strip and hide the duplicate summary.
assert.match(adminTheme, /#view \.waiter-zone-row>\*\{min-width:0!important\}/);
assert.match(adminTheme, /waiter-zone-row:has\(\.waiter-table-chip:only-child\) \.waiter-table-strip\{display:none!important\}/);
assert.match(adminTheme, /waiter-zone-row:has\(\.waiter-table-chip:nth-child\(2\)\) \.waiter-table-summary\{display:none!important\}/);
assert.match(adminTheme, /waiter-zone-row:has\(\.waiter-table-chip:only-child\)\)\{grid-template-columns:minmax\(132px,220px\) minmax\(150px,210px\)!important/);

// V29 must be presentation only. Rotation cannot reload or know business endpoints.
assert.doesNotMatch(visualV29, /fetch\s*\(/);
assert.doesNotMatch(visualV29, /\/api\//);
assert.doesNotMatch(visualV29, /location\.reload|location\.href|window\.location/);
assert.doesNotMatch(visualV29, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
assert.match(visualV29, /preserve[\s\S]*selected zone, table, filters, draft quantities, realtime alerts and device session/i);

// Existing adaptive behavior and business runtime stay untouched.
assert.match(runtime, /MutationObserver/);
assert.match(runtime, /VER PEDIDO/);
assert.match(runtime, /Ver rondas/);
assert.match(runtime, /Cerrar pedido/);
assert.match(runtime, /waiter-order-open/);
assert.doesNotMatch(runtime, /fetch\s*\(/, 'La capa adaptativa no debe llamar APIs');
assert.doesNotMatch(runtime, /\/api\//, 'La capa adaptativa no debe conocer endpoints');
assert.doesNotMatch(runtime, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/, 'La capa adaptativa no debe mutar negocio');

assert.match(html, /restaurant-ui\.js\?v=salon-qr-v2/);
assert.match(html, /restaurant-control-center\.js\?v=workspace-v3-nav2/);
assert.match(html, /only retries idempotent Restaurant GETs/);
assert.match(html, /\/restaurantes\/theme-v1\.css/);

console.log(JSON.stringify({
  ok: true,
  version: 'V29',
  adaptive: ['tablet-landscape-split', 'tablet-portrait-sheet', 'mobile-fallback', 'desktop-wide'],
  palette: ['navy', 'orange', 'teal', 'white', 'light-blue-gray', 'gold-warning', 'red-alert'],
  rotationReloads: 0,
  statePreservedByCssReflow: true,
  waiterHeaderDuplicateTable: false,
  businessApiCallsAdded: 0
}));
