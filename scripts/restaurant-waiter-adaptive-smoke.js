'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'restaurant.html'), 'utf8');

function between(start, end) {
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  assert.ok(a >= 0 && b > a, `No se encontró bloque ${start}`);
  return html.slice(a, b + end.length);
}

const css = between('WAITER_ADAPTIVE_TOUCH_V1_START', 'WAITER_ADAPTIVE_TOUCH_V1_END');
const runtime = between('WAITER_ADAPTIVE_RUNTIME_V1_START', 'WAITER_ADAPTIVE_RUNTIME_V1_END');

assert.match(html, /width=device-width,initial-scale=1,viewport-fit=cover/);
assert.match(css, /min-width:1280px/);
assert.match(css, /min-width:800px[^}]*max-width:1279px[^}]*orientation:landscape/);
assert.match(css, /min-width:600px[^}]*max-width:999px[^}]*orientation:portrait/);
assert.match(css, /max-width:599px/);
assert.match(css, /100dvh/);
assert.match(css, /waiter-order-toggle/);
assert.match(css, /waiter-order-open/);
assert.match(css, /waiter-history-open/);
assert.match(css, /min-height:56px/);
assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);

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

console.log(JSON.stringify({
  ok: true,
  adaptive: ['desktop-wide', 'tablet-landscape', 'tablet-portrait', 'mobile'],
  touchTargetPx: 56,
  tabletPortraitOrderSheet: true,
  mobileOrderSheet: true,
  collapsibleHistory: true,
  businessApiCallsAdded: 0
}));
