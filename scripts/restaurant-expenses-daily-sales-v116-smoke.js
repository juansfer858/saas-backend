'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const serviceSource = fs.readFileSync('src/modules/restaurant/restaurant-expenses-v116.service.js','utf8');
const routeSource = fs.readFileSync('src/modules/restaurant/restaurant-expenses-v116.routes.js','utf8');
const publicSource = fs.readFileSync('src/modules/restaurant/restaurant-expenses-v116.public.routes.js','utf8');
const reconcileSource = fs.readFileSync('src/modules/restaurant/restaurant-close-sales-reconcile-v116.js','utf8');
const coreSource = fs.readFileSync('src/routes/core.routes.js','utf8');
const publicRouterSource = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js','utf8');
const v2CashPublicSource = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.public.routes.js','utf8');
const v2ControlSource = fs.readFileSync('src/web/restaurant-v2-native-control-p11.js','utf8');
const v2ExpensesHtml = fs.readFileSync('src/web/restaurant-v2-expenses-v117.html','utf8');
const v2ExpensesJs = fs.readFileSync('src/web/restaurant-v2-expenses-v117.js','utf8');
const summary = require('../src/modules/restaurant/restaurant-cash-close-summary.service');
const publicModule = require('../src/modules/restaurant/restaurant-expenses-v116.public.routes');

assert.match(serviceSource,/VANTIX_RESTAURANT_EXPENSES_DAILY_SALES_V116/);
assert.match(serviceSource,/treasuryIntegration\.directExpense/,'los gastos deben usar Tesorería canónica');
assert.doesNotMatch(serviceSource,/(?:prisma|client)\.cajaBanco\.update\s*\(/,'el módulo Restaurante no debe modificar Caja/Banco directamente');
assert.doesNotMatch(serviceSource,/recordSessionFlow\s*\(/,'el módulo Restaurante no debe alterar el turno directamente');
assert.match(serviceSource,/expenseSummary/,'el cierre debe capturar gastos');
assert.match(serviceSource,/toExcelHtml/,'el informe diario debe producir Excel');
assert.match(serviceSource,/Cliente/);
assert.match(serviceSource,/Descripción/);
assert.match(serviceSource,/Medio de pago/);
assert.match(routeSource,/gastos-v116/);
assert.match(routeSource,/ventas-dia-v116\.xls/);
assert.match(routeSource,/restaurant-close-sales-reconcile-v116/);
assert.match(reconcileSource,/saleTotal/,'la reconciliación debe usar valor de venta sin propina');
assert.match(reconcileSource,/salesExcludeTips:true/);
assert.match(coreSource,/restaurantExpensesV116Router/);
assert.match(publicRouterSource,/installRestaurantExpensesV116/);
assert.match(publicSource,/Descargar ventas del día/);
assert.match(publicSource,/Registrar gasto/);
assert.doesNotMatch(publicModule.runtime,/MutationObserver|setInterval/,'V116 debe respetar el contrato realtime/event-driven de restaurant-ui');
assert.match(publicModule.runtime,/vantix:tenant-realtime/);
assert.match(publicModule.runtime,/pageshow/);
assert.match(publicModule.runtime,/data-tab=\"caja\"/,'Gastos debe seguir la autorización real de Caja y no depender solo del rol guardado en sesión');
assert.doesNotThrow(()=>new Function(publicModule.runtime),'el runtime de Gastos V116 debe compilar');

assert.match(v2ControlSource,/gastos:\{ label:'Gastos', hint:'Egresos de caja y banco', route:'\/app\/restaurante-v2\/gastos', roles:\['ADMIN','SUPER_ADMIN','CAJERO'\] \}/,'Gastos debe existir como módulo nativo V2');
const cajaIndex = v2ControlSource.indexOf("caja:{ label:'Caja'");
const gastosIndex = v2ControlSource.indexOf("gastos:{ label:'Gastos'");
const cierresIndex = v2ControlSource.indexOf("cierres:{ label:'Historial de cierres'");
assert.ok(cajaIndex >= 0 && gastosIndex > cajaIndex && cierresIndex > gastosIndex,'Gastos debe quedar entre Caja e Historial de cierres');
assert.match(v2CashPublicSource,/\/app\/restaurante-v2\/gastos/,'la ruta pública V2 de Gastos debe estar montada');
assert.match(v2CashPublicSource,/restaurant-v2-expenses-v117\.html/);
assert.match(v2CashPublicSource,/restaurant-v2-expenses-v117\.js/);
assert.match(v2ExpensesHtml,/VANTIX_RESTAURANT_V2_EXPENSES_NATIVE_V117/);
assert.match(v2ExpensesHtml,/Registrar gasto/);
assert.match(v2ExpensesHtml,/Descargar ventas del día/);
assert.match(v2ExpensesJs,/VANTIX_RESTAURANT_V2_EXPENSES_NATIVE_V117/);
assert.match(v2ExpensesJs,/\/api\/v1\/restaurante\/gastos-v116/);
assert.match(v2ExpensesJs,/\/api\/v1\/restaurante\/reportes\/ventas-dia-v116\.xls/);
assert.doesNotMatch(v2ExpensesJs,/\/api\/v1\/(?:tesoreria|contabilidad)\//,'la UI V2 no debe saltarse el contrato V116');
assert.doesNotMatch(v2ExpensesJs,/MutationObserver|setInterval/,'la UI V2 de Gastos no debe introducir polling');
assert.doesNotThrow(()=>new Function(v2ExpensesJs),'el runtime nativo V2 de Gastos debe compilar');

const report = {
  shift:{
    id:'shift-1',cajaNombre:'Caja General',cajero:'Caja',abiertoEn:'2026-09-16T13:00:00Z',cerradoEn:'2026-09-17T02:00:00Z',
    expenseSummary:{cash:'12000',transfer:'8000',total:'20000',count:2}
  },
  businessDate:'2026-09-16',timezoneOffsetMinutes:300,
  totals:{billedValue:'100000',tips:'10000'},
  production:{COCINA:{value:'100000'},BARRA:{value:'0'},POSTRES:{value:'0'}},
  payments:{cash:'110000',transfer:'0',card:'0',credit:'0',other:'0'},
  cash:{openingBalance:'50000',cashIncome:'110000',cashOut:'12000',expectedCash:'148000',countedCash:'148000',difference:'0'},
  operations:[{paymentMethod:'EFECTIVO',tips:'10000',billedValue:'100000',state:'COBRADA'}]
};
const corrected = summary.salesPayments(report);
assert.equal(corrected.cash,100000,'la propina no puede inflar ventas en efectivo');
const cross = summary.closeCross(report);
assert.equal(cross.sales,100000,'el cruce detallado debe partir de ventas facturadas');
assert.equal(cross.expenses.total,20000,'el cruce detallado debe tomar gastos canónicos');
assert.equal(cross.salesMinusExpenses,80000,'ventas menos gastos debe cuadrar sin alterar la venta');
assert.equal(cross.cashNet,88000,'flujo efectivo neto usa venta en efectivo menos gasto en efectivo');
assert.equal(cross.bankNet,-8000,'flujo banco neto descuenta únicamente gastos bancarios');

const own = summary.ownCloseReport(report);
assert.equal(own.base,50000,'BASE debe usar el saldo inicial del turno');
assert.equal(own.ownSales,100000,'ventas propias deben conservar la venta sin propina');
assert.equal(own.production.total,100000,'producción propia debe conciliar con ventas propias');
assert.equal(own.productionDifference,0);
assert.equal(own.covered,100000);
assert.equal(own.collectionDifference,0);

const rows = summary.summaryRows(report);
const baseRow = rows.find(row=>row.section==='TURNO'&&row.label==='BASE');
assert.ok(baseRow?.value.includes('50.000'),'el resumen debe mostrar la base registrada al abrir turno');
const totalSales = rows.find(row=>row.section==='VENTAS RESTAURANTE'&&row.label==='TOTAL VENTAS PROPIAS');
assert.ok(totalSales?.value.includes('100.000'),'TOTAL VENTAS PROPIAS debe usar la venta propia');
const totalCovered = rows.find(row=>row.section==='RECAUDO VENTAS PROPIAS'&&row.label==='TOTAL CUBIERTO');
assert.ok(totalCovered?.value.includes('100.000'),'TOTAL CUBIERTO debe usar pagos propios');
assert.equal(rows.some(row=>['GASTOS','CRUCE FINAL','ARQUEO','ARQUEO FINAL'].includes(row.section)),false,'el resumen compacto ya no debe mostrar gastos ni arqueo final');

const zeroRows = summary.summaryRows({shift:{id:'zero',expenseSummary:{cash:0,transfer:0,total:0,count:0}},cash:{openingBalance:0},totals:{billedValue:0},production:{COCINA:{value:0},BARRA:{value:0},POSTRES:{value:0}},payments:{}});
assert.ok(zeroRows.some(row=>row.section==='TURNO'&&row.label==='BASE'),'BASE debe existir incluso cuando sea cero');
assert.ok(zeroRows.some(row=>row.section==='VENTAS RESTAURANTE'&&row.label==='TOTAL VENTAS PROPIAS'),'ventas propias deben existir incluso cuando sean cero');
assert.equal(zeroRows.some(row=>row.section==='GASTOS'),false,'Gastos queda fuera del resumen compacto, no del módulo de Gastos');

console.log('RESTAURANT EXPENSES DAILY SALES V125 SMOKE OK',JSON.stringify({
  treasuryCanonicalExpense:true,
  dailySalesExport:true,
  customerDescriptionValuePaymentMethod:true,
  tipsSeparatedFromSales:true,
  detailedCrossPreserved:true,
  baseVisible:true,
  ownSalesVisible:true,
  compactSummaryWithoutFinalArqueo:true,
  expensesStillCanonical:true,
  eventDrivenRuntime:true,
  visibilityFollowsCanonicalCashAccess:true,
  nativeV2ExpensesModule:true,
  nativeV2MenuOrder:'Caja>Gastos>Cierres',
  runtimeCompiles:true
}));
