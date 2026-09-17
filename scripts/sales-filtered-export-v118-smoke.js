'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const pageSource = fs.readFileSync('src/web/sales.html', 'utf8');
const routeSource = fs.readFileSync('src/modules/commercial/commercial.routes.js', 'utf8');
const controllerSource = fs.readFileSync('src/modules/commercial/sales.controller.js', 'utf8');
const exportSource = fs.readFileSync('src/modules/commercial/sales-list-export.service.js', 'utf8');

assert.match(pageSource, /VANTIX_SALES_FILTERED_EXPORT_V118/);
assert.ok(pageSource.includes('>Exportar Excel</button>'));
assert.ok(pageSource.includes('function salesFilterQuery(capture=true)'));
for (const pair of [
  "['fCustomer','terceroId']",
  "['fState','estado']",
  "['fFrom','desde']",
  "['fTo','hasta']"
]) assert.ok(pageSource.includes(pair), `falta filtro ${pair}`);
assert.ok(pageSource.includes('/api/v1/comercial/ventas/exportar?'));
assert.ok(pageSource.includes("initialFilters.get('desde')"));
assert.ok(pageSource.includes("initialFilters.get('hasta')"));
assert.ok(pageSource.includes('value="${esc(st.filters.desde)}"'));
assert.ok(pageSource.includes('value="${esc(st.filters.hasta)}"'));
assert.ok(pageSource.includes('st.meta=r.meta'));
assert.match(pageSource, /VANTIX_SALES_DOCUMENT_DETAIL_REPRINT_V2/, 'la exportación no debe remover el detalle/reimpresión V2');
assert.ok(pageSource.includes('id="reprintDocument"'), 'la exportación no debe remover Reimprimir');

const scriptMatch = pageSource.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, 'sales.html debe conservar el script principal');
assert.doesNotThrow(() => new Function(scriptMatch[1]), 'el JavaScript de Ventas debe compilar');

const exportRoute = routeSource.indexOf("router.get('/ventas/exportar', salesController.exportList)");
const idRoute = routeSource.indexOf("router.get('/ventas/:id', salesController.get)");
assert.ok(exportRoute >= 0, 'debe existir GET /ventas/exportar');
assert.ok(idRoute >= 0 && exportRoute < idRoute, '/ventas/exportar debe declararse antes de /ventas/:id');
assert.match(controllerSource, /salesListExport\.exportFilteredSales\(req\.tenantId, req\.query\)/);
assert.match(controllerSource, /X-VantixGC-Sales-Filtered-Export/);
assert.match(controllerSource, /application\/vnd\.ms-excel/);

assert.match(exportSource, /queryService\.list/,'la exportación debe reutilizar el filtro canónico de Ventas');
assert.match(exportSource, /PAGE_SIZE = 200/);
assert.match(exportSource, /MAX_EXPORT_ROWS = 50000/);
assert.match(exportSource, /total > MAX_EXPORT_ROWS/,'debe limitar exportaciones masivas');
assert.match(exportSource, /for \(let page = 2; page <= pages; page \+= 1\)/,'debe recorrer todas las páginas');
assert.match(exportSource, /items\.push\(\.\.\.next\.items\)/,'debe acumular cada página del filtro');
assert.match(exportSource, /\.\.\.filters, page: 1, pageSize: PAGE_SIZE/,'la primera página debe conservar todos los filtros');
assert.match(exportSource, /\.\.\.filters, page, pageSize: PAGE_SIZE/,'las páginas siguientes deben conservar todos los filtros');
assert.match(exportSource, /SALES_EXPORT_RANGE_TOO_LARGE/);
assert.match(exportSource, /toExcelHtml/);
for (const column of ['Número','Fecha','Cliente','Estado','DIAN','Medio de pago','Total','Saldo']) {
  assert.ok(exportSource.includes(column), `falta columna ${column}`);
}
assert.match(exportSource, /paymentLabel\(doc\.formaPago\)/,'el Excel debe incluir el medio de pago');
assert.match(exportSource, /customerLabel\(doc\)/,'el Excel debe incluir el cliente');
assert.match(exportSource, /TOTALES/,'el Excel debe cerrar con totales');
assert.doesNotMatch(exportSource, /(?:prisma|client)\.[a-zA-Z0-9_]+\.(?:create|update|delete|upsert)\s*\(/, 'exportar debe ser solo lectura');

console.log('SALES FILTERED EXPORT V118 SMOKE OK', JSON.stringify({
  sameCanonicalFilters:true,
  filterPersistence:true,
  clientAndStateIncluded:true,
  allPagesExported:true,
  boundedExport:true,
  excelColumns:true,
  readOnly:true,
  salesReprintPreserved:true,
  javascriptCompiles:true
}));
