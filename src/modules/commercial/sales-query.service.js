const { prisma } = require('../../config/prisma');
const sales = require('./sales.service');

const ISSUED_STATES = ['EMITIDO', 'PAGADO_PARCIAL', 'PAGADO_TOTAL', 'CONFIRMADO'];
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function safeTimezoneOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-840, Math.min(840, Math.trunc(parsed)));
}

function localDateKey(value, offsetMinutes) {
  const shifted = new Date(new Date(value).getTime() - offsetMinutes * MINUTE_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function periodBounds(offsetMinutes) {
  const shiftedNow = new Date(Date.now() - offsetMinutes * MINUTE_MS);
  const year = shiftedNow.getUTCFullYear();
  const month = shiftedNow.getUTCMonth();
  const day = shiftedNow.getUTCDate();
  const atLocalMidnight = (y, m, d) => new Date(Date.UTC(y, m, d) + offsetMinutes * MINUTE_MS);
  const todayStart = atLocalMidnight(year, month, day);
  const tomorrowStart = atLocalMidnight(year, month, day + 1);
  const monthStart = atLocalMidnight(year, month, 1);
  const previousMonthStart = atLocalMidnight(year, month - 1, 1);
  const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
  const last7Start = new Date(todayStart.getTime() - 6 * DAY_MS);
  return { todayStart, tomorrowStart, monthStart, previousMonthStart, yesterdayStart, last7Start };
}

function numeric(value) {
  return Number(value || 0);
}

function trendPct(current, previous) {
  const now = numeric(current);
  const before = numeric(previous);
  if (before === 0) return null;
  return Number((((now - before) / Math.abs(before)) * 100).toFixed(1));
}

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

async function dashboard(tenantId, filters = {}) {
  const offsetMinutes = safeTimezoneOffset(filters.tzOffsetMinutes);
  const bounds = periodBounds(offsetMinutes);
  const saleBase = { tenantId, tipo: 'FACTURA_VENTA', estado: { in: ISSUED_STATES } };
  const openReceivables = { tenantId, tipo: 'CXC', estado: { in: ['PENDIENTE', 'PARCIAL'] }, saldo: { gt: 0 } };

  const [
    todayAgg,
    yesterdayAgg,
    monthAgg,
    previousMonthAgg,
    dailySales,
    productGroups,
    receivableAgg,
    receivableCount,
    activeProducts,
    criticalStock
  ] = await Promise.all([
    prisma.comprobanteComercial.aggregate({
      where: { ...saleBase, fecha: { gte: bounds.todayStart, lt: bounds.tomorrowStart } },
      _sum: { total: true },
      _count: { id: true }
    }),
    prisma.comprobanteComercial.aggregate({
      where: { ...saleBase, fecha: { gte: bounds.yesterdayStart, lt: bounds.todayStart } },
      _sum: { total: true },
      _count: { id: true }
    }),
    prisma.comprobanteComercial.aggregate({
      where: { ...saleBase, fecha: { gte: bounds.monthStart, lt: bounds.tomorrowStart } },
      _sum: { total: true },
      _count: { id: true }
    }),
    prisma.comprobanteComercial.aggregate({
      where: { ...saleBase, fecha: { gte: bounds.previousMonthStart, lt: bounds.monthStart } },
      _sum: { total: true },
      _count: { id: true }
    }),
    prisma.comprobanteComercial.findMany({
      where: { ...saleBase, fecha: { gte: bounds.last7Start, lt: bounds.tomorrowStart } },
      select: { fecha: true, total: true }
    }),
    prisma.detalleComprobante.groupBy({
      by: ['productoId'],
      where: {
        tenantId,
        productoId: { not: null },
        comprobante: {
          is: {
            tenantId,
            tipo: 'FACTURA_VENTA',
            estado: { in: ISSUED_STATES },
            fecha: { gte: bounds.monthStart, lt: bounds.tomorrowStart }
          }
        }
      },
      _sum: { cantidad: true, totalLinea: true }
    }),
    prisma.cartera.aggregate({ where: openReceivables, _sum: { saldo: true } }),
    prisma.cartera.count({ where: openReceivables }),
    prisma.producto.count({ where: { tenantId, activo: true } }),
    prisma.producto.count({ where: { tenantId, activo: true, tipo: 'PRODUCTO', controlaInventario: true, stockActual: { lte: 5 } } })
  ]);

  const productIds = productGroups.map((row) => row.productoId).filter(Boolean);
  const products = productIds.length
    ? await prisma.producto.findMany({ where: { tenantId, id: { in: productIds } }, select: { id: true, nombre: true, sku: true } })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const totalProductRevenue = productGroups.reduce((sum, row) => sum + numeric(row._sum.totalLinea), 0);
  const topProducts = productGroups
    .map((row) => ({
      productoId: row.productoId,
      nombre: productById.get(row.productoId)?.nombre || 'Producto',
      sku: productById.get(row.productoId)?.sku || '',
      cantidad: numeric(row._sum.cantidad),
      ventas: numeric(row._sum.totalLinea)
    }))
    .sort((a, b) => (b.cantidad - a.cantidad) || (b.ventas - a.ventas))
    .slice(0, 5)
    .map((row) => ({ ...row, participacion: totalProductRevenue > 0 ? Number(((row.ventas / totalProductRevenue) * 100).toFixed(1)) : 0 }));

  const dailyMap = new Map();
  for (const row of dailySales) {
    const key = localDateKey(row.fecha, offsetMinutes);
    const current = dailyMap.get(key) || { total: 0, count: 0 };
    current.total += numeric(row.total);
    current.count += 1;
    dailyMap.set(key, current);
  }
  const salesByDay = Array.from({ length: 7 }, (_, index) => {
    const boundary = new Date(bounds.last7Start.getTime() + index * DAY_MS);
    const key = localDateKey(boundary, offsetMinutes);
    const value = dailyMap.get(key) || { total: 0, count: 0 };
    return { date: key, total: Number(value.total.toFixed(2)), count: value.count };
  });

  const todayTotal = numeric(todayAgg._sum.total);
  const yesterdayTotal = numeric(yesterdayAgg._sum.total);
  const monthTotal = numeric(monthAgg._sum.total);
  const previousMonthTotal = numeric(previousMonthAgg._sum.total);
  const monthCount = numeric(monthAgg._count.id);

  return {
    timezoneOffsetMinutes: offsetMinutes,
    kpis: {
      ventasHoy: todayTotal,
      ventasAyer: yesterdayTotal,
      tendenciaHoyPct: trendPct(todayTotal, yesterdayTotal),
      ventasMes: monthTotal,
      ventasMesAnterior: previousMonthTotal,
      tendenciaMesPct: trendPct(monthTotal, previousMonthTotal),
      ticketPromedio: monthCount > 0 ? Number((monthTotal / monthCount).toFixed(2)) : 0,
      ventasMesCantidad: monthCount,
      carteraPendiente: numeric(receivableAgg._sum.saldo),
      carteraDocumentos: receivableCount
    },
    salesByDay,
    topProducts,
    productSalesTotal: Number(totalProductRevenue.toFixed(2)),
    indicators: {
      productosActivos: activeProducts,
      stockCritico: criticalStock
    },
    updatedAt: new Date()
  };
}

module.exports = { list, dashboard };
