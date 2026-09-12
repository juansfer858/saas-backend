'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const installer = read('edge/supervisor/install-windows.ps1');
const watchdog = read('edge/supervisor/watchdog-windows.ps1');
const uninstall = read('edge/supervisor/uninstall-windows.ps1');
const supervisor = read('edge/supervisor/supervisor.js');
const version = JSON.parse(read('edge/version.json'));

assert.equal(version.version, '2.1.16-self-heal.3');
assert.equal(version.channel, 'PILOT');

assert.match(installer, /VantixGC Edge Supervisor/);
assert.match(installer, /VantixGC Edge Watchdog/);
assert.match(installer, /RestartCount 999/);
assert.match(installer, /watchdog-windows\.ps1/);
assert.match(installer, /New-ScheduledTaskTrigger -Once/);
assert.match(installer, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
assert.match(installer, /Register-ScheduledTask -TaskName \$WatchdogTaskName/);
assert.match(installer, /Start-ScheduledTask -TaskName \$WatchdogTaskName/);
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

assert.match(uninstall, /VantixGC Edge Watchdog/);
assert.match(uninstall, /Unregister-ScheduledTask -TaskName \$WatchdogTask/);
assert.match(uninstall, /Unregister-ScheduledTask -TaskName \$SupervisorTask/);

console.log('EDGE_WINDOWS_SELF_HEAL_V95_OK');
