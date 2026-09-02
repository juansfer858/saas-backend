const crypto = require('node:crypto');
const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');

const STATION_QUEUES = Object.freeze(['COCINA', 'BARRA', 'POSTRES']);
const STATION_MODES = Object.freeze(['KDS', 'IMPRESORA', 'AMBOS']);
const STORAGE_KEY = 'productionStations';
const ROLE_PREFIX = 'STATION:';

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function normalizeStation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const name = normalizeName(raw.name);
  const queue = String(raw.queue || '').trim().toUpperCase();
  const mode = String(raw.mode || '').trim().toUpperCase();
  if (!id || !name || !STATION_QUEUES.includes(queue) || !STATION_MODES.includes(mode)) return null;
  return {
    id,
    name,
    queue,
    mode,
    active: raw.active !== false,
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Math.max(0, Math.trunc(Number(raw.sortOrder))) : 0,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null
  };
}

function storedData(config) {
  return config?.themeData && typeof config.themeData === 'object' && !Array.isArray(config.themeData)
    ? config.themeData
    : {};
}

function storedStations(config) {
  const rows = storedData(config)[STORAGE_KEY];
  return (Array.isArray(rows) ? rows : []).map(normalizeStation).filter(Boolean);
}

async function getConfig(tenantId, client = prisma) {
  return client.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
}

function stationRole(id) {
  return `${ROLE_PREFIX}${String(id || '').trim()}`;
}

function stationIdFromRole(role) {
  const value = String(role || '').trim();
  return value.startsWith(ROLE_PREFIX) ? value.slice(ROLE_PREFIX.length) : null;
}

async function persistStations(tenantId, userId, beforeConfig, stations, action, stationId) {
  const nextThemeData = { ...storedData(beforeConfig), [STORAGE_KEY]: stations };
  const updated = await prisma.restaurantConfig.update({ where: { tenantId }, data: { themeData: nextThemeData } });
  if (userId) {
    await prisma.auditoriaContable.create({
      data: {
        tenantId,
        userId,
        entidad: 'RESTAURANT_PRODUCTION_STATION',
        entidadId: stationId || tenantId,
        accion: action,
        metadata: { stations }
      }
    });
  }
  return updated;
}

async function listStations(tenantId, options = {}) {
  const config = await getConfig(tenantId);
  const includeInactive = options.includeInactive !== false;
  const stations = storedStations(config)
    .filter((station) => includeInactive || station.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'));

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
  return stations.map((station) => ({ ...station, printerRole: stationRole(station.id), printers: byRole.get(stationRole(station.id)) || [] }));
}

function assertUniqueName(stations, name, exceptId = null) {
  const key = normalizeName(name).toLocaleLowerCase('es');
  if (stations.some((station) => station.id !== exceptId && station.active && station.name.toLocaleLowerCase('es') === key)) {
    throw new AppError(409, 'Ya existe una estación activa con ese nombre', 'PRINT_STATION_DUPLICATE_NAME');
  }
}

async function createStation(tenantId, userId, input) {
  const config = await getConfig(tenantId);
  const stations = storedStations(config);
  assertUniqueName(stations, input.name);
  const now = new Date().toISOString();
  const station = normalizeStation({
    id: crypto.randomUUID(),
    name: input.name,
    queue: input.queue,
    mode: input.mode,
    active: input.active !== false,
    sortOrder: input.sortOrder || 0,
    createdAt: now,
    updatedAt: now
  });
  if (!station) throw new AppError(400, 'Estación de preparación inválida', 'PRINT_STATION_INVALID');
  stations.push(station);
  await persistStations(tenantId, userId, config, stations, 'CREATE', station.id);
  return (await listStations(tenantId)).find((row) => row.id === station.id);
}

async function updateStation(tenantId, userId, id, input) {
  const config = await getConfig(tenantId);
  const stations = storedStations(config);
  const index = stations.findIndex((station) => station.id === id);
  if (index < 0) throw new AppError(404, 'Estación no encontrada', 'PRINT_STATION_NOT_FOUND');
  const current = stations[index];
  const name = Object.prototype.hasOwnProperty.call(input, 'name') ? input.name : current.name;
  assertUniqueName(stations, name, id);
  const next = normalizeStation({
    ...current,
    ...input,
    id: current.id,
    name,
    queue: input.queue || current.queue,
    mode: input.mode || current.mode,
    active: Object.prototype.hasOwnProperty.call(input, 'active') ? input.active : current.active,
    sortOrder: Object.prototype.hasOwnProperty.call(input, 'sortOrder') ? input.sortOrder : current.sortOrder,
    updatedAt: new Date().toISOString()
  });
  if (!next) throw new AppError(400, 'Estación de preparación inválida', 'PRINT_STATION_INVALID');
  stations[index] = next;
  await persistStations(tenantId, userId, config, stations, 'UPDATE', id);
  return (await listStations(tenantId)).find((row) => row.id === id);
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
