'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'lab', 'restaurant-p14', 'production-simple-offline-v1.html');
const runtimePath = path.join(root, 'lab', 'restaurant-p14', 'runtime.js');
const html = fs.readFileSync(htmlPath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(html.includes('P14_PRODUCTION_SIMPLE_OFFLINE_V1'), 'missing isolated production lab marker');
expect(html.includes('/app/restaurant-v2-design-system.css'), 'must reuse canonical restaurant colors/design system');
expect(html.includes('Por preparar'), 'simple pending lane missing');
expect(html.includes('Listos para recoger'), 'simple ready lane missing');
expect(html.includes('✓ LISTO'), 'one-touch ready action missing');
expect(html.includes("id:'COCINA'") && html.includes("id:'BARRA'"), 'kitchen/bar station demo missing');
expect(html.includes('localStorage'), 'offline browser persistence missing');
expect(!html.includes('confirmDialog'), 'normal ready flow must not use confirmation dialogs');
expect(!html.includes('EN_PREPARACION'), 'UX lab must not expose intermediate preparation state');
expect(!html.includes('fetch('), 'offline UX lab must not call network APIs');
expect(runtime.includes("const SIMPLE_PRODUCTION_ENTRY = '/__p14/produccion-simple';"), 'P14-only route missing');
expect(runtime.includes("production-simple-offline-v1.html"), 'P14 runtime does not serve isolated lab file');
expect(!runtime.includes("local.get('/app/produccion-v2'"), 'canonical production route must remain untouched');

console.log('P14_PRODUCTION_SIMPLE_UI_SMOKE=PASS');
console.log('P14_PRODUCTION_SIMPLE_NETWORK_CALLS=0');
console.log('P14_PRODUCTION_SIMPLE_CANONICAL_ROUTE_UNTOUCHED=PASS');
