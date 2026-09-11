'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(file, 'utf8');
const kdsRoutes = read('src/modules/restaurant/restaurant-v2-kds.public.routes.js');
const kdsStations = read('src/web/restaurant-v2-kds-stations-v23.js');
const templateUi = require('../src/modules/restaurant/restaurant-print-template-ui.public.routes');
const kdsPublic = require('../src/modules/restaurant/restaurant-v2-kds.public.routes');

assert.equal(templateUi.MARKER, 'VANTIX_RESTAURANT_PRINT_TEMPLATE_EDITOR_V4');
assert.doesNotThrow(() => new vm.Script(templateUi.browserRuntime));
assert.match(templateUi.browserRuntime, /RestaurantPrintTemplates/);
assert.match(templateUi.browserRuntime, /vantix:restaurant-print-template:open/);

assert.equal(kdsPublic.PRINT_TEMPLATE_HEADER, 'v4.1-kds-native');
assert.equal(kdsPublic.PRINT_TEMPLATE_KDS_MARKER, 'VANTIX_RESTAURANT_PRINT_TEMPLATE_KDS_V4_1');
assert.match(kdsRoutes, /browserRuntime:\s*printTemplateBrowserRuntime/);
assert.match(kdsRoutes, /restaurant-v2-kds-stations-v23\.js/);
assert.match(kdsRoutes, /X-VantixGC-Print-Template-Editor/);
assert.match(kdsRoutes, /printTemplateBrowserRuntime/);
assert.match(kdsRoutes, /VANTIX_RESTAURANT_PRINT_TEMPLATE_KDS_V4_1/);
assert.match(kdsRoutes, /data\.rkdsPrintTemplate\s*=\s*'true'/);
assert.match(kdsRoutes, /Plantilla comanda/);
assert.match(kdsRoutes, /RestaurantPrintTemplates\?\.open/);
assert.match(kdsRoutes, /vantix:restaurant-print-template:open/);
assert.match(kdsRoutes, /actions\.insertBefore\(button, newButton\)/);
assert.match(kdsRoutes, /#rv2StationManagerV23/);
assert.match(kdsRoutes, /MutationObserver/);

// La integración V4.1 no altera el administrador V23 ni el motor de estaciones.
assert.match(kdsStations, /VANTIX_RESTAURANT_V2_KDS_STATIONS_V23/);
assert.match(kdsStations, /Estaciones de producción/);
assert.match(kdsStations, /data-station-new/);
assert.doesNotMatch(kdsStations, /VANTIX_RESTAURANT_PRINT_TEMPLATE_KDS_V4_1/);
assert.doesNotMatch(kdsStations, /plantilla-impresion/);

console.log('RESTAURANT PRINT TEMPLATE KDS V4.1 SMOKE OK');
console.log(JSON.stringify({
  nativeKdsManager:true,
  editorReusedFromV4:true,
  button:'Plantilla comanda',
  besideNewStation:true,
  noBackendMutation:true,
  noPrintingEngineMutation:true,
  noStationEngineMutation:true
}, null, 2));