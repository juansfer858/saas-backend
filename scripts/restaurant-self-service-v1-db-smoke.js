const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const service = require('../src/modules/self-service/restaurant-self-service.service');
const installClarity = require('../src/modules/self-service/restaurant-install-clarity.service');
const verticalEntitlements = require('../src/modules/platform/verticals/vertical-entitlement.service');
const edgePlatform = require('../src/modules/edge/edge-platform.service');

async function main() {
  process.env.RESTAURANT_SELF_SERVICE_ENABLED = 'true';
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const registered = await service.registerRestaurant({
    restaurantName: `Restaurante Autoservicio ${suffix}`,
    adminName: 'Admin Autoservicio',
    email: `self-${suffix}@example.com`,
    password: 'Prueba-Segura-12345',
    phone: '3000000000',
    city: 'Yarumal',
    department: 'Antioquia',
    country: 'CO',
    currency: 'COP'
  });

  assert.ok(registered.session.token);
  assert.equal(registered.session.tenant.nicho, 'RESTAURANTE');
  assert.equal(registered.subscription.effectiveState, 'TRIAL');
  assert.equal(registered.subscription.daysRemaining > 0, true);
  assert.equal(registered.next, '/app/onboarding');

  const tenantId = registered.session.tenant.id;
  const [subscription, onboarding, entitlement] = await Promise.all([
    prisma.saasSubscription.findUnique({ where: { tenantId } }),
    prisma.tenantOnboarding.findUnique({ where: { tenantId } }),
    prisma.tenantVerticalEntitlement.findUnique({ where: { tenantId_verticalCode: { tenantId, verticalCode: 'RESTAURANT' } } })
  ]);
  assert.equal(subscription.planCode, 'TRIAL');
  assert.equal(subscription.state, 'TRIAL');
  assert.equal(onboarding.state, 'IN_PROGRESS');
  assert.equal(entitlement.state, 'ACTIVE');
  assert.equal(await verticalEntitlements.hasVertical(tenantId, 'RESTAURANT'), true);

  await service.updateOnboarding(tenantId, {
    profile: { restaurantName: registered.session.tenant.nombreEmpresa },
    completeStep: 'BUSINESS',
    currentStep: 'TABLES'
  });
  const tables = await service.configureTables(tenantId, 3);
  assert.equal(tables.tables >= 3, true);
  const menu = await service.seedStarterMenu(tenantId);
  assert.equal(menu.menuItems >= 4, true);

  const claim = await service.createInstallClaim(tenantId, registered.session.user.id, { name: 'Sede principal', pointCode: 'SEDE-PRINCIPAL' });
  await installClarity.noteInstallerGenerated(tenantId);
  assert.ok(claim.token.length >= 30);
  assert.match(claim.downloadPath, /\/api\/public\/restaurantes\/instalador\//);
  const storedClaim = await prisma.edgeInstallClaim.findFirst({ where: { tenantId, pointCode: 'SEDE-PRINCIPAL' }, orderBy: { creadoEn: 'desc' } });
  assert.ok(storedClaim);
  assert.notEqual(storedClaim.tokenHash, claim.token, 'El claim sólo puede persistir hasheado');

  let state = await installClarity.getOnboarding(tenantId);
  assert.equal(state.progress.installations, 0);
  assert.equal(new Set(state.onboarding.completedSteps).has('SITE'), false, 'Descargar/generar no puede marcar la sede como instalada');
  await assert.rejects(
    () => installClarity.completeOnboarding(tenantId),
    (error) => error?.code === 'ONBOARDING_REQUIRED_STEPS_PENDING'
  );

  const consumed = await installClarity.consumeInstallClaim(claim.token, 'CI-WINDOWS-DEMO');
  assert.ok(consumed.edgeAgentId);
  assert.ok(consumed.edgeKey && consumed.edgeKey.length > 20);
  const agent = await prisma.edgeAgent.findFirst({ where: { id: consumed.edgeAgentId, tenantId } });
  assert.equal(agent.pointCode, 'SEDE-PRINCIPAL');
  const manifest = await verticalEntitlements.edgeManifest(tenantId);
  assert.equal(manifest.verticals.some((row) => row.code === 'RESTAURANT' && row.edgeAdapter === 'restaurant'), true);

  state = await installClarity.getOnboarding(tenantId);
  assert.equal(state.progress.installations, 0, 'Canjear el claim tampoco basta: Edge debe arrancar');
  assert.equal(new Set(state.onboarding.completedSteps).has('SITE'), false);

  const installationId = crypto.randomUUID();
  await edgePlatform.heartbeat({ id: agent.id, tenantId, softwareVersion: 'SELF_SERVICE_UNIVERSAL' }, {
    installationId,
    deviceName: 'CI-WINDOWS-DEMO',
    os: 'win32',
    architecture: 'x64',
    lanHost: '192.168.50.20',
    lanPort: 8788,
    softwareVersion: 'SELF_SERVICE_UNIVERSAL',
    healthStatus: 'OK',
    health: { pending: 0, printPending: 0 },
    relayConnected: true,
    updaterState: 'IDLE'
  });

  state = await installClarity.getOnboarding(tenantId);
  assert.equal(state.progress.installations, 1);
  assert.equal(new Set(state.onboarding.completedSteps).has('SITE'), true, 'SITE sólo se completa cuando Edge aparece en Core');
  assert.equal(state.onboarding.profile.installationState, 'EDGE_ONLINE');

  await assert.rejects(
    () => installClarity.consumeInstallClaim(claim.token, 'SECOND-USE'),
    (error) => error?.code === 'EDGE_INSTALL_CLAIM_CONSUMED'
  );

  const completed = await installClarity.completeOnboarding(tenantId);
  assert.equal(completed.state, 'COMPLETED');
  console.log('RESTAURANT SELF SERVICE V1 POSTGRESQL SMOKE OK');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
