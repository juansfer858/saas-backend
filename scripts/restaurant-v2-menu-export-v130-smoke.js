'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('src/web/restaurant-v2-menu.html', 'utf8');
const client = fs.readFileSync('src/web/restaurant-v2-menu-export-v130.js', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-v2-menu.public.routes.js', 'utf8');
const apiRoutes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.routes.js', 'utf8');
const service = fs.readFileSync('src/modules/restaurant/restaurant-menu-export.service.js', 'utf8');

assert.match(html, /id="exportCarta"[^>]*>Exportar Excel<\/button>/);
assert.match(html, /restaurant-v2-menu-export-v130\.js\?v=v130/);
assert.match(publicRoutes, /restaurant-v2-menu-export-v130\.js/);

assert.match(client, /VANTIX_RESTAURANT_V2_MENU_EXPORT_V130/);
assert.match(client, /\/api\/v1\/restaurante\/carta-importacion\/exportar/);
assert.match(client, /response\.blob\(\)/);
assert.match(client, /link\.download = downloadName/);
assert.match(client, /readOnly:true/);
assert.doesNotThrow(() => new vm.Script(client));

assert.match(apiRoutes, /router\.get\('\/carta-importacion\/exportar'/);
assert.match(apiRoutes, /requirePermission\('RESTAURANTE\.ADMINISTRAR'\)/);
assert.match(apiRoutes, /application\/vnd\.ms-excel/);
assert.match(apiRoutes, /X-VantixGC-Restaurant-Menu-Export/);

assert.match(service, /menuImport\.listCarta\(tenantId\)/);
assert.match(service, /commercialCategories\.decorateCartaRows\(tenantId, rows\)/);
for (const column of ['Categoría','Producto / Variante','Precio','Categoría operativa','Estación','Confianza']) {
  assert.ok(service.includes(column), `falta columna ${column}`);
}
assert.match(service, /toExcelHtml/);
assert.match(service, /Carta_\$\{date\}\.xls/);
assert.doesNotMatch(service, /(?:prisma|client)\.[a-zA-Z0-9_]+\.(?:create|update|delete|upsert)\s*\(/);

console.log('RESTAURANT V2 MENU EXPORT V130 SMOKE OK', JSON.stringify({
  button:true,
  activeCarta:true,
  commercialCategories:true,
  canonicalColumns:true,
  excelDownload:true,
  readOnly:true,
  javascriptCompiles:true
}));
