'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const service = require('../src/modules/inventory/inventory.service');
const { productSchema } = require('../src/modules/inventory/inventory.schemas');
const { parseAutoSku, formatAutoSku, nextAutoSku } = require('../src/modules/inventory/inventory-auto-sku');

async function main() {
  assert.equal(parseAutoSku('PROD-000009'), 9);
  assert.equal(parseAutoSku('prod-000010'), 10);
  assert.equal(parseAutoSku('LEGACY-10'), null);
  assert.equal(formatAutoSku(1), 'PROD-000001');
  assert.equal(nextAutoSku([], 0), 'PROD-000001');
  assert.equal(nextAutoSku(['PROD-000004', 'LEGACY'], 7), 'PROD-000008');
  assert.equal(nextAutoSku(['PROD-000010'], 2), 'PROD-000011');
  assert.equal(productSchema.safeParse({ nombre:'Producto sin código' }).success, true, 'productSchema debe aceptar SKU omitido');

  const stamp = Date.now().toString(36);
  const tenant = await prisma.tenant.create({
    data: { nombreEmpresa:'Auto SKU QA', subdomain:`auto-sku-${stamp}`, nicho:'RESTAURANTE' }
  });
  const tenant2 = await prisma.tenant.create({
    data: { nombreEmpresa:'Auto SKU QA 2', subdomain:`auto-sku-2-${stamp}`, nicho:'RESTAURANTE' }
  });

  try {
    await prisma.producto.create({ data:{ tenantId:tenant.id, sku:'LEGACY-ABC', nombre:'Producto legado' } });
    await prisma.producto.create({ data:{ tenantId:tenant.id, sku:'PROD-000010', nombre:'Producto automático previo' } });

    assert.equal(await service.nextProductSku(tenant.id), 'PROD-000011');

    const [a,b] = await Promise.all([
      service.createProduct(tenant.id, { nombre:'Producto concurrente A' }),
      service.createProduct(tenant.id, { nombre:'Producto concurrente B' })
    ]);
    assert.deepEqual(new Set([a.sku,b.sku]), new Set(['PROD-000011','PROD-000012']));
    assert.equal(await service.nextProductSku(tenant.id), 'PROD-000013');

    const other = await service.createProduct(tenant2.id, { nombre:'Producto otra empresa' });
    assert.equal(other.sku, 'PROD-000001', 'cada empresa debe tener su propia secuencia');

    let duplicateCode = '';
    try {
      await service.createProduct(tenant.id, { sku:a.sku, nombre:'Duplicado manual' });
    } catch (error) {
      duplicateCode = error?.code || '';
    }
    assert.equal(duplicateCode, 'PRODUCT_SKU_EXISTS', 'un SKU manual duplicado debe seguir bloqueado');

    console.log('INVENTORY_AUTO_SKU_DB_OK legacy_preserved max_plus_one concurrent_unique tenant_isolation manual_duplicate_blocked');
  } finally {
    await prisma.producto.deleteMany({ where:{ tenantId:{ in:[tenant.id,tenant2.id] } } });
    await prisma.tenant.deleteMany({ where:{ id:{ in:[tenant.id,tenant2.id] } } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
