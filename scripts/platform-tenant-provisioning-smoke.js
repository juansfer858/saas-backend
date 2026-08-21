const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const provisioning = require('../src/modules/platform/saas/platform-tenant-provisioning.service');
const integration = require('../src/modules/accounting/accounting-integration.service');

async function main() {
  const stamp = Date.now();
  const superAdmin = await prisma.platformSuperAdmin.create({
    data: {
      name: 'Master QA',
      email: `master-${stamp}@example.com`,
      passwordHash: await bcrypt.hash(`Master-${stamp}-Secure!`, 12),
      active: true
    }
  });

  const core = await provisioning.createTenant(superAdmin.id, {
    nombreEmpresa: `Papelería Próxima ${stamp}`,
    templateCode: 'CORE',
    nit: null,
    pais: 'CO',
    moneda: 'COP',
    admin: { nombre: 'Admin Core', email: `core-${stamp}@example.com`, password: `Tenant-Core-${stamp}!` }
  });
  assert.equal(core.template.code, 'CORE');
  assert.equal(core.tenant.nicho, 'CORE');
  assert.ok(core.tenant.subdomain.startsWith('papeleria-proxima-'));
  assert.equal(core.access.passwordReturned, false);

  const restaurant = await provisioning.createTenant(superAdmin.id, {
    nombreEmpresa: `Restaurante Prueba ${stamp}`,
    templateCode: 'RESTAURANTE',
    nit: null,
    pais: 'CO',
    moneda: 'COP',
    admin: { nombre: 'Admin Restaurante', email: `rest-${stamp}@example.com`, password: `Tenant-Rest-${stamp}!` }
  });
  assert.equal(restaurant.template.code, 'RESTAURANTE');
  assert.equal(restaurant.tenant.nicho, 'RESTAURANTE');
  assert.ok(restaurant.tenant.subdomain.startsWith('restaurante-prueba-'));

  for (const result of [core, restaurant]) {
    const [accounts, cash, generic, adminRole, audit, ready] = await Promise.all([
      prisma.cuentaPUC.count({ where: { tenantId: result.tenant.id } }),
      prisma.cajaBanco.findFirst({ where: { tenantId: result.tenant.id, nombre: 'Caja General', activo: true } }),
      prisma.tercero.findFirst({ where: { tenantId: result.tenant.id, identificacion: '222222222222', activo: true } }),
      prisma.rbacUserRole.count({ where: { tenantId: result.tenant.id, userId: result.admin.id } }),
      prisma.platformAudit.findFirst({ where: { tenantId: result.tenant.id, action: 'TENANT_CREATE' } }),
      integration.integrationStatus(result.tenant.id)
    ]);
    assert.ok(accounts >= 80, 'Tenant debe recibir PUC completo');
    assert.ok(cash, 'Tenant debe recibir Caja General');
    assert.ok(generic, 'Tenant debe recibir tercero genérico');
    assert.ok(adminRole >= 1, 'ADMIN inicial debe recibir RBAC');
    assert.ok(audit, 'Alta debe quedar auditada');
    assert.equal(ready.ready, true, 'Integración contable debe nacer lista');
  }

  const restaurantConfig = await prisma.restaurantConfig.findUnique({ where: { tenantId: restaurant.tenant.id } });
  assert.ok(restaurantConfig, 'Plantilla Restaurante debe activar su configuración vertical');

  const templates = provisioning.templates();
  assert.equal(templates.find((x) => x.code === 'CORE').available, true);
  assert.equal(templates.find((x) => x.code === 'RESTAURANTE').available, true);
  const paper = templates.find((x) => x.code === 'PAPELERIA');
  assert.ok(paper, 'Catálogo debe publicar PAPELERIA como próxima plantilla');
  assert.equal(paper.label, 'Papelería');
  assert.equal(paper.available, false);
  assert.equal(paper.comingSoon, true);

  const ui = fs.readFileSync('src/web/platform-restaurant-fiscal-governance.js', 'utf8');
  for (const marker of ['+ Crear nuevo tenant', '/platform/api/tenant-templates', '/platform/api/tenants', 'Contraseña inicial']) {
    assert.ok(ui.includes(marker), `UI plataforma debe contener ${marker}`);
  }
  assert.ok(ui.includes('templates.filter((x) => !x.available)'), 'UI debe separar plantillas próximas recibidas dinámicamente');
  assert.ok(ui.includes("coming.map((t) => esc(t.label))"), 'UI debe mostrar los nombres dinámicos de plantillas próximas');
  assert.ok(ui.includes('passwordReturned: false') === false, 'UI no debe fingir que recibe contraseña del servidor');

  const cli = fs.readFileSync('scripts/create-platform-superadmin-interactive.js', 'utf8');
  assert.ok(cli.includes('setRawMode(true)'), 'CLI debe enmascarar contraseña');
  assert.ok(cli.includes('bcrypt.hash(password, 12)'), 'CLI debe persistir solo hash bcrypt');
  assert.ok(!cli.includes('console.log(password)'), 'CLI nunca imprime contraseña');

  const authRoutes = fs.readFileSync('src/modules/auth/auth.routes.js', 'utf8');
  assert.ok(authRoutes.includes('PUBLIC_TENANT_REGISTRATION_ENABLED'), 'Registro público debe requerir opt-in explícito');
  assert.ok(authRoutes.includes('PUBLIC_TENANT_REGISTRATION_DISABLED'), 'Debe existir respuesta explícita cuando el registro público está cerrado');

  console.log('PLATFORM TENANT PROVISIONING SMOKE OK');
  console.log(JSON.stringify({
    coreTenant: core.tenant.subdomain,
    restaurantTenant: restaurant.tenant.subdomain,
    coreReady: true,
    restaurantReady: true,
    papeleriaAvailable: false,
    papeleriaComingSoon: true,
    audited: true,
    passwordReturned: false,
    anonymousRegistrationDefault: 'DISABLED'
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
