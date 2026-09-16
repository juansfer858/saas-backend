'use strict';

// VANTIX_RESTAURANT_CASH_CLOSE_SUMMARY_V110
// Presentation only: reads the immutable closure, never changes accounting totals.
function amount(value) {
  if (value == null) return 'Sin registro';
  const n=Number(value);
  return Number.isFinite(n)?new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:2}).format(n):'Sin registro';
}
function short(value,limit=60){return String(value??'').replace(/[\r\n\t]+/g,' ').slice(0,limit)}
function localTime(value,offset=300){
  if(!value)return 'Sin registro';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return 'Sin registro';
  const n=Number(offset);
  return new Date(d.getTime()-(Number.isFinite(n)?n:300)*60000).toISOString().slice(0,16).replace('T',' ');
}
function summaryRows(report){
  const rows=[],add=(section,label,value)=>rows.push({section,label,value:String(value)});
  const shift=report.shift||{},cash=report.cash||{},totals=report.totals||{},payments=report.payments||{};
  const day=report.kind==='DAY';
  add('TURNO',day?'Día operativo':'Turno',day?report.businessDate:short(shift.id,12).toUpperCase());
  if(!day)add('TURNO','Día operativo',report.businessDate||'Ver fechas del turno');
  if(day){
    add('TURNO','Turnos consolidados',report.shiftCount||0);
    add('TURNO','Responsables','Consultar cada turno');
  }else{
    add('TURNO','Caja',short(shift.cajaNombre||'Caja'));
    add('TURNO','Cajero',short(shift.cajero||'Sin registro'));
    add('TURNO','Apertura',localTime(shift.abiertoEn,report.timezoneOffsetMinutes));
    add('TURNO','Cierre',localTime(shift.cerradoEn,report.timezoneOffsetMinutes));
  }
  add('OPERACIÓN','Cuentas cobradas',totals.accountsCharged??'Sin registro');
  add('OPERACIÓN','Valor facturado',amount(totals.billedValue));
  add('OPERACIÓN','Propinas',amount(totals.tips));
  add('OPERACIÓN','Liquidado incl. crédito',amount(totals.settledValue));
  add('PAGOS','Efectivo',amount(payments.cash));
  add('PAGOS','Transferencias / QR',amount(payments.transfer));
  add('PAGOS','Tarjetas',amount(payments.card));
  add('PAGOS','Crédito / no es efectivo',amount(payments.credit));
  if(Number(payments.other||0)!==0)add('PAGOS','Otros medios',amount(payments.other));
  const labels={MESAS:'Mesas',MOSTRADOR:'Mostrador',DOMICILIOS:'Domicilios',PARA_LLEVAR:'Para llevar'};
  for(const [key,label] of Object.entries(labels)){
    const c=report.channels?.[key];
    if(c&&(Number(c.tickets)||Number(c.settledValue)))add('CANALES',label+' ('+Number(c.tickets||0)+')',amount(c.settledValue));
  }
  add('ARQUEO','Fondo inicial',amount(cash.openingBalance));
  add('ARQUEO','Entradas efectivo (+)',amount(cash.cashIncome));
  add('ARQUEO','Salidas efectivo (-)',amount(cash.cashOut));
  add('ARQUEO','Efectivo esperado',amount(cash.expectedCash));
  add('ARQUEO','Efectivo contado',amount(cash.countedCash));
  add('ARQUEO','DESCUADRE',amount(cash.difference));
  const diff=cash.difference==null?null:Number(cash.difference);
  add('ARQUEO','Estado efectivo',diff==null?'SIN REGISTRO':diff===0?'CUADRADO':diff>0?'SOBRANTE':'FALTANTE');
  if(day)add('ARQUEO','Alcance','Suma de turnos; revisar cada caja');
  add('CONTROL','Diferencia operativa',amount(totals.difference));
  const exceptions=report.exceptions;
  add('CONTROL','Alertas operativas',Array.isArray(exceptions)?exceptions.length:'Ver informe completo');
  if(exceptions?.length){
    const delivery=exceptions.filter(e=>/ENTREGA|PRODUCCION|RECAUDO/.test(e.type||'')).length;
    if(delivery)add('CONTROL','Entrega / producción / cobro',delivery);
    add('CONTROL','Revisión','Consultar detalle en historial');
  }
  if(report.complete){
    add('CONTROL','Cobros registrados (cajero)',amount(report.complete.totals?.collected));
    add('CONTROL','Pendientes restaurante',(report.complete.pending||[]).length);
    const prior=report.complete.totals?.priorInvoiceCollections;
    if(Number(prior||0))add('CONTROL','Abonos cartera anterior',amount(prior));
    for(const [key,label] of [['discount','Descuentos informativos'],['vat','IVA incluido'],['consumptionTax','INC incluido']]){
      const v=report.complete.totals?.[key];if(Number(v||0))add('CONTROL',label,amount(v));
    }
  }
  if(report.complete?.historicalReconstruction)add('CONTROL','Histórico','Detalle reconstruido después');
  if(!report.complete&&!day)add('CONTROL','Cobertura','Datos del cierre histórico');
  add('FIRMAS','Entrega cajero','____________________');
  add('FIRMAS','Recibe / revisa','____________________');
  return rows;
}
function legacyReport(snapshot){
  const s=snapshot.shift||{},p=snapshot.paymentBreakdown||{};
  return {shift:s,totals:{accountsCharged:snapshot.tables?.length,
    settledValue:snapshot.restaurantClosedTablesTotal},
    payments:{cash:p.cashSales,transfer:p.transferSales,card:p.cardSales,credit:p.creditSales,other:p.bankOtherSales},
    cash:{openingBalance:s.saldoInicial,cashIncome:s.ingresosEfectivo,cashOut:s.egresosEfectivo,
      expectedCash:snapshot.systemCashExpected,countedCash:s.saldoFinal,difference:s.descuadre}};
}
function summaryPdfSpec(tenant,report){
  const entries=summaryRows(report);
  const rows=[];
  // Two independent concept/value columns keep the summary on one landscape page.
  const half=Math.ceil(entries.length/2);
  for(let i=0;i<half;i++){
    const left=entries[i],right=entries[i+half];
    rows.push([left.label,left.value,right?.label||'',right?.value||'']);
  }
  rows.push(['Detalle completo','Historial de cierres','Uso','Control interno - no es factura']);
  return {title:'Resumen cierre '+(report.businessDate||'')+' - '+short(tenant.nombreEmpresa||tenant.subdomain||'Restaurante'),
    headers:['Concepto','Resultado','Concepto','Resultado'],
    columns:[{label:'Concepto',width:.23,type:'text',align:'left'},{label:'Resultado',width:.27,type:'text',align:'left'},
      {label:'Concepto',width:.23,type:'text',align:'left'},{label:'Resultado',width:.27,type:'text',align:'left'}],
    rows,rowStyles:rows.map(()=> 'data')};
}
module.exports={summaryRows,legacyReport,summaryPdfSpec};

