const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const platform = require('../src/modules/edge/edge-platform.service');

async function main() {
  for (const delegate of ['edgeAgent', 'edgeInstallation', 'edgeRelease', 'edgeDeployment', 'edgeRelayRequest', 'edgeRemoteChannel', 'edgeRemoteOrder']) {
    assert.ok(prisma[delegate], `Prisma runtime no expone ${delegate}`);
  }

  const tenantId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const installationId = crypto.randomUUID();

  try {
    await prisma.edgeAgent.create({
      data: {
        id: agentId,
        tenantId,
        name: 'EDGE V2 Runtime CI',
        pointCode: `CI-${Date.now()}`,
        credentialHash: crypto.randomBytes(32).toString('hex'),
        serviceUserId: crypto.randomUUID(),
        createdByUserId: crypto.randomUUID(),
        softwareVersion: 'ci-runtime-v1'
      }
    });

    const heartbeat = await platform.heartbeat({ id: agentId, tenantId, softwareVersion: 'ci-runtime-v1' }, {
      installationId,
      deviceName: 'CI-WINDOWS',
      os: 'win32 ci',
      architecture: 'x64',
      lanHost: '192.168.50.10',
      lanPort: 8788,
      softwareVersion: 'ci-runtime-v1',
      healthStatus: 'OK',
      health: { pending: 0, printPending: 0 },
      relayConnected: true,
      updaterState: 'IDLE'
    });

    assert.equal(heartbeat.installationId, installationId);
    assert.equal(heartbeat.edgeAgentId, agentId);
    assert.equal(heartbeat.online, true);

    const rows = await platform.listInstallations(tenantId);
    assert.equal(rows.length, 1, 'Debe listar el Edge recién registrado');
    assert.equal(rows[0].agent.id, agentId);
    assert.equal(rows[0].installation.installationId, installationId);
    assert.equal(rows[0].installation.online, true);
    assert.equal(rows[0].installation.lanHost, '192.168.50.10');
    assert.equal(rows[0].installation.lanPort, 8788);

    console.log('EDGE PLATFORM V2 RUNTIME DB SMOKE OK');
    console.log(JSON.stringify({
      prismaDelegates: true,
      heartbeatPersisted: true,
      installationListed: true,
      installationId,
      agentId
    }, null, 2));
  } finally {
    await prisma.edgeDeployment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.edgeRelayRequest.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.edgeRemoteOrder.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.edgeRemoteChannel.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.edgeInstallation.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.edgeRelease.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.edgeAgent.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
