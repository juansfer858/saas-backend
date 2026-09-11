'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const shared = fs.readFileSync('src/web/restaurant-delivery-shared-menu-v90.js', 'utf8');
const waiter = fs.readFileSync('src/web/restaurant-waiter-runtime-v7.js', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-delivery-p11.html', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-delivery.public.routes.js', 'utf8');

assert.match(shared, /MENU_PATH\s*=\s*['"]\/api\/v1\/restaurante\/menu['"]/);
assert.match(waiter, /api\('\/api\/v1\/restaurante\/menu'\)/);
assert.match(shared, /MENU_PAGE\s*=\s*40/);
assert.match(waiter, /MENU_PAGE\s*=\s*40/);
assert.ok(shared.includes("sameMenuAsWaiter:true"));
assert.ok(shared.includes("requiresTable:false"));
assert.ok(shared.includes("event.stopImmediatePropagation()"));

const guardSrc = '/app/restaurant-delivery-menu-guard-v88.js?v=v88';
const compactSrc = '/app/restaurant-delivery-menu-compact-v89.js?v=v89';
const sharedSrc = '/app/restaurant-delivery-shared-menu-v90.js?v=v90';
const v91Src = '/app/restaurant-delivery-orders-menu-v91.js?v=v91';
const v93Src = '/app/restaurant-delivery-orders-compact-v93.js?v=v93';
const v93Active = html.includes(`<script src="${v93Src}"></script>`);
const v91Declared = html.includes(v91Src);
const uiSrc = v93Active ? '/app/restaurant-delivery-ui.js?v=v93' : v91Declared ? '/app/restaurant-delivery-ui.js?v=v91' : '/app/restaurant-delivery-ui.js?v=v90';

assert.ok(html.includes(guardSrc));
assert.ok(html.includes(uiSrc));
assert.ok(!html.includes(`<script src="${compactSrc}"></script>`));

if (v93Active) {
  assert.ok(!html.includes(`<script src="${sharedSrc}"></script>`));
  assert.ok(html.indexOf(uiSrc) < html.indexOf(v93Src));
} else if (v91Declared) {
  assert.ok(!html.includes(`<script src="${sharedSrc}"></script>`));
} else {
  assert.ok(html.includes(`<script src="${sharedSrc}"></script>`));
}

assert.ok(publicRoutes.includes("router.get('/app/restaurant-delivery-shared-menu-v90.js'"));
assert.ok(publicRoutes.includes("X-VantixGC-Restaurant-Delivery-Shared-Menu', 'v90'"));

console.log(`RESTAURANT DELIVERY SHARED MENU V90 SMOKE OK · ${v93Active ? 'ROLLBACK BEHIND V93' : v91Declared ? 'ROLLBACK BEHIND V91' : 'ACTIVE'}`);
