const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

async function assertCustomer(tenantId, customerThirdPartyId, client = prisma) {
  const customer = await client.tercero.findFirst({
    where: { id: customerThirdPartyId, tenantId, activo: true }
  });
  if (!customer) {
    throw new AppError(404, 'Cliente no encontrado en esta empresa', 'BIKE_CUSTOMER_NOT_FOUND');
  }
  return customer;
}

async function assertServiceProduct(tenantId, productId, client = prisma) {
  const product = await client.producto.findFirst({
    where: { id: productId, tenantId, activo: true }
  });
  if (!product) {
    throw new AppError(404, 'Producto de servicio no encontrado en esta empresa', 'BIKE_SERVICE_PRODUCT_NOT_FOUND');
  }
  if (product.tipo !== 'SERVICIO') {
    throw new AppError(409, 'El catálogo técnico Bike solo puede vincular productos tipo SERVICIO', 'BIKE_SERVICE_PRODUCT_TYPE_INVALID');
  }
  return product;
}

async function createBike(tenantId, input) {
  await assertCustomer(tenantId, input.customerThirdPartyId);
  try {
    return await prisma.bikeAsset.create({
      data: {
        tenantId,
        branchId: input.branchId || null,
        customerThirdPartyId: input.customerThirdPartyId,
        code: input.code,
        serial: input.serial || null,
        brand: input.brand,
        model: input.model,
        bikeType: input.bikeType || null,
        year: input.year || null,
        frameSize: input.frameSize || null,
        color: input.color || null,
        odometerKm: input.odometerKm ?? null,
        notes: input.notes || null,
        metadata: input.metadata || undefined
      }
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new AppError(409, 'Código o serial de bicicleta duplicado en esta empresa', 'BIKE_DUPLICATE');
    }
    throw error;
  }
}

async function listBikes(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.customerThirdPartyId) where.customerThirdPartyId = filters.customerThirdPartyId;
  if (filters.branchId) where.branchId = filters.branchId;
  if (filters.status) where.status = filters.status;
  if (filters.q) {
    where.OR = [
      { code: { contains: filters.q, mode: 'insensitive' } },
      { serial: { contains: filters.q, mode: 'insensitive' } },
      { brand: { contains: filters.q, mode: 'insensitive' } },
      { model: { contains: filters.q, mode: 'insensitive' } }
    ];
  }

  return prisma.bikeAsset.findMany({
    where,
    include: {
      components: { where: { active: true }, orderBy: { system: 'asc' } },
      _count: { select: { workOrders: true, appointments: true } }
    },
    orderBy: [{ updatedAt: 'desc' }, { brand: 'asc' }],
    take: Math.min(Number(filters.limit) || 100, 500)
  });
}

async function getBike(tenantId, id, client = prisma) {
  const bike = await client.bikeAsset.findFirst({
    where: { id, tenantId },
    include: {
      components: { where: { active: true }, orderBy: [{ system: 'asc' }, { componentType: 'asc' }] },
      workOrders: { orderBy: { createdAt: 'desc' }, take: 20 },
      appointments: { orderBy: { startsAt: 'desc' }, take: 20 }
    }
  });
  if (!bike) throw new AppError(404, 'Bicicleta no encontrada', 'BIKE_NOT_FOUND');
  return bike;
}

async function updateBike(tenantId, id, input) {
  await getBike(tenantId, id);
  if (input.customerThirdPartyId) await assertCustomer(tenantId, input.customerThirdPartyId);
  try {
    return await prisma.bikeAsset.update({ where: { id }, data: input });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new AppError(409, 'Código o serial de bicicleta duplicado en esta empresa', 'BIKE_DUPLICATE');
    }
    throw error;
  }
}

async function createServiceCatalogItem(tenantId, input) {
  const product = await assertServiceProduct(tenantId, input.productId);
  try {
    return await prisma.bikeServiceCatalog.create({
      data: {
        tenantId,
        productId: product.id,
        code: product.sku,
        name: product.nombre,
        category: input.category,
        estimatedMinutes: input.estimatedMinutes,
        basePrice: product.precio1,
        active: input.active !== false,
        metadata: input.metadata || undefined
      }
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new AppError(409, 'Ese servicio del Core ya está vinculado al catálogo Bike', 'BIKE_SERVICE_MAPPING_EXISTS');
    }
    throw error;
  }
}

async function listServiceCatalog(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.active !== undefined) where.active = filters.active;
  if (filters.category) where.category = filters.category;
  if (filters.q) {
    where.OR = [
      { code: { contains: filters.q, mode: 'insensitive' } },
      { name: { contains: filters.q, mode: 'insensitive' } },
      { category: { contains: filters.q, mode: 'insensitive' } }
    ];
  }
  const rows = await prisma.bikeServiceCatalog.findMany({
    where,
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    take: Math.min(Number(filters.limit) || 200, 500)
  });
  if (!rows.length) return rows;

  const products = await prisma.producto.findMany({
    where: { tenantId, id: { in: rows.map((row) => row.productId) } },
    select: {
      id: true,
      sku: true,
      nombre: true,
      descripcion: true,
      precio1: true,
      ivaPct: true,
      impoconsumoPct: true,
      activo: true,
      tipo: true
    }
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  return rows.map((row) => ({ ...row, product: byId.get(row.productId) || null }));
}

async function updateServiceCatalogItem(tenantId, id, input) {
  const item = await prisma.bikeServiceCatalog.findFirst({ where: { id, tenantId } });
  if (!item) throw new AppError(404, 'Servicio Bike no encontrado', 'BIKE_SERVICE_NOT_FOUND');

  const product = await assertServiceProduct(tenantId, input.productId || item.productId);
  const data = {
    ...input,
    productId: product.id,
    code: product.sku,
    name: product.nombre,
    basePrice: product.precio1
  };

  try {
    return await prisma.bikeServiceCatalog.update({ where: { id }, data });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new AppError(409, 'Ese servicio del Core ya está vinculado al catálogo Bike', 'BIKE_SERVICE_MAPPING_EXISTS');
    }
    throw error;
  }
}

async function foundationStatus(tenantId) {
  const [bikes, services, openOrders, upcomingAppointments] = await Promise.all([
    prisma.bikeAsset.count({ where: { tenantId } }),
    prisma.bikeServiceCatalog.count({ where: { tenantId, active: true } }),
    prisma.bikeWorkOrder.count({ where: { tenantId, status: { notIn: ['DELIVERED', 'CANCELLED'] } } }),
    prisma.bikeAppointment.count({ where: { tenantId, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gte: new Date() } } })
  ]);

  return {
    vertical: 'BIKE',
    version: 'bike-super-core-foundation-v1',
    tenantId,
    boundaries: {
      customers: 'SUPER_CORE_TERCEROS',
      products: 'SUPER_CORE_PRODUCTO',
      inventory: 'SUPER_CORE_INVENTARIO',
      sales: 'SUPER_CORE_COMERCIAL',
      cash: 'SUPER_CORE_TESORERIA',
      security: 'SUPER_CORE_RBAC',
      entitlement: 'SUPER_CORE_VERTICAL_ENTITLEMENT',
      sync: 'SUPER_CORE_EDGE',
      notifications: 'SUPER_CORE_NOTIFICACIONES'
    },
    counts: { bikes, services, openOrders, upcomingAppointments }
  };
}

module.exports = {
  assertCustomer,
  assertServiceProduct,
  createBike,
  listBikes,
  getBike,
  updateBike,
  createServiceCatalogItem,
  listServiceCatalog,
  updateServiceCatalogItem,
  foundationStatus
};
