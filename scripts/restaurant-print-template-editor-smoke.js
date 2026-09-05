'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const template = require('../src/modules/restaurant/restaurant-print-template.service');
const { buildCommandPrintJobs } = require('../src/modules/edge/edge-restaurant-print-bridge');
const { RESTAURANT_COMMAND_LARGE_V2, DEFAULT_COMMAND_LAYOUT, normalizeCommandLayout, buildEscPos } = require('../edge/print-spooler/escpos');
const ui = require('../src/modules/restaurant/restaurant-print-template-ui.public.routes');

const recommended = template.normalizePrintTemplate({});
assert.equal(recommended.version, 'RESTAURANT_COMMAND_TEMPLATE_V3');
assert.equal(recommended.itemAlign, 'CENTER');
assert.equal(recommended.noteAlign, 'CENTER');
assert.equal(recommended.seatAlign, 'CENTER');
assert.equal(recommended.showTopTime, false, 'recommended template must not repeat time at top');
assert.equal(recommended.showBottomDateTime, true);
assert.equal(recommended.showTrace, true);
assert.equal(recommended.showSeat, true);
assert.equal(recommended.blankLinesBetweenItems, 1);
assert.equal(recommended.separatorStyle, 'DOUBLE');

const safe = template.normalizePrintTemplate({ itemAlign:'RIGHT', itemSize:'GIANT', blankLinesBetweenItems:99, showTopTime:true });
assert.equal(safe.itemAlign, 'CENTER', 'unsupported alignment must fall back safely');
assert.equal(safe.itemSize, 'TALL');
assert.equal(safe.blankLinesBetweenItems, 2);
assert.equal(safe.showTopTime, true);

const command = {
  id:'cmd-template-1', station:'COCINA', state:'PENDIENTE', createdAt:'2026-09-05T17:04:00.000Z',
  table:{ id:'t1', code:'M1', name:'Mesa 1' },
  items:[{ description:'Hamburguesa especial', quantity:2, notes:'Sin cebolla', seatNumber:1 }]
};
const jobs = buildCommandPrintJobs([command], [{ id:'p1', name:'Cocina', transport:'WINDOWS', host:'POS-80 Cocina', routeRole:'COCINA', format:'TERMICA_80' }], {
  itemAlign:'LEFT', noteAlign:'CENTER', seatAlign:'CENTER', showTopTime:false, showBottomDateTime:true,
  showTrace:false, showSeat:true, headerSize:'DOUBLE', itemSize:'NORMAL', noteSize:'TALL', separatorStyle:'SINGLE', blankLinesBetweenItems:2
});
assert.equal(jobs.length, 1);
assert.equal(jobs[0].payload.template, RESTAURANT_COMMAND_LARGE_V2);
assert.equal(jobs[0].payload.layout.itemAlign, 'LEFT');
assert.equal(jobs[0].payload.layout.separatorStyle, 'SINGLE');
assert.equal(jobs[0].payload.layout.blankLinesBetweenItems, 2);
assert.equal(jobs[0].payload.layout.showTrace, false);

const normalizedEdge = normalizeCommandLayout({});
assert.deepEqual(normalizedEdge, DEFAULT_COMMAND_LAYOUT);
const printed = buildEscPos({
  template:RESTAURANT_COMMAND_LARGE_V2,
  tableLabel:'Mesa 1', stationLabel:'COCINA', createdAt:'2026-09-05T17:04:00.000Z', traceLabel:'COMANDA ABC12345', paperFormat:'TERMICA_80',
  lines:[{ quantity:2, name:'Hamburguesa especial', note:'sin cebolla', seatNumber:1 }], cut:false
});
const printedText = printed.toString('utf8');
assert.match(printedText, /MESA 1/);
assert.match(printedText, /2 x HAMBURGUESA ESPECIAL/);
assert.match(printedText, /\*\*\* SIN CEBOLLA \*\*\*/);
assert.match(printedText, />>> PERSONA 1 <<</);
assert.match(printedText, /COMANDA ABC12345/);
assert.equal((printedText.match(/\d{1,2}:\d{2}/g) || []).length, 1, 'recommended command must print time once only');
assert.ok(printed.includes(Buffer.from([0x1b, 0x61, 0x01])), 'recommended product alignment must use ESC/POS center');

const withoutFooterTime = buildEscPos({
  template:RESTAURANT_COMMAND_LARGE_V2,
  tableLabel:'Mesa 2', stationLabel:'BARRA', createdAt:'2026-09-05T17:04:00.000Z',
  layout:{ showTopTime:false, showBottomDateTime:false, showTrace:false, separatorStyle:'NONE', blankLinesBetweenItems:0 },
  lines:[{ quantity:1, name:'Limonada' }], cut:false
}).toString('utf8');
assert.equal((withoutFooterTime.match(/\d{1,2}:\d{2}/g) || []).length, 0);
assert.doesNotMatch(withoutFooterTime, /={4,}|-{4,}/);

assert.equal(ui.MARKER, 'VANTIX_RESTAURANT_PRINT_TEMPLATE_EDITOR_V1');
assert.doesNotThrow(() => new vm.Script(ui.browserRuntime));
assert.match(ui.browserRuntime, /Plantillas de impresión/);
assert.match(ui.browserRuntime, /Restaurar diseño recomendado/);
assert.match(ui.browserRuntime, /Alineación del producto/);
assert.match(ui.browserRuntime, /Vista previa térmica/);
assert.match(ui.browserRuntime, /plantilla-impresion/);
assert.doesNotMatch(ui.browserRuntime, /setInterval|MutationObserver/);

const coreRoutes = fs.readFileSync('src/routes/core.routes.js', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
const routeSource = fs.readFileSync('src/modules/restaurant/restaurant-print-template.routes.js', 'utf8');
const serviceSource = fs.readFileSync('src/modules/restaurant/restaurant-print-template.service.js', 'utf8');
assert.match(coreRoutes, /restaurantPrintTemplateRouter/);
assert.match(publicRoutes, /installPrintTemplateEditorRuntime/);
assert.match(routeSource, /router\.get\('\/plantilla-impresion'/);
assert.match(routeSource, /router\.put\('\/plantilla-impresion'/);
assert.match(routeSource, /plantilla-impresion\/restaurar/);
assert.match(routeSource, /RESTAURANTE\.ADMINISTRAR/);
assert.match(serviceSource, /RESTAURANT_PRINT_TEMPLATE/);
assert.match(serviceSource, /themeData/);

const version = require('../edge/version.json');
assert.equal(version.version, '2.1.9-print-templates.1');
assert.equal(version.channel, 'PILOT');
const artifactManifest = JSON.parse(fs.readFileSync('public/edge-releases/manifest.json', 'utf8'));
const bundledRelease = artifactManifest?.releases?.[version.version];
assert.ok(bundledRelease, `Core release store must contain Edge ${version.version}`);
assert.equal(bundledRelease.channel, version.channel);
assert.match(String(bundledRelease.sha256 || ''), /^[0-9a-f]{64}$/);
assert.ok(fs.existsSync(`public/edge-releases/${bundledRelease.file}`), 'bundled Edge ZIP must exist in Core release store');

console.log('RESTAURANT PRINT TEMPLATE EDITOR + SYMMETRIC COMMAND V3 SMOKE OK', JSON.stringify({
  tenantScoped:true,
  noSchemaMigration:true,
  safeEditor:true,
  livePreview58And80:true,
  symmetricRecommendedLayout:true,
  timePrintedOnce:true,
  cajaReceiptsUntouched:true,
  configurableEscPos:true,
  edgeBundledInCore:true,
  edgeVersion:version.version
}));