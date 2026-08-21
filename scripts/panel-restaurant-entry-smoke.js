const assert = require('node:assert/strict');
const fs = require('node:fs');
const script = fs.readFileSync('src/web/panel-restaurant-entry.js','utf8');

// Shared Core navigation parity applies to every tenant before Restaurant access
// is evaluated. This prevents the legacy panel SPA from shadowing the complete
// Accounting and Advanced Configuration applications.
assert.ok(script.includes('installCoreNavigationParity'));
assert.ok(script.includes("'/app/contabilidad'"));
assert.ok(script.includes("label.textContent = 'Contabilidad'"));
assert.ok(script.includes("removeAttribute('data-nav')"));
assert.ok(script.includes("'/app/configuracion-avanzada'"));
assert.ok(script.includes('Configuración avanzada'));

// Restaurant remains an additive permission-backed vertical entry.
assert.ok(script.includes("'/api/v1/restaurante/ui-context'"));
assert.ok(script.includes("'/app/restaurante'"));
assert.ok(script.includes('data-restaurant-entry'));
assert.ok(script.includes('Abrir Restaurante'));
assert.ok(!script.includes("rol === 'ADMIN'"), 'Restaurant visibility must be permission-backed, not hardcoded to ADMIN');

console.log('PANEL SHARED CORE PARITY + RESTAURANT ENTRY SMOKE OK');