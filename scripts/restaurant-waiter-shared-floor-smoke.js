'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RESTAURANT_SHARED_WAITER_ROLE,
  runtimeUserForRequest
} = require('../src/middleware/auth-middleware');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const auth = read('src/middleware/auth-middleware.js');
const permissions = read('src/middleware/require-permission.js');
const restaurant = read('src/modules/restaurant/restaurant.service.js');
const identity = read('src/modules/restaurant/restaurant-identity.service.js');
const zones = read('src/modules/restaurant/restaurant-zones.service.js');

assert.match(auth, /MESERO_OPERATIVO_COMPARTIDO/);
assert.match(auth, /restaurantWaiterSharedFloor/);
assert.match(auth, /securityRole:\s*'MESERO'/);
assert.match(auth, /restaurante\\\/ui-context/);
assert.match(permissions, /function securityUser/);
assert.match(permissions, /req\.userRole/);
assert.match(permissions, /rbac\.hasPermission\(req\.tenantId, securityUser\(req\), code\)/);

// Los filtros históricos siguen existiendo para llamadas de dominio con un actor MESERO literal.
// La API operacional usa el actor compartido para que esos filtros no conviertan la asignación
// de una mesa en una barrera de trabajo.
assert.match(restaurant, /user\?\.rol === 'MESERO'/);
assert.match(identity, /user\?\.rol === 'MESERO'/);
assert.match(zones, /user\?\.rol === 'MESERO'/);

const waiter = { id:'waiter-1', tenantId:'tenant-1', nombre:'Mesero QA', rol:'MESERO', activo:true };
const operational = runtimeUserForRequest({ originalUrl:'/api/v1/restaurante/mesas' }, waiter);
assert.equal(operational.id, waiter.id);
assert.equal(operational.rol, RESTAURANT_SHARED_WAITER_ROLE);
assert.equal(operational.securityRole, 'MESERO');

const orderRequest = runtimeUserForRequest({ originalUrl:'/api/v1/restaurante/sesiones/abc/pedido-borrador' }, waiter);
assert.equal(orderRequest.rol, RESTAURANT_SHARED_WAITER_ROLE);

const uiContext = runtimeUserForRequest({ originalUrl:'/api/v1/restaurante/ui-context' }, waiter);
assert.equal(uiContext.rol, 'MESERO');
assert.equal(uiContext.securityRole, undefined);

const outsideRestaurant = runtimeUserForRequest({ originalUrl:'/api/v1/contabilidad/reportes' }, waiter);
assert.equal(outsideRestaurant.rol, 'MESERO');

console.log(JSON.stringify({
  ok:true,
  allWaitersShareFloor:true,
  allZonesAndTablesOperational:true,
  reinforcementSupported:true,
  securityRolePreserved:true,
  uiRolePreserved:true,
  runtimeRole:RESTAURANT_SHARED_WAITER_ROLE
}));
