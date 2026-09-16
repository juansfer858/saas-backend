const rbac = require('../platform/rbac/rbac.service');

const BIKE_MODULES = ['BIKE', 'BIKE_TALLER', 'BIKE_AGENDA', 'BIKE_PASAPORTE'];

const BIKE_ROLES = {
  BIKE_RECEPCION: [
    'DASHBOARD.VER',
    'BIKE.VER', 'BIKE.CREAR', 'BIKE.EDITAR',
    'BIKE_TALLER.VER', 'BIKE_TALLER.CREAR', 'BIKE_TALLER.EDITAR', 'BIKE_TALLER.CERRAR', 'BIKE_TALLER.ANULAR',
    'BIKE_AGENDA.VER', 'BIKE_AGENDA.CREAR', 'BIKE_AGENDA.EDITAR',
    'BIKE_PASAPORTE.VER',
    'TERCEROS.VER', 'TERCEROS.CREAR', 'TERCEROS.EDITAR',
    'INVENTARIO.VER'
  ],
  BIKE_MECANICO: [
    'DASHBOARD.VER',
    'BIKE.VER',
    'BIKE_TALLER.VER', 'BIKE_TALLER.EDITAR',
    'BIKE_AGENDA.VER',
    'BIKE_PASAPORTE.VER',
    'INVENTARIO.VER'
  ],
  BIKE_ASESOR: [
    'DASHBOARD.VER',
    'BIKE.VER', 'BIKE.CREAR', 'BIKE.EDITAR',
    'BIKE_TALLER.VER', 'BIKE_TALLER.CREAR', 'BIKE_TALLER.EDITAR', 'BIKE_TALLER.CERRAR', 'BIKE_TALLER.ANULAR',
    'BIKE_AGENDA.VER', 'BIKE_AGENDA.CREAR', 'BIKE_AGENDA.EDITAR',
    'BIKE_PASAPORTE.VER',
    'VENTAS.VER', 'VENTAS.CREAR', 'VENTAS.EDITAR', 'VENTAS.EMITIR',
    'TERCEROS.VER', 'TERCEROS.CREAR',
    'INVENTARIO.VER'
  ]
};

let installed = false;

function installBikeRbac() {
  if (installed) return;
  for (const module of BIKE_MODULES) if (!rbac.MODULES.includes(module)) rbac.MODULES.push(module);
  rbac.BASE_ROLES.ADMIN = ['*'];
  for (const [role, grants] of Object.entries(BIKE_ROLES)) rbac.BASE_ROLES[role] = [...grants];
  installed = true;
}

module.exports = { BIKE_MODULES, BIKE_ROLES, installBikeRbac };
