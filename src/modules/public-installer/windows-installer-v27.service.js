'use strict';

const legacy = require('./windows-installer.service');
// 2.1.11 is the first installer source we pin here with the restart-liveness-v2
// Supervisor contract. It keeps the Supervisor alive when the managed updater
// intentionally exits the Edge child with code 75 during activation handoff.
const INSTALL_SOURCE_COMMIT = '2f5fe6005d2398ff259788bbffc29af1564be0dc';

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
  fixed = fixed.replace(legacy.INSTALL_SOURCE_COMMIT, INSTALL_SOURCE_COMMIT);

  const packageAnchor = `  foreach ($Required in @('agent\\server.js', 'supervisor\\install-windows.ps1', 'supervisor\\supervisor.js')) {\n    if (-not (Test-Path (Join-Path $EdgeSource $Required))) { throw \"El paquete VantixGC esta incompleto: falta $Required\" }\n  }\n\n  $Stage = 'runtime local'`;
  const packageBlock = `  foreach ($Required in @('agent\\server.js', 'supervisor\\install-windows.ps1', 'supervisor\\supervisor.js')) {\n    if (-not (Test-Path (Join-Path $EdgeSource $Required))) { throw \"El paquete VantixGC esta incompleto: falta $Required\" }\n  }\n  $SupervisorSource = Join-Path $EdgeSource 'supervisor\\supervisor.js'\n  $SupervisorContract = Get-Content -LiteralPath $SupervisorSource -Raw\n  if (-not $SupervisorContract.Contains('restart-liveness-v2') -or -not $SupervisorContract.Contains('UPDATE_RESTART_REQUEST accepted')) {\n    throw 'El paquete VantixGC no contiene el Supervisor persistente requerido para actualizaciones Edge.'\n  }\n\n  $Stage = 'runtime local'`;
  if (!fixed.includes(packageAnchor)) throw new Error('El instalador Windows perdió la validación del paquete Edge.');
  fixed = fixed.replace(packageAnchor, packageBlock);

  const installAnchor = `  $Installer = Join-Path $EdgeSource 'supervisor\\install-windows.ps1'\n  & $Installer @InstallParams`;
  const installBlock = `  $Stage = 'normalizacion de activacion Edge anterior'\n  $ManagedCurrent = Join-Path $InstallDir 'current'\n  $PendingActivation = Join-Path $InstallDir 'data\\update-pending.json'\n  try { Stop-ScheduledTask -TaskName 'VantixGC Edge Supervisor' -ErrorAction SilentlyContinue } catch {}\n  Start-Sleep -Milliseconds 700\n  if (Test-Path $ManagedCurrent) {\n    Write-Host 'Restableciendo runtime base verificado antes de reinstalar...' -ForegroundColor Cyan\n    Remove-Item -LiteralPath $ManagedCurrent -Recurse -Force -ErrorAction Stop\n  }\n  Remove-Item -LiteralPath $PendingActivation -Force -ErrorAction SilentlyContinue\n\n  $Stage = 'vinculacion e instalacion local'\n  $Installer = Join-Path $EdgeSource 'supervisor\\install-windows.ps1'\n  & $Installer @InstallParams`;
  if (!fixed.includes(installAnchor)) throw new Error('El instalador Windows perdió el punto de instalación local.');
  fixed = fixed.replace(installAnchor, installBlock);

  const stabilityAnchor = `  $Stage = 'vinculacion con Super Core'\n  Write-Host '[6/7] Verificando identidad y vinculacion...' -ForegroundColor Cyan`;
  const stabilityBlock = `  $Stage = 'estabilidad del servicio local'\n  Write-Host 'Validando estabilidad del servicio local...' -ForegroundColor Cyan\n  $StableChecks = 0\n  for ($i = 0; $i -lt 3; $i++) {\n    Start-Sleep -Seconds 4\n    try {\n      $StableStatus = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8788/api/status' -TimeoutSec 3\n      if ($StableStatus.ok) { $StableChecks += 1; $Status = $StableStatus }\n    } catch {}\n  }\n  if ($StableChecks -lt 3) {\n    $SupervisorLog = Join-Path $InstallDir 'data\\supervisor.log'\n    if (Test-Path $SupervisorLog) { Get-Content -LiteralPath $SupervisorLog -Tail 40 | ForEach-Object { Write-Host $_ } }\n    throw 'El servicio local arranco, pero no se mantuvo estable. La instalacion no se marcara como completada.'\n  }\n\n  $Stage = 'vinculacion con Super Core'\n  Write-Host '[6/7] Verificando identidad y vinculacion...' -ForegroundColor Cyan`;
  if (!fixed.includes(stabilityAnchor)) throw new Error('El instalador Windows perdió el punto de validación de estabilidad.');
  fixed = fixed.replace(stabilityAnchor, stabilityBlock);

  if (fixed.includes('$InstallArgs = @(') || fixed.includes('& $Installer @InstallArgs')) {
    throw new Error('El instalador Windows conserva el splatting posicional inseguro.');
  }
  if (!fixed.includes('$InstallParams = @{') || !fixed.includes('& $Installer @InstallParams')) {
    throw new Error('El instalador Windows no contiene el contrato de parámetros nombrados.');
  }
  if (!/\$InstallDir\s*=\s*'C:\\+ProgramData\\+VantixGC\\+Edge'/.test(fixed)) {
    throw new Error('El instalador Windows perdió la ruta canónica de instalación.');
  }
  if (!fixed.includes(INSTALL_SOURCE_COMMIT)) {
    throw new Error('El instalador Windows no apunta al Edge con Supervisor persistente validado.');
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
  INSTALL_SOURCE_COMMIT,
  NODE_VERSION:legacy.NODE_VERSION,
  NODE_WIN_X64_SHA256:legacy.NODE_WIN_X64_SHA256,
  fixPowerShell,
  claimInstallerPowerShell,
  claimInstallerCmd,
  genericInstallerPowerShell,
  genericInstallerCmd
};
