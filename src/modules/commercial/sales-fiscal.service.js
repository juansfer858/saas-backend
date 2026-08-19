const { prisma } = require('../../config/prisma');
const commercial = require('./commercial.service');
const dian = require('../platform/dian/dian.service');

async function enrichJournalType(client, sale) {
  if (!sale?.asiento || sale.asiento.tipoComprobante) return sale;
  const tipoComprobante = sale.asiento.tipoComprobanteId
    ? await client.tipoComprobanteContable.findUnique({ where: { id: sale.asiento.tipoComprobanteId } })
    : null;
  return { ...sale, asiento: { ...sale.asiento, tipoComprobante } };
}

async function createSale(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    let sale = await commercial.createDocumentInTx(tx, tenantId, userId, { ...input, tipo: 'FACTURA_VENTA' });
    sale = await enrichJournalType(tx, sale);
    let dianDocument = null;
    if (sale.estado === 'EMITIDO') {
      dianDocument = await dian.enqueueCommercialInTx(tx, {
        tenantId,
        comprobante: sale,
        subtotal: sale.subtotal,
        ivaTotal: sale.ivaTotal,
        total: sale.total,
        documentType: input.documentType || 'DOCUMENTO_EQUIVALENTE_POS'
      });
    }
    return { ...sale, dianDocument };
  });
}

async function emitExistingSale(tenantId, userId, id, documentType = 'DOCUMENTO_EQUIVALENTE_POS') {
  let emitted = await commercial.emitDocument(tenantId, userId, id);
  emitted = await enrichJournalType(prisma, emitted);
  const dianDocument = await prisma.$transaction((tx) => dian.enqueueCommercialInTx(tx, {
    tenantId,
    comprobante: emitted,
    subtotal: emitted.subtotal,
    ivaTotal: emitted.ivaTotal,
    total: emitted.total,
    documentType
  }));
  return { ...emitted, dianDocument };
}

module.exports = { createSale, emitExistingSale };
