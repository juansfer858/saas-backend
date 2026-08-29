'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const work = require('../src/modules/restaurant/restaurant-employee-work.service');
const { ensureRestaurantDemoTenant, SUBDOMAIN } = require('./ensure-restaurant-demo-tenant');

async function rejectsCode(promise, code) {
  let error = null;
  try { await promise; } catch (caught) { error = caught; }
  assert.ok(error, `Se esperaba error ${code}`);
  assert.equal(error.code, code);
}

async function main() {
  await ensureRestaurantDemoTenant();
  const tenant = await prisma.tenant.findUnique({ where:{ subdomain:SUBDOMAIN } });
  assert.ok(tenant?.id);

  const admin = await prisma.user.findFirst({ where:{ tenantId:tenant.id, rol:{ in:['ADMIN','SUPER_ADMIN'] }, activo:true } });
  const waiter = await prisma.user.findFirst({ where:{ tenantId:tenant.id, rol:'MESERO', activo:true } });
  assert.ok(admin?.id, 'admin demo faltante');
  assert.ok(waiter?.id, 'mesero demo faltante');

  const opts = await work.options(tenant.id);
  assert.ok(opts.zones.length >= 1, 'zonas demo faltantes');
  assert.ok(opts.tables.length >= 1, 'mesas demo faltantes');

  const waiterProfile = await work.saveProfile(tenant.id, admin.id, waiter.id, {
    zoneIds:[opts.zones[0].id],
    tableIds:[opts.tables[0].id],
    stations:[]
  });
  assert.equal(waiterProfile.mode, 'FLEXIBLE');
  assert.equal(waiterProfile.flexibleSupport, true);
  assert.deepEqual(waiterProfile.zoneIds, [opts.zones[0].id]);
  assert.deepEqual(waiterProfile.tableIds, [opts.tables[0].id]);
  assert.deepEqual(waiterProfile.stations, []);

  const stamp = String(Date.now()).slice(-10);
  const kitchen = await prisma.user.create({
    data:{
      tenantId:tenant.id,
      nombre:`Producción flexible ${stamp}`,
      email:`produccion-flex-${stamp}@example.test`,
      password:'not-used',
      rol:'COCINA',
      activo:true
    }
  });
  const kitchenProfile = await work.saveProfile(tenant.id, admin.id, kitchen.id, {
    zoneIds:[], tableIds:[], stations:['COCINA','BARRA']
  });
  assert.deepEqual(kitchenProfile.stations, ['COCINA','BARRA']);
  assert.equal(kitchenProfile.flexibleSupport, true);

  const runtimeUser = work.productionRuntimeUser(kitchen);
  assert.equal(runtimeUser.id, kitchen.id);
  assert.equal(runtimeUser.rol, 'PRODUCCION');
  assert.equal(runtimeUser.securityRole, 'COCINA');
  const persistedKitchen = await prisma.user.findUnique({ where:{ id:kitchen.id } });
  assert.equal(persistedKitchen.rol, 'COCINA', 'la flexibilidad no debe alterar el rol de seguridad persistido');

  const allTablesCount = await prisma.restaurantTable.count({ where:{ tenantId:tenant.id, active:true } });
  const waiterFloor = await restaurant.listTables(tenant.id, { ...waiter, rol:'MESERO_OPERATIVO_COMPARTIDO', securityRole:'MESERO' });
  assert.equal(waiterFloor.length, allTablesCount, 'la prioridad del mesero no debe ocultar mesas de refuerzo');

  const adminCommands = await restaurant.listCommands(tenant.id, admin, { limit:500 });
  const productionCommands = await restaurant.listCommands(tenant.id, runtimeUser, { limit:500 });
  assert.deepEqual(
    productionCommands.map((row) => row.id).sort(),
    adminCommands.map((row) => row.id).sort(),
    'el actor de producción flexible debe poder ver todas las estaciones para refuerzo'
  );

  const profiles = await work.listProfiles(tenant.id);
  assert.ok(profiles.some((profile) => profile.userId === waiter.id && profile.zoneIds.includes(opts.zones[0].id)));
  assert.ok(profiles.some((profile) => profile.userId === kitchen.id && profile.stations.includes('BARRA')));

  await rejectsCode(
    work.saveProfile(tenant.id, admin.id, kitchen.id, { stations:['NO_EXISTE'] }),
    'RESTAURANT_EMPLOYEE_STATION_INVALID'
  );

  const audits = await prisma.auditoriaContable.count({
    where:{ tenantId:tenant.id, entidad:'RESTAURANT_EMPLOYEE_WORK', entidadId:{ in:[waiter.id, kitchen.id] } }
  });
  assert.ok(audits >= 2, 'las asignaciones deben quedar auditadas');

  console.log(JSON.stringify({
    ok:true,
    waiterPriority:{ zones:waiterProfile.zoneIds.length, tables:waiterProfile.tableIds.length, allTablesVisible:waiterFloor.length },
    productionModules:kitchenProfile.stations,
    flexibleSupport:true,
    securityRolePersisted:persistedKitchen.rol,
    audits
  }));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
