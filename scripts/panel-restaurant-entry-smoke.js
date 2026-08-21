const assert = require('node:assert/strict');
const fs = require('node:fs');
const script = fs.readFileSync('src/web/panel-restaurant-entry.js','utf8');
assert.ok(script.includes("'/api/v1/restaurante/ui-context'"));
assert.ok(script.includes("'/app/restaurante'"));
assert.ok(script.includes('data-restaurant-entry'));
assert.ok(script.includes('Abrir Restaurante'));
assert.ok(!script.includes("rol === 'ADMIN'"), 'Restaurant visibility must be permission-backed, not hardcoded to ADMIN');
console.log('PANEL RESTAURANT ENTRY SMOKE OK');
