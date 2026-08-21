const rbac = require('../platform/rbac/rbac.service');

const RESTAURANT_MODULES = ['RESTAURANTE', 'MESAS', 'PEDIDOS', 'COMANDAS'];

const RESTAURANT_ROLES = {
  MESERO: [
    'DASHBOARD.VER', 'RESTAURANTE.VER',
    'MESAS.VER', 'MESAS.CREAR', 'MESAS.EDITAR',
    'PEDIDOS.VER', 'PEDIDOS.CREAR',
    'COMANDAS.VER'
  ],
  COCINA: ['RESTAURANTE.VER', 'COMANDAS.VER', 'COMANDAS.EDITAR'],
  BARRA: ['RESTAURANTE.VER', 'COMANDAS.VER', 'COMANDAS.EDITAR'],
  POSTRES: ['RESTAURANTE.VER', 'COMANDAS.VER', 'COMANDAS.EDITAR'],
  CAJERO: [
    'DASHBOARD.VER',
    'RESTAURANTE.VER', 'RESTAURANTE.CERRAR',
    'MESAS.VER',
    'PEDIDOS.VER',
    'COMANDAS.VER',
    'TESORERIA.VER', 'TESORERIA.CREAR', 'TESORERIA.CERRAR', 'TESORERIA.PAGAR'
  ]
};

let installed = false;

function installRestaurantRbac() {
  if (installed) return;
  for (const module of RESTAURANT_MODULES) {
    if (!rbac.MODULES.includes(module)) rbac.MODULES.push(module);
  }

  // ADMIN is intentionally represented as wildcard after vertical modules are registered.
  // ensureTenantRoles() expands '*' to the current permission catalog, so existing tenants
  // receive the new Restaurant permissions during the normal platform bootstrap as well.
  rbac.BASE_ROLES.ADMIN = ['*'];

  for (const [role, grants] of Object.entries(RESTAURANT_ROLES)) {
    rbac.BASE_ROLES[role] = [...grants];
  }
  installed = true;
}

module.exports = { RESTAURANT_MODULES, RESTAURANT_ROLES, installRestaurantRbac };
