param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P13",
  [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'
$TaskName = 'VantixGC Restaurant P13 Lab'
$WatchdogTaskName = 'VantixGC Restaurant P13 Watchdog'
$PgCtl = Join-Path $InstallDir 'postgres\bin\pg_ctl.exe'
$PgData = Join-Path $InstallDir 'data\postgres'

try { Stop-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction SilentlyContinue } catch {}
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
try { Unregister-ScheduledTask -TaskName $WatchdogTaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}

try {
  $Processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase)) -or
    ($_.CommandLine -and $_.CommandLine.IndexOf($InstallDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
  }
  foreach ($Process in $Processes) {
    if ($Process.ProcessId -and $Process.ProcessId -ne $PID) {
      try { Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
} catch {}

if ((Test-Path -LiteralPath $PgCtl) -and (Test-Path -LiteralPath (Join-Path $PgData 'PG_VERSION'))) {
  try { & $PgCtl -D $PgData -m fast -w -t 20 stop | Out-Null } catch {}
}

try {
  $Desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
  $Shortcut = Join-Path $Desktop 'VantixGC Restaurante P13.url'
  if (Test-Path -LiteralPath $Shortcut) { Remove-Item -LiteralPath $Shortcut -Force }
} catch {}

if ($PurgeData) {
  if (Test-Path -LiteralPath $InstallDir) { Remove-Item -LiteralPath $InstallDir -Recurse -Force }
  Write-Host 'P13 eliminado completamente. Edge productivo no fue modificado.' -ForegroundColor Green
  exit 0
}

foreach ($Name in @('app','runtime','postgres','ops')) {
  $Target = Join-Path $InstallDir $Name
  if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
}
Write-Host "P13 desinstalado conservando datos, secretos, logs y backups en $InstallDir." -ForegroundColor Green
Write-Host 'Edge productivo C:\ProgramData\VantixGC\Edge no fue modificado.'
