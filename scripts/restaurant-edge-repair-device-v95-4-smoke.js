'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const repairPath = path.join(root, 'src/modules/public-installer/edge-repair-windows.service.js');

for (const file of [
  'src/modules/public-installer/edge-repair-windows.service.js',
  'src/modules/public-installer/public-installer.routes.js'
]) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

const repair = require(repairPath);
const ps = repair.windowsRepairPowerShell('https://core.vantixgc.com');
const cmd = repair.windowsRepairCmd('https://core.vantixgc.com');
const routes = read('src/modules/public-installer/public-installer.routes.js');
const devices = read('src/web/restaurant-v2-admin-parity.html');
const manifest = JSON.parse(read('public/edge-releases/manifest.json'));

assert.equal(repair.EDGE_REPAIR_VERSION, '2.1.16-self-heal.4');
assert.equal(manifest.installRecommended, '2.1.16-self-heal.4');
assert.equal(String(manifest.fleetRolloutVersion || ''), '', 'V95.4 no debe lanzarse automáticamente a toda la flota');

const release = manifest.releases?.[repair.EDGE_REPAIR_VERSION];
assert.ok(release, 'V95.4 debe existir en el manifiesto');
assert.match(String(release.sha256 || ''), /^[a-f0-9]{64}$/);
assert.equal(release.file, 'vantixgc-edge-2.1.16-self-heal.4.zip');
const artifact = path.join(root, 'public/edge-releases', release.file);
assert.ok(fs.existsSync(artifact), 'el ZIP V95.4 debe estar empaquetado');
const actual = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
assert.equal(actual, release.sha256, 'el ZIP V95.4 debe coincidir con el SHA publicado');

assert.match(ps, /2\.1\.16-self-heal\.4/);
assert.match(ps, /Start-Process powershell\.exe -Verb RunAs -Wait -PassThru/);
assert.match(ps, /vantixgc-edge\.sqlite/);
assert.match(ps, /repair-backups\\manual-/);
assert.match(ps, /Copy-Item \(Join-Path \$InstallDir 'data'\)/);
assert.match(ps, /Remove-Item -LiteralPath \$ManagedCurrent -Recurse -Force/);
assert.match(ps, /update-pending\.json/);
assert.match(ps, /supervisor\\install-windows\.ps1/);
assert.match(ps, /restart-liveness-v3-startup-grace/);
assert.match(ps, /VantixGC Edge Watchdog/);
assert.match(ps, /http:\/\/127\.0\.0\.1:8788\/api\/status/);
assert.match(ps, /REPARACION COMPLETADA/);
assert.match(ps, /Backup disponible en/);
assert.match(cmd, /\/reparar-edge\/windows\.ps1/);
assert.match(cmd, /VantixGC_Edge_Repair_/);
assert.match(cmd, /VANTIX_EXIT/);

assert.match(routes, /edge-repair-windows\.service/);
assert.match(routes, /\/reparar-edge\/windows\.cmd/);
assert.match(routes, /\/reparar-edge\/windows\.ps1/);
assert.match(routes, /REPARAR_VANTIXGC_EDGE\.cmd/);

assert.match(devices, /id="edgeRepairPanel"/);
assert.match(devices, /Reparar Edge de este computador/);
assert.match(devices, /href="\/reparar-edge\/windows\.cmd"/);
assert.match(devices, /Conserva vinculación, base local, impresoras y configuración/);
assert.match(devices, /Para computadores nuevos usa la instalación normal/);

console.log('RESTAURANT EDGE REPAIR DEVICES V95.4 OK', JSON.stringify({
  version: repair.EDGE_REPAIR_VERSION,
  recommended: manifest.installRecommended,
  fleetAutoRollout: false,
  artifactSha256: release.sha256,
  devicesDownload: '/reparar-edge/windows.cmd'
}));
