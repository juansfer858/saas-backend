const { prisma } = require('../../config/prisma');
const commercial = require('./commercial.service');
const dian = require('../platform/dian/dian.service');

async function createSale(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    const sale = await commercial.createDocumentInTx(tx, tenantId, userId, { ...input, tipo: 'FACTURA_VENTA' });
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
  const emitted = await commercial.emitDocument(tenantId, userId, id);
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
