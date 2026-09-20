'use strict';

const { prisma } = require('../src/config/prisma');
const { ensureDemoDefaultStations } = require('../src/modules/restaurant/restaurant-v2-kds.service');

const stamp = Date.now().toString(36);
const demoSubdomain = 'demo-restaurante';
const otherSubdomain = `demo-station-control-${stamp}`;

async function cleanupTenant(tenantId) {
  if (!tenantId) return;
  await prisma.restaurantProductionStation.deleteMany({ where:{ tenantId } });
  await prisma.tenant.deleteMany({ where:{ id:tenantId } });
}

async function main() {
  let demo = null;
  let other = null;
  const existingDemo = await prisma.tenant.findUnique({ where:{ subdomain:demoSubdomain }, select:{ id:true } });
  if (existingDemo) await cleanupTenant(existingDemo.id);

  try {
    demo = await prisma.tenant.create({
      data:{ nombreEmpresa:'Demo Restaurante Station Test', subdomain:demoSubdomain, nicho:'RESTAURANTE', pais:'CO', moneda:'COP', activo:true }
    });
    other = await prisma.tenant.create({
      data:{ nombreEmpresa:'Other Tenant Station Test', subdomain:otherSubdomain, nicho:'RESTAURANTE', pais:'CO', moneda:'COP', activo:true }
    });

    const first = await ensureDemoDefaultStations(demo.id);
    if (first !== true) throw new Error('First demo bootstrap must create defaults');

    let rows = await prisma.restaurantProductionStation.findMany({
      where:{ tenantId:demo.id },
      orderBy:{ sortOrder:'asc' }
    });
    const expected = [
      ['Cocina','COCINA',10],
      ['Barra','BARRA',20],
      ['Postres','POSTRES',30]
    ];
    if (rows.length !== 3) throw new Error(`Expected 3 default stations, got ${rows.length}`);
    expected.forEach(([name,queue,sortOrder], index) => {
      const row = rows[index];
      if (!row || row.name !== name || row.queue !== queue || row.mode !== 'KDS' || row.sortOrder !== sortOrder || row.active !== true) {
        throw new Error(`Invalid default station at index ${index}: ${JSON.stringify(row)}`);
      }
    });

    const second = await ensureDemoDefaultStations(demo.id);
    if (second !== false) throw new Error('Second bootstrap must be idempotent');
    if (await prisma.restaurantProductionStation.count({ where:{ tenantId:demo.id } }) !== 3) {
      throw new Error('Idempotent bootstrap duplicated stations');
    }

    const postres = rows.find((row) => row.name === 'Postres');
    await prisma.restaurantProductionStation.update({ where:{ id:postres.id }, data:{ active:false } });
    const afterDeleteBootstrap = await ensureDemoDefaultStations(demo.id);
    if (afterDeleteBootstrap !== false) throw new Error('Deleted default station must not be recreated');

    rows = await prisma.restaurantProductionStation.findMany({ where:{ tenantId:demo.id } });
    const deletedPostres = rows.find((row) => row.name === 'Postres');
    if (!deletedPostres || deletedPostres.active !== false || rows.length !== 3) {
      throw new Error('Deleted Postres station was unexpectedly recreated');
    }

    const otherResult = await ensureDemoDefaultStations(other.id);
    if (otherResult !== false) throw new Error('Non-demo tenant must never receive demo defaults');
    if (await prisma.restaurantProductionStation.count({ where:{ tenantId:other.id } }) !== 0) {
      throw new Error('Non-demo tenant received production stations');
    }

    console.log('DEMO_DEFAULT_STATIONS_DB=PASS');
    console.log('DEFAULTS=Cocina,Barra,Postres');
    console.log('DELETE_DOES_NOT_RESEED=PASS');
    console.log('OTHER_TENANTS_UNTOUCHED=PASS');
  } finally {
    if (demo) await cleanupTenant(demo.id).catch(() => {});
    if (other) await cleanupTenant(other.id).catch(() => {});
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
