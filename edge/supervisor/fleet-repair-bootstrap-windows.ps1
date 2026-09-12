param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Edge",
  [string]$ReleaseRoot = ""
)

$ErrorActionPreference = 'Stop'
$TaskName = 'VantixGC Edge Fleet Repair'
$DataDir = Join-Path $InstallDir 'data'
$Pending = Join-Path $DataDir 'fleet-repair-v95-4.pending.json'
$Done = Join-Path $DataDir 'fleet-repair-v95-4.done.json'

if (-not $ReleaseRoot) { $ReleaseRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
$VersionFile = Join-Path $ReleaseRoot 'version.json'
$RepairScript = Join-Path $ReleaseRoot 'supervisor\fleet-repair-windows.ps1'
if (-not (Test-Path $VersionFile) -or -not (Test-Path $RepairScript)) { throw 'Paquete de reparación de flota incompleto.' }
$Version = [string]((Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json).version)
if (-not $Version) { throw 'No fue posible identificar la versión Edge de reparación.' }

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
if (Test-Path $Done) {
  try {
    $CurrentDone = Get-Content -LiteralPath $Done -Raw | ConvertFrom-Json
    if ([string]$CurrentDone.version -eq $Version -and [bool]$CurrentDone.ok) { exit 0 }
  } catch {}
}

# The legacy Supervisor may restart a fresh child several times before this repair
# finishes. Reuse the same one-shot SYSTEM task instead of creating a repair storm.
if (Test-Path $Pending) {
  try {
    $CurrentPending = Get-Content -LiteralPath $Pending -Raw | ConvertFrom-Json
    $ScheduledAt = [datetime]::Parse([string]$CurrentPending.scheduledAt).ToUniversalTime()
    $AgeMinutes = ((Get-Date).ToUniversalTime() - $ScheduledAt).TotalMinutes
    if ([string]$CurrentPending.version -eq $Version -and $AgeMinutes -ge 0 -and $AgeMinutes -lt 10) {
      $ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      if ($ExistingTask) { exit 0 }
    }
  } catch {}
}

$RepairArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $RepairScript + '" -InstallDir "' + $InstallDir + '" -ReleaseRoot "' + $ReleaseRoot + '" -TaskName "' + $TaskName + '"'
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $RepairArgs -WorkingDirectory $InstallDir
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(10)
$Settings = New-ScheduledTaskSettingsSet -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
@{
  version = $Version
  releaseRoot = $ReleaseRoot
  scheduledAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $Pending -Encoding UTF8
Start-ScheduledTask -TaskName $TaskName
