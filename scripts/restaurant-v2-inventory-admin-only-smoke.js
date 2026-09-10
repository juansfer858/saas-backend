'use strict';

const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const control = read('src/web/restaurant-v2-native-control-p11.js');
const carta = read('src/web/restaurant-v2-menu.html');

assert(control.includes("carta:{ label:'Carta'"), 'Carta debe permanecer en el lateral operativo');
assert(!control.includes("inventario:{ label:'Inventario / Kardex'"), 'Inventario / Kardex no debe aparecer como módulo del lateral Restaurante');
assert(!control.includes("route:'/app/inventario'"), 'El lateral Restaurante no debe navegar directamente a /app/inventario');

assert(carta.includes('id="addInventory"'), '+ Desde inventario debe permanecer disponible para vincular productos existentes');
assert(carta.includes('+ Desde inventario'), 'Debe conservarse la acción de vinculación desde inventario');
assert(!carta.includes('href="/app/inventario"'), 'Carta no debe ofrecer acceso directo a la administración de Inventario / Kardex');
assert(carta.includes('Inventario/Kardex del Super Core'), 'Carta debe seguir aclarando que las existencias pertenecen al Super Core');

console.log('restaurant-v2-inventory-admin-only-smoke: OK');
