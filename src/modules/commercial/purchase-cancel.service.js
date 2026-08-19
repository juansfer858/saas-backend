const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const accountingService = require('../accounting/accounting.service');
const inventoryService = require('../inventory/inventory.service');
const treasuryService = require('../treasury/treasury.service');
const treasuryReversalService = require('../treasury/treasury-reversal.service');

async function createCancellationNoteInTx(tx, tenantId, userId, original, motivo) {
  const numero = `ND-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const note = await tx.comprobanteComercial.create({
    data: {
      tenantId,
      tipo: 'NOTA_DEBITO',
      numero,
      estado: 'EMITIDO',
      documentoOrigenId: original.id,
      terceroId: original.terceroId,
      creadoPorId: userId,
      fecha: new Date(),
      emitidoEn: new Date(),
      observaciones: motivo,
      subtotal: original.subtotal,
      descuentoTotal: original.descuentoTotal,
      ivaTotal: original.ivaTotal,
      impoconsumoTotal: original.impoconsumoTotal,
      total: original.total,
      saldo: 0
    }
  });

  if (original.detalles.length) {
    await tx.detalleComprobante.createMany({
      data: original.detalles.map((line) => ({
        tenantId,
        comprobanteId: note.id,
        productoId: line.productoId,
        descripcion: `Reverso: ${line.descripcion}`,
        cantidad: line.cantidad,
        precioUnitario: line.precioUnitario,
        descuentoPct: line.descuentoPct,
        ivaPct: line.ivaPct,
        impoconsumoPct: line.impoconsumoPct,
        subtotalLinea: line.subtotalLinea,
        ivaValor: line.ivaValor,
        impoconsumoValor: line.impoconsumoValor,
        totalLinea: line.totalLinea,
        costoUnitario: line.costoUnitario
      }))
    });
  }

  return note;
}

async function cancelPurchase(tenantId, userId, id, motivo) {
  return prisma.$transaction(async (tx) => {
    const original = await tx.comprobanteComercial.findFirst({
      where: { id, tenantId, tipo: 'COMPRA' },
      include: {
        detalles: true,
        asiento: { include: { detalles: true } },
        pagosRecibidos: true
      }
    });

    if (!original) throw new AppError(404, 'Compra no encontrada', 'PURCHASE_NOT_FOUND');
    if (original.estado === 'ANULADO') return { documentoId: original.id, notaId: null, yaAnulada: true };

    if (original.estado === 'BORRADOR') {
      await tx.comprobanteComercial.update({
        where: { id: original.id },
        data: { estado: 'ANULADO', saldo: 0, anuladoEn: new Date(), motivoAnulacion: motivo }
      });
      return { documentoId: original.id, notaId: null, yaAnulada: false };
    }

    if (original.estado !== 'EMITIDO') {
      throw new AppError(409, 'Solo una compra emitida y sin pagos puede anularse', 'PURCHASE_CANCEL_STATE_INVALID');
    }

    if (original.pagosRecibidos.length > 0) {
      throw new AppError(
        409,
        'No se puede anular una compra con pagos aplicados. Reverse los pagos desde Tesorería primero.',
        'PURCHASE_HAS_PAYMENTS'
      );
    }

    const note = await createCancellationNoteInTx(tx, tenantId, userId, original, motivo);

    await treasuryReversalService.reverseDirectDocumentSettlementInTx(tx, {
      tenantId,
      userId,
      documentoId: original.id,
      reversalDocumentId: note.id,
      referencia: note.numero,
      motivo
    });

    await treasuryService.cancelCarteraForDocumentInTx(tx, {
      tenantId,
      documentoId: original.id,
      reversalDocumentId: note.id,
      referencia: note.numero,
      motivo
    });

    await inventoryService.reverseDocumentMovementsInTx(tx, {
      tenantId,
      comprobanteId: original.id,
      reversalDocumentId: note.id,
      referencia: note.numero
    });

    if (original.asiento) {
      await accountingService.reverseJournalInTx(tx, {
        tenantId,
        userId,
        asiento: original.asiento,
        comprobanteId: note.id,
        sourceId: `REV-PUR-${original.id}`,
        referencia: note.numero,
        concepto: `Anulación compra ${original.numero}`,
        motivo
      });
    }

    await tx.comprobanteComercial.update({
      where: { id: original.id },
      data: { estado: 'ANULADO', saldo: 0, anuladoEn: new Date(), motivoAnulacion: motivo }
    });

    return { documentoId: original.id, notaId: note.id, yaAnulada: false };
  });
}

module.exports = { cancelPurchase };
