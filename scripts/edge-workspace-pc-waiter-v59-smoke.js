'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const wrapper = read('edge/agent/workspace-entry-v59.js');
const entry = read('edge/agent/restaurant-entry-v2.js');
const version = JSON.parse(read('edge/version.json'));

assert.match(wrapper, /VANTIX_EDGE_WORKSPACE_PC_WAITER_V59/);
assert.match(wrapper, /const tables = state\.restaurant\.tables \|\| \[\];/);
assert.doesNotMatch(wrapper, /const tables = \(state\.restaurant\.tables \|\| \[\]\)\.filter\(\(x\) => x\.activeSession\)/);
assert.match(wrapper, /Abrir mesa y tomar pedido/);
assert.match(wrapper, /No hay mesas configuradas/);
assert.match(wrapper, /La carta local aún no tiene productos sincronizados/);
assert.match(wrapper, /Este usuario no tiene permiso para tomar pedidos/);
assert.match(wrapper, /PEDIDOS\.CREAR/);
assert.match(wrapper, /MESAS\.CREAR/);
assert.match(wrapper, /Sincronizar carta/);
assert.match(wrapper, /return true;\\n}\\n\\nasync function readJson/);
assert.match(wrapper, /workspacePcWaiterRenderV59\.toString\(\)/);
assert.match(entry, /require\('\.\/workspace-entry-v59'\)/);
assert.doesNotMatch(entry, /require\('\.\/workspace-entry-v28'\)/);
assert.equal(version.version, '2.1.13-pc-waiter.1');
assert.equal(version.channel, 'PILOT');

console.log('EDGE WORKSPACE PC WAITER V59 ALL-TABLES + FREE-TABLE OPEN + EXPLICIT EMPTY STATES OK');
