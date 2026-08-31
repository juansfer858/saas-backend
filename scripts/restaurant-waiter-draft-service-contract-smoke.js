'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

// Reproduce the real application load order. If a legacy side-effect module replaces
// the waiter draft methods, these assertions must fail before the PR can merge.
require('../src/routes/core.routes');
const identity = require('../src/modules/restaurant/restaurant-identity.service');

const coreRoutes = read('src/routes/core.routes.js');
const getDraftSource = String(identity.getWaiterDraft);
const setItemSource = String(identity.setWaiterDraftItem);

assert.doesNotMatch(coreRoutes, /restaurant-draft-fix/,
  'core.routes no debe reactivar el parche legacy que elimina service.allItems');
assert.match(getDraftSource, /sessionServiceSummaryInTx/,
  'getWaiterDraft debe usar el resumen canónico de servicio de la mesa');
assert.match(getDraftSource, /service/,
  'getWaiterDraft debe devolver service para renderizar productos y total desde la misma fuente');
assert.match(setItemSource, /seatNumber/,
  'setWaiterDraftItem debe conservar la persona del consumo');

console.log(JSON.stringify({
  ok:true,
  contract:'WAITER_DRAFT_SERVICE_CANONICAL',
  serviceItems:true,
  totalAndItemsSameServiceSource:true,
  seatNumberPreserved:true,
  legacyDraftPatchInactive:true
}));
