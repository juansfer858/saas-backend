'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money } = require('../../utils/decimal');
const productionSalesReconcile = require('./restaurant-shift-production-sales-reconcile-v119.service');
const salesPaymentsReconcile = require('./restaurant-shift-sales-payments-reconcile-v120.service');

const MARKER = 'VANTIX_RESTAURANT_SHIFT_CLOSE_ALL_TABLES_V111';
const ACTIVE = ['ABIERTA', 'CUENTA_PEDIDA'];
const PENDING = ['PENDIENTE', 'EN_PREPARACION', 'LISTA'];
const REASON = 'Cierre de turno';

const { lockOperation } = require('./restaurant-operation-lock-v111.service');

function blocker(reference, reason, extra = {}) { return { reference, reason, ...extra }; }

async function inspect(tx, tenantId) {
  const [sessions, commands, deliveries] = await Promise.all([
    tx.restaurantTableSession.findMany({where:{tenantId,state:{in:ACTIVE}},include:{table:true,orders:{include:{items:true,commands:true}}}}),
    tx.restaurantCommand.findMany({where:{tenantId,state:{in:PENDING}},include:{order:{include:{session:{include:{table:true}}}}}}),
    tx.restaurantDeliveryOrder.findMany({where:{tenantId,state:{not:'CANCELADO'},OR:[{state:{not:'ENTREGADO'}},{paymentStatus:{not:'PAGADO'}}]},select:{id:true,code:true,state:true,paymentStatus:true}})
  ]);
  const blockers = commands.map(c=>blocker(c.order.session.table.name,`${c.station}: ${c.state}`,{orderId:c.orderId,commandId:c.id,kind:'PRODUCCION'}));
  for (const d of deliveries) blockers.push(blocker(d.code,d.state!=='ENTREGADO'?'Domicilio sin entregar':'Domicilio pendiente de cobro',{kind:'DOMICILIO',deliveryId:d.id}));
  const plans = [];
  for (const session of sessions) {
    const reference = session.table.name;
    const unresolved = session.orders.filter(o=>!['BORRADOR','CANCELADO'].includes(o.state));
    if (unresolved.length) {
      blockers.push(blocker(reference,'Cuenta con consumo: entregar y resolver el cobro',{kind:'CUENTA',sessionId:session.id}));
      continue;
    }
    const [sale,payments,fiscal,treasuryPayments] = await Promise.all([
      tx.comprobanteComercial.findFirst({where:{tenantId,id:session.saleId},include:{detalles:true}}),
      tx.restaurantSessionPayment.count({where:{tenantId,sessionId:session.id}}),
      tx.restaurantFiscalDocument.count({where:{tenantId,sessionId:session.id}}),
      tx.pago.count({where:{tenantId,documentoId:session.saleId}})
    ]);
    const drafts = session.orders.filter(o=>o.state==='BORRADOR');
    const items = drafts.flatMap(o=>o.items);
    const detailIds = new Set(items.map(i=>i.saleDetailId));
    const draftTotal = items.reduce((sum,i)=>sum.plus(i.lineTotal),money(0));
    const onlyDraftDetails = sale && sale.detalles.length===detailIds.size && sale.detalles.every(d=>detailIds.has(d.id));
    if (!sale || sale.estado!=='BORRADOR' || payments || fiscal || treasuryPayments || session.splitMetadata ||
        !onlyDraftDetails || !money(sale.total).eq(draftTotal) || drafts.some(o=>o.commands.length)) {
      blockers.push(blocker(reference,'Tiene pagos, documentos o consumo que requiere revisión en Caja',{kind:'CUENTA',sessionId:session.id}));
      continue;
    }
    plans.push({session,sale,drafts});
  }
  return { blockers, plans };
}

function productionSalesSummary(result) {
  return {
    marker:result.marker,
    productionTotal:result.productionTotal,
    nonProductionCharges:result.nonProductionCharges,
    operationalTotal:result.operationalTotal,
    saleTotal:result.saleTotal,
    difference:result.difference,
    balanced:result.balanced,
    checkedOperations:result.checkedOperations,
    failedOperations:result.failedOperations
  };
}

function salesPaymentsSummary(result) {
  return {
    marker:result.marker,
    saleTotal:result.saleTotal,
    paidTotal:result.paidTotal,
    receivableBalance:result.receivableBalance,
    financialCoverage:result.financialCoverage,
    difference:result.difference,
    balanced:result.balanced,
    checkedOperations:result.checkedOperations,
    failedOperations:result.failedOperations
  };
}

// V131: reconciliation findings are retained for review, never a cash-close veto.
function reconciliationWarnings(production, payments) {
  return [
    ['RESTAURANT_SHIFT_CLOSE_PRODUCTION_SALES_MISMATCH', production],
    ['RESTAURANT_SHIFT_CLOSE_SALES_PAYMENTS_MISMATCH', payments]
  ].flatMap(([type, result]) => result.balanced ? [] : (
    result.failures.length ? result.failures : [result]
  ).map(entry => ({
    type,
    severity:'HIGH',
    reference:entry.reference || 'Turno',
    value:entry.difference,
    reason:(entry.issues || []).map(issue => issue.message).join(' ') || 'Revisar conciliación del turno.',
    reconciliation:entry
  })));
}

async function closeRestaurantShift(tenantId, userId, shiftId, input, finish, client = prisma) {
  return client.$transaction(async tx => {
    await lockOperation(tx,tenantId,true);
    const shift = await tx.aperturaCierreCaja.findFirst({where:{tenantId,id:shiftId,userId,estado:'ABIERTA'}});
    if (!shift) throw new AppError(409,'El turno ya no está abierto. Actualiza Caja.','RESTAURANT_SHIFT_CLOSE_NOT_OPEN');
    const {blockers,plans} = await inspect(tx,tenantId);
    if (blockers.length) {
      const detail = blockers.slice(0,12).map(b=>`${b.reference}: ${b.reason}`).join('\n');
      throw new AppError(409,`No se puede cerrar el turno. Resuelve los pendientes:\n${detail}${blockers.length>12?'\nHay más pendientes; revisa Mesas y Producción.':''}`,
        'RESTAURANT_SHIFT_CLOSE_PENDING',{blockers,total:blockers.length});
    }

    const productionSalesReconciliation = await productionSalesReconcile.reconcileShiftProductionSales(tx,tenantId,shift);
    const salesPaymentsReconciliation = await salesPaymentsReconcile.reconcileShiftSalesPayments(tx,tenantId,shift);
    const warnings = reconciliationWarnings(productionSalesReconciliation,salesPaymentsReconciliation);

    const now = new Date();
    let cancelledDrafts = 0;
    for (const {session,sale,drafts} of plans) {
      const ids = drafts.map(o=>o.id);
      if (ids.length) {
        const result = await tx.restaurantOrder.updateMany({where:{tenantId,id:{in:ids},state:'BORRADOR'},data:{state:'CANCELADO'}});
        if (result.count!==ids.length) throw new AppError(409,'Un pedido cambió. Revisa la mesa y vuelve a cerrar.','RESTAURANT_SHIFT_CLOSE_CHANGED');
        cancelledDrafts += result.count;
      }
      const voided = await tx.comprobanteComercial.updateMany({where:{tenantId,id:sale.id,estado:'BORRADOR'},data:{estado:'ANULADO',anuladoEn:now,motivoAnulacion:REASON}});
      const closed = await tx.restaurantTableSession.updateMany({where:{tenantId,id:session.id,state:{in:ACTIVE}},data:{state:'CANCELADA',closedAt:now,closedByUserId:userId,cashShiftId:shiftId}});
      if (voided.count!==1 || closed.count!==1) throw new AppError(409,'Una mesa cambió. Revisa y vuelve a cerrar.','RESTAURANT_SHIFT_CLOSE_CHANGED');
      await tx.restaurantQrVisitDevice.updateMany({where:{tenantId,sessionId:session.id,revokedAt:null},data:{revokedAt:now}});
      await tx.restaurantTable.update({where:{id:session.tableId},data:{state:'LIBRE'}});
      await tx.auditoriaContable.create({data:{tenantId,userId,entidad:'RESTAURANT_TABLE_SESSION',entidadId:session.id,
        accion:'RESTAURANT_VISIT_CANCELLED_SHIFT_CLOSE',metadata:{marker:MARKER,shiftId,tableId:session.tableId,saleId:sale.id,
          reason:REASON,cancelledDraftIds:ids,historyPreserved:true}}});
    }
    // Repair occupied/reserved table flags with no active visit. No rows are deleted.
    await tx.restaurantTable.updateMany({where:{tenantId,state:{not:'LIBRE'},sessions:{none:{state:{in:ACTIVE}}}},data:{state:'LIBRE'}});
    const result = await finish(tx);
    const productionSummary = productionSalesSummary(productionSalesReconciliation);
    const paymentSummary = salesPaymentsSummary(salesPaymentsReconciliation);
    await tx.auditoriaContable.create({data:{tenantId,userId,entidad:'APERTURA_CIERRE_CAJA',entidadId:shiftId,
      accion:'RESTAURANT_SHIFT_ALL_TABLES_CLOSED',metadata:{marker:MARKER,reason:REASON,closedVisits:plans.length,cancelledDrafts,
        reconciliationPolicy:'WARN_ONLY',warnings,
        productionSalesReconciliation:productionSummary,salesPaymentsReconciliation:paymentSummary}}});
    return {...result,operationalClose:{marker:MARKER,closedVisits:plans.length,cancelledDrafts,allTablesFree:true,
      reconciliationPolicy:'WARN_ONLY',warnings,
      productionSalesReconciliation:productionSummary,salesPaymentsReconciliation:paymentSummary}};
  },{maxWait:10000,timeout:30000});
}

module.exports = {MARKER,lockOperation,inspect,productionSalesSummary,salesPaymentsSummary,reconciliationWarnings,closeRestaurantShift};
