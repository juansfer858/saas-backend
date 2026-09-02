'use strict';

const legacy = require('./windows-installer.service');

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

  if (fixed.includes('$InstallArgs = @(') || fixed.includes('& $Installer @InstallArgs')) {
    throw new Error('El instalador Windows conserva el splatting posicional inseguro.');
  }
  if (!fixed.includes('$InstallParams = @{') || !fixed.includes('& $Installer @InstallParams')) {
    throw new Error('El instalador Windows no contiene el contrato V27 de parámetros nombrados.');
  }
  if (!/\$InstallDir\s*=\s*'C:\\+ProgramData\\+VantixGC\\+Edge'/.test(fixed)) {
    throw new Error('El instalador Windows perdió la ruta canónica de instalación.');
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
  INSTALL_SOURCE_COMMIT:legacy.INSTALL_SOURCE_COMMIT,
  NODE_VERSION:legacy.NODE_VERSION,
  NODE_WIN_X64_SHA256:legacy.NODE_WIN_X64_SHA256,
  fixPowerShell,
  claimInstallerPowerShell,
  claimInstallerCmd,
  genericInstallerPowerShell,
  genericInstallerCmd
};
