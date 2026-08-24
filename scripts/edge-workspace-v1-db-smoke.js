const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const workspace = require('../src/modules/edge/edge-workspace.service');
require('../src/modules/restaurant/restaurant.rbac').installRestaurantRbac();

(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await prisma.tenant.create({
    data: { nombreEmpresa: `Edge Workspace QA ${suffix}`, subdomain: `edge-workspace-${suffix}`.slice(0, 60), nicho: 'RESTAURANTE', pais: 'CO', moneda: 'COP' }
  });
  const admin = await prisma.user.create({
    data: { tenantId: tenant.id, nombre: 'Admin Workspace', email: `admin-${suffix}@qa.vantixgc.local`, password: 'qa-not-a-real-password', rol: 'ADMIN', activo: true }
  });
  const serviceUser = await prisma.user.create({
    data: { tenantId: tenant.id, nombre: 'Edge Service', email: `edge-${suffix}@qa.vantixgc.local`, password: 'qa-service', rol: 'EDGE_AGENT', activo: true }
  });
  const agent = await prisma.edgeAgent.create({
    data: {
      tenantId: tenant.id,
      name: 'Caja QA',
      pointCode: `QA-${Date.now()}`,
      credentialHash: '0'.repeat(64),
      serviceUserId: serviceUser.id,
      state: 'ACTIVE',
      createdByUserId: admin.id
    }
  });
  await prisma.edgeInstallation.create({
    data: {
      tenantId: tenant.id,
      edgeAgentId: agent.id,
      installationId: `install-${suffix}`,
      lanHost: '192.168.50.10',
      lanPort: 8788,
      healthStatus: 'OK',
      lastHeartbeatAt: new Date()
    }
  });

  try {
    const grant = await workspace.createLocalAccessGrant(tenant.id, admin, agent.id);
    assert.ok(grant.token.length >= 40);
    assert.equal(grant.localOrigin, 'http://192.168.50.10:8788');
    assert.match(grant.localUrl, /\/access\?grant=/);

    const snapshot = await workspace.consumeLocalAccessGrant({ ...agent, tenantId: tenant.id }, grant.token);
    assert.equal(snapshot.user.id, admin.id);
    assert.equal(snapshot.tenant.id, tenant.id);
    assert.ok(snapshot.permissions.includes('*'));

    await assert.rejects(
      () => workspace.consumeLocalAccessGrant({ ...agent, tenantId: tenant.id }, grant.token),
      (error) => error?.code === 'EDGE_LOCAL_GRANT_INVALID'
    );
    console.log('EDGE WORKSPACE V1 DB SMOKE OK');
  } finally {
    await prisma.edgeLocalAccessGrant.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.edgeInstallation.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.edgeAgent.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.user.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.$disconnect();
  }
})().catch(async (error) => {
  console.error(error);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
