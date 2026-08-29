'use strict';

const { prisma } = require('../../config/prisma');
const { money } = require('../../utils/decimal');

function planFrom(session) {
  return session?.splitMetadata && typeof session.splitMetadata === 'object' ? session.splitMetadata : null;
}

async function reconcilePaidSessionAfterCommit(tenantId, user, tableId) {
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.restaurantTableSession.findFirst({
      where: { tenantId, tableId, splitMode: { not: null } },
      orderBy: { openedAt: 'desc' },
      include: { table: true }
    });
    if (!session) return { eligible: false, closed: false };

    const plan = planFrom(session);
    const parts = Array.isArray(plan?.parts) ? plan.parts : [];
    if (!parts.length) return { eligible: false, closed: session.state === 'CERRADA' };

    const [payments, sale] = await Promise.all([
      tx.restaurantSessionPayment.findMany({
        where: { tenantId, sessionId: session.id },
        select: { partKey: true }
      }),
      tx.comprobanteComercial.findFirst({
        where: { id: session.saleId, tenantId },
        select: { estado: true, saldo: true }
      })
    ]);

    const paidKeys = new Set(payments.map((row) => row.partKey));
    const allPartsPaid = parts.every((part) => paidKeys.has(part.key));
    const commercialPaid = sale?.estado === 'PAGADO_TOTAL' && money(sale.saldo).eq(0);
    if (!allPartsPaid || !commercialPaid) {
      return { eligible: false, closed: session.state === 'CERRADA' };
    }

    const closedAt = new Date();
    if (session.state !== 'CERRADA') {
      await tx.restaurantTableSession.updateMany({
        where: { id: session.id, tenantId, state: { not: 'CERRADA' } },
        data: { state: 'CERRADA', closedByUserId: user?.id || null, closedAt }
      });
    }

    // Idempotent repair: even if another concurrent caller already closed the session,
    // the table and QR devices are reconciled to the same terminal state.
    await tx.restaurantTable.updateMany({
      where: { id: session.tableId, tenantId },
      data: { state: 'LIBRE' }
    });
    await tx.restaurantQrVisitDevice.updateMany({
      where: { tenantId, sessionId: session.id, revokedAt: null },
      data: { revokedAt: closedAt }
    });

    return { eligible: true, closed: true, sessionId: session.id };
  });

  return result;
}

module.exports = { reconcilePaidSessionAfterCommit };
