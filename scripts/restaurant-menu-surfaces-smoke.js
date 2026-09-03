'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const syncService = require('../src/modules/restaurant/restaurant-menu-surface-sync.service');
const {
  MARKER,
  patchDesktopRuntime,
  patchWaiterTabletRuntime,
  patchQrRuntime
} = require('../src/modules/restaurant/restaurant-menu-surface-sync.public.routes');
const { waiterRuntimeV14 } = require('../src/modules/restaurant/restaurant-waiter-device.public.routes');

const tables = [
  { id:'10', name:'Mesa 10', code:'M10' },
  { id:'2', name:'Mesa 2', code:'M2' },
  { id:'1', name:'Mesa 1', code:'M1' },
  { id:'20', name:'Mesa 20', code:'M20' },
  { id:'11', name:'Mesa 11', code:'M11' }
].sort(syncService.tableNaturalCompare);
assert.deepEqual(tables.map((row) => row.name), ['Mesa 1','Mesa 2','Mesa 10','Mesa 11','Mesa 20']);

const menu = syncService.decorateMenuRows([
  { id:'b', category:'POSTRES', sortOrder:2, creadoEn:new Date('2026-01-01'), product:{ descripcion:'Categoría de carta: Tulipanes - Postres' } },
  { id:'a', category:'POSTRES', sortOrder:0, creadoEn:new Date('2026-01-01'), product:{ descripcion:'Categoría de carta: Girasoles - Helados' } },
  { id:'c', category:'BEBIDAS', sortOrder:1, creadoEn:new Date('2026-01-01'), product:{ descripcion:'Categoría de carta: Magnolias - Bebidas Calientes' } },
  { id:'d', category:'FUERTES', sortOrder:3, creadoEn:new Date('2026-01-01'), product:{ descripcion:'Producto manual' } }
]);
assert.deepEqual(menu.map((row) => row.id), ['a','c','b','d']);
assert.deepEqual(menu.map((row) => row.displayCategory), [
  'Girasoles - Helados',
  'Magnolias - Bebidas Calientes',
  'Tulipanes - Postres',
  'FUERTES'
]);
assert.equal(menu[0].category, 'POSTRES', 'operational category must remain intact');

const desktopSource = fs.readFileSync('src/web/restaurant-ui.js', 'utf8');
const desktop = patchDesktopRuntime(desktopSource);
assert.match(desktop, new RegExp(`${MARKER}_DESKTOP`));
assert.match(desktop, /displayCategory \|\| item\?\.category/);
assert.match(desktop, /waiterMenuCategories\(\)/);
assert.doesNotMatch(desktop, /\['ENTRADAS','FUERTES','BEBIDAS','POSTRES'\]\.map\(\(cat\)/);
assert.doesNotThrow(() => new vm.Script(desktop), 'desktop waiter asset must remain valid JavaScript');

const tabletBase = fs.readFileSync('src/web/restaurant-waiter-runtime-v7.js', 'utf8');
const tabletV14 = waiterRuntimeV14(tabletBase);
const tablet = patchWaiterTabletRuntime(tabletV14);
assert.match(tablet, new RegExp(`${MARKER}_TABLET`));
assert.match(tablet, /function menuCategories\(\)/);
assert.match(tablet, /menuDisplayCategory\(item\) === S\.category/);
assert.doesNotMatch(tablet, /const CATEGORIES = \['ENTRADAS','FUERTES','BEBIDAS','POSTRES'\]/);
assert.match(tablet, /VANTIX_WAITER_ORDER_REVIEW_HARD_GATE_V14/);
assert.doesNotThrow(() => new vm.Script(tablet), 'final tablet runtime must remain valid JavaScript');

const qrSource = fs.readFileSync('src/web/restaurant-qr-ui.js', 'utf8');
const qr = patchQrRuntime(qrSource);
assert.match(qr, new RegExp(`${MARKER}_QR`));
assert.match(qr, /function categoryFilters\(\)/);
assert.match(qr, /menuDisplayCategory\(item\) === S\.filter/);
assert.doesNotMatch(qr, /\{ id:'ENTRADAS', label:'ENTRADAS' \}/);
assert.doesNotThrow(() => new vm.Script(qr), 'QR asset must remain valid JavaScript');

console.log('RESTAURANT MENU SURFACES SMOKE OK', JSON.stringify({
  marker:MARKER,
  tableOrder:tables.map((row) => row.name),
  displayCategories:menu.map((row) => row.displayCategory),
  surfaces:['DESKTOP_WAITER','WAITER_TABLET','CLIENT_QR']
}));
