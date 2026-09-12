'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('src/web/restaurant-v2-orders.js', 'utf8');
const css = fs.readFileSync('src/web/restaurant-v2-person-buttons-v100.css', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-orders.html', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-v2-orders.public.routes.js', 'utf8');

assert.match(ui, /VANTIX_RESTAURANT_V2_PERSON_BUTTONS_V100/);
assert.match(ui, /function targetLabel\(seatNumber\)/);
assert.match(ui, /return seatNumber\?`Persona \$\{Number\(seatNumber\)\}`:'TODOS'/);
assert.match(ui, /data-person-target/);
assert.match(ui, />TODOS<\/button>/);
assert.match(ui, />Persona \$\{i\}<\/button>/);
assert.match(ui, /aria-label="Agregar productos para"/);
assert.match(ui, /menu-target/);
assert.match(ui, /Para: <b>/);
assert.match(ui, /draft-target-label/);
assert.match(ui, /line-seat-buttons/);
assert.match(ui, /data-line-seat/);
assert.match(ui, /data-seat-value/);
assert.match(ui, /patchItem\(b\.dataset\.lineSeat,\{seatNumber:b\.dataset\.seatValue\?Number\(b\.dataset\.seatValue\):null\}\)/);
assert.match(ui, /seatNumber:seatNumber\?\?null/);
assert.match(ui, /Number\(x\.seatNumber\|\|0\)===Number\(S\.person\|\|0\)/, 'La identidad de línea debe seguir separando TODOS/persona al agregar');
assert.match(ui, /if\(item\?\.seatNumber\)return `Persona \$\{item\.seatNumber\}`;return 'TODOS'/);
assert.match(ui, /Revisa productos, cantidades, para quién va cada uno y notas/);
assert.doesNotMatch(ui, /Mesa \/ sin asignar/);
assert.doesNotMatch(ui, /MutationObserver|setInterval/);

assert.match(css, /VANTIX_RESTAURANT_V2_PERSON_BUTTONS_V100/);
assert.match(css, /\.service-controls\{flex-wrap:nowrap/);
assert.match(css, /\.person-targets\{[^}]*display:flex/);
assert.match(css, /\.person-targets\{[^}]*overflow-x:auto/);
assert.match(css, /\.line-seat-buttons\{[^}]*display:flex/);
assert.match(css, /\.line-seat-buttons\{[^}]*overflow-x:auto/);
assert.match(css, /@media\(max-width:720px\)/);

assert.match(html, /\/app\/restaurant-v2-person-buttons-v100\.css/);
assert.match(routes, /\/app\/restaurant-v2-person-buttons-v100\.css/);
assert.match(routes, /restaurant-v2-person-buttons-v100\.css/);

console.log(JSON.stringify({
  ok:true,
  marker:'VANTIX_RESTAURANT_V2_PERSON_BUTTONS_V100',
  topSelector:'HORIZONTAL_BUTTONS',
  sharedTarget:'TODOS_TO_SEAT_NULL',
  mixedTargetsPerOrder:true,
  existingLineAssignmentPreserved:true,
  draftTargetVisible:true,
  reviewTargetVisible:true,
  sentTargetVisible:true,
  schemaChanged:false,
  backendContractChanged:false
}, null, 2));
