'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const menuSurface = require('../src/modules/restaurant/restaurant-menu-surface-sync.public.routes');
const globalSearch = require('../src/modules/restaurant/restaurant-global-product-search-v57.public.routes');
const attention = require('../src/modules/restaurant/restaurant-account-attention-v58.public.routes');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const desktopV10 = menuSurface.patchDesktopRuntime(read('src/web/restaurant-ui.js'));
const desktopV57 = globalSearch.patchOperatorSource(desktopV10);
const desktop = attention.patchOperatorSource(desktopV57);
assert.ok(desktop.includes(attention.MARKER));
assert.ok(desktop.includes('accountAttentionActive(table)'));
assert.ok(desktop.includes('table.activeSession.accountRequestedAt'));
assert.ok(desktop.includes("String(table.state || '') === 'CUENTA_PEDIDA'"));
assert.ok(desktop.includes('ACCOUNT_ATTENTION'));
assert.ok(desktop.includes('CUENTA SOLICITADA'));
assert.ok(desktop.includes('COBRAR '));
assert.ok(desktop.includes('Cuenta solicitada · abrir Caja'));
assert.ok(desktop.includes("can('RESTAURANTE.CERRAR') && can('TESORERIA.CERRAR')"));
assert.ok(desktop.includes("setTab('caja')"));
assert.ok(desktop.includes('setInterval(() => refreshAccountAttentionDock().catch(() => {}), 2500)'));
assert.ok(desktop.includes('prefers-reduced-motion:reduce'));
assert.ok(desktop.includes(globalSearch.MARKER), 'V58 debe preservar V57');
assert.ok(desktop.includes(menuSurface.MARKER), 'V58 debe preservar Menu Surfaces');

const waiterV10 = menuSurface.patchWaiterTabletRuntime(read('src/web/restaurant-waiter-runtime-v7.js'));
const waiterV57 = globalSearch.patchDedicatedWaiterSource(waiterV10);
const waiter = attention.patchDedicatedWaiterSource(waiterV57);
assert.ok(waiter.includes(attention.MARKER));
assert.ok(waiter.includes('wv-table.ACCOUNT_ATTENTION'));
assert.ok(waiter.includes("if (accountAttentionActive(table)) return 'CUENTA SOLICITADA'"));
assert.ok(waiter.includes('row.activeSession?.accountRequestedAt'));
assert.ok(waiter.includes(globalSearch.MARKER), 'Tablet debe conservar búsqueda global V57');

function active(table) {
  return Boolean(table?.activeSession && (String(table.state || '') === 'CUENTA_PEDIDA' || table.activeSession.accountRequestedAt));
}
assert.equal(active({ state:'OCUPADA', activeSession:{ id:'s1', accountRequestedAt:'2026-09-07T20:00:00Z' } }), true, 'solicitud del cliente debe encender atención aunque la mesa siga OCUPADA');
assert.equal(active({ state:'CUENTA_PEDIDA', activeSession:{ id:'s2', accountRequestedAt:null } }), true, 'solicitud del mesero debe encender atención');
assert.equal(active({ state:'OCUPADA', activeSession:{ id:'s3', accountRequestedAt:null } }), false);
assert.equal(active({ state:'LIBRE', activeSession:null }), false, 'al cerrar la mesa debe desaparecer la atención');

const routes = read('src/modules/restaurant/restaurant.public.routes.js');
const v58 = routes.indexOf('router.use(installRestaurantAccountAttentionV58);');
const v57 = routes.indexOf('router.use(installRestaurantGlobalProductSearchV57);');
assert.ok(v58 >= 0 && v57 >= 0 && v58 < v57, 'V58 debe envolver el asset final después de V57 por unwind inverso');

console.log('RESTAURANT ACCOUNT ATTENTION V58 CLIENT+WAITER+FLOATING CASH CONTRACT OK');
