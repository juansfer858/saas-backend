const assert = require('node:assert/strict');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const stations = require('../src/modules/platform/printing/printing-stations.service');
const printing = require('../src/modules/platform/printing/printing.service');

function read(path) { return fs.readFileSync(path, 'utf8'); }

async function main() {
  const panel = read('src/web/panel-printing-config.js');
  const theme = read('src/web/restaurant-theme.js');
  const routes = read('src/modules/platform/printing/printing.routes.js');
  const commercialRoutes = read('src/modules/commercial/commercial.routes.js');
  const stationServiceSource = read('src/modules/platform/printing/printing-stations.service.js');

  for (const token of [
    'Áreas de preparación / KDS',
    'VantixGC no crea cocinas ni KDS por defecto',
    '+ Nueva estación',
    "callApi('/api/v1/impresion/estaciones')",
    'Selecciona un destino…'
  ]) assert.ok(panel.includes(token), `Panel manual de estaciones debe contener: ${token}`);
  assert.ok(!panel.includes('const ROLE_OPTIONS'), 'El panel no debe conservar destinos fijos Cocina/Barra');
  assert.ok(!panel.includes("current?.role || 'COCINA'"), 'Nueva impresora no puede preseleccionar Cocina');
  assert.ok(stationServiceSource.includes("const ROLE_PREFIX = 'STATION:'"));
  assert.ok(theme.includes('restaurant-production-stations'));
  assert.ok(theme.includes('No hay estaciones KDS configuradas.'));
  assert.ok(theme.includes('[data-tab="kds"]'));
  assert.ok(routes.includes("router.get('/estaciones'"));
  assert.ok(routes.includes("router.post('/estaciones'"));
  assert.ok(commercialRoutes.includes("router.get('/ui-runtime/restaurant-production-stations'"));
  new Function(panel);
  new Function(theme);

  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: { nombreEmpresa:`Estaciones QA ${stamp}`, subdomain:`stations-${stamp}`, nicho:'RESTAURANTE', pais:'CO', moneda:'COP' }
  });
  const user = await prisma.user.create({
    data: { tenantId:tenant.id, nombre:'Admin estaciones QA', email:`stations-${stamp}@example.com`, password:'not-login', rol:'ADMIN' }
  });

  const empty = await stations.listStations(tenant.id);
  assert.deepEqual(empty, [], 'Un tenant nuevo debe iniciar con cero estaciones de producción');

  const kdsOnly = await stations.createStation(tenant.id, user.id, {
    name:'KDS central', queue:'COCINA', mode:'KDS', active:true, sortOrder:1
  });
  assert.equal(kdsOnly.name, 'KDS central');
  assert.equal(kdsOnly.mode, 'KDS');
  assert.equal(kdsOnly.printers.length, 0);

  let kdsPrinterError = null;
  try {
    await printing.savePrinter(tenant.id, {
      name:'No debe enlazar', transport:'LAN', role:kdsOnly.printerRole,
      host:'192.168.10.20', port:9100, format:'TERMICA_80', active:true
    });
  } catch (error) { kdsPrinterError = error; }
  assert.equal(kdsPrinterError?.code, 'PRINT_STATION_KDS_ONLY');

  const kitchen = await stations.createStation(tenant.id, user.id, {
    name:'Cocina caliente', queue:'COCINA', mode:'AMBOS', active:true, sortOrder:2
  });
  assert.match(kitchen.printerRole, /^STATION:/);

  let duplicateError = null;
  try {
    await stations.createStation(tenant.id, user.id, {
      name:'Cocina caliente', queue:'BARRA', mode:'KDS', active:true
    });
  } catch (error) { duplicateError = error; }
  assert.equal(duplicateError?.code, 'PRINT_STATION_DUPLICATE_NAME');

  const printer = await printing.savePrinter(tenant.id, {
    name:'Térmica cocina caliente', transport:'LAN', role:kitchen.printerRole,
    host:'192.168.10.30', port:9100, format:'TERMICA_80', active:true
  });
  assert.equal(printer.role, kitchen.printerRole);

  const routed = await printing.printersForRoles(tenant.id, ['COCINA']);
  assert.equal(routed.length, 1);
  assert.equal(routed[0].id, printer.id);
  assert.equal(routed[0].routeRole, 'COCINA');
  assert.equal(routed[0].stationName, 'Cocina caliente');

  const jobs = await printing.buildDirectedJobs(tenant.id, {
    title:'COMANDA QA',
    groups:[{ role:'COCINA', lines:[{ quantity:2, name:'Hamburguesa QA' }] }]
  });
  assert.equal(jobs.entries.length, 1);
  assert.equal(jobs.entries[0].stationId, kitchen.id);
  assert.equal(jobs.entries[0].stationName, 'Cocina caliente');
  assert.equal(jobs.entries[0].target.id, printer.id);
  assert.deepEqual(jobs.missingRoles, []);

  await stations.removeStation(tenant.id, user.id, kitchen.id);
  const routedAfterRemoval = await printing.printersForRoles(tenant.id, ['COCINA']);
  assert.equal(routedAfterRemoval.length, 0, 'Una estación desactivada deja de enrutar nuevas comandas a su impresora');

  const activeStations = await stations.listStations(tenant.id, { includeInactive:false });
  assert.equal(activeStations.length, 1);
  assert.equal(activeStations[0].id, kdsOnly.id);

  console.log('RESTAURANT MANUAL PRODUCTION STATIONS SMOKE OK');
  console.log(JSON.stringify({
    zeroDefaultStations:true,
    manualCreate:true,
    kdsOnlyCannotOwnPrinter:true,
    printerRoutesThroughManualStation:true,
    inactiveStationStopsRouting:true,
    kdsHiddenWithoutConfiguredStation:true
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
