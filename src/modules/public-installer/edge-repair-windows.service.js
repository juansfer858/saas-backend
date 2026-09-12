'use strict';

const EDGE_REPAIR_VERSION = '2.1.16-self-heal.4';
const EDGE_MANIFEST_PATH = '/edge-releases/manifest.json';

function normalizeBaseUrl(value) {
  const base = String(value || '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('CoreBaseUrl inválido para reparación Edge.');
  return base;
}

function windowsRepairPowerShell(coreBaseUrl) {
  const base = normalizeBaseUrl(coreBaseUrl).replace(/'/g, "''");
  return String.raw`$ErrorActionPreference = 'Stop'
$CoreBaseUrl = '${base}'
$TargetVersion = '${EDGE_REPAIR_VERSION}'
$InstallDir = 'C:\ProgramData\VantixGC\Edge'
$ManifestPath = '${EDGE_MANIFEST_PATH}'

function Test-IsAdmin {
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
  return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
  Write-Host 'Solicitando permiso de Administrador...' -ForegroundColor Cyan
  $Args = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
  $Elevated = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList $Args
  exit $Elevated.ExitCode
}

function Invoke-Download([string]$Uri, [string]$OutFile) {
  $Last = $null
  for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile -TimeoutSec 45
      return
    } catch {
      $Last = $_
      if ($Attempt -lt 3) { Start-Sleep -Seconds (2 * $Attempt) }
    }
  }
  throw $Last
}

function Stop-ExistingEdge([string]$Root) {
  foreach ($Task in @('VantixGC Edge Watchdog','VantixGC Edge Supervisor','VantixGC Edge Fleet Repair')) {
    try { Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 2
  $NormalizedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($NormalizedRoot,[StringComparison]::OrdinalIgnoreCase)) -or
      ($_.CommandLine -and $_.CommandLine.IndexOf($NormalizedRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0)
    } |
    ForEach-Object {
      if ($_.ProcessId -and $_.ProcessId -ne $PID) {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  Start-Sleep -Seconds 2
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor DarkGreen
Write-Host ' VANTIXGC EDGE · REPARACION DE CONEXION WINDOWS' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor DarkGreen
Write-Host ''

if (-not (Test-Path $InstallDir)) {
  Write-Host 'No existe una instalación Edge previa en este PC.' -ForegroundColor Yellow
  Write-Host ('Para una instalación nueva usa: ' + $CoreBaseUrl + '/instalar')
  exit 2
}
if (-not (Test-Path (Join-Path $InstallDir '.env'))) {
  throw 'La instalación Edge existe pero no tiene .env. Se aborta para no perder la vinculación.'
}
if (-not (Test-Path (Join-Path $InstallDir 'data\vantixgc-edge.sqlite'))) {
  throw 'La base local Edge no está presente. Se aborta antes de modificar el equipo.'
}

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Temp = Join-Path $env:TEMP ('vantixgc-edge-repair-' + $Stamp)
$Zip = Join-Path $Temp 'edge.zip'
$Extract = Join-Path $Temp 'edge'
$Backup = Join-Path $InstallDir ('repair-backups\manual-' + $Stamp)
New-Item -ItemType Directory -Force -Path $Temp,$Extract,$Backup | Out-Null

try {
  Write-Host '[1/7] Consultando paquete de reparación...' -ForegroundColor Cyan
  $ManifestUri = $CoreBaseUrl.TrimEnd('/') + $ManifestPath
  $Manifest = Invoke-RestMethod -UseBasicParsing -Uri $ManifestUri -TimeoutSec 30
  $ReleaseProperty = $Manifest.releases.PSObject.Properties[$TargetVersion]
  if (-not $ReleaseProperty) { throw "El Core no publicó la versión de reparación $TargetVersion." }
  $Release = $ReleaseProperty.Value
  $ReleaseFile = [string]$Release.file
  $ReleaseSha = ([string]$Release.sha256).ToLowerInvariant()
  if (-not $ReleaseFile -or $ReleaseSha -notmatch '^[a-f0-9]{64}$') { throw 'El release de reparación no contiene archivo y SHA-256 válidos.' }

  Write-Host '[2/7] Descargando y verificando V95.4...' -ForegroundColor Cyan
  Invoke-Download -Uri ($CoreBaseUrl.TrimEnd('/') + '/edge-releases/' + $ReleaseFile) -OutFile $Zip
  $ActualSha = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualSha -ne $ReleaseSha) { throw 'SHA-256 incorrecto. No se modificó la instalación.' }
  Expand-Archive -LiteralPath $Zip -DestinationPath $Extract -Force
  $VersionFile = Join-Path $Extract 'version.json'
  $Installer = Join-Path $Extract 'supervisor\install-windows.ps1'
  $SupervisorSource = Join-Path $Extract 'supervisor\supervisor.js'
  $WatchdogSource = Join-Path $Extract 'supervisor\watchdog-windows.ps1'
  foreach ($Required in @($VersionFile,$Installer,$SupervisorSource,$WatchdogSource)) {
    if (-not (Test-Path $Required)) { throw "Paquete incompleto: falta $Required" }
  }
  $PackageVersion = [string]((Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json).version)
  if ($PackageVersion -ne $TargetVersion) { throw "El paquete descargado reporta $PackageVersion y se esperaba $TargetVersion." }
  $SupervisorContract = Get-Content -LiteralPath $SupervisorSource -Raw
  if (-not $SupervisorContract.Contains('restart-liveness-v3-startup-grace')) { throw 'El paquete no contiene el Supervisor corregido.' }

  Write-Host '[3/7] Deteniendo Edge para respaldo consistente...' -ForegroundColor Cyan
  Stop-ExistingEdge $InstallDir

  Write-Host '[4/7] Respaldando configuración y base local...' -ForegroundColor Cyan
  Copy-Item (Join-Path $InstallDir '.env') (Join-Path $Backup '.env') -Force
  if (Test-Path (Join-Path $InstallDir 'version.json')) { Copy-Item (Join-Path $InstallDir 'version.json') (Join-Path $Backup 'version-before.json') -Force }
  Copy-Item (Join-Path $InstallDir 'data') (Join-Path $Backup 'data') -Recurse -Force

  Write-Host '[5/7] Limpiando activación administrada anterior...' -ForegroundColor Cyan
  $ManagedCurrent = Join-Path $InstallDir 'current'
  $PendingActivation = Join-Path $InstallDir 'data\update-pending.json'
  if (Test-Path $ManagedCurrent) { Remove-Item -LiteralPath $ManagedCurrent -Recurse -Force }
  Remove-Item -LiteralPath $PendingActivation -Force -ErrorAction SilentlyContinue

  Write-Host '[6/7] Instalando Supervisor + Watchdog corregidos...' -ForegroundColor Cyan
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Installer -InstallDir $InstallDir
  if ($LASTEXITCODE -ne 0) { throw "El instalador Edge terminó con código $LASTEXITCODE." }

  Write-Host '[7/7] Verificando recuperación...' -ForegroundColor Cyan
  $Healthy = $false
  $Status = $null
  for ($Attempt = 1; $Attempt -le 20; $Attempt++) {
    Start-Sleep -Seconds 3
    try {
      $Status = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8788/api/status' -TimeoutSec 3
      $SupervisorTask = Get-ScheduledTask -TaskName 'VantixGC Edge Supervisor' -ErrorAction SilentlyContinue
      $WatchdogTask = Get-ScheduledTask -TaskName 'VantixGC Edge Watchdog' -ErrorAction SilentlyContinue
      if ($Status.ok -and [string]$Status.softwareVersion -eq $TargetVersion -and $SupervisorTask -and $WatchdogTask) {
        $Healthy = $true
        break
      }
    } catch {}
  }
  if (-not $Healthy) { throw 'Edge no confirmó salud V95.4 dentro de 60 segundos.' }

  Write-Host ''
  Write-Host 'REPARACION COMPLETADA' -ForegroundColor Green
  Write-Host ('Versión: ' + [string]$Status.softwareVersion)
  Write-Host ('Conectado: ' + [string]$Status.connected)
  Write-Host ('Relay: ' + [string]$Status.relayConnected)
  Write-Host ('Backup: ' + $Backup)
  Write-Host 'Supervisor y Watchdog quedaron instalados para iniciar con Windows.' -ForegroundColor Green
  exit 0
} catch {
  Write-Host ''
  Write-Host ('REPARACION NO COMPLETADA: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host ('Backup disponible en: ' + $Backup) -ForegroundColor Yellow
  try { Start-ScheduledTask -TaskName 'VantixGC Edge Supervisor' -ErrorAction SilentlyContinue } catch {}
  exit 1
} finally {
  try { Remove-Item -LiteralPath $Temp -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}
`;
}

function windowsRepairCmd(coreBaseUrl) {
  const base = normalizeBaseUrl(coreBaseUrl);
  const psUrl = `${base}/reparar-edge/windows.ps1`;
  return `@echo off\r\nsetlocal\r\ntitle VantixGC Edge - Reparacion Windows\r\nset "VANTIX_PS=%TEMP%\\VantixGC_Edge_Repair_%RANDOM%.ps1"\r\necho Descargando reparacion VantixGC Edge...\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '${psUrl}' -OutFile '%VANTIX_PS%' -TimeoutSec 30 } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }"\r\nif errorlevel 1 goto :fail\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%VANTIX_PS%"\r\nset "VANTIX_EXIT=%ERRORLEVEL%"\r\ndel /q "%VANTIX_PS%" >nul 2>&1\r\necho.\r\nif not "%VANTIX_EXIT%"=="0" goto :failcode\r\necho Reparacion VantixGC Edge finalizada.\r\npause\r\nexit /b 0\r\n:failcode\r\necho La reparacion termino con codigo %VANTIX_EXIT%.\r\npause\r\nexit /b %VANTIX_EXIT%\r\n:fail\r\necho No fue posible descargar la reparacion.\r\npause\r\nexit /b 1\r\n`;
}

module.exports = {
  EDGE_REPAIR_VERSION,
  EDGE_MANIFEST_PATH,
  windowsRepairPowerShell,
  windowsRepairCmd
};
