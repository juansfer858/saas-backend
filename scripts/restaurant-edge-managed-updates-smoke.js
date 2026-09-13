'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EdgeUpdater } = require('../edge/updater/updater');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const updaterSource = read('edge/updater/updater.js');
const serverSource = read('edge/agent/server.js');
const installer = read('edge/supervisor/install-windows.ps1');
const fleetRepair = read('edge/supervisor/fleet-repair-windows.ps1');

// Auto-update controla únicamente el polling periódico. Un despliegue solicitado
// explícitamente por Core debe consultar el manifiesto incluso si el polling está apagado.
assert.doesNotMatch(updaterSource, /if \(!this\.enabled \|\| this\.running\)/);
assert.match(updaterSource, /if \(this\.running\) return \{ skipped: true, reason: 'RUNNING' \}/);
assert.match(serverSource, /if \(process\.env\.EDGE_AUTO_UPDATE_ENABLED === 'true'\) \{[\s\S]*setInterval\(\(\) => updater\.checkNow\(\)/);

// Una instalación o reparación normal debe sanar un false heredado. Solo el switch
// explícito de soporte crea un lock persistente.
assert.match(installer, /\$AutoUpdate = if \(\$DisableAutoUpdate\) \{ 'false' \} else \{ 'true' \}/);
assert.match(installer, /\$ManagedUpdatesLocked = if \(\$DisableAutoUpdate\) \{ 'true' \} else \{ 'false' \}/);
assert.match(installer, /EDGE_MANAGED_UPDATES_LOCKED/);
assert.doesNotMatch(installer, /Existing\.ContainsKey\('EDGE_AUTO_UPDATE_ENABLED'\)/);
assert.match(fleetRepair, /EDGE_MANAGED_UPDATES_LOCKED/);
assert.doesNotMatch(fleetRepair, /EDGE_AUTO_UPDATE_ENABLED\\s\*=\\s\*false/);

(async () => {
  const calls = [];
  const updater = new EdgeUpdater({
    enabled: false,
    store: null,
    central: async (pathname) => {
      calls.push(pathname);
      if (pathname === '/edge/api/v1/update/manifest') return { data: { updateAvailable: false } };
      throw new Error(`Unexpected central call: ${pathname}`);
    }
  });

  const result = await updater.checkNow();
  assert.deepEqual(result, { updated: false });
  assert.deepEqual(calls, ['/edge/api/v1/update/manifest']);

  console.log(JSON.stringify({
    ok: true,
    manualDeploymentIgnoresPeriodicAutoUpdateFlag: true,
    periodicAutoUpdateStillRespectsFlag: true,
    installerRepairsInheritedFalse: true,
    fleetRepairRepairsInheritedFalse: true,
    explicitSupportLockStillAvailable: true
  }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
