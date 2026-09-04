const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const installerModulePath = path.join(root, 'src/modules/public-installer/windows-installer-v27.service.js');
const installerSource = read('src/modules/public-installer/windows-installer-v27.service.js');
const routes = read('src/modules/public-installer/public-installer.routes.js');
const selfServiceRoutes = read('src/modules/self-service/restaurant-self-service.routes.js');
const landing = read('src/web/public-installer.html');
const edgeVersion = JSON.parse(read('edge/version.json'));

for (const file of [
  'src/modules/public-installer/windows-installer.service.js',
  'src/modules/public-installer/windows-installer-v27.service.js',
  'src/modules/public-installer/public-installer.routes.js',
  'src/modules/self-service/restaurant-self-service.routes.js'
]) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

const installer = require(installerModulePath);
const claimToken = 'claim_token_123456789012345678901234567890123456';
const genericPs = installer.genericInstallerPowerShell('https://core.vantixgc.com');
const genericCmd = installer.genericInstallerCmd('https://core.vantixgc.com');
const claimPs = installer.claimInstallerPowerShell(claimToken, 'https://core.vantixgc.com');
const claimCmd = installer.claimInstallerCmd(claimToken, 'https://core.vantixgc.com');
const EDGE_V28_COMMIT = '97e3d958f5a787c9826d9bb74a1b0a2def12f1d0';

assert.equal(installer.INSTALL_SOURCE_COMMIT, EDGE_V28_COMMIT);
assert.equal(edgeVersion.version, '2.1.3-immediate-print.1');
assert.equal(edgeVersion.channel, 'PILOT');
assert.equal(installer.NODE_VERSION, '22.23.2');
assert.equal(installer.NODE_WIN_X64_SHA256, '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97');

for (const ps of [genericPs, claimPs]) {
  assert.match(ps, /Start-Process[^\n]+-Verb RunAs/);
  assert.match(ps, /Get-FileHash[^\n]+SHA256/);
  assert.match(ps, /1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97/);
  assert.match(ps, /New-NetFirewallRule/);
  assert.match(ps, /RemoteAddress LocalSubnet/);
  assert.match(ps, /Profile Private,Domain/);
  assert.match(ps, /TCP 8788/);
  assert.match(ps, /UDP 8789/);
  assert.match(ps, /last-error\.log/);
  assert.match(ps, /for \(\$Attempt = 1; \$Attempt -le 3/);
  assert.match(ps, /supervisor\\install-windows\.ps1/);
  assert.match(ps, /http:\/\/127\.0\.0\.1:8788\/api\/status/);
  assert.match(ps, /installationId/);
  assert.match(ps, /provisioned/);
  assert.match(ps, new RegExp(EDGE_V28_COMMIT));
  assert.doesNotMatch(ps, /07f057ec69c699fbb24859d49c1fabfa7eb9d7c9/);
  assert.match(ps, /\$InstallParams = @\{/);
  assert.match(ps, /InstallDir = \$InstallDir/);
  assert.match(ps, /CoreBaseUrl = \$CoreBaseUrl/);
  assert.match(ps, /& \$Installer @InstallParams/);
  assert.doesNotMatch(ps, /\$InstallArgs = @\(/);
  assert.doesNotMatch(ps, /& \$Installer @InstallArgs/);
  assert.match(ps, /\$InstallDir\s*=\s*'C:\\+ProgramData\\+VantixGC\\+Edge'/);
  assert.match(ps, /estabilidad del servicio local/);
  assert.match(ps, /\$StableChecks = 0/);
  assert.match(ps, /\$StableChecks -lt 3/);
  assert.match(ps, /no se mantuvo estable/);
}

assert.match(genericPs, /EDGE_AGENT_ID/);
assert.match(genericPs, /EDGE_AGENT_KEY/);
assert.doesNotMatch(genericPs, /InstallClaimToken = \$ClaimToken/);
assert.match(claimPs, /InstallClaimToken = \$ClaimToken/);
assert.ok(claimPs.includes(claimToken));
assert.doesNotMatch(claimPs, /Read-Host 'Pegue el EDGE_AGENT_ID/);

assert.match(genericCmd, /\/instalar\/windows\.ps1/);
assert.match(claimCmd, /\/api\/public\/restaurantes\/instalador\//);
assert.match(genericCmd, /VANTIX_EXIT/);
assert.match(claimCmd, /VANTIX_EXIT/);

assert.match(routes, /\/instalar\/windows\.cmd/);
assert.match(routes, /\/instalar\/windows\.ps1/);
assert.match(routes, /windows-installer-v27\.service/);
assert.match(routes, /genericInstallerCmd/);
assert.match(routes, /genericInstallerPowerShell/);
assert.match(selfServiceRoutes, /windows-installer-v27\.service/);
assert.match(selfServiceRoutes, /claimInstallerCmd/);
assert.match(selfServiceRoutes, /claimInstallerPowerShell/);
assert.doesNotMatch(selfServiceRoutes, /service\.installerCmd/);
assert.doesNotMatch(selfServiceRoutes, /service\.installerPowerShell/);
assert.match(landing, /href="\/instalar\/windows\.cmd"/);
assert.doesNotMatch(landing, /raw\.githubusercontent\.com\/juansfer858\/saas-backend\/main\/public\/downloads/);
assert.match(landing, /solicitará automáticamente permiso de Administrador/);

assert.match(installerSource, /splatting posicional inseguro/);
assert.match(installerSource, /ruta canónica de instalación/);
assert.match(installerSource, /Edge V28 corregido/);
assert.match(installerSource, /validación V28 de estabilidad/);
console.log('PUBLIC INSTALLER WINDOWS V28 NAMED PARAMS + STABLE EDGE CONTRACT OK');
