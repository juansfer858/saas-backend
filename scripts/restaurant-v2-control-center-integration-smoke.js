'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path){return fs.readFileSync(path,'utf8')}

const aggregator=read('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js');
const router=read('src/modules/restaurant/restaurant-v2-control-center.public.routes.js');
const bridge=read('src/web/restaurant-v2-control-center-bridge.js');
const sdk=read('src/web/restaurant-v2-sdk.js');

assert.match(aggregator,/restaurantV2ControlCenterPublicRouter/);
assert.match(aggregator,/use\(restaurantV2ControlCenterPublicRouter\)/);
assert.match(router,/\/app\/centro-de-control/);
assert.match(router,/restaurant-v2-control-center-bridge\.js/);
assert.match(router,/v2-control-center-bridge-p6-5/);

for(const route of [
  '/app/restaurante-v2/mesas',
  '/app/restaurante-v2/pedidos',
  '/app/restaurante-v2/kds',
  '/app/restaurante-v2/caja',
  '/app/restaurante-v2/division'
]) assert.ok(bridge.includes(route),`Falta ruta V2 ${route}`);

assert.match(bridge,/VANTIX_RESTAURANT_V2_CONTROL_CENTER_BRIDGE_P6_5/);
assert.match(bridge,/data-v2-workspace/);
assert.match(bridge,/data-v2-frame/);
assert.match(bridge,/← Centro de control/);
assert.match(bridge,/history\.replaceState/);
assert.doesNotMatch(bridge,/MutationObserver|setInterval|POLL_MS/);
assert.match(sdk,/version:'1\.0\.0'/);
assert.doesNotMatch(sdk,/MutationObserver|setInterval|document\.querySelector|innerHTML/);

console.log(JSON.stringify({ok:true,marker:'RESTAURANT_V2_CONTROL_CENTER_INTEGRATION_OK',routes:5,embeddedWorkspace:true,returnToControlCenter:true,sdkDomFree:true}));
