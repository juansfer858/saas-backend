const assert = require('node:assert/strict');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const stations = require('../src/modules/platform/printing/printing-stations.service');
const printing = require('../src/modules/platform/printing/printing.service');

function read(path) { return fs.readFileSync(path, 'utf8'); }

async function main() {
  const panel = read('src/web/panel-printing-config.js');
  const theme = read('src/web/restaurant-theme.js');
  const companyAdmin = read('src/web/restaurant-company-admin-advanced.js');
  const kdsAdmin = read('src/web/restaurant-kds-stations-admin.js');
  const routes = read('src/modules/platform/printing/printing.routes.js');
  const commercialRoutes = read('src/modules/commercial/commercial.routes.js');
  const stationServiceSource = read('src/modules/platform/printing/printing-stations.service.js');

  assert.ok(!panel.includes('const ROLE_OPTIONS'), 'El panel no debe conservar destinos fijos Cocina/Barra');
  assert.ok(!panel.includes("current?.role || 'COCINA'"), 'Nueva impresora no puede preseleccionar Cocina');
  assert.ok(stationServiceSource.includes("const ROLE_PREFIX = 'STATION:'"));

  // El gestor KDS se sirve desde una ruta autenticada. No puede cargarse con un
  // <script src> normal porque ese request no transporta el Bearer del tenant.
  for (const token of [
    'loadAuthenticatedControlAddon',
    "'/api/v1/comercial/ui-runtime/restaurant-kds-stations-admin.js'",
    'Authorization:`Bearer ${session.token}`',
    "'x-tenant-subdomain':session.subdomain",
    'RESTAURANT_KDS_ADMIN_RUNTIME_UNAVAILABLE'
  ]) assert.ok(theme.includes(token), `Tema debe cargar KDS autenticado: ${token}`);

  assert.equal(theme.includes('ensureRestaurantConfigAccess'), false, 'No debe existir acceso Configuración lateral roto');
  assert.equal(theme.includes('data-restaurant-config-action'), false, 'No debe inyectar Configuración en dashboard');
  assert.equal(theme.includes('data-restaurant-config-link'), false, 'No debe inyectar Configuración en lateral');
  assert.equal(theme.includes('/app/centro-de-control?view=config'), false, 'No debe navegar al view=config inexistente');
  assert.equal(theme.includes('restaurant-admin-config-ui.js?v='), false, 'No debe cargar Configuración general desde el KDS');
  assert.equal(theme.includes('view.innerHTML'), false, 'La capa de estaciones no debe destruir el shell KDS durante polling');

  // La administración del nicho KDS vive dentro de Cocina / Barra.
  for (const token of [
    'Administrar KDS',
    'Gestionar KDS / estaciones',
    '+ Crear primera estación',
    '+ Nueva estación',
    'applyConfiguredLanes',
    'activeKdsStations',
    'stationNamesForQueue',
    ".kds-v2-lane[data-station]",
    "lane.style.setProperty('display', 'none', 'important')",
    'No hay KDS creados para este restaurante.',
    "api('/api/v1/impresion/estaciones')",
    "method:'DELETE'",
    'Configuración propia del restaurante'
  ]) assert.ok(kdsAdmin.includes(token), `Ver KDS debe administrar estaciones realmente: ${token}`);

  assert.ok(theme.includes('hasKds || canManage'), 'Administrador debe poder abrir KDS aun con cero estaciones');
  assert.ok(theme.includes("querySelectorAll('[data-cc-order-kds]')"), 'Accesos operativos de pedidos deben depender de KDS existente');

  // La configuración empresarial ya no es un runtime del KDS/Centro de control.
  // Vive en Administración → Configuración avanzada y no debe acoplar estaciones.
  assert.ok(companyAdmin.includes('VANTIX_RESTAURANT_COMPANY_ADMIN_ADVANCED_V3'));
  assert.ok(companyAdmin.includes("button.textContent = 'Empresa'"));
  assert.ok(companyAdmin.includes('Nombre del documento POS'));
  assert.equal(commercialRoutes.includes("router.get('/ui-runtime/restaurant-admin-config-ui.js'"), false,
    'No debe conservarse el runtime administrativo empresarial duplicado');
  assert.ok(commercialRoutes.includes("router.get('/ui-runtime/restaurant-kds-stations-admin.js'"));
  assert.ok(theme.includes('restaurant-production-stations'));
  assert.ok(routes.includes("router.get('/estaciones'"));
  assert.ok(routes.includes("router.post('/estaciones'"));
  assert.ok(commercialRoutes.includes("router.get('/ui-runtime/restaurant-production-stations'"));

  new Function(panel);
  new Function(theme);
  new Function(companyAdmin);
  new Function(kdsAdmin);

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

  console.log('RESTAURANT KDS ADMIN VISIBLE + AUTHENTICATED RUNTIME SMOKE OK');
  console.log(JSON.stringify({
    zeroDefaultStations:true,
    manualCreate:true,
    kdsOnlyCannotOwnPrinter:true,
    printerRoutesThroughManualStation:true,
    inactiveStationStopsRouting:true,
    authenticatedKdsRuntime:true,
    brokenConfigShortcutRemoved:true,
    companyAdminDecoupledFromKds:true,
    companyAdminCurrentSurface:true,
    lanesRequireManualStation:true,
    kdsShellPreservedDuringPolling:true,
    adminCanOpenEmptyKds:true,
    kdsManagementLivesInKds:true
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });