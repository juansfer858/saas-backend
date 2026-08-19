const { money } = require('../../utils/decimal');
const treasuryService = require('./treasury.service');

/**
 * Revierte movimientos de caja/banco originados directamente por una venta o
 * compra de contado. Los pagos a crédito se revierten por separado mediante
 * reversePaymentsForDocumentInTx.
 */
async function reverseDirectDocumentSettlementInTx(tx, params) {
  const originals = await tx.movimientoTesoreria.findMany({
    where: {
      tenantId: params.tenantId,
      comprobanteId: params.documentoId,
      tipo: { in: ['INGRESO', 'EGRESO'] }
    },
    orderBy: { creadoEn: 'asc' }
  });

  const reversals = [];
  for (const movement of originals) {
    const isOriginalIncome = movement.tipo === 'INGRESO';
    const result = await treasuryService.recordTreasuryMovementInTx(tx, {
      tenantId: params.tenantId,
      userId: params.userId,
      cajaBancoId: movement.cajaBancoId,
      comprobanteId: params.reversalDocumentId || null,
      tipo: 'AJUSTE',
      monto: money(movement.monto),
      sign: isOriginalIncome ? -1 : 1,
      referencia: params.referencia,
      concepto: params.motivo || 'Reverso de documento contado'
    });
    reversals.push(result.movement);
  }

  return reversals;
}

module.exports = { reverseDirectDocumentSettlementInTx };
