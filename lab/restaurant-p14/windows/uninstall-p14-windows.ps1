param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P14-Home-Pilot",
  [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'
$TaskName = 'VantixGC Restaurant P14 Home Pilot'
$WatchdogTaskName = 'VantixGC Restaurant P14 Watchdog'
$FirewallRuleName = 'VantixGC Restaurant P14 Home Pilot LAN 8790'
$PgCtl = Join-Path $InstallDir 'postgres\bin\pg_ctl.exe'
$PgData = Join-Path $InstallDir 'data\postgres'
$RuntimeNode = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'runtime\node.exe'))
$RuntimeScript = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'app\lab\restaurant-p14\runtime.js'))

foreach ($Name in @($WatchdogTaskName, $TaskName)) {
  try { Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue } catch {}
  try { Disable-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue | Out-Null } catch {}
  try { Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue } catch {}
}

try {
  foreach ($Process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    try {
      $Executable = [string]$Process.ExecutablePath
      $CommandLine = [string]$Process.CommandLine
      if (-not $Executable -or -not $CommandLine) { continue }
      if (-not [System.IO.Path]::GetFullPath($Executable).Equals($RuntimeNode, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
      if ($CommandLine.IndexOf($RuntimeScript, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
      if ($Process.ProcessId -and $Process.ProcessId -ne $PID) {
        Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
} catch {}

if ((Test-Path -LiteralPath $PgCtl) -and (Test-Path -LiteralPath (Join-Path $PgData 'PG_VERSION'))) {
  try {
    & $PgCtl -D $PgData -m fast -w -t 30 stop | Out-Null
    $global:LASTEXITCODE = 0
  } catch {}
}

try { Remove-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue | Out-Null } catch {}

try {
  $Desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
  $Shortcut = Join-Path $Desktop 'VantixGC Restaurante P14 Piloto.url'
  if (Test-Path -LiteralPath $Shortcut) { Remove-Item -LiteralPath $Shortcut -Force }
} catch {}

if ($PurgeData) {
  if (Test-Path -LiteralPath $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
  }
  Write-Host 'P14 Home Pilot eliminado completamente. Edge productivo no fue modificado.' -ForegroundColor Green
  exit 0
}

foreach ($Name in @('app','runtime','postgres','ops')) {
  $Target = Join-Path $InstallDir $Name
  if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
}

Write-Host "P14 desinstalado conservando base, secretos, logs y backups en $InstallDir." -ForegroundColor Green
Write-Host 'La regla de firewall P14 fue eliminada.'
Write-Host 'Edge productivo C:\ProgramData\VantixGC\Edge no fue modificado.'
