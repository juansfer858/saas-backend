'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = (file) => fs.readFileSync(file, 'utf8');

const design = read('src/web/restaurant-v2-design-system.css');
const native = read('src/web/restaurant-v2-native-control-p11.css');
const qrCss = read('src/web/restaurant-v2-client-qr.css');
const qrUx = read('src/web/restaurant-v2-client-ux-v12.js');
const qrHtml = read('src/web/restaurant-v2-client-qr.html');

assert.match(design, /VANTIX_RESTAURANT_V2_ADAPTIVE_SURFACE_V13/);
assert.match(design, /min-height:100dvh/);
assert.match(design, /input,select,textarea\{font-size:16px!important\}/);
assert.match(design, /overflow-x:hidden/);

assert.match(native, /VANTIX_RESTAURANT_V2_NATIVE_ADAPTIVE_V13/);
assert.match(native, /\.p11-workspace\{height:calc\(100dvh - 78px\);min-height:0\}/);
assert.match(native, /font-size:16px!important/);

assert.match(qrCss, /VANTIX_RESTAURANT_V2_CLIENT_ADAPTIVE_KEYBOARD_V13/);
assert.match(qrCss, /body\.p7-lock\{inset:auto 0 auto 0/);
assert.match(qrCss, /\.p7-note textarea\{font-size:16px!important\}/);
assert.match(qrCss, /--p7-visual-bottom/);
assert.match(qrCss, /--p7-visual-height/);

assert.match(qrUx, /VANTIX_RESTAURANT_V2_CLIENT_ADAPTIVE_VIEWPORT_V13/);
assert.match(qrUx, /window\.visualViewport/);
assert.match(qrUx, /--p7-visual-height/);
assert.match(qrUx, /--p7-visual-bottom/);

assert.match(qrHtml, /interactive-widget=resizes-content/);
assert.match(qrHtml, /p7-v13/);
assert.match(qrHtml, /v13-adaptive/);

console.log('Restaurant V2 adaptive keyboard V13 smoke: OK');
