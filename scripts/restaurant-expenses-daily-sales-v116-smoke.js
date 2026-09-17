'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const serviceSource = fs.readFileSync('src/modules/restaurant/restaurant-expenses-v116.service.js','utf8');
const routeSource = fs.readFileSync('src/modules/restaurant/restaurant-expenses-v116.routes.js','utf8');
const publicSource = fs.readFileSync('src/modules/restaurant/restaurant-expenses-v116.public.routes.js','utf8');
const reconcileSource = fs.readFileSync('src/modules/restaurant/restaurant-close-sales-reconcile-v116.js','utf8');
const coreSource = fs.readFileSync('src/routes/core.routes.js','utf8');
const publicRouterSource = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js','utf8');
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

const report = {
  shift:{
    id:'shift-1',cajaNombre:'Caja General',cajero:'Caja',abiertoEn:'2026-09-16T13:00:00Z',cerradoEn:'2026-09-17T02:00:00Z',
    expenseSummary:{cash:'12000',transfer:'8000',total:'20000',count:2}
  },
  businessDate:'2026-09-16',timezoneOffsetMinutes:300,
  totals:{billedValue:'100000',tips:'10000'},
  payments:{cash:'110000',transfer:'0',card:'0',credit:'0',other:'0'},
  operations:[{paymentMethod:'EFECTIVO',tips:'10000',billedValue:'100000',state:'COBRADA'}]
};
const corrected = summary.salesPayments(report);
assert.equal(corrected.cash,100000,'la propina no puede inflar ventas en efectivo');
const rows = summary.summaryRows(report);
const totalSales = rows.find(row=>row.section==='VENTAS'&&row.label==='Valor total');
assert.ok(totalSales?.value.includes('100.000'),'Valor total debe usar ventas facturadas');
assert.ok(rows.some(row=>row.section==='GASTOS'&&row.label==='Efectivo'&&row.value.includes('12.000')),'debe mostrar gastos en efectivo');
assert.ok(rows.some(row=>row.section==='GASTOS'&&row.label==='Transferencia'&&row.value.includes('8.000')),'debe mostrar gastos por transferencia');

console.log('RESTAURANT EXPENSES DAILY SALES V116 SMOKE OK',JSON.stringify({
  treasuryCanonicalExpense:true,
  dailySalesExport:true,
  customerDescriptionValuePaymentMethod:true,
  tipsSeparatedFromSales:true,
  cashCloseUsesSaleValue:true,
  closeExpensesSeparated:true,
  eventDrivenRuntime:true,
  visibilityFollowsCanonicalCashAccess:true,
  runtimeCompiles:true
}));
