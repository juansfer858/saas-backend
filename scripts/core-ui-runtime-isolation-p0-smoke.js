'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const restaurant = read('src/web/panel-restaurant-entry.js');
const loader = read('src/web/panel-integration-extras.js');
const accounting = read('src/web/panel-integration-extras-core.js');

new Function(restaurant);
new Function(loader);
new Function(accounting);

// Restaurant may navigate to its own surfaces, but it must not own, rename or
// repair the shared Accounting/Configuration screen.
assert.doesNotMatch(restaurant, /renameAccountingConfigurationHeading/);
assert.doesNotMatch(restaurant, /Parametrización Contable/);

// Accounting is a critical Core runtime and loads before optional realtime /
// printing integrations. Optional failures must not suppress the Accounting UI.
assert.match(loader, /function loadRuntimeIsolated\(/);
assert.match(loader, /SUPER_CORE_ACCOUNTING_RUNTIME_ERROR/);
assert.match(loader, /VantixGCCoreRuntimeIsolationP0/);
assert.match(loader, /accountingIndependent:\s*true/);
assert.match(loader, /optionalRuntimesIsolated:\s*true/);
assert.match(loader, /viewAccountingRuntimeUnavailable/);
assert.match(loader, /No se mostrará Configuración de empresa como sustituto/);
assert.doesNotMatch(loader, /const \[realtime, realtimePanel, core, printing\]\s*=\s*await Promise\.all/);

const accountingLoad = loader.indexOf("'/api/v1/comercial/ui-runtime/panel-integration-extras-core.js'");
const optionalLoad = loader.indexOf('await Promise.all([', accountingLoad);
assert.ok(accountingLoad >= 0, 'Debe existir la carga del runtime contable');
assert.ok(optionalLoad > accountingLoad, 'Contabilidad debe cargarse antes de los runtimes opcionales');

// The Accounting integration owns its own title and operational mappings.
assert.match(accounting, /<h1>Parametrización Contable<\/h1>/);
assert.match(accounting, /\/api\/v1\/contabilidad\/integracion\/estado/);
assert.match(accounting, /\/api\/v1\/contabilidad\/mapeos\//);
assert.match(accounting, /Cuenta PUC por Caja \/ Banco/);
assert.match(accounting, /VENTAS:'Ventas'/);
assert.match(accounting, /COMPRAS:'Compras'/);
assert.match(accounting, /INVENTARIO:'Inventario \/ Kardex'/);
assert.match(accounting, /TESORERIA:'Tesorería & Bancos'/);
assert.match(accounting, /CARTERA:'Cartera'/);

console.log('CORE UI RUNTIME ISOLATION P0 SMOKE OK', JSON.stringify({
  restaurantCannotRenameAccounting: true,
  accountingLoadsIndependently: true,
  optionalRuntimesCannotSuppressAccounting: true,
  accountingOwnsItsHeading: true,
  accountingFailureDoesNotMasqueradeAsCompanyConfig: true
}));
