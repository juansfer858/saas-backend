'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const rbac = require('../src/modules/platform/rbac/rbac.service');
const { installRestaurantRbac } = require('../src/modules/restaurant/restaurant.rbac');
const { installBikeRbac } = require('../src/modules/bike/bike.rbac');

installRestaurantRbac();
installBikeRbac();

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const adminId = demo.users.ADMIN;
  const suffix = crypto.randomBytes(4).toString('hex');
  let customRoleId = null;
  let bikeTenantId = null;

  try {
    // Simula el dato contaminado que ya existía por el registro global de Bike.
    const staleBike = await prisma.rbacRole.upsert({
      where: { tenantId_code: { tenantId: demo.tenantId, code: 'BIKE_MECANICO' } },
      create: { tenantId: demo.tenantId, code:'BIKE_MECANICO', name:'Bike mecanico', system:true, active:true },
      update: { vertical:null, system:true, active:true }
    });

    const permissions = await rbac.listPermissions(demo.tenantId);
    assert.equal(permissions.some((p)=>p.module.startsWith('BIKE')), false, 'Restaurant must not expose Bike permissions');
    assert.ok(permissions.some((p)=>p.module === 'RESTAURANTE'), 'Restaurant permissions must stay visible');
    assert.ok(permissions.some((p)=>p.module === 'CONTABILIDAD'), 'Core accounting permissions must stay visible');

    const roles = await rbac.listRoles(demo.tenantId);
    assert.equal(roles.some((role)=>role.code.startsWith('BIKE_')), false, 'Restaurant must not expose Bike roles');
    assert.ok(roles.some((role)=>role.code === 'MESERO'), 'Restaurant role MESERO must stay visible');

    const staleAfter = await prisma.rbacRole.findUnique({ where:{ id:staleBike.id } });
    assert.equal(staleAfter.active, false, 'Stale Bike role must be deactivated in restaurant tenant');
    assert.equal(staleAfter.vertical, 'BIKE', 'Stale Bike role must be tagged with its owner vertical');

    const adminRole = await prisma.rbacRole.findUnique({
      where:{ tenantId_code:{ tenantId:demo.tenantId, code:'ADMIN' } },
      include:{ permissions:{ include:{ permission:true } } }
    });
    assert.ok(adminRole, 'ADMIN role missing');
    assert.equal(adminRole.permissions.some((rp)=>rp.permission.module.startsWith('BIKE')), false, 'Restaurant ADMIN grant set must not contain Bike');

    await assert.rejects(
      ()=>rbac.createRole(demo.tenantId, adminId, { code:'BIKE_FAKE_'+suffix, name:'Bike fake', vertical:'BIKE' }),
      (error)=>error.code === 'RBAC_ROLE_VERTICAL_NOT_ENTITLED'
    );

    const custom = await rbac.createRole(demo.tenantId, adminId, {
      code:'SUPERVISOR_'+suffix.toUpperCase(),
      name:'Supervisor '+suffix,
      vertical:'RESTAURANT'
    });
    customRoleId = custom.id;

    await rbac.setRolePermissions(demo.tenantId, adminId, custom.id, ['RESTAURANTE.VER','CONTABILIDAD.VER']);
    await assert.rejects(
      ()=>rbac.setRolePermissions(demo.tenantId, adminId, custom.id, ['BIKE.VER']),
      (error)=>error.code === 'RBAC_PERMISSION_VERTICAL_FORBIDDEN'
    );

    const deleted = await rbac.deleteRole(demo.tenantId, adminId, custom.id);
    assert.equal(deleted.deleted, true);
    customRoleId = null;
    assert.equal(await prisma.rbacRole.findUnique({ where:{ id:custom.id } }), null, 'Custom role must be deleted');

    const systemRole = roles.find((role)=>role.code === 'MESERO');
    await assert.rejects(
      ()=>rbac.deleteRole(demo.tenantId, adminId, systemRole.id),
      (error)=>error.code === 'RBAC_SYSTEM_ROLE_DELETE_FORBIDDEN'
    );

    // Bike tenant still receives Bike catalog; isolation must not break that vertical.
    const bikeTenant = await prisma.tenant.create({
      data:{ nombreEmpresa:'Bike RBAC '+suffix, subdomain:'bike-rbac-'+suffix, nicho:'BIKE', pais:'CO', moneda:'COP', activo:true }
    });
    bikeTenantId = bikeTenant.id;
    const ui = require('node:fs').readFileSync('src/web/restaurant-v2-advanced-config-core-v1.html','utf8');
    assert.match(ui, /data-delete-role/, 'Restaurant Roles UI must expose delete button for custom roles');
    assert.match(ui, /RBAC aislado por vertical/, 'Restaurant Roles UI must explain vertical isolation');
    assert.match(ui, /<option value="RESTAURANT">Restaurante<\/option>/, 'Role creation must constrain vertical to Restaurant/Core');
    assert.doesNotMatch(ui, /placeholder="RESTAURANTE"/, 'Free-form vertical input must not return');

    const bikePermissions = await rbac.listPermissions(bikeTenant.id);
    const bikeRoles = await rbac.listRoles(bikeTenant.id);
    assert.ok(bikePermissions.some((p)=>p.module === 'BIKE'), 'Bike tenant must keep Bike permissions');
    assert.ok(bikeRoles.some((role)=>role.code === 'BIKE_MECANICO'), 'Bike tenant must keep Bike roles');
    assert.equal(bikePermissions.some((p)=>p.module === 'RESTAURANTE'), false, 'Bike tenant must not receive Restaurant permissions');

    console.log('RBAC_VERTICAL_ISOLATION=PASS');
    console.log('RESTAURANT_BIKE_PERMISSIONS=0');
    console.log('RESTAURANT_BIKE_ROLES=0');
    console.log('CUSTOM_ROLE_DELETE=PASS');
    console.log('SYSTEM_ROLE_DELETE_BLOCKED=PASS');
    console.log('BIKE_VERTICAL_PRESERVED=PASS');
  } finally {
    if (customRoleId) {
      await prisma.rbacUserRole.deleteMany({ where:{ roleId:customRoleId } }).catch(()=>{});
      await prisma.rbacRolePermission.deleteMany({ where:{ roleId:customRoleId } }).catch(()=>{});
      await prisma.rbacRole.deleteMany({ where:{ id:customRoleId } }).catch(()=>{});
    }
    if (bikeTenantId) {
      const roles = await prisma.rbacRole.findMany({ where:{ tenantId:bikeTenantId }, select:{ id:true } }).catch(()=>[]);
      const roleIds = roles.map((r)=>r.id);
      if (roleIds.length) {
        await prisma.rbacUserRole.deleteMany({ where:{ roleId:{ in:roleIds } } }).catch(()=>{});
        await prisma.rbacRolePermission.deleteMany({ where:{ roleId:{ in:roleIds } } }).catch(()=>{});
      }
      await prisma.rbacRole.deleteMany({ where:{ tenantId:bikeTenantId } }).catch(()=>{});
      await prisma.tenantVerticalEntitlement.deleteMany({ where:{ tenantId:bikeTenantId } }).catch(()=>{});
      await prisma.tenant.deleteMany({ where:{ id:bikeTenantId } }).catch(()=>{});
    }
  }
}

main().catch((error)=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
