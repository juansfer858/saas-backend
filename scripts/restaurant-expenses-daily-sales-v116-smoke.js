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
  payments:{cash:'110000',transfer:'0',card:'0',credit:'0',other:'0'},
  cash:{openingBalance:'0',cashIncome:'110000',cashOut:'12000',expectedCash:'98000',countedCash:'98000',difference:'0'},
  operations:[{paymentMethod:'EFECTIVO',tips:'10000',billedValue:'100000',state:'COBRADA'}]
};
const corrected = summary.salesPayments(report);
assert.equal(corrected.cash,100000,'la propina no puede inflar ventas en efectivo');
const cross = summary.closeCross(report);
assert.equal(cross.sales,100000,'el cruce debe partir de ventas facturadas');
assert.equal(cross.expenses.total,20000,'el cruce debe tomar gastos canónicos');
assert.equal(cross.salesMinusExpenses,80000,'ventas menos gastos debe cuadrar sin alterar la venta');
assert.equal(cross.cashNet,88000,'flujo efectivo neto usa venta en efectivo menos gasto en efectivo');
assert.equal(cross.bankNet,-8000,'flujo banco neto descuenta únicamente gastos bancarios');

const rows = summary.summaryRows(report);
const totalSales = rows.find(row=>row.section==='VENTAS'&&row.label==='Valor total');
assert.ok(totalSales?.value.includes('100.000'),'Valor total debe usar ventas facturadas');
assert.ok(rows.some(row=>row.section==='GASTOS'&&row.label==='Cantidad de gastos'&&row.value==='2'),'debe indicar cantidad de gastos');
assert.ok(rows.some(row=>row.section==='GASTOS'&&row.label==='Efectivo'&&row.value.includes('12.000')),'debe mostrar gastos en efectivo');
assert.ok(rows.some(row=>row.section==='GASTOS'&&row.label==='Banco / transferencia'&&row.value.includes('8.000')),'debe mostrar gastos por transferencia');
assert.ok(rows.some(row=>row.section==='GASTOS'&&row.label==='Total gastos'&&row.value.includes('20.000')),'debe mostrar total de gastos');
assert.ok(rows.some(row=>row.section==='CRUCE FINAL'&&row.label==='Ventas - gastos'&&row.value.includes('80.000')),'debe mostrar ventas menos gastos');
assert.ok(rows.some(row=>row.section==='CRUCE FINAL'&&row.label==='Flujo efectivo neto'&&row.value.includes('88.000')),'debe cruzar efectivo operativo');
assert.ok(rows.some(row=>row.section==='CRUCE FINAL'&&row.label==='Flujo banco neto'&&row.value.includes('-8.000')),'debe cruzar banco operativo');
assert.ok(rows.some(row=>row.section==='CAJA'&&row.label==='Efectivo esperado'&&row.value.includes('98.000')),'debe conservar el efectivo esperado canónico de Tesorería');
assert.ok(rows.some(row=>row.section==='CAJA'&&row.label==='Descuadre'&&row.value.includes('$ 0')),'el reporte debe mostrar el descuadre físico sin recomputarlo');

const zeroRows = summary.summaryRows({shift:{id:'zero',expenseSummary:{cash:0,transfer:0,total:0,count:0}},totals:{billedValue:0},payments:{}});
assert.ok(zeroRows.some(row=>row.section==='GASTOS'&&row.label==='Total gastos'),'el cierre debe mostrar Gastos incluso cuando sean cero');

console.log('RESTAURANT EXPENSES DAILY SALES V121 SMOKE OK',JSON.stringify({
  treasuryCanonicalExpense:true,
  dailySalesExport:true,
  customerDescriptionValuePaymentMethod:true,
  tipsSeparatedFromSales:true,
  cashCloseUsesSaleValue:true,
  closeExpensesSeparated:true,
  finalCross:true,
  cashExpenseNotDoubleCounted:true,
  bankExpenseSeparated:true,
  zeroExpensesVisible:true,
  eventDrivenRuntime:true,
  visibilityFollowsCanonicalCashAccess:true,
  nativeV2ExpensesModule:true,
  nativeV2MenuOrder:'Caja>Gastos>Cierres',
  runtimeCompiles:true
}));
