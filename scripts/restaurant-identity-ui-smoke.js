const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'src/web/restaurant.html'), 'utf8');
const qrHtml = fs.readFileSync(path.join(ROOT, 'src/web/restaurant-qr.html'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'src/web/restaurant-ui.js'), 'utf8');
const qr = fs.readFileSync(path.join(ROOT, 'src/web/restaurant-qr-ui.js'), 'utf8');
const theme = fs.readFileSync(path.join(ROOT, 'src/web/restaurant-theme.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/web/restaurant-theme.css'), 'utf8');

assert.ok(html.includes('/app/restaurant-theme.css?v=la-riel-v1'));
assert.ok(html.includes('/app/restaurant-theme.js?v=panel-font-v1'));
assert.ok(html.includes('/app/restaurant-control-center.css?v=workspace-v7-kds'));
assert.ok(html.includes('/app/restaurant-ui.js?v=kds-v2'));
assert.ok(!html.includes('<style>'), 'Restaurant shell must not own theme CSS');
assert.ok(!html.includes('font-family:Lora,Georgia,serif'), 'Restaurant shell must not retain the old serif Edge banner');
assert.ok(qrHtml.includes('/app/restaurant-theme.css'));
assert.ok(qrHtml.includes('/app/restaurant-theme.js?v=panel-font-v1'));
assert.ok(qrHtml.includes('/app/restaurant-qr-ui.js'));
assert.ok(!qrHtml.includes('<style>'), 'QR shell must share the same theme file');

for (const endpoint of [
  '/api/v1/restaurante/ui-context',
  '/api/v1/restaurante/mesas',
  '/api/v1/restaurante/menu',
  'pedido-borrador',
  '/api/v1/restaurante/comandas',
  '/api/v1/restaurante/caja/turnos/',
  '/api/v1/tesoreria/cajas-bancos'
]) assert.ok(ui.includes(endpoint), `Connected UI must consume ${endpoint}`);
assert.ok(ui.includes("S.context.polling.kdsMs || 2000"));
assert.ok(ui.includes("String(command.order?.source || '').toUpperCase() === 'QR'"));
assert.ok(ui.includes('📱 vía autopedido QR'));
assert.ok(ui.includes("can('MESAS.VER') && can('PEDIDOS.CREAR')"));
assert.ok(ui.includes("can('COMANDAS.EDITAR')"));
assert.ok(ui.includes("can('RESTAURANTE.CERRAR') && can('TESORERIA.CERRAR')"));
assert.match(ui, /const diff = number\(raw\) - number\(summary\?\.systemCashExpected\)/);
assert.ok(ui.includes('restaurantClosedTablesTotal'));
assert.ok(ui.includes('restaurantCashRecorded'));
assert.ok(!ui.includes('summary?.paymentBreakdown'), 'Connected Caja must not depend on a non-existent summary field');
assert.doesNotMatch(ui, /#[0-9a-fA-F]{6}/, 'Data/UI logic must not hardcode theme colors');
assert.doesNotMatch(qr, /#[0-9a-fA-F]{6}/, 'QR logic must not hardcode theme colors');

assert.ok(qr.includes('/api/public/restaurante/qr/'));
assert.ok(qr.includes('RestaurantTheme?.apply(ctx.theme)'));
assert.ok(qr.includes('confirmedTotal:total()'));

assert.ok(theme.includes("root.style.setProperty('--paper'"));
assert.ok(theme.includes("root.style.setProperty('--ink'"));
assert.ok(theme.includes("root.style.setProperty('--ember'"));
assert.ok(theme.includes("root.style.setProperty('--brass'"));
assert.ok(theme.includes("root.style.setProperty('--verdigris'"));
assert.ok(theme.includes("root.style.setProperty('--oxblood'"));
assert.ok(css.includes('var(--restaurant-font-family,'));
assert.ok(css.includes('Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'));
assert.ok(!css.includes('Fraunces'));
assert.ok(!css.includes('JetBrains Mono'));

new Function(ui);
new Function(qr);
new Function(theme);

console.log('RESTAURANT IDENTITY UI SMOKE OK');
