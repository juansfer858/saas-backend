'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const users = require('../src/modules/users/user.service');
const { userSchema } = require('../src/modules/users/user.schemas');
const rbac = require('../src/modules/platform/rbac/rbac.service');
const { installRestaurantRbac } = require('../src/modules/restaurant/restaurant.rbac');

(async () => {
  installRestaurantRbac();
  const tenant = await prisma.tenant.create({ data:{ nombreEmpresa:'CI Empleados Restaurante', subdomain:`employees-${Date.now()}`, nicho:'RESTAURANTE' } });
  const created = {};
  const stamp = Date.now();
  for (const role of ['MESERO','COCINA','BARRA','POSTRES','CAJERO']) {
    const input = userSchema.parse({
      nombre:`Empleado ${role}`,
      email:`${role.toLowerCase()}-${stamp}@example.test`,
      password:'ClaveSegura123!',
      rol:role,
      activo:true
    });
    created[role] = await users.createUser(tenant.id, input);
  }

  await rbac.ensureTenantRoles(tenant.id);
  const perms = {};
  for (const [role, user] of Object.entries(created)) perms[role] = await rbac.effectivePermissions(tenant.id, user);

  assert(perms.MESERO.has('PEDIDOS.CREAR'));
  assert(perms.MESERO.has('DOMICILIOS.CREAR'));
  assert(!perms.MESERO.has('COMANDAS.EDITAR'));
  for (const role of ['COCINA','BARRA','POSTRES']) assert(perms[role].has('COMANDAS.EDITAR'));
  assert(perms.CAJERO.has('DOMICILIOS.PAGAR'));
  assert(perms.CAJERO.has('TESORERIA.CERRAR'));

  const forbiddenSuper = userSchema.parse({
    nombre:'Escalacion bloqueada',
    email:`super-${stamp}@example.test`,
    password:'ClaveSegura123!',
    rol:'SUPER_ADMIN',
    activo:true
  });
  await assert.rejects(
    () => users.createUser(tenant.id, forbiddenSuper, { actorRole:'ADMIN' }),
    (error) => error?.code === 'USER_ROLE_ESCALATION_FORBIDDEN'
  );

  await assert.rejects(
    () => users.updateUser(tenant.id, created.MESERO.id, { activo:false }, { actorRole:'MESERO', actorUserId:created.MESERO.id }),
    (error) => error?.code === 'USER_SELF_DEACTIVATE_FORBIDDEN'
  );

  await users.updateUser(tenant.id, created.MESERO.id, { activo:false });
  const listed = await users.listUsers(tenant.id);
  const waiter = listed.find((row) => row.id === created.MESERO.id);
  assert.equal(waiter.activo, false);
  assert.equal(listed.length, 5);

  console.log(JSON.stringify({
    ok:true,
    tenantId:tenant.id,
    createdRoles:Object.keys(created),
    users:listed.length,
    waiterDeactivated:true,
    permissionsValidated:true,
    escalationBlocked:true,
    selfLockoutBlocked:true
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
