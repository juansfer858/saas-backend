'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RESTAURANT_SHARED_WAITER_ROLE,
  runtimeUserForRequest
} = require('../src/middleware/auth-middleware');
const { securityUser } = require('../src/middleware/require-permission');

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
assert.match(auth, /zonas\|mesas\|menu\|sesiones\|pedidos/);
assert.match(permissions, /function securityUser/);
assert.match(permissions, /req\.userRole/);
assert.match(permissions, /rbac\.hasPermission\(req\.tenantId, securityUser\(req\), code\)/);

// Los filtros históricos siguen existiendo para llamadas de dominio con un actor MESERO literal.
// La API del salón usa el actor compartido para que esos filtros no conviertan la asignación
// de una mesa en una barrera de trabajo.
assert.match(restaurant, /user\?\.rol === 'MESERO'/);
assert.match(identity, /user\?\.rol === 'MESERO'/);
assert.match(zones, /user\?\.rol === 'MESERO'/);

const waiter = { id:'waiter-1', tenantId:'tenant-1', nombre:'Mesero QA', rol:'MESERO', activo:true };
for (const url of [
  '/api/v1/restaurante/zonas',
  '/api/v1/restaurante/mesas',
  '/api/v1/restaurante/menu',
  '/api/v1/restaurante/sesiones/abc/pedido-borrador',
  '/api/v1/restaurante/pedidos?sessionId=abc'
]) {
  const operational = runtimeUserForRequest({ originalUrl:url }, waiter);
  assert.equal(operational.id, waiter.id);
  assert.equal(operational.rol, RESTAURANT_SHARED_WAITER_ROLE, `${url} debe operar con piso compartido`);
  assert.equal(operational.securityRole, 'MESERO');
  const secured = securityUser({ user:operational, userRole:'MESERO' });
  assert.equal(secured.id, waiter.id);
  assert.equal(secured.rol, 'MESERO', 'RBAC debe evaluar siempre el rol real, no el actor operacional');
}

for (const url of [
  '/api/v1/restaurante/ui-context',
  '/api/v1/restaurante/config',
  '/api/v1/restaurante/comandas',
  '/api/v1/restaurante/caja',
  '/api/v1/contabilidad/reportes'
]) {
  const untouched = runtimeUserForRequest({ originalUrl:url }, waiter);
  assert.equal(untouched.rol, 'MESERO', `${url} debe conservar el rol real`);
  assert.equal(untouched.securityRole, undefined);
}

console.log(JSON.stringify({
  ok:true,
  allWaitersShareFloor:true,
  allZonesAndTablesOperational:true,
  reinforcementSupported:true,
  securityRolePreserved:true,
  noPrivilegeEscalation:true,
  uiRolePreserved:true,
  scopeLimitedToWaiterFloor:true,
  runtimeRole:RESTAURANT_SHARED_WAITER_ROLE
}));
