'use strict';

const legacy = require('./windows-installer.service');
const INSTALL_SOURCE_COMMIT = '97e3d958f5a787c9826d9bb74a1b0a2def12f1d0';

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

  const stabilityAnchor = `  $Stage = 'vinculacion con Super Core'\n  Write-Host '[6/7] Verificando identidad y vinculacion...' -ForegroundColor Cyan`;
  const stabilityBlock = `  $Stage = 'estabilidad del servicio local'\n  Write-Host 'Validando estabilidad del servicio local...' -ForegroundColor Cyan\n  $StableChecks = 0\n  for ($i = 0; $i -lt 3; $i++) {\n    Start-Sleep -Seconds 4\n    try {\n      $StableStatus = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8788/api/status' -TimeoutSec 3\n      if ($StableStatus.ok) { $StableChecks += 1; $Status = $StableStatus }\n    } catch {}\n  }\n  if ($StableChecks -lt 3) {\n    $SupervisorLog = Join-Path $InstallDir 'data\\supervisor.log'\n    if (Test-Path $SupervisorLog) { Get-Content -LiteralPath $SupervisorLog -Tail 40 | ForEach-Object { Write-Host $_ } }\n    throw 'El servicio local arranco, pero no se mantuvo estable. La instalacion no se marcara como completada.'\n  }\n\n  $Stage = 'vinculacion con Super Core'\n  Write-Host '[6/7] Verificando identidad y vinculacion...' -ForegroundColor Cyan`;
  if (!fixed.includes(stabilityAnchor)) throw new Error('El instalador Windows perdió el punto de validación de estabilidad.');
  fixed = fixed.replace(stabilityAnchor, stabilityBlock);

  if (fixed.includes('$InstallArgs = @(') || fixed.includes('& $Installer @InstallArgs')) {
    throw new Error('El instalador Windows conserva el splatting posicional inseguro.');
  }
  if (!fixed.includes('$InstallParams = @{') || !fixed.includes('& $Installer @InstallParams')) {
    throw new Error('El instalador Windows no contiene el contrato V27 de parámetros nombrados.');
  }
  if (!/\$InstallDir\s*=\s*'C:\\+ProgramData\\+VantixGC\\+Edge'/.test(fixed)) {
    throw new Error('El instalador Windows perdió la ruta canónica de instalación.');
  }
  if (!fixed.includes(INSTALL_SOURCE_COMMIT)) {
    throw new Error('El instalador Windows no apunta al Edge V28 corregido.');
  }
  if (!fixed.includes('$StableChecks = 0') || !fixed.includes("$Stage = 'estabilidad del servicio local'")) {
    throw new Error('El instalador Windows no contiene la validación V28 de estabilidad.');
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
