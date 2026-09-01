const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const installerModulePath = path.join(root, 'src/modules/public-installer/windows-installer.service.js');
const installerSource = read('src/modules/public-installer/windows-installer.service.js');
const routes = read('src/modules/public-installer/public-installer.routes.js');
const selfServiceRoutes = read('src/modules/self-service/restaurant-self-service.routes.js');
const landing = read('src/web/public-installer.html');

for (const file of [
  'src/modules/public-installer/windows-installer.service.js',
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

assert.equal(installer.INSTALL_SOURCE_COMMIT, '6e6b3012f39bc21dd1d7324b43ada897279b300a');
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
  assert.match(ps, /6e6b3012f39bc21dd1d7324b43ada897279b300a/);
}

assert.match(genericPs, /EDGE_AGENT_ID/);
assert.match(genericPs, /EDGE_AGENT_KEY/);
assert.doesNotMatch(genericPs, /-InstallClaimToken', \$ClaimToken/);
assert.match(claimPs, /-InstallClaimToken/);
assert.ok(claimPs.includes(claimToken));
assert.doesNotMatch(claimPs, /Read-Host 'Pegue el EDGE_AGENT_ID/);

assert.match(genericCmd, /\/instalar\/windows\.ps1/);
assert.match(claimCmd, /\/api\/public\/restaurantes\/instalador\//);
assert.match(genericCmd, /VANTIX_EXIT/);
assert.match(claimCmd, /VANTIX_EXIT/);

assert.match(routes, /\/instalar\/windows\.cmd/);
assert.match(routes, /\/instalar\/windows\.ps1/);
assert.match(routes, /genericInstallerCmd/);
assert.match(routes, /genericInstallerPowerShell/);
assert.match(selfServiceRoutes, /windows-installer\.service/);
assert.match(selfServiceRoutes, /claimInstallerCmd/);
assert.match(selfServiceRoutes, /claimInstallerPowerShell/);
assert.doesNotMatch(selfServiceRoutes, /service\.installerCmd/);
assert.doesNotMatch(selfServiceRoutes, /service\.installerPowerShell/);
assert.match(landing, /href="\/instalar\/windows\.cmd"/);
assert.doesNotMatch(landing, /raw\.githubusercontent\.com\/juansfer858\/saas-backend\/main\/public\/downloads/);
assert.match(landing, /solicitará automáticamente permiso de Administrador/);

assert.match(installerSource, /VantixGC-Restaurantes-Installer\/2\.2/);
console.log('PUBLIC INSTALLER WINDOWS V18 UAC LAN INTEGRITY CONTRACT OK');