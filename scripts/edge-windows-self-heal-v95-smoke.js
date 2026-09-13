'use strict';

// V95.4 capability validation: supervised runtime + watchdog + one-time in-place repair.
// La versión activa puede avanzar y un piloto puede desactivar fleetRollout sin perder
// las capacidades de autorecuperación que este smoke valida.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function versionTuple(raw) {
  const match = String(raw || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, `Versión Edge inválida: ${raw}`);
  return match.slice(1).map(Number);
}

function versionAtLeast(raw, minimum) {
  const a = versionTuple(raw);
  const b = versionTuple(minimum);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

const installer = read('edge/supervisor/install-windows.ps1');
const watchdog = read('edge/supervisor/watchdog-windows.ps1');
const uninstall = read('edge/supervisor/uninstall-windows.ps1');
const supervisor = read('edge/supervisor/supervisor.js');
const fleetBootstrap = read('edge/supervisor/fleet-repair-bootstrap-windows.ps1');
const fleetRepair = read('edge/supervisor/fleet-repair-windows.ps1');
const universalEntry = read('edge/agent/universal-entry.js');
const version = JSON.parse(read('edge/version.json'));

assert.ok(versionAtLeast(version.version, '2.1.16'), `Edge ${version.version} no puede retroceder antes del baseline self-heal 2.1.16`);
assert.ok(['PILOT', 'STABLE'].includes(version.channel));
assert.equal(typeof version.fleetRollout, 'boolean');

assert.match(installer, /VantixGC Edge Supervisor/);
assert.match(installer, /VantixGC Edge Watchdog/);
assert.match(installer, /RestartCount 999/);
assert.match(installer, /watchdog-windows\.ps1/);
assert.match(installer, /New-ScheduledTaskTrigger -Once/);
assert.match(installer, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
assert.match(installer, /Register-ScheduledTask -TaskName \$WatchdogTaskName/);
assert.match(installer, /Start-ScheduledTask -TaskName \$WatchdogTaskName/);
assert.match(installer, /EDGE_AUTO_UPDATE_ENABLED/);
assert.match(installer, /ExistingRaw/);
assert.match(installer, /CanonicalKeys/);
assert.match(installer, /if \(\$CanonicalKeys -notcontains \$Name\)/);
assert.ok(installer.indexOf('Stop-ScheduledTask -TaskName $WatchdogTaskName') < installer.indexOf('Stop-ScheduledTask -TaskName $TaskName'), 'el watchdog debe detenerse antes que el supervisor durante instalación/upgrade');

assert.match(supervisor, /restart-liveness-v3-startup-grace/);
assert.match(supervisor, /EDGE_SUPERVISOR_STARTUP_GRACE_MS/);
assert.match(supervisor, /startupGraceMs=/);
assert.match(supervisor, /HEALTH_WAIT startup/);
assert.match(supervisor, /ageMs < STARTUP_GRACE_MS/);
assert.match(supervisor, /childStartedAt = Date\.now\(\)/);

assert.match(watchdog, /Global\\VantixGCEdgeWatchdog/);
assert.match(watchdog, /http:\/\/127\.0\.0\.1:\{0\}\/api\/status/);
assert.match(watchdog, /TimeoutSec 4/);
assert.match(watchdog, /FailureThreshold = 2/);
assert.match(watchdog, /Get-SupervisorProcess/);
assert.match(watchdog, /Test-SupervisorProtection/);
assert.match(watchdog, /SUPERVISOR_PROTECTION_MISSING local_health=healthy/);
assert.match(watchdog, /Stop-OrphanEdgeAgent/);
assert.match(watchdog, /ORPHAN_AGENT_STOP pid=/);
assert.match(watchdog, /PROTECTION_RECOVERY_OK/);
assert.match(watchdog, /Stop-ScheduledTask -TaskName \$SupervisorTaskName/);
assert.match(watchdog, /Start-ScheduledTask -TaskName \$SupervisorTaskName/);
assert.match(watchdog, /for \(\$Attempt = 1; \$Attempt -le 10/);
assert.match(watchdog, /RECOVERY_OK/);
assert.match(watchdog, /watchdog-state\.json/);
assert.match(watchdog, /watchdog\.log/);

assert.match(fleetBootstrap, /VantixGC Edge Fleet Repair/);
assert.match(fleetBootstrap, /Register-ScheduledTask -TaskName \$TaskName/);
assert.match(fleetBootstrap, /-User 'SYSTEM' -RunLevel Highest/);
assert.match(fleetBootstrap, /Start-ScheduledTask -TaskName \$TaskName/);
assert.match(fleetBootstrap, /fleet-repair-v95-4\.pending\.json/);
assert.match(fleetRepair, /install-windows\.ps1/);
assert.match(fleetRepair, /fleet-repair-v95-4\.done\.json/);
assert.match(fleetRepair, /softwareVersion/);
assert.match(fleetRepair, /restart-liveness-v3-startup-grace/);
assert.match(fleetRepair, /VantixGC Edge Watchdog/);
assert.match(fleetRepair, /Unregister-ScheduledTask -TaskName \$TaskName/);
assert.match(universalEntry, /scheduleWindowsFleetRepair/);
assert.match(universalEntry, /fleet-repair-bootstrap-windows\.ps1/);
assert.match(universalEntry, /spawnSync\('powershell\.exe'/);
assert.ok(universalEntry.indexOf('scheduleWindowsFleetRepair();') < universalEntry.indexOf('const online = await fetchManifest();'), 'la reparación debe programarse antes del fetch de manifiesto remoto');

assert.match(uninstall, /VantixGC Edge Watchdog/);
assert.match(uninstall, /Unregister-ScheduledTask -TaskName \$WatchdogTask/);
assert.match(uninstall, /Unregister-ScheduledTask -TaskName \$SupervisorTask/);

console.log('EDGE_WINDOWS_SELF_HEAL_V95_4_CAPABILITY_OK', JSON.stringify({
  edgeVersion: version.version,
  channel: version.channel,
  fleetRollout: version.fleetRollout,
  selfHealBaselinePreserved: true
}));
