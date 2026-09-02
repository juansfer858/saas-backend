const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');

const STATION_QUEUES = Object.freeze(['COCINA', 'BARRA', 'POSTRES']);
const STATION_MODES = Object.freeze(['KDS', 'IMPRESORA', 'AMBOS']);
const ROLE_PREFIX = 'STATION:';

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function stationRole(id) {
  return `${ROLE_PREFIX}${String(id || '').trim()}`;
}

function stationIdFromRole(role) {
  const value = String(role || '').trim();
  return value.startsWith(ROLE_PREFIX) ? value.slice(ROLE_PREFIX.length) : null;
}

async function assertUniqueName(tenantId, name, exceptId = null, client = prisma) {
  const normalized = normalizeName(name).toLocaleLowerCase('es');
  const rows = await client.restaurantProductionStation.findMany({
    where: { tenantId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true }
  });
  if (rows.some((row) => normalizeName(row.name).toLocaleLowerCase('es') === normalized)) {
    throw new AppError(409, 'Ya existe una estación con ese nombre', 'PRINT_STATION_DUPLICATE_NAME');
  }
}

async function audit(client, tenantId, userId, station, action) {
  if (!userId) return;
  await client.auditoriaContable.create({
    data: {
      tenantId,
      userId,
      entidad: 'RESTAURANT_PRODUCTION_STATION',
      entidadId: station.id,
      accion: action,
      metadata: {
        id: station.id,
        name: station.name,
        queue: station.queue,
        mode: station.mode,
        active: station.active,
        sortOrder: station.sortOrder
      }
    }
  });
}

async function listStations(tenantId, options = {}) {
  const includeInactive = options.includeInactive !== false;
  const stations = await prisma.restaurantProductionStation.findMany({
    where: { tenantId, ...(includeInactive ? {} : { active: true }) },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
  });
  if (!stations.length) return [];

  const roles = stations.map((station) => stationRole(station.id));
  const printers = await prisma.printerEndpoint.findMany({
    where: { tenantId, role: { in: roles } },
    orderBy: { name: 'asc' }
  });
  const byRole = new Map();
  for (const printer of printers) {
    if (!byRole.has(printer.role)) byRole.set(printer.role, []);
    byRole.get(printer.role).push(printer);
  }
  return stations.map((station) => ({
    ...station,
    printerRole: stationRole(station.id),
    printers: byRole.get(stationRole(station.id)) || []
  }));
}

async function createStation(tenantId, userId, input) {
  const name = normalizeName(input.name);
  if (!name) throw new AppError(400, 'Nombre de estación requerido', 'PRINT_STATION_NAME_REQUIRED');
  return prisma.$transaction(async (tx) => {
    await assertUniqueName(tenantId, name, null, tx);
    const station = await tx.restaurantProductionStation.create({
      data: {
        tenantId,
        name,
        queue: input.queue,
        mode: input.mode,
        active: input.active !== false,
        sortOrder: Number(input.sortOrder || 0)
      }
    });
    await audit(tx, tenantId, userId, station, 'CREATE');
    return { ...station, printerRole: stationRole(station.id), printers: [] };
  });
}

async function updateStation(tenantId, userId, id, input) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.restaurantProductionStation.findFirst({ where: { id, tenantId } });
    if (!current) throw new AppError(404, 'Estación no encontrada', 'PRINT_STATION_NOT_FOUND');
    const name = Object.prototype.hasOwnProperty.call(input, 'name') ? normalizeName(input.name) : current.name;
    if (!name) throw new AppError(400, 'Nombre de estación requerido', 'PRINT_STATION_NAME_REQUIRED');
    if (name !== current.name) await assertUniqueName(tenantId, name, id, tx);
    const station = await tx.restaurantProductionStation.update({
      where: { id: current.id },
      data: {
        ...(Object.prototype.hasOwnProperty.call(input, 'name') ? { name } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'queue') ? { queue: input.queue } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'mode') ? { mode: input.mode } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'active') ? { active: input.active } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'sortOrder') ? { sortOrder: Number(input.sortOrder) } : {})
      }
    });
    await audit(tx, tenantId, userId, station, 'UPDATE');
    const printers = await tx.printerEndpoint.findMany({ where: { tenantId, role: stationRole(id) }, orderBy: { name: 'asc' } });
    return { ...station, printerRole: stationRole(station.id), printers };
  });
}

async function removeStation(tenantId, userId, id) {
  return updateStation(tenantId, userId, id, { active: false });
}

async function routeInfo(tenantId, roles) {
  const normalizedQueues = [...new Set((roles || []).map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))];
  const stations = await listStations(tenantId, { includeInactive: false });
  const stationByRole = new Map();
  for (const station of stations) {
    if (!['IMPRESORA', 'AMBOS'].includes(station.mode)) continue;
    stationByRole.set(station.printerRole, station);
  }
  const printerRoles = [...normalizedQueues];
  for (const station of stationByRole.values()) {
    if (normalizedQueues.includes(station.queue)) printerRoles.push(station.printerRole);
  }
  return { normalizedQueues, stationByRole, printerRoles: [...new Set(printerRoles)] };
}

module.exports = {
  STATION_QUEUES,
  STATION_MODES,
  ROLE_PREFIX,
  stationRole,
  stationIdFromRole,
  listStations,
  createStation,
  updateStation,
  removeStation,
  routeInfo
};
