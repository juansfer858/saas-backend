'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const qr = require('../src/modules/restaurant/restaurant-qr.service');
const compatibility = require('../src/modules/restaurant/restaurant-qr-compatibility.service');

function source(relative) {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
}

async function staticContract() {
  const qrSource = source('src/modules/restaurant/restaurant-qr.service.js');
  const routesSource = source('src/modules/restaurant/restaurant.routes.js');
  const schemaSource = source('prisma/restaurant-phase2-v1.prisma');
  const runtimeSource = source('scripts/ensure-restaurant-runtime-schema.js');
  const guardSource = source('src/modules/restaurant/restaurant-qr-compatibility.service.js');

  assert.match(schemaSource, /qrToken\s+String\s+@unique\s+@default\(uuid\(\)\)/);
  assert.match(qrSource, /publicTableUrl\(publicBaseUrl\(\), qrToken\)/);
  assert.equal(qr.buildPublicTableUrl('legacy-token-123'), 'https://core.vantixgc.com/r/legacy-token-123');
  assert.match(routesSource, /tableUpdateSchema\s*=\s*tableSchema\.omit\(\{ code: true \}\)/);
  assert.doesNotMatch(routesSource, /tableUpdateSchema[\s\S]{0,400}qrToken/);
  assert.match(routesSource, /post\('\/mesas\/:id\/qr\/regenerar', requirePermission\('RESTAURANTE\.ADMINISTRAR'\)/);
  assert.match(guardSource, /BEFORE UPDATE OF "qrToken"/);
  assert.match(guardSource, /current_setting\('vantix\.restaurant_qr_regenerate', true\)/);
  assert.match(guardSource, /set_config\('vantix\.restaurant_qr_regenerate', 'allowed', true\)/);
  assert.match(qrSource, /authorizeQrTokenRegeneration\(tx\)[\s\S]{0,250}restaurantTable\.update/);
  assert.match(runtimeSource, /qrTokenGuard/);
  assert.match(runtimeSource, /ensureQrTokenGuard\(prisma\)/);
}

async function databaseContract() {
  await compatibility.ensureQrTokenGuard(prisma);
  const guard = await compatibility.guardState(prisma);
  assert.equal(guard.installed, true);

  const suffix = crypto.randomBytes(6).toString('hex');
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: `QR Compat ${suffix}`,
      subdomain: `qr-compat-${suffix}`,
      nicho: 'RESTAURANTE'
    }
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Compat Admin',
      email: `compat-${suffix}@example.test`,
      password: 'not-used-in-smoke',
      rol: 'ADMIN'
    }
  });
  const table = await prisma.restaurantTable.create({
    data: { tenantId: tenant.id, code: `Q${suffix}`, name: 'Mesa QR histórica' }
  });
  const originalToken = table.qrToken;

  try {
    let blocked = false;
    try {
      await prisma.restaurantTable.update({ where: { id: table.id }, data: { qrToken: crypto.randomUUID() } });
    } catch (error) {
      blocked = String(error?.message || error).includes('RESTAURANT_QR_TOKEN_IMMUTABLE');
    }
    assert.equal(blocked, true, 'un UPDATE normal no puede invalidar un QR físico');

    const renamed = await prisma.restaurantTable.update({ where: { id: table.id }, data: { name: 'Mesa QR histórica renombrada' } });
    assert.equal(renamed.qrToken, originalToken, 'editar la mesa conserva el QR');

    const regenerated = await qr.regenerateTableQr(tenant.id, user.id, table.id);
    assert.notEqual(regenerated.url, qr.buildPublicTableUrl(originalToken), 'regenerar es la única transición que cambia el QR');
    assert.match(regenerated.url, /^https:\/\/core\.vantixgc\.com\/r\//);

    const audit = await prisma.auditoriaContable.findFirst({
      where: { tenantId: tenant.id, entidad: 'RESTAURANT_TABLE_QR', entidadId: table.id, accion: 'REGENERATE' },
      orderBy: { fecha: 'desc' }
    });
    assert.ok(audit, 'la regeneración debe quedar auditada');
  } finally {
    await prisma.auditoriaContable.deleteMany({ where: { tenantId: tenant.id, entidadId: table.id } }).catch(() => {});
    await prisma.restaurantTable.deleteMany({ where: { id: table.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: user.id } }).catch(() => {});
    await prisma.tenant.deleteMany({ where: { id: tenant.id } }).catch(() => {});
  }
}

async function main() {
  await staticContract();
  if (process.env.DATABASE_URL) await databaseContract();
  console.log(JSON.stringify({
    ok: true,
    contract: compatibility.QR_COMPATIBILITY_CONTRACT,
    publicPath: compatibility.QR_PUBLIC_PATH,
    qrTokenImmutableByDefault: true,
    auditedExplicitRegeneration: true,
    existingTableEditsPreserveQr: true
  }));
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect().catch(() => {});
});
