const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const installerModulePath = path.join(root, 'src/modules/public-installer/windows-installer-v27.service.js');
const installerSource = read('src/modules/public-installer/windows-installer-v27.service.js');
const supervisorSource = read('edge/supervisor/supervisor.js');
const routes = read('src/modules/public-installer/public-installer.routes.js');
const publicComposition = read('src/modules/restaurant/restaurant.public.routes.js');
const platformPanelRuntime = read('src/web/platform-restaurant-fiscal-governance.js');
const selfServiceRoutes = read('src/modules/self-service/restaurant-self-service.routes.js');
const landing = read('src/web/public-installer.html');
const edgeVersion = JSON.parse(read('edge/version.json'));
const releaseManifest = JSON.parse(read('public/edge-releases/manifest.json'));

for (const file of [
  'src/modules/public-installer/windows-installer.service.js',
  'src/modules/public-installer/windows-installer-v27.service.js',
  'src/modules/public-installer/public-installer.routes.js',
  'src/modules/self-service/restaurant-self-service.routes.js',
  'src/modules/restaurant/restaurant.public.routes.js',
  'src/web/platform-restaurant-fiscal-governance.js'
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

assert.equal(installer.INSTALL_MANIFEST_PATH, '/edge-releases/manifest.json');
assert.match(edgeVersion.version, /^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/);
assert.ok(['PILOT', 'STABLE'].includes(edgeVersion.channel));
assert.equal(installer.NODE_VERSION, '22.23.2');
assert.equal(installer.NODE_WIN_X64_SHA256, '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97');
assert.match(supervisorSource, /SUPERVISOR_REVISION = 'restart-liveness-v3-startup-grace'/);
assert.match(supervisorSource, /EDGE_SUPERVISOR_STARTUP_GRACE_MS/);
assert.match(supervisorSource, /HEALTH_WAIT startup/);
assert.match(supervisorSource, /Number\(code\) === 75/);
assert.match(supervisorSource, /UPDATE_RESTART_REQUEST accepted/);
assert.doesNotMatch(supervisorSource, /setTimeout\(start, wait\)\.unref/);

assert.equal(releaseManifest.schema, 'vantixgc-edge-core-artifacts-v1');
assert.match(releaseManifest.installRecommended, /^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/);
const recommended = releaseManifest.releases?.[releaseManifest.installRecommended];
assert.ok(recommended, 'installRecommended debe apuntar a un release existente');
assert.match(recommended.file, /^vantixgc-edge-.+\.zip$/);
assert.match(recommended.sha256, /^[a-f0-9]{64}$/);
const recommendedPath = path.join(root, 'public/edge-releases', recommended.file);
assert.ok(fs.existsSync(recommendedPath), 'el ZIP recomendado debe estar empaquetado en Core');
const recommendedHash = crypto.createHash('sha256').update(fs.readFileSync(recommendedPath)).digest('hex');
assert.equal(recommendedHash, recommended.sha256, 'el ZIP recomendado debe coincidir con el SHA-256 publicado');

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
  assert.match(ps, /\/edge-releases\/manifest\.json/);
  assert.match(ps, /\$StableCandidates = @\(\)/);
  assert.match(ps, /channel -ne 'STABLE'/);
  assert.match(ps, /\$ReleaseManifest\.installRecommended/);
  assert.match(ps, /\$SelectionReason = 'STABLE'/);
  assert.match(ps, /\$SelectionReason = 'RECOMMENDED'/);
  assert.match(ps, /\/edge-releases\/.*\$ReleaseFile/);
  assert.match(ps, /\$ActualEdgeHash/);
  assert.match(ps, /\$ReleaseSha256/);
  assert.doesNotMatch(ps, /github\.com\/juansfer858\/saas-backend\/archive\/\$Commit\.zip/);
  assert.doesNotMatch(ps, /\$Commit\s*=/);
  assert.match(ps, /\$InstallParams = @\{/);
  assert.match(ps, /InstallDir = \$InstallDir/);
  assert.match(ps, /CoreBaseUrl = \$CoreBaseUrl/);
  assert.match(ps, /& \$Installer @InstallParams/);
  assert.doesNotMatch(ps, /\$InstallArgs = @\(/);
  assert.doesNotMatch(ps, /& \$Installer @InstallArgs/);
  assert.match(ps, /\$InstallDir\s*=\s*'C:\\+ProgramData\\+VantixGC\\+Edge'/);
  assert.match(ps, /\$SupervisorContract = Get-Content -LiteralPath \$SupervisorSource -Raw/);
  assert.match(ps, /\$SupervisorContract\.Contains\('restart-liveness-v3-startup-grace'\)/);
  assert.match(ps, /\$SupervisorContract\.Contains\('EDGE_SUPERVISOR_STARTUP_GRACE_MS'\)/);
  assert.match(ps, /\$SupervisorContract\.Contains\('HEALTH_WAIT startup'\)/);
  assert.match(ps, /\$SupervisorContract\.Contains\('UPDATE_RESTART_REQUEST accepted'\)/);
  assert.match(ps, /Supervisor V95\.2 con gracia de arranque y reinicio persistente/);
  assert.match(ps, /estabilidad del servicio local/);
  assert.match(ps, /\$StableChecks = 0/);
  assert.match(ps, /\$StableChecks -lt 3/);
  assert.match(ps, /no se mantuvo estable/);
  assert.match(ps, /normalizacion de activacion Edge anterior/);
  assert.match(ps, /\$ManagedCurrent = Join-Path \$InstallDir 'current'/);
  assert.match(ps, /\$PendingActivation = Join-Path \$InstallDir 'data\\update-pending\.json'/);
  assert.match(ps, /Stop-ScheduledTask -TaskName 'VantixGC Edge Supervisor'/);
  assert.match(ps, /Remove-Item -LiteralPath \$ManagedCurrent -Recurse -Force -ErrorAction Stop/);
  assert.match(ps, /Remove-Item -LiteralPath \$PendingActivation -Force -ErrorAction SilentlyContinue/);
  assert.match(ps, /Restableciendo runtime base verificado antes de reinstalar/);
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
assert.match(publicComposition, /publicInstallerRouter/);
assert.match(publicComposition, /router\.use\(publicInstallerRouter\)/);
assert.match(selfServiceRoutes, /windows-installer-v27\.service/);
assert.match(selfServiceRoutes, /claimInstallerCmd/);
assert.match(selfServiceRoutes, /claimInstallerPowerShell/);
assert.doesNotMatch(selfServiceRoutes, /service\.installerCmd/);
assert.doesNotMatch(selfServiceRoutes, /service\.installerPowerShell/);
assert.match(landing, /href="\/instalar\/windows\.cmd"/);
assert.doesNotMatch(landing, /raw\.githubusercontent\.com\/juansfer858\/saas-backend\/main\/public\/downloads/);
assert.match(landing, /solicitará automáticamente permiso de Administrador/);
assert.match(platformPanelRuntime, /VANTIXGC_PLATFORM_RESTAURANT_INSTALLER_V1/);
assert.match(platformPanelRuntime, /Instalador Restaurante/);
assert.match(platformPanelRuntime, /publicPage:\s*'\/instalar'/);
assert.match(platformPanelRuntime, /windowsDownload:\s*'\/instalar\/windows\.cmd'/);
assert.match(platformPanelRuntime, /Abrir página de descarga/);

assert.match(installerSource, /INSTALL_MANIFEST_PATH/);
assert.match(installerSource, /STABLE\/recomendado desde el Core/);
assert.match(installerSource, /ruta canónica de instalación/);
assert.match(installerSource, /SHA-256 del Edge recomendado/);
assert.match(installerSource, /contrato V95\.2 de gracia de arranque y reinicio persistente del Supervisor/);
assert.match(installerSource, /activación Edge anterior antes de reinstalar/);
console.log('PUBLIC INSTALLER WINDOWS V53 DYNAMIC RECOMMENDED EDGE + V95.2 SUPERVISOR CONTRACT OK');
