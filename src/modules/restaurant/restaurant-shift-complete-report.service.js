'use strict';

const { decimal, money } = require('../../utils/decimal');
const value = n => money(n || 0).toString();
const iso = d => d ? new Date(d).toISOString() : null;
const sum = (rows, key) => value(rows.reduce((n, r) => n.plus(r[key] || 0), decimal(0)));

// Captured once with the close snapshot. Operational activity is tenant-wide;
// money below is explicitly scoped to the closed cash shift or its cashier.
async function buildCompleteReport(tenantId, base, client) {
  const shift = base.shift;
  const window = { gte:new Date(shift.abiertoEn), lte:new Date(shift.cerradoEn) };
  const sessions = await client.restaurantTableSession.findMany({
    where:{ tenantId, openedAt:{ lte:window.lte }, OR:[
      { cashShiftId:shift.id }, { state:{ in:['ABIERTA','CUENTA_PEDIDA'] } },
      { closedAt:window }, { orders:{ some:{ actualizadoEn:window } } }
    ] },
    include:{ table:true, orders:{ include:{ items:true, commands:true } }, sessionPayments:true },
    orderBy:{ openedAt:'asc' }
  });
  const deliveries = await client.restaurantDeliveryOrder.findMany({
    where:{ tenantId, creadoEn:{ lte:window.lte }, OR:[
      { actualizadoEn:window }, { state:{ notIn:['ENTREGADO','CANCELADO'] } },
      { paymentStatus:'PENDIENTE', state:{ not:'CANCELADO' } }
    ] }, include:{ items:true, commands:true }, orderBy:{ creadoEn:'asc' }
  });
  const paymentRows = await client.pago.findMany({
    where:{ tenantId, userId:shift.userId, creadoEn:window, documento:{ tipo:'FACTURA_VENTA' }, comprobanteTesoreria:{ estado:{ not:'ANULADO' } } },
    include:{ documento:true, cajaBanco:{ select:{ nombre:true } } }, orderBy:{ creadoEn:'asc' }
  });
  // Include older restaurant invoices collected during this shift as well.
  const candidateIds = [...new Set(paymentRows.map(p => p.documentoId))];
  const [paidSessions, paidDeliveries] = candidateIds.length ? await Promise.all([
    client.restaurantTableSession.findMany({ where:{ tenantId, saleId:{ in:candidateIds } }, select:{ saleId:true } }),
    client.restaurantDeliveryOrder.findMany({ where:{ tenantId, saleId:{ in:candidateIds } }, select:{ saleId:true } })
  ]) : [[],[]];
  const restaurantPaidIds = new Set([...paidSessions,...paidDeliveries].map(s => s.saleId));
  const sessionPaymentById = new Map(sessions.flatMap(s => s.sessionPayments).map(p => [p.treasuryPaymentId,p]));
  const collections = paymentRows.filter(p => restaurantPaidIds.has(p.documentoId) &&
    (!sessionPaymentById.has(p.id) || !sessionPaymentById.get(p.id).cashShiftId || sessionPaymentById.get(p.id).cashShiftId === shift.id)
  ).map(p => ({ id:p.id, saleId:p.documentoId, saleNumber:p.documento.numero, customerId:p.documento.terceroId,
    method:p.metodoPago, account:p.cajaBanco.nombre, amount:value(p.monto), at:iso(p.creadoEn), userId:p.userId,
    priorInvoice:Boolean(p.documento.emitidoEn && new Date(p.documento.emitidoEn) < window.gte) }));
  const saleIds = [...new Set([...sessions,...deliveries].map(s => s.saleId))];
  const sales = saleIds.length ? await client.comprobanteComercial.findMany({
    where:{ tenantId, id:{ in:saleIds }, tipo:'FACTURA_VENTA' }, include:{ detalles:true, tercero:{ select:{ nombre:true } } }
  }) : [];
  const saleMap = new Map(sales.map(s => [s.id,s]));
  // Full cash sales post directly to Treasury; split/credit payments use Pago.
  // Their treasury documents differ, so collecting both sources does not count
  // the Pago movement a second time.
  const directSaleIds = sessions.filter(s => s.cashShiftId === shift.id ||
    (s.closedByUserId === shift.userId && s.closedAt && new Date(s.closedAt) >= window.gte && new Date(s.closedAt) <= window.lte)).map(s=>s.saleId);
  directSaleIds.push(...deliveries.filter(d=>d.createdByUserId === shift.userId).map(d=>d.saleId));
  const directMovements = directSaleIds.length ? await client.movimientoTesoreria.findMany({
    where:{ tenantId, comprobanteId:{in:directSaleIds}, tipo:'INGRESO', creadoEn:window, comprobante:{estado:{not:'ANULADO'}} },
    include:{cajaBanco:{select:{nombre:true}}}, orderBy:{creadoEn:'asc'}
  }) : [];
  for (const m of directMovements) {
    const sale = saleMap.get(m.comprobanteId);
    const s = sessions.find(s=>s.saleId === m.comprobanteId);
    collections.push({id:m.id,saleId:m.comprobanteId,saleNumber:sale?.numero,customerId:sale?.terceroId,
      method:s?.paymentMethodKind || sale?.formaPago || 'OTROS',account:m.cajaBanco.nombre,amount:value(m.monto),
      at:iso(m.creadoEn),userId:shift.userId,priorInvoice:false,source:'TESORERIA_DIRECTA',concept:m.concepto});
  }
  const ownSales = new Set(sessions.filter(s => s.cashShiftId === shift.id && s.state === 'CERRADA').map(s => s.saleId));
  const emitted = sales.filter(s => s.estado !== 'BORRADOR' && s.estado !== 'ANULADO' && (ownSales.has(s.id) ||
    (s.creadoPorId === shift.userId && s.emitidoEn && new Date(s.emitidoEn) >= window.gte && new Date(s.emitidoEn) <= window.lte)));
  const saleDetail = emitted.map(s => ({ id:s.id, number:s.numero, customer:s.tercero?.nombre || 'Cliente genérico',
    userId:s.creadoPorId, at:iso(s.emitidoEn), subtotal:value(s.subtotal), discount:value(s.descuentoTotal),
    vat:value(s.ivaTotal), consumptionTax:value(s.impoconsumoTotal), total:value(s.total), balance:value(s.saldo), method:s.formaPago,
    items:s.detalles.map(d => ({ id:d.id, product:d.descripcion, quantity:String(d.cantidad), unitPrice:value(d.precioUnitario),
      discountPct:String(d.descuentoPct), vat:value(d.ivaValor), consumptionTax:value(d.impoconsumoValor), total:value(d.totalLinea) })) }));
  const orders = [];
  const addOrder = (o, reference, saleId, channel) => {
    const active = !['ENTREGADO','CANCELADO'].includes(o.state);
    if (!active && !(new Date(o.actualizadoEn) >= window.gte && new Date(o.actualizadoEn) <= window.lte)) return;
    orders.push({ id:o.id, reference, saleId, channel, source:o.source || o.channel, state:o.state,
      waiterId:o.createdByUserId, at:iso(o.creadoEn), total:value(o.total), notes:o.notes,
      items:o.items.map(i => ({ id:i.id, product:i.description, quantity:String(i.quantity), price:value(i.unitPrice),
        total:value(i.lineTotal), station:i.station, person:i.seatNumber == null ? 'TODOS' : `Persona ${i.seatNumber}`, notes:i.notes })),
      commands:o.commands.map(c => ({ id:c.id, station:c.station, state:c.state, at:iso(c.creadoEn),
        startedAt:iso(c.startedAt), readyAt:iso(c.readyAt), deliveredAt:iso(c.deliveredAt),
        preparationMinutes:c.startedAt && c.readyAt ? Math.max(0,(new Date(c.readyAt)-new Date(c.startedAt))/60000) : null })) });
  };
  for (const s of sessions) for (const o of s.orders) addOrder(o, s.table.name, s.saleId, 'MESAS');
  for (const d of deliveries) addOrder(d, d.code, d.saleId, 'DOMICILIOS');
  const pending = [
    ...sessions.filter(s => ['ABIERTA','CUENTA_PEDIDA'].includes(s.state)).map(s => ({ id:s.id, reference:s.table.name,
      state:s.state, saleId:s.saleId, amount:value(saleMap.get(s.saleId)?.total), balance:value(saleMap.get(s.saleId)?.saldo) })),
    ...deliveries.filter(d => d.state !== 'CANCELADO' && (d.state !== 'ENTREGADO' || d.paymentStatus !== 'PAGADO')).map(d => ({
      id:d.id, reference:d.code, state:`${d.state} / ${d.paymentStatus}`, saleId:d.saleId, amount:value(d.total), balance:value(saleMap.get(d.saleId)?.saldo) }))
  ];
  const audits = await client.auditoriaContable.findMany({
    where:{ tenantId, creadoEn:window, OR:[{ entidad:{ startsWith:'RESTAURANT', mode:'insensitive' } },{ entidadId:{ in:[...saleIds,...orders.map(o=>o.id)] } }] },
    orderBy:{ creadoEn:'asc' }, select:{ id:true, userId:true, entidad:true, entidadId:true, accion:true, metadata:true, creadoEn:true }
  });
  const incidents = audits.map(a => ({ id:a.id, userId:a.userId, entity:a.entidad, entityId:a.entidadId, action:a.accion,
    reason:a.metadata?.reason || a.metadata?.motivo || a.metadata?.motivoAnulacion || a.metadata?.label || null, at:iso(a.creadoEn) }));
  const adjustments = saleIds.length ? await client.comprobanteComercial.findMany({
    where:{ tenantId, documentoOrigenId:{in:saleIds}, creadoEn:window },
    select:{id:true, numero:true, tipo:true, estado:true, documentoOrigenId:true, total:true, motivoAnulacion:true, creadoEn:true}
  }) : [];
  const userIds = [...new Set([shift.userId,...orders.map(o => o.waiterId),...incidents.map(a => a.userId),...saleDetail.map(s => s.userId)].filter(Boolean))];
  const users = await client.user.findMany({ where:{ tenantId, id:{ in:userIds } }, select:{ id:true, nombre:true } });
  const names = new Map(users.map(u => [u.id,u.nombre]));
  for (const o of orders) o.waiter = names.get(o.waiterId) || (o.source === 'QR' ? 'Cliente QR' : o.waiterId || 'Sin identificar');
  for (const a of incidents) a.user = names.get(a.userId) || a.userId;
  const waiters = [...new Set(orders.map(o => o.waiter))].map(name => ({ name, orders:orders.filter(o => o.waiter === name).length,
    sent:orders.filter(o => o.waiter === name && !['BORRADOR','CANCELADO'].includes(o.state)).length,
    draft:orders.filter(o => o.waiter === name && o.state === 'BORRADOR').length,
    cancelled:orders.filter(o => o.waiter === name && o.state === 'CANCELADO').length }));
  const methods = [...new Set(collections.map(p => `${p.method} · ${p.account}`))].map(name => ({ name,
    amount:sum(collections.filter(p => `${p.method} · ${p.account}` === name),'amount') }));
  return { version:1, capturedAt:new Date().toISOString(),
    scope:'Cuadre de esta caja. Cobros del cajero durante el turno. Actividad y pendientes de todo el restaurante; no sumar entre cajas concurrentes.',
    historicalReconstruction:Date.now()-window.lte.getTime()>60000,
    sales:saleDetail, collections, methods, orders, pending, incidents, waiters,
    adjustments:adjustments.map(a=>({id:a.id,number:a.numero,type:a.tipo,state:a.estado,saleId:a.documentoOrigenId,total:value(a.total),reason:a.motivoAnulacion,at:iso(a.creadoEn)})),
    credits:saleDetail.filter(s => s.method === 'CREDITO' || decimal(s.balance).gt(0)),
    totals:{ sales:sum(saleDetail,'total'), discount:sum(saleDetail,'discount'), vat:sum(saleDetail,'vat'),
      consumptionTax:sum(saleDetail,'consumptionTax'), collected:sum(collections,'amount'),
      priorInvoiceCollections:sum(collections.filter(p => p.priorInvoice),'amount') }
  };
}

function completeRows(report) {
  const d = report.complete;
  if (!d) return [['COBERTURA','','Cierre histórico anterior al informe completo','','','']];
  const rows = [];
  const add = (section, id, text, at='', qty='', amount='') => rows.push([section,id || '',text || '',at || '',qty,amount]);
  add('COBERTURA',report.shift?.id,d.scope,d.capturedAt);
  if (d.historicalReconstruction) add('COBERTURA','','Reconstrucción posterior: estados y saldos corresponden a la captura, no necesariamente al instante del cierre.');
  for (const [key,label] of Object.entries({sales:'Ventas registradas',discount:'Descuentos',vat:'IVA',consumptionTax:'Impoconsumo',collected:'Cobros registrados',priorInvoiceCollections:'Abonos a facturas anteriores (incluidos en cobros)'})) add('TOTALES','',label,'','',d.totals[key]);
  for (const m of d.methods) add('MÉTODOS','',m.name,'','',m.amount);
  for (const s of d.sales) {
    add('VENTA',s.id,`${s.number} · ${s.customer} · ${s.method}`,s.at,'',s.total);
    for (const i of s.items) add('PRODUCTO VENDIDO',i.id,`${i.product} · precio ${i.unitPrice} · dto ${i.discountPct}% · IVA ${i.vat} · INC ${i.consumptionTax}`,s.at,i.quantity,i.total);
  }
  for (const p of d.collections) add('COBRO',p.id,`${p.saleNumber} · ${p.method} · ${p.account} · usuario ${p.userId}${p.priorInvoice?' · factura anterior':''}`,p.at,'',p.amount);
  for (const c of d.credits) add('CARTERA',c.id,`${c.number} · ${c.customer} · saldo a la captura`,c.at,'',c.balance);
  for (const w of d.waiters) add('MESERO','',`${w.name} · enviados ${w.sent} · borradores ${w.draft} · cancelados ${w.cancelled}`,'',w.orders);
  for (const o of d.orders) {
    add('PEDIDO',o.id,`${o.reference} · ${o.state} · ${o.waiter} · ${o.source} · ${o.notes || ''}`,o.at,'',o.total);
    for (const i of o.items) add('PRODUCTO PEDIDO',i.id,`${o.reference} · ${i.product} · ${i.person} · ${i.station} · ${i.notes || ''}`,o.at,i.quantity,i.total);
    for (const c of o.commands) add('PRODUCCIÓN',c.id,`${c.station} · ${c.state} · inicio ${c.startedAt || '—'} · listo ${c.readyAt || '—'} · entrega ${c.deliveredAt || '—'} · preparación ${c.preparationMinutes == null?'sin registro':c.preparationMinutes.toFixed(1)+' min'}`,c.at);
  }
  for (const p of d.pending) add('PENDIENTE',p.id,`${p.reference} · ${p.state} · saldo ${p.balance}`,'','',p.amount);
  for (const a of d.incidents) add('AUDITORÍA',a.id,`${a.user} · ${a.action} · ${a.entity} ${a.entityId} · ${a.reason || 'Sin motivo registrado'}`,a.at);
  for (const a of d.adjustments || []) add('AJUSTE',a.id,`${a.number} · ${a.type} · ${a.state} · venta ${a.saleId} · ${a.reason || ''}`,a.at,'',a.total);
  return rows;
}
module.exports = { buildCompleteReport, completeRows };
