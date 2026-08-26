const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const DEFAULT_ZONE_NAME = 'Salón principal';
const MAX_ZONES_PER_TENANT = 50;

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

async function ensureDefaultZone(tenantId, client = prisma) {
  let zone = await client.restaurantZone.findFirst({
    where: { tenantId, active: true },
    orderBy: [{ sortOrder: 'asc' }, { creadoEn: 'asc' }]
  });

  if (!zone) {
    zone = await client.restaurantZone.upsert({
      where: { tenantId_name: { tenantId, name: DEFAULT_ZONE_NAME } },
      create: { tenantId, name: DEFAULT_ZONE_NAME, sortOrder: 0, active: true },
      update: { active: true }
    });
  }

  await client.restaurantTable.updateMany({
    where: { tenantId, active: true, zoneId: null },
    data: { zoneId: zone.id }
  });

  return zone;
}

async function resolveZoneForTable(tenantId, zoneId, client = prisma) {
  const fallback = await ensureDefaultZone(tenantId, client);
  if (!zoneId) return fallback;
  const zone = await client.restaurantZone.findFirst({ where: { id: zoneId, tenantId, active: true } });
  if (!zone) throw new AppError(400, 'La zona seleccionada no existe o está inactiva', 'RESTAURANT_ZONE_INVALID');
  return zone;
}

async function listZones(tenantId, user = null) {
  await ensureDefaultZone(tenantId);
  const zones = await prisma.restaurantZone.findMany({
    where: { tenantId, active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
  });
  const ids = zones.map((zone) => zone.id);
  if (!ids.length) return [];

  const tableWhere = { tenantId, active: true, zoneId: { in: ids } };
  if (user?.rol === 'MESERO') tableWhere.assignedWaiterId = user.id;
  const tables = await prisma.restaurantTable.findMany({
    where: tableWhere,
    select: { id: true, zoneId: true, state: true }
  });
  const counts = new Map();
  for (const table of tables) {
    const current = counts.get(table.zoneId) || { total: 0, open: 0, billRequested: 0 };
    current.total += 1;
    if (table.state === 'OCUPADA' || table.state === 'CUENTA_PEDIDA') current.open += 1;
    if (table.state === 'CUENTA_PEDIDA') current.billRequested += 1;
    counts.set(table.zoneId, current);
  }

  const visible = user?.rol === 'MESERO' ? zones.filter((zone) => counts.has(zone.id)) : zones;
  return visible.map((zone) => ({
    ...zone,
    tableCount: counts.get(zone.id)?.total || 0,
    openTableCount: counts.get(zone.id)?.open || 0,
    billRequestedCount: counts.get(zone.id)?.billRequested || 0
  }));
}

async function createZone(tenantId, input) {
  const name = cleanName(input.name);
  if (!name) throw new AppError(400, 'El nombre de la zona es obligatorio', 'RESTAURANT_ZONE_NAME_REQUIRED');
  const count = await prisma.restaurantZone.count({ where: { tenantId, active: true } });
  if (count >= MAX_ZONES_PER_TENANT) throw new AppError(409, `Máximo ${MAX_ZONES_PER_TENANT} zonas activas por restaurante`, 'RESTAURANT_ZONE_LIMIT');

  const existing = await prisma.restaurantZone.findFirst({
    where: { tenantId, name: { equals: name, mode: 'insensitive' } }
  });
  if (existing?.active) throw new AppError(409, 'Ya existe una zona con ese nombre', 'RESTAURANT_ZONE_DUPLICATE');

  const max = await prisma.restaurantZone.aggregate({ where: { tenantId, active: true }, _max: { sortOrder: true } });
  const sortOrder = Number(max._max.sortOrder || 0) + 10;
  if (existing) {
    return prisma.restaurantZone.update({
      where: { id: existing.id },
      data: { name, active: true, sortOrder }
    });
  }
  return prisma.restaurantZone.create({ data: { tenantId, name, sortOrder } });
}

async function renameZone(tenantId, id, input) {
  const zone = await prisma.restaurantZone.findFirst({ where: { id, tenantId, active: true } });
  if (!zone) throw new AppError(404, 'Zona no encontrada', 'RESTAURANT_ZONE_NOT_FOUND');
  const name = cleanName(input.name);
  if (!name) throw new AppError(400, 'El nombre de la zona es obligatorio', 'RESTAURANT_ZONE_NAME_REQUIRED');
  const duplicate = await prisma.restaurantZone.findFirst({
    where: { tenantId, id: { not: id }, name: { equals: name, mode: 'insensitive' } }
  });
  if (duplicate) throw new AppError(409, 'Ya existe o existió una zona con ese nombre; reactívala desde Crear zona', 'RESTAURANT_ZONE_DUPLICATE');
  return prisma.restaurantZone.update({ where: { id }, data: { name } });
}

async function removeZone(tenantId, id) {
  return prisma.$transaction(async (tx) => {
    const zone = await tx.restaurantZone.findFirst({ where: { id, tenantId, active: true } });
    if (!zone) throw new AppError(404, 'Zona no encontrada', 'RESTAURANT_ZONE_NOT_FOUND');
    const tables = await tx.restaurantTable.count({ where: { tenantId, zoneId: id, active: true } });
    if (tables) throw new AppError(409, 'Mueve o retira las mesas de esta zona antes de eliminarla', 'RESTAURANT_ZONE_HAS_TABLES');
    const activeZones = await tx.restaurantZone.count({ where: { tenantId, active: true } });
    if (activeZones <= 1) throw new AppError(409, 'El restaurante debe conservar al menos una zona', 'RESTAURANT_ZONE_LAST');
    return tx.restaurantZone.update({ where: { id }, data: { active: false } });
  });
}

async function assignTable(tenantId, tableId, zoneId) {
  const zone = await resolveZoneForTable(tenantId, zoneId);
  const table = await prisma.restaurantTable.findFirst({ where: { id: tableId, tenantId, active: true } });
  if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
  return prisma.restaurantTable.update({
    where: { id: table.id },
    data: { zoneId: zone.id },
    include: { zone: true }
  });
}

module.exports = {
  DEFAULT_ZONE_NAME,
  ensureDefaultZone,
  resolveZoneForTable,
  listZones,
  createZone,
  renameZone,
  removeZone,
  assignTable
};
