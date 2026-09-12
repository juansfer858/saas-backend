param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Edge",
  [string]$ReleaseRoot = "",
  [string]$TaskName = 'VantixGC Edge Fleet Repair'
)

$ErrorActionPreference = 'Stop'
$DataDir = Join-Path $InstallDir 'data'
$Pending = Join-Path $DataDir 'fleet-repair-v95-4.pending.json'
$Done = Join-Path $DataDir 'fleet-repair-v95-4.done.json'
$Failed = Join-Path $DataDir 'fleet-repair-v95-4.failed.json'
$BackupRoot = Join-Path $DataDir 'backups\fleet-repair-v95-4'

function Write-Result([string]$Path, [hashtable]$Value) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $Value | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Path -Encoding UTF8
}

try {
  if (-not $ReleaseRoot) { $ReleaseRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
  $VersionFile = Join-Path $ReleaseRoot 'version.json'
  $Installer = Join-Path $ReleaseRoot 'supervisor\install-windows.ps1'
  if (-not (Test-Path $VersionFile) -or -not (Test-Path $Installer)) { throw 'Paquete de reparación de flota incompleto.' }
  $Version = [string]((Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json).version)
  if (-not $Version) { throw 'No fue posible identificar la versión Edge de reparación.' }

  if (Test-Path $Done) {
    try {
      $ExistingDone = Get-Content -LiteralPath $Done -Raw | ConvertFrom-Json
      if ([string]$ExistingDone.version -eq $Version -and [bool]$ExistingDone.ok) { exit 0 }
    } catch {}
  }

  New-Item -ItemType Directory -Force -Path $DataDir,$BackupRoot | Out-Null
  $Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $Backup = Join-Path $BackupRoot $Stamp
  New-Item -ItemType Directory -Force -Path $Backup | Out-Null
  if (Test-Path (Join-Path $InstallDir '.env')) { Copy-Item (Join-Path $InstallDir '.env') (Join-Path $Backup '.env') -Force }
  if (Test-Path (Join-Path $InstallDir 'version.json')) { Copy-Item (Join-Path $InstallDir 'version.json') (Join-Path $Backup 'version.json') -Force }
  if (Test-Path (Join-Path $InstallDir 'supervisor\supervisor.js')) { Copy-Item (Join-Path $InstallDir 'supervisor\supervisor.js') (Join-Path $Backup 'supervisor.js') -Force }

  $DisableAutoUpdate = $false
  $EnvFile = Join-Path $InstallDir '.env'
  if (Test-Path $EnvFile) {
    foreach ($Line in Get-Content -LiteralPath $EnvFile) {
      if ($Line.Trim() -match '^EDGE_AUTO_UPDATE_ENABLED\s*=\s*false\s*$') { $DisableAutoUpdate = $true; break }
    }
  }

  if ($DisableAutoUpdate) {
    & $Installer -InstallDir $InstallDir -DisableAutoUpdate
  } else {
    & $Installer -InstallDir $InstallDir
  }

  $Healthy = $false
  for ($Attempt = 1; $Attempt -le 15; $Attempt++) {
    Start-Sleep -Seconds 2
    try {
      $Status = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8788/api/status' -TimeoutSec 3
      $SupervisorTask = Get-ScheduledTask -TaskName 'VantixGC Edge Supervisor' -ErrorAction SilentlyContinue
      $WatchdogTask = Get-ScheduledTask -TaskName 'VantixGC Edge Watchdog' -ErrorAction SilentlyContinue
      $SupervisorSource = Join-Path $InstallDir 'supervisor\supervisor.js'
      $SupervisorContract = if (Test-Path $SupervisorSource) { Get-Content -LiteralPath $SupervisorSource -Raw } else { '' }
      if ($Status.ok -and [string]$Status.softwareVersion -eq $Version -and $SupervisorTask -and $WatchdogTask -and $SupervisorContract.Contains('restart-liveness-v3-startup-grace')) {
        $Healthy = $true
        break
      }
    } catch {}
  }
  if (-not $Healthy) { throw 'La reparación instaló archivos, pero el runtime no confirmó salud V95.4 dentro de la ventana esperada.' }

  Write-Result $Done @{
    ok = $true
    version = $Version
    repairedAt = (Get-Date).ToUniversalTime().ToString('o')
    backupPath = $Backup
    supervisor = 'restart-liveness-v3-startup-grace'
    watchdog = $true
  }
  Remove-Item -LiteralPath $Pending -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Failed -Force -ErrorAction SilentlyContinue
} catch {
  Write-Result $Failed @{
    ok = $false
    version = $Version
    failedAt = (Get-Date).ToUniversalTime().ToString('o')
    error = $_.Exception.Message
  }
  Remove-Item -LiteralPath $Pending -Force -ErrorAction SilentlyContinue
  throw
} finally {
  try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
}
