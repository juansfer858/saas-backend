const { prisma } = require('../../config/prisma');
const restaurant = require('./restaurant.service');

async function listTablesLive(tenantId, user) {
  const tables = await restaurant.listTables(tenantId, user);
  const sessions = tables.map((row) => row.activeSession).filter(Boolean);
  const saleIds = sessions.map((row) => row.saleId);
  const sales = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds } },
    select: { id: true, numero: true, estado: true, total: true, creadoEn: true }
  }) : [];
  const bySale = new Map(sales.map((row) => [row.id, row]));
  return tables.map((table) => {
    const session = table.activeSession;
    const sale = session ? bySale.get(session.saleId) : null;
    return {
      ...table,
      activeSession: session ? {
        ...session,
        sale: sale ? { id: sale.id, numero: sale.numero, estado: sale.estado, total: sale.total, creadoEn: sale.creadoEn } : null
      } : null
    };
  });
}

module.exports = { listTablesLive };
