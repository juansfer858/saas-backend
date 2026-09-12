'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('src/web/restaurant-v2-orders.js', 'utf8');
const css = fs.readFileSync('src/web/restaurant-v2-person-buttons-v100.css', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-orders.html', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-v2-orders.public.routes.js', 'utf8');

assert.match(ui, /VANTIX_RESTAURANT_V2_PERSON_BUTTONS_V100/);
assert.match(ui, /VANTIX_RESTAURANT_V2_CARD_TARGET_V101/);
assert.match(ui, /function targetLabel\(seatNumber\)/);
assert.match(ui, /return seatNumber\?`Persona \$\{Number\(seatNumber\)\}`:'TODOS'/);

// El selector superior sigue siendo horizontal y explícito para productos nuevos.
assert.match(ui, /data-person-target/);
assert.match(ui, />TODOS<\/button>/);
assert.match(ui, />Persona \$\{i\}<\/button>/);
assert.match(ui, /aria-label="Agregar productos para"/);
assert.match(ui, /menu-target/);
assert.match(ui, /Para: <b>/);

// V101: cada línea ya registrada muestra UNA sola identidad, no otro selector completo.
assert.match(ui, /draft-target-label/);
assert.match(ui, /targetLabel\(item\.seatNumber\)/);
assert.doesNotMatch(ui, /lineTargetButtons/);
assert.doesNotMatch(ui, /line-seat-buttons/);
assert.doesNotMatch(ui, /data-line-seat/);
assert.doesNotMatch(ui, /data-seat-value/);
assert.doesNotMatch(ui, /<span>Asignar:<\/span>/);

// La identidad real sigue siendo seatNumber por línea. Cambiar el selector superior
// no reetiqueta productos ya agregados y una misma ronda puede mezclar TODOS/personas.
assert.match(ui, /seatNumber:seatNumber\?\?null/);
assert.match(ui, /Number\(x\.seatNumber\|\|0\)===Number\(S\.person\|\|0\)/, 'La identidad de línea debe seguir separando TODOS/persona al agregar');
assert.match(ui, /item\.seatNumber\?\?null/);
assert.match(ui, /if\(item\?\.seatNumber\)return `Persona \$\{item\.seatNumber\}`;return 'TODOS'/);
assert.match(ui, /Revisa productos, cantidades, para quién va cada uno y notas/);
assert.match(ui, /Para: \$\{RV2\.esc\(targetLabel\(x\.seatNumber\)\)\}/);
assert.doesNotMatch(ui, /Mesa \/ sin asignar/);
assert.doesNotMatch(ui, /MutationObserver|setInterval/);

assert.match(css, /VANTIX_RESTAURANT_V2_PERSON_BUTTONS_V100/);
assert.match(css, /VANTIX_RESTAURANT_V2_CARD_TARGET_V101/);
assert.match(css, /\.service-controls\{flex-wrap:nowrap/);
assert.match(css, /\.person-targets\{[^}]*display:flex/);
assert.match(css, /\.person-targets\{[^}]*overflow-x:auto/);
assert.match(css, /\.draft-target-label b\{[^}]*display:inline-flex/);
assert.match(css, /\.draft-target-label b\{[^}]*border-radius:999px/);
assert.doesNotMatch(css, /\.line-seat-buttons/);
assert.doesNotMatch(css, /\.line-target-editor/);
assert.match(css, /@media\(max-width:720px\)/);

assert.match(html, /\/app\/restaurant-v2-person-buttons-v100\.css/);
assert.match(routes, /\/app\/restaurant-v2-person-buttons-v100\.css/);
assert.match(routes, /restaurant-v2-person-buttons-v100\.css/);

console.log(JSON.stringify({
  ok:true,
  marker:'VANTIX_RESTAURANT_V2_CARD_TARGET_V101',
  topSelector:'HORIZONTAL_BUTTONS',
  sharedTarget:'TODOS_TO_SEAT_NULL',
  mixedTargetsPerOrder:true,
  existingLineAssignmentPreserved:true,
  draftTarget:'ONE_STORED_LABEL_ONLY',
  draftReassignmentButtonsRemoved:true,
  reviewTargetVisible:true,
  sentTargetVisible:true,
  schemaChanged:false,
  backendContractChanged:false
}, null, 2));
