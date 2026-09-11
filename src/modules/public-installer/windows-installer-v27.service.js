'use strict';

const legacy = require('./windows-installer.service');
const INSTALL_MANIFEST_PATH = '/edge-releases/manifest.json';

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`No se encontró el bloque esperado del instalador: ${label}`);
  return source.replace(search, replacement);
}

function fixPowerShell(source) {
  let fixed = String(source || '');

  const genericOld = `$InstallArgs = @('-InstallDir', $InstallDir, '-CoreBaseUrl', $CoreBaseUrl)\nif ($EdgeAgentId) { $InstallArgs += @('-EdgeAgentId', $EdgeAgentId, '-EdgeAgentKey', $EdgeAgentKey) }`;
  const genericNew = `$InstallParams = @{\n  InstallDir = $InstallDir\n  CoreBaseUrl = $CoreBaseUrl\n}\nif ($EdgeAgentId) {\n  $InstallParams['EdgeAgentId'] = $EdgeAgentId\n  $InstallParams['EdgeAgentKey'] = $EdgeAgentKey\n}`;

  const claimOld = `$InstallArgs = @('-InstallDir', $InstallDir, '-CoreBaseUrl', $CoreBaseUrl, '-InstallClaimToken', $ClaimToken)`;
  const claimNew = `$InstallParams = @{\n  InstallDir = $InstallDir\n  CoreBaseUrl = $CoreBaseUrl\n  InstallClaimToken = $ClaimToken\n}`;

  if (fixed.includes(genericOld)) fixed = replaceOnce(fixed, genericOld, genericNew, 'credenciales manuales');
  if (fixed.includes(claimOld)) fixed = replaceOnce(fixed, claimOld, claimNew, 'claim automático');
  fixed = fixed.replace(/& \$Installer @InstallArgs/g, '& $Installer @InstallParams');

  const commitLine = `$Commit = '${legacy.INSTALL_SOURCE_COMMIT}'`;
  fixed = replaceOnce(fixed, commitLine, `$EdgeManifestPath = '${INSTALL_MANIFEST_PATH}'`, 'fuente Edge dinámica');

  const packageAnchor = `  $RepoZip = Join-Path $Temp 'repo.zip'\n  $RepoOut = Join-Path $Temp 'repo'\n  $NodeZip = Join-Path $Temp 'node.zip'\n  $NodeOut = Join-Path $Temp 'node'\n  New-Item -ItemType Directory -Force -Path $Temp,$RepoOut,$NodeOut | Out-Null\n  Invoke-Download -Uri (\"https://github.com/juansfer858/saas-backend/archive/$Commit.zip\") -OutFile $RepoZip\n  Expand-Archive -LiteralPath $RepoZip -DestinationPath $RepoOut -Force\n  $RepoRoot = Get-ChildItem -LiteralPath $RepoOut -Directory | Where-Object { $_.Name -like 'saas-backend-*' } | Select-Object -First 1\n  if (-not $RepoRoot) { throw 'No se pudo preparar el paquete VantixGC.' }\n  $EdgeSource = Join-Path $RepoRoot.FullName 'edge'`;

  const packageBlock = `  $EdgeZip = Join-Path $Temp 'edge-release.zip'\n  $EdgeSource = Join-Path $Temp 'edge'\n  $NodeZip = Join-Path $Temp 'node.zip'\n  $NodeOut = Join-Path $Temp 'node'\n  New-Item -ItemType Directory -Force -Path $Temp,$EdgeSource,$NodeOut | Out-Null\n\n  $Stage = 'seleccion de version Edge recomendada'\n  $ManifestUri = $CoreBaseUrl.TrimEnd('/') + $EdgeManifestPath\n  try {\n    $ReleaseManifest = Invoke-RestMethod -UseBasicParsing -Uri $ManifestUri -TimeoutSec 30\n  } catch {\n    throw \"No fue posible consultar la version Edge recomendada en $ManifestUri. $($_.Exception.Message)\"\n  }\n  $RecommendedVersion = [string]$ReleaseManifest.installRecommended\n  if (-not $RecommendedVersion) { throw 'El Core no definio una version Edge recomendada para instalaciones nuevas.' }\n  $ReleaseProperty = $ReleaseManifest.releases.PSObject.Properties[$RecommendedVersion]\n  if (-not $ReleaseProperty) { throw \"La version Edge recomendada $RecommendedVersion no existe en el manifiesto del Core.\" }\n  $Release = $ReleaseProperty.Value\n  $ReleaseFile = [string]$Release.file\n  $ReleaseSha256 = ([string]$Release.sha256).ToLowerInvariant()\n  if (-not $ReleaseFile -or $ReleaseSha256 -notmatch '^[a-f0-9]{64}$') { throw 'El manifiesto Edge recomendado no contiene archivo y SHA-256 validos.' }\n  Write-Host ('Version Edge recomendada: ' + $RecommendedVersion + ' · canal ' + [string]$Release.channel) -ForegroundColor Cyan\n\n  $Stage = 'descarga Edge recomendada'\n  $ReleaseUri = $CoreBaseUrl.TrimEnd('/') + '/edge-releases/' + $ReleaseFile\n  Invoke-Download -Uri $ReleaseUri -OutFile $EdgeZip\n  $ActualEdgeHash = (Get-FileHash -LiteralPath $EdgeZip -Algorithm SHA256).Hash.ToLowerInvariant()\n  if ($ActualEdgeHash -ne $ReleaseSha256) { throw 'La verificacion de integridad del paquete Edge recomendado no coincidio.' }\n  Expand-Archive -LiteralPath $EdgeZip -DestinationPath $EdgeSource -Force\n  $VersionFile = Join-Path $EdgeSource 'version.json'\n  if (-not (Test-Path $VersionFile)) { throw 'El paquete Edge recomendado no contiene version.json.' }\n  $PackageVersion = (Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json).version\n  if ([string]$PackageVersion -ne $RecommendedVersion) { throw \"El paquete Edge descargado reporta $PackageVersion y el Core recomendo $RecommendedVersion.\" }`;

  fixed = replaceOnce(fixed, packageAnchor, packageBlock, 'descarga del paquete Edge');

  const requiredAnchor = `  foreach ($Required in @('agent\\server.js', 'supervisor\\install-windows.ps1', 'supervisor\\supervisor.js')) {\n    if (-not (Test-Path (Join-Path $EdgeSource $Required))) { throw \"El paquete VantixGC esta incompleto: falta $Required\" }\n  }\n\n  $Stage = 'runtime local'`;
  const requiredBlock = `  foreach ($Required in @('agent\\server.js', 'supervisor\\install-windows.ps1', 'supervisor\\supervisor.js')) {\n    if (-not (Test-Path (Join-Path $EdgeSource $Required))) { throw \"El paquete VantixGC esta incompleto: falta $Required\" }\n  }\n  $SupervisorSource = Join-Path $EdgeSource 'supervisor\\supervisor.js'\n  $SupervisorContract = Get-Content -LiteralPath $SupervisorSource -Raw\n  if (-not $SupervisorContract.Contains('restart-liveness-v2') -or -not $SupervisorContract.Contains('UPDATE_RESTART_REQUEST accepted')) {\n    throw 'El paquete VantixGC no contiene el Supervisor persistente requerido para actualizaciones Edge.'\n  }\n\n  $Stage = 'runtime local'`;
  fixed = replaceOnce(fixed, requiredAnchor, requiredBlock, 'validación del paquete Edge');

  const installAnchor = `  $Installer = Join-Path $EdgeSource 'supervisor\\install-windows.ps1'\n  & $Installer @InstallParams`;
  const installBlock = `  $Stage = 'normalizacion de activacion Edge anterior'\n  $ManagedCurrent = Join-Path $InstallDir 'current'\n  $PendingActivation = Join-Path $InstallDir 'data\\update-pending.json'\n  try { Stop-ScheduledTask -TaskName 'VantixGC Edge Supervisor' -ErrorAction SilentlyContinue } catch {}\n  Start-Sleep -Milliseconds 700\n  if (Test-Path $ManagedCurrent) {\n    Write-Host 'Restableciendo runtime base verificado antes de reinstalar...' -ForegroundColor Cyan\n    Remove-Item -LiteralPath $ManagedCurrent -Recurse -Force -ErrorAction Stop\n  }\n  Remove-Item -LiteralPath $PendingActivation -Force -ErrorAction SilentlyContinue\n\n  $Stage = 'vinculacion e instalacion local'\n  $Installer = Join-Path $EdgeSource 'supervisor\\install-windows.ps1'\n  & $Installer @InstallParams`;
  fixed = replaceOnce(fixed, installAnchor, installBlock, 'instalación local');

  const stabilityAnchor = `  $Stage = 'vinculacion con Super Core'\n  Write-Host '[6/7] Verificando identidad y vinculacion...' -ForegroundColor Cyan`;
  const stabilityBlock = `  $Stage = 'estabilidad del servicio local'\n  Write-Host 'Validando estabilidad del servicio local...' -ForegroundColor Cyan\n  $StableChecks = 0\n  for ($i = 0; $i -lt 3; $i++) {\n    Start-Sleep -Seconds 4\n    try {\n      $StableStatus = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8788/api/status' -TimeoutSec 3\n      if ($StableStatus.ok) { $StableChecks += 1; $Status = $StableStatus }\n    } catch {}\n  }\n  if ($StableChecks -lt 3) {\n    $SupervisorLog = Join-Path $InstallDir 'data\\supervisor.log'\n    if (Test-Path $SupervisorLog) { Get-Content -LiteralPath $SupervisorLog -Tail 40 | ForEach-Object { Write-Host $_ } }\n    throw 'El servicio local arranco, pero no se mantuvo estable. La instalacion no se marcara como completada.'\n  }\n\n  $Stage = 'vinculacion con Super Core'\n  Write-Host '[6/7] Verificando identidad y vinculacion...' -ForegroundColor Cyan`;
  fixed = replaceOnce(fixed, stabilityAnchor, stabilityBlock, 'validación de estabilidad');

  if (fixed.includes('$InstallArgs = @(') || fixed.includes('& $Installer @InstallArgs')) {
    throw new Error('El instalador Windows conserva el splatting posicional inseguro.');
  }
  if (!fixed.includes('$InstallParams = @{') || !fixed.includes('& $Installer @InstallParams')) {
    throw new Error('El instalador Windows no contiene el contrato de parámetros nombrados.');
  }
  if (!/\$InstallDir\s*=\s*'C:\\+ProgramData\\+VantixGC\\+Edge'/.test(fixed)) {
    throw new Error('El instalador Windows perdió la ruta canónica de instalación.');
  }
  if (!fixed.includes(INSTALL_MANIFEST_PATH) || !fixed.includes('$RecommendedVersion = [string]$ReleaseManifest.installRecommended')) {
    throw new Error('El instalador Windows no resuelve la versión Edge recomendada desde el Core.');
  }
  if (fixed.includes('github.com/juansfer858/saas-backend/archive/$Commit.zip')) {
    throw new Error('El instalador Windows todavía depende de un commit fijo del repositorio.');
  }
  if (!fixed.includes('$ActualEdgeHash') || !fixed.includes('$ReleaseSha256')) {
    throw new Error('El instalador Windows no valida SHA-256 del Edge recomendado.');
  }
  if (!fixed.includes("$SupervisorContract.Contains('restart-liveness-v2')") || !fixed.includes("$SupervisorContract.Contains('UPDATE_RESTART_REQUEST accepted')")) {
    throw new Error('El instalador Windows no valida el contrato de reinicio persistente del Supervisor.');
  }
  if (!fixed.includes('$StableChecks = 0') || !fixed.includes("$Stage = 'estabilidad del servicio local'")) {
    throw new Error('El instalador Windows no contiene la validación de estabilidad.');
  }
  if (!fixed.includes("$Stage = 'normalizacion de activacion Edge anterior'") || !fixed.includes("Join-Path $InstallDir 'current'")) {
    throw new Error('El instalador Windows no limpia una activación Edge anterior antes de reinstalar.');
  }

  return fixed;
}

function claimInstallerPowerShell(rawToken, coreBaseUrl) {
  return fixPowerShell(legacy.claimInstallerPowerShell(rawToken, coreBaseUrl));
}

function genericInstallerPowerShell(coreBaseUrl) {
  return fixPowerShell(legacy.genericInstallerPowerShell(coreBaseUrl));
}

function claimInstallerCmd(rawToken, coreBaseUrl) {
  return legacy.claimInstallerCmd(rawToken, coreBaseUrl);
}

function genericInstallerCmd(coreBaseUrl) {
  return legacy.genericInstallerCmd(coreBaseUrl);
}

module.exports = {
  INSTALL_MANIFEST_PATH,
  NODE_VERSION:legacy.NODE_VERSION,
  NODE_WIN_X64_SHA256:legacy.NODE_WIN_X64_SHA256,
  fixPowerShell,
  claimInstallerPowerShell,
  claimInstallerCmd,
  genericInstallerPowerShell,
  genericInstallerCmd
};
