const assert = require('node:assert/strict');
const fs = require('node:fs');

const loader = fs.readFileSync('src/web/panel-integration-extras.js', 'utf8');

assert.ok(loader.includes('installPersistentDashboardExportActions'));
assert.ok(loader.includes('data-dashboard-direct-export="excel"'));
assert.ok(loader.includes('data-dashboard-direct-export="pdf"'));
assert.ok(loader.includes('Exportar Excel'));
assert.ok(loader.includes('Exportar PDF'));
assert.ok(loader.includes('/api/v1/comercial/ventas/dashboard/exportar?formato='));
assert.ok(loader.includes('ensureDashboardExportActions'));
new Function(loader);

console.log('DASHBOARD VISIBLE EXCEL/PDF EXPORT SMOKE OK');
