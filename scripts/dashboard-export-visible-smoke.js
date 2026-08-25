const assert = require('node:assert/strict');
const fs = require('node:fs');

const dashboard = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
const loader = fs.readFileSync('src/web/panel-integration-extras.js', 'utf8');
const routes = fs.readFileSync('src/modules/commercial/commercial.routes.js', 'utf8');

// El Dashboard tiene un único dueño. Los botones se renderizan junto con el
// contenido y usan un listener delegado estable que sobrevive a innerHTML.
assert.ok(dashboard.includes("window.VantixGCCoreDashboardOwner = 'panel-restaurant-entry.js'"));
assert.ok(dashboard.includes('data-dashboard-actions="single-owner-v1"'));
assert.ok(dashboard.includes('data-dashboard-format="excel"'));
assert.ok(dashboard.includes('data-dashboard-format="pdf"'));
assert.ok(dashboard.includes('Exportar Excel'));
assert.ok(dashboard.includes('Exportar PDF'));
assert.ok(dashboard.includes('/api/v1/comercial/ventas/dashboard/exportar?formato='));
assert.ok(dashboard.includes('function installDashboardEvents()'));
assert.ok(dashboard.includes("document.addEventListener('click'"));
assert.ok(dashboard.includes('data-dashboard-route'));

// Las capas viejas quedan retiradas: el loader de integración no toca Dashboard
// y ya no existe un runtime secundario dashboard-interactions.js.
assert.ok(!loader.includes('Dashboard'));
assert.ok(!loader.includes('Exportar Excel'));
assert.ok(!loader.includes('setInterval'));
assert.ok(!loader.includes('dashboard-interactions.js'));
assert.ok(!routes.includes('dashboard-interactions.js'));
assert.equal(fs.existsSync('src/web/dashboard-interactions.js'), false);
assert.ok(!dashboard.includes('MutationObserver'));
assert.ok(!dashboard.includes('setInterval'));

new Function(dashboard);
new Function(loader);
console.log('DASHBOARD SINGLE OWNER + ALWAYS VISIBLE EXPORT SMOKE OK');
