'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const pageSource = fs.readFileSync('src/web/sales.html', 'utf8');
const routeSource = fs.readFileSync('src/modules/commercial/commercial.routes.js', 'utf8');
const controllerSource = fs.readFileSync('src/modules/commercial/sales.controller.js', 'utf8');
const exportSource = fs.readFileSync('src/modules/commercial/sales-list-export.service.js', 'utf8');

assert.match(pageSource, /VANTIX_SALES_FILTERED_EXPORT_V118/);
assert.match(pageSource, />Exportar Excel<\/button>/);
assert.match(pageSource, /function salesFilterQuery\(capture=true\)/);
assert.match(pageSource, /\['fCustomer','terceroId'\]/);
assert.match(pageSource, /\['fState','estado'\]/);
assert.match(pageSource, /\['fFrom','desde'\]/);
assert.match(pageSource, /\['fTo','hasta'\]/);
assert.match(pageSource, /\/api\/v1\/comercial\/ventas\/exportar\?/);
assert.match(pageSource, /initialFilters\.get\('desde'\)/);
assert.match(pageSource, /initialFilters\.get\('hasta'\)/);
assert.match(pageSource, /value=\"\$\{esc\(st\.filters\.desde\)\}\"/);
assert.match(pageSource, /value=\"\$\{esc\(st\.filters\.hasta\)\}\"/);
assert.match(pageSource, /st\.meta=r\.meta/);
assert.match(pageSource, /VANTIX_SALES_DOCUMENT_DETAIL_REPRINT_V2/, 'la exportación no debe remover el detalle/reimpresión V2');
assert.match(pageSource, /id=\"reprintDocument\"/, 'la exportación no debe remover Reimprimir');

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
assert.match(exportSource, /toExcelHtml/);
for (const column of ['Número','Fecha','Cliente','Estado','DIAN','Medio de pago','Total','Saldo']) {
  assert.ok(exportSource.includes(column), `falta columna ${column}`);
}
assert.doesNotMatch(exportSource, /\.create\s*\(|\.update\s*\(|\.delete\s*\(/, 'exportar debe ser solo lectura');

const queryService = require('../src/modules/commercial/sales-query.service');
const exporter = require('../src/modules/commercial/sales-list-export.service');
const originalList = queryService.list;

(async () => {
  try {
    const calls = [];
    queryService.list = async (_tenantId, filters) => {
      calls.push({ ...filters });
      const page = Number(filters.page || 1);
      const total = 450;
      const count = page < 3 ? 200 : 50;
      return {
        items: Array.from({ length: count }, (_, index) => ({ id:`${page}-${index}` })),
        meta: { page, pageSize:200, total, pages:3 }
      };
    };
    const rows = await exporter.loadAllFiltered('tenant-1', {
      desde:'2026-09-01',
      hasta:'2026-09-16',
      terceroId:'cliente-1',
      estado:'PAGADO_TOTAL'
    });
    assert.equal(rows.length, 450, 'debe exportar todas las páginas del filtro');
    assert.deepEqual(calls.map((call) => call.page), [1,2,3]);
    for (const call of calls) {
      assert.equal(call.desde, '2026-09-01');
      assert.equal(call.hasta, '2026-09-16');
      assert.equal(call.terceroId, 'cliente-1');
      assert.equal(call.estado, 'PAGADO_TOTAL');
      assert.equal(call.pageSize, 200);
    }

    queryService.list = async () => ({ items:[], meta:{ page:1, pageSize:200, total:50001, pages:251 } });
    await assert.rejects(
      () => exporter.loadAllFiltered('tenant-1', { desde:'2020-01-01' }),
      (error) => error?.code === 'SALES_EXPORT_RANGE_TOO_LARGE'
    );

    queryService.list = async () => ({
      items:[{
        numero:'000001', fecha:new Date('2026-09-16T12:00:00Z'), estado:'PAGADO_TOTAL',
        total:25000, saldo:0, formaPago:'BANCO', tercero:{ razonSocial:'Cliente prueba' },
        dianDocument:null
      }],
      meta:{ page:1, pageSize:200, total:1, pages:1 }
    });
    const report = await exporter.exportFilteredSales('tenant-1', { desde:'2026-09-16', hasta:'2026-09-16' });
    const text = Buffer.isBuffer(report.buffer) ? report.buffer.toString('utf8') : String(report.buffer);
    assert.equal(report.count, 1);
    assert.match(report.filename, /Ventas_2026-09-16_2026-09-16\.xls/);
    assert.match(text, /Cliente prueba/);
    assert.match(text, /Transferencia \/ QR/);
    assert.match(text, /TOTALES/);

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
  } finally {
    queryService.list = originalList;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
