const rbac = require('../modules/platform/rbac/rbac.service');

async function seedPlatformDefaults(tx, tenant, adminUser = null) {
  const roles = await rbac.ensureTenantRoles(tenant.id, tx);
  await tx.printTenantConfig.upsert({
    where: { tenantId: tenant.id },
    create: { tenantId: tenant.id, defaultFormat: 'TERMICA_80', invoicePdfFormat: 'PDF_CARTA', qrMinimumMm: 20, updatedByUserId: adminUser?.id || null },
    update: {}
  });
  await tx.platformTenantControl.upsert({
    where: { tenantId: tenant.id },
    create: { tenantId: tenant.id, planCode: 'CORE', rolloutChannel: tenant.subdomain === 'demo-core' ? 'PILOTO' : 'ESTABLE' },
    update: {}
  });
  if (adminUser && roles.ADMIN) {
    await tx.rbacUserRole.upsert({
      where: { tenantId_userId_roleId: { tenantId: tenant.id, userId: adminUser.id, roleId: roles.ADMIN.id } },
      create: { tenantId: tenant.id, userId: adminUser.id, roleId: roles.ADMIN.id },
      update: {}
    });
  }
  return { tenantId: tenant.id, roles: Object.keys(roles), print: true, platformControl: true };
}

module.exports = { seedPlatformDefaults };
