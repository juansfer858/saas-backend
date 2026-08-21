const rbac = require('../platform/rbac/rbac.service');

const RESTAURANT_MODULES = ['RESTAURANTE', 'MESAS', 'PEDIDOS', 'COMANDAS'];

const RESTAURANT_ROLES = {
  MESERO: [
    'DASHBOARD.VER',
    'MESAS.VER', 'MESAS.CREAR', 'MESAS.EDITAR',
    'PEDIDOS.VER', 'PEDIDOS.CREAR',
    'COMANDAS.VER'
  ],
  COCINA: ['COMANDAS.VER', 'COMANDAS.EDITAR'],
  BARRA: ['COMANDAS.VER', 'COMANDAS.EDITAR'],
  POSTRES: ['COMANDAS.VER', 'COMANDAS.EDITAR'],
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
  for (const [role, grants] of Object.entries(RESTAURANT_ROLES)) {
    rbac.BASE_ROLES[role] = [...grants];
  }
  installed = true;
}

module.exports = { RESTAURANT_MODULES, RESTAURANT_ROLES, installRestaurantRbac };
