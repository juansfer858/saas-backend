'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const schemas = read('src/modules/users/user.schemas.js');
const userService = read('src/modules/users/user.service.js');
const userController = read('src/modules/users/user.controller.js');
const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');
const publicRoutes = read('src/modules/restaurant/restaurant-employees.public.routes.js');
const theme = read('src/web/restaurant-theme.js');
const center = read('src/web/restaurant-control-center.js');
const delivery = read('src/web/restaurant-delivery-ui.js');
const employees = read('src/web/restaurant-employees-ui.js');
const waiter = read('src/web/restaurant-waiter-device-admin.js');

for (const role of ['MESERO','COCINA','BARRA','POSTRES','CAJERO','ADMIN','CONTADOR']) assert.match(schemas, new RegExp(`'${role}'`));
assert.match(userService, /USER_ROLE_ESCALATION_FORBIDDEN/);
assert.match(userService, /USER_SELF_DEACTIVATE_FORBIDDEN/);
assert.match(userController, /actorRole:req\.userRole/);
assert.match(publicRoot, /restaurantEmployeesPublicRouter/);
assert.match(publicRoutes, /restaurant-employees-ui\.js/);
assert.match(theme, /restaurant-employees-ui\.js\?v=employees-v1/);
assert.match(center, /empleados:'Empleados'/);
assert.match(center, /data-cc-employees/);
assert.match(center, /view === 'empleados'/);
assert.match(delivery, /data-cc-employees/);
assert.match(employees, /\+ NUEVO EMPLEADO/);
assert.match(employees, /\/api\/v1\/usuarios/);
assert.match(employees, /method:'POST'/);
assert.match(employees, /method:'PATCH'/);
assert.doesNotMatch(employees, /method:'DELETE'/, 'Los empleados se desactivan; no se borran');
assert.match(employees, /VantixGCWaiterDeviceAdmin/);
assert.match(waiter, /VantixGCWaiterDeviceAdmin/);
assert.match(waiter, /preselectedUserId/);

console.log(JSON.stringify({ ok:true, module:'RESTAURANT_EMPLOYEES_V1', roles:['MESERO','COCINA','BARRA','POSTRES','CAJERO','ADMIN','CONTADOR'], deleteUsers:false, waiterDeviceShortcut:true, roleEscalationGuard:true }));
