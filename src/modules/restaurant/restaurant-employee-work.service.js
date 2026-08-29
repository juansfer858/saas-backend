'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const MARKER = 'VANTIX_RESTAURANT_EMPLOYEE_WORK_FLEX_V1';
const PRODUCTION_ROLES = Object.freeze(['COCINA', 'BARRA', 'POSTRES']);
const STATIONS = Object.freeze(['COCINA', 'BARRA', 'POSTRES']);
const OPERATIONAL_ROLES = Object.freeze(['MESERO', ...PRODUCTION_ROLES]);

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function defaultStations(role) {
  const normalized = String(role || '').toUpperCase();
  return PRODUCTION_ROLES.includes(normalized) ? [normalized] : [];
}

function stationLabel(station) {
  if (station === 'COCINA') return 'Cocina';
  if (station === 'BARRA') return 'Barra';
  if (station === 'POSTRES') return 'Postres';
  return station;
}

async function employee(tenantId, userId, client = prisma) {
  const row = await client.user.findFirst({ where: { id:userId, tenantId } });
  if (!row) throw new AppError(404, 'Empleado no encontrado', 'RESTAURANT_EMPLOYEE_NOT_FOUND');
  return row;
}

async function options(tenantId, client = prisma) {
  const [zones, tables] = await Promise.all([
    client.restaurantZone.findMany({
      where:{ tenantId, active:true },
      orderBy:[{ sortOrder:'asc' }, { name:'asc' }],
      select:{ id:true, name:true, sortOrder:true }
    }),
    client.restaurantTable.findMany({
      where:{ tenantId, active:true },
      orderBy:[{ code:'asc' }],
      select:{ id:true, code:true, name:true, zoneId:true, state:true }
    })
  ]);
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  return {
    marker:MARKER,
    flexibleSupport:true,
    zones,
    tables:tables.map((table) => ({
      ...table,
      zoneName:zoneById.get(table.zoneId)?.name || 'Sin zona'
    })),
    stations:STATIONS.map((code) => ({ code, label:stationLabel(code) }))
  };
}

function normalizedIds(row, field) {
  return uniqueStrings(row?.[field]);
}

function normalizedProfileForRole(user, row) {
  const role = String(user?.rol || '').toUpperCase();
  if (role === 'MESERO') {
    return {
      zoneIds:normalizedIds(row, 'zoneIds'),
      tableIds:normalizedIds(row, 'tableIds'),
      stations:[]
    };
  }
  if (PRODUCTION_ROLES.includes(role)) {
    const selected = uniqueStrings(row?.stations).filter((station) => STATIONS.includes(station));
    return { zoneIds:[], tableIds:[], stations:selected.length ? selected : defaultStations(role) };
  }
  return { zoneIds:[], tableIds:[], stations:[] };
}

function resolvedProfile(user, row, opts) {
  const normalized = normalizedProfileForRole(user, row);
  const zoneById = new Map(opts.zones.map((zone) => [zone.id, zone]));
  const tableById = new Map(opts.tables.map((table) => [table.id, table]));
  return {
    marker:MARKER,
    userId:user.id,
    role:String(user.rol || '').toUpperCase(),
    configured:Boolean(row),
    mode:'FLEXIBLE',
    flexibleSupport:true,
    zoneIds:normalized.zoneIds,
    tableIds:normalized.tableIds,
    stations:normalized.stations,
    zones:normalized.zoneIds.map((id) => zoneById.get(id)).filter(Boolean),
    tables:normalized.tableIds.map((id) => tableById.get(id)).filter(Boolean),
    stationDetails:normalized.stations.map((code) => ({ code, label:stationLabel(code) })),
    actualizadoEn:row?.actualizadoEn || null
  };
}

async function getProfile(tenantId, userId, client = prisma) {
  const [user, row, opts] = await Promise.all([
    employee(tenantId, userId, client),
    client.restaurantEmployeeWorkProfile.findUnique({ where:{ tenantId_userId:{ tenantId, userId } } }),
    options(tenantId, client)
  ]);
  return resolvedProfile(user, row, opts);
}

async function listProfiles(tenantId, client = prisma) {
  const [users, rows, opts] = await Promise.all([
    client.user.findMany({ where:{ tenantId }, orderBy:[{ activo:'desc' }, { nombre:'asc' }] }),
    client.restaurantEmployeeWorkProfile.findMany({ where:{ tenantId } }),
    options(tenantId, client)
  ]);
  const byUser = new Map(rows.map((row) => [row.userId, row]));
  return users.map((user) => ({
    userId:user.id,
    nombre:user.nombre,
    rol:user.rol,
    activo:user.activo,
    ...resolvedProfile(user, byUser.get(user.id) || null, opts)
  }));
}

async function validateAssignments(tenantId, role, input, client = prisma) {
  const normalizedRole = String(role || '').toUpperCase();
  if (normalizedRole === 'MESERO') {
    const zoneIds = uniqueStrings(input.zoneIds);
    const tableIds = uniqueStrings(input.tableIds);
    if (zoneIds.length) {
      const count = await client.restaurantZone.count({ where:{ tenantId, active:true, id:{ in:zoneIds } } });
      if (count !== zoneIds.length) throw new AppError(400, 'Una o más zonas no pertenecen al restaurante', 'RESTAURANT_EMPLOYEE_ZONE_INVALID');
    }
    if (tableIds.length) {
      const count = await client.restaurantTable.count({ where:{ tenantId, active:true, id:{ in:tableIds } } });
      if (count !== tableIds.length) throw new AppError(400, 'Una o más mesas no pertenecen al restaurante', 'RESTAURANT_EMPLOYEE_TABLE_INVALID');
    }
    return { zoneIds, tableIds, stations:[] };
  }

  if (PRODUCTION_ROLES.includes(normalizedRole)) {
    const stations = uniqueStrings(input.stations).map((station) => station.toUpperCase());
    if (stations.some((station) => !STATIONS.includes(station))) {
      throw new AppError(400, 'Uno o más módulos de producción son inválidos', 'RESTAURANT_EMPLOYEE_STATION_INVALID');
    }
    return { zoneIds:[], tableIds:[], stations:stations.length ? stations : defaultStations(normalizedRole) };
  }

  return { zoneIds:[], tableIds:[], stations:[] };
}

async function saveProfile(tenantId, actorUserId, userId, input) {
  return prisma.$transaction(async (tx) => {
    const user = await employee(tenantId, userId, tx);
    const before = await tx.restaurantEmployeeWorkProfile.findUnique({ where:{ tenantId_userId:{ tenantId, userId } } });
    const normalized = await validateAssignments(tenantId, user.rol, input || {}, tx);
    const row = await tx.restaurantEmployeeWorkProfile.upsert({
      where:{ tenantId_userId:{ tenantId, userId } },
      create:{
        tenantId,
        userId,
        roleSnapshot:String(user.rol || '').toUpperCase(),
        zoneIds:normalized.zoneIds,
        tableIds:normalized.tableIds,
        stations:normalized.stations,
        flexibleSupport:true,
        updatedByUserId:actorUserId || null
      },
      update:{
        roleSnapshot:String(user.rol || '').toUpperCase(),
        zoneIds:normalized.zoneIds,
        tableIds:normalized.tableIds,
        stations:normalized.stations,
        flexibleSupport:true,
        updatedByUserId:actorUserId || null
      }
    });
    await tx.auditoriaContable.create({
      data:{
        tenantId,
        userId:actorUserId,
        entidad:'RESTAURANT_EMPLOYEE_WORK',
        entidadId:userId,
        accion:'UPDATE',
        metadata:{
          marker:MARKER,
          mode:'FLEXIBLE',
          before:before ? { roleSnapshot:before.roleSnapshot, zoneIds:before.zoneIds, tableIds:before.tableIds, stations:before.stations } : null,
          after:{ roleSnapshot:row.roleSnapshot, zoneIds:row.zoneIds, tableIds:row.tableIds, stations:row.stations },
          note:'La asignación ordena/prioriza el trabajo; no bloquea refuerzos fuera de la asignación.'
        }
      }
    });
    const opts = await options(tenantId, tx);
    return resolvedProfile(user, row, opts);
  });
}

function productionRuntimeUser(user) {
  const role = String(user?.rol || '').toUpperCase();
  if (!PRODUCTION_ROLES.includes(role)) return user;
  return { ...user, rol:'PRODUCCION', securityRole:role };
}

function uiRoleFor(user) {
  const role = String(user?.rol || '').toUpperCase();
  return PRODUCTION_ROLES.includes(role) ? 'PRODUCCION' : role;
}

module.exports = {
  MARKER,
  PRODUCTION_ROLES,
  STATIONS,
  OPERATIONAL_ROLES,
  defaultStations,
  stationLabel,
  options,
  getProfile,
  listProfiles,
  saveProfile,
  productionRuntimeUser,
  uiRoleFor
};
