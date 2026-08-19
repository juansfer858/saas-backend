const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money } = require('../../utils/decimal');
const inventoryService = require('./inventory.service');
const accountingService = require('../accounting/accounting.service');
const integration = require('../accounting/accounting-integration.service');

const ALLOWED = new Set(['AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'MERMA']);

async function createAccountedAdjustment(tenantId, userId, input) {
  if (!ALLOWED.has(input.tipo)) {
    throw new AppError(400, 'Use este endpoint solo para ajustes, faltantes, sobrantes o mermas', 'INVENTORY_ADJUSTMENT_TYPE_INVALID');
  }
  const justificacion = String(input.justificacion || '').trim();
  if (justificacion.length < 5) {
    throw new AppError(400, 'La justificación del ajuste es obligatoria', 'INVENTORY_ADJUSTMENT_REASON_REQUIRED');
  }

  return prisma.$transaction(async (tx) => {
    const isSurplus = input.tipo === 'AJUSTE_ENTRADA';
    const event = isSurplus ? 'AJUSTE_SOBRANTE' : 'AJUSTE_FALTANTE';
    const mappings = await integration.assertEventMappingsInTx(tx, tenantId, event);

    const result = await inventoryService.applyMovement(tx, {
      tenantId,
      productoId: input.productoId,
      tipo: input.tipo,
      cantidad: input.cantidad,
      costoUnitario: input.costoUnitario,
      referencia: input.referencia || `AJUSTE-${Date.now()}`
    });

    if (!result.movement) throw new AppError(409, 'El producto no controla inventario', 'INVENTORY_ADJUSTMENT_NOT_STOCKED');
    const amount = money(result.movement.costoTotal);
    if (amount.lte(0)) throw new AppError(409, 'El ajuste no tiene valor contable', 'INVENTORY_ADJUSTMENT_ZERO_VALUE');

    const inventoryAccount = mappings.INVENTARIO;
    const counterpart = isSurplus ? mappings.INGRESO_SOBRANTE_INVENTARIO : mappings.GASTO_FALTANTE_INVENTARIO;
    const details = isSurplus
      ? [
        { cuentaId: inventoryAccount.id, debito: amount, credito: 0, concepto: justificacion },
        { cuentaId: counterpart.id, debito: 0, credito: amount, concepto: justificacion }
      ]
      : [
        { cuentaId: counterpart.id, debito: amount, credito: 0, concepto: justificacion },
        { cuentaId: inventoryAccount.id, debito: 0, credito: amount, concepto: justificacion }
      ];

    const journal = await accountingService.createJournalInTx(tx, {
      tenantId,
      userId,
      sourceId: input.sourceId ? `INV-${input.sourceId}` : `INV-ADJ-${result.movement.id}`,
      fecha: input.fecha || new Date(),
      concepto: `${isSurplus ? 'Sobrante' : input.tipo === 'MERMA' ? 'Merma' : 'Faltante'} de inventario · ${result.product.nombre}`,
      referencia: result.movement.referencia,
      origen: 'AUTOMATICO',
      codigoTipo: 'AU',
      detalles: details
    });

    return { movimiento: result.movement, producto: result.product, asiento: journal, justificacion };
  });
}

module.exports = { createAccountedAdjustment };
