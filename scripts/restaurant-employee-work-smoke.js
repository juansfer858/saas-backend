'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');

const schema = read('prisma/restaurant-employee-work-v1.prisma');
assert.match(schema, /model RestaurantEmployeeWorkProfile/);
assert.match(schema, /zoneIds\s+Json/);
assert.match(schema, /tableIds\s+Json/);
assert.match(schema, /stations\s+Json/);
assert.match(schema, /flexibleSupport\s+Boolean\s+@default\(true\)/);
assert.match(schema, /@@unique\(\[tenantId, userId\]\)/);

const service = read('src/modules/restaurant/restaurant-employee-work.service.js');
assert.match(service, /VANTIX_RESTAURANT_EMPLOYEE_WORK_FLEX_V1/);
assert.match(service, /mode:'FLEXIBLE'/);
assert.match(service, /flexibleSupport:true/);
assert.match(service, /PRODUCTION_ROLES/);
assert.match(service, /defaultStations/);
assert.match(service, /productionRuntimeUser/);
assert.match(service, /rol:'PRODUCCION'/);
assert.doesNotMatch(service, /ASSIGNED_ONLY|HARD_BLOCK|STRICT_SCOPE/);

const routes = read('src/modules/restaurant/restaurant-employee-work.routes.js');
assert.match(routes, /\/ui-context/);
assert.match(routes, /\/comandas/);
assert.match(routes, /empleados\/asignaciones\/opciones/);
assert.match(routes, /empleados\/asignaciones/);
assert.match(routes, /empleados\/:userId\/asignacion/);
assert.match(routes, /RESTAURANTE\.ADMINISTRAR/);
assert.match(routes, /COMANDAS\.VER/);
assert.match(routes, /COMANDAS\.EDITAR/);

const employeeUi = read('src/web/restaurant-employees-ui.js');
assert.match(employeeUi, /VANTIX_EMPLOYEE_ASSIGNMENT_EDITOR_V1/);
assert.match(employeeUi, /Zonas principales/);
assert.match(employeeUi, /Mesas puntuales/);
assert.match(employeeUi, /Módulos de producción/);
assert.match(employeeUi, /REFUERZO SIEMPRE LIBRE/);
assert.match(employeeUi, /zoneIds/);
assert.match(employeeUi, /tableIds/);
assert.match(employeeUi, /stations/);
assert.match(employeeUi, /Conectar tablet\/celular/);

const runtime = read('src/web/restaurant-employee-work-runtime.js');
assert.match(runtime, /VANTIX_EMPLOYEE_WORK_SCOPE_V1/);
assert.match(runtime, /Ver todas las estaciones/);
assert.match(runtime, /Ver mis módulos/);
assert.match(runtime, /Refuerzo libre/);
assert.match(runtime, /data-waiter-table/);
assert.match(runtime, /kds-v2-lane/);
assert.doesNotMatch(runtime, /disabled\s*=\s*true.*work-primary/);

const publicRoutes = read('src/modules/restaurant/restaurant-employee-work.public.routes.js');
assert.match(publicRoutes, /restaurant-employee-work-runtime\.js/);
assert.match(publicRoutes, /employee-work-readiness/);
assert.match(publicRoutes, /assignmentIsAuthorization:false/);

const publicAggregator = read('src/modules/restaurant/restaurant.public.routes.js');
assert.ok(publicAggregator.indexOf('restaurantEmployeeWorkPublicRouter') < publicAggregator.indexOf('legacyRestaurantPublicRouter);'), 'runtime flexible debe montarse antes del router legacy');
const core = read('src/routes/core.routes.js');
assert.ok(core.indexOf("router.use('/restaurante', restaurantEmployeeWorkRouter)") < core.indexOf("router.use('/restaurante', restaurantRouter)"), 'rutas flexibles deben interceptar antes del router Restaurante base');

const schemaGuard = read('scripts/ensure-restaurant-runtime-schema.js');
assert.match(schemaGuard, /RestaurantEmployeeWorkProfile/);
assert.match(schemaGuard, /employeeWorkProfile/);

console.log(JSON.stringify({ ok:true, marker:'VANTIX_RESTAURANT_EMPLOYEE_WORK_FLEX_V1', waiter:'zonas+mesas prioritarias sin bloqueo', production:'multiestación con refuerzo', authorization:'RBAC_REAL_ROLE' }));
