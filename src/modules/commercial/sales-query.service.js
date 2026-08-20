const { prisma } = require('../../config/prisma');
const sales = require('./sales.service');

async function list(tenantId, filters = {}) {
  const where = { tenantId, tipo: 'FACTURA_VENTA' };
  if (filters.terceroId) where.terceroId = filters.terceroId;
  if (filters.estado) where.estado = filters.estado;
  if (filters.desde || filters.hasta) {
    where.fecha = {};
    if (filters.desde) where.fecha.gte = new Date(filters.desde.includes('T') ? filters.desde : `${filters.desde}T00:00:00.000Z`);
    if (filters.hasta) where.fecha.lte = new Date(filters.hasta.includes('T') ? filters.hasta : `${filters.hasta}T23:59:59.999Z`);
  }
  if (filters.montoMin !== undefined || filters.montoMax !== undefined) {
    where.total = {};
    if (filters.montoMin !== undefined && filters.montoMin !== '') where.total.gte = Number(filters.montoMin);
    if (filters.montoMax !== undefined && filters.montoMax !== '') where.total.lte = Number(filters.montoMax);
  }

  const page = Math.max(Number(filters.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(filters.pageSize || filters.limit) || 50, 1), 200);
  const [docs, total] = await Promise.all([
    prisma.comprobanteComercial.findMany({
      where,
      include: { tercero: true, asiento: { select: { id: true, numeroComprobante: true, estado: true } }, pagosRecibidos: { select: { id: true, monto: true } } },
      orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.comprobanteComercial.count({ where })
  ]);
  const ids = docs.map((d) => d.id);
  const dianDocs = ids.length ? await prisma.dianDocument.findMany({ where: { tenantId, originType: 'COMPROBANTE_COMERCIAL', originId: { in: ids } } }) : [];
  const fiscalByOrigin = new Map(dianDocs.map((d) => [d.originId, d]));
  const items = docs.map((doc) => ({ ...doc, ...sales.unpackMeta(doc.observaciones), dianDocument: fiscalByOrigin.get(doc.id) || null }));
  return { items, meta: { page, pageSize, total, pages: Math.max(Math.ceil(total / pageSize), 1) } };
}

module.exports = { list };
