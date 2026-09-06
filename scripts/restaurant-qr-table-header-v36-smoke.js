'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MARKER, runtime } = require('../src/modules/restaurant/restaurant-qr-table-header.public.routes');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const mobileFit = read('src/web/restaurant-qr-mobile-fit.js');
const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');

assert.equal(MARKER, 'VANTIX_QR_TABLE_HEADER_V36');
new Function(runtime);
assert.match(runtime, /minmax\(116px,42%\)/);
assert.match(runtime, /\.qrv3-table\{width:100%!important;min-width:116px!important;max-width:none!important/);
assert.match(runtime, /\.qrv3-table>div:last-child\{min-width:0!important;flex:1 1 auto!important/);
assert.match(runtime, /font-size:clamp\(15px,4\.8vw,20px\)!important/);
assert.match(runtime, /overflow-wrap:anywhere!important/);
assert.match(runtime, /@media\(max-width:390px\)/);
assert.match(runtime, /minmax\(108px,44%\)/);
assert.match(publicRoot, /installQrTableHeaderRuntime/);
assert.match(mobileFit, /max-width:94px!important/);
assert.match(mobileFit, /max-width:86px!important/);

console.log(JSON.stringify({
  ok:true,
  marker:MARKER,
  mobileTableColumn:'116px..42%',
  smallPhoneTableColumn:'108px..44%',
  legacyNarrowCapsOverridden:true,
  tableNameWrapsInsideCard:true
}, null, 2));
