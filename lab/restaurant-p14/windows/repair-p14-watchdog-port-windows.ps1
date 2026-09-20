param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P14-Home-Pilot",
  [string]$RuntimeTaskName = "VantixGC Restaurant P14 Home Pilot",
  [string]$WatchdogTaskName = "VantixGC Restaurant P14 Watchdog",
  [int]$StabilitySeconds = 150,
  [switch]$NoOpenBrowser
)

$ErrorActionPreference = 'Stop'
$ExpectedTenant = 'demo-restaurante'
$ExpectedInstallation = 'HOME-PILOT-01'
$ExpectedHttpPort = 8791
$ExpectedPostgresPort = 55433
$LegacyHealthUrl = 'http://127.0.0.1:8790/__p14/status'
$CorrectHealthUrl = 'http://127.0.0.1:8791/__p14/status'
$ExpectedMarker = 'VANTIX_RESTAURANT_LOCAL_FIRST_P14_HOME_PILOT'
$EnvFile = Join-Path $InstallDir '.env'
$OpsWatchdog = Join-Path $InstallDir 'ops\watchdog-p14-windows.ps1'
$AppWatchdog = Join-Path $InstallDir 'app\lab\restaurant-p14\windows\watchdog-p14-windows.ps1'
$StartScript = Join-Path $InstallDir 'ops\start-p14-windows.ps1'
$RuntimeNode = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'runtime\node.exe'))
$RuntimeScript = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'app\lab\restaurant-p14\runtime.js'))
$LogDir = Join-Path $InstallDir 'logs'
$WatchdogLog = Join-Path $LogDir 'watchdog.log'
$ReportPath = Join-Path $LogDir 'P14_WATCHDOG_PORT_REPAIR_RESULT.txt'
$BackupRoot = Join-Path $InstallDir ('backups\watchdog-port-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Test-Administrator {
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
  return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Read-DotEnv([string]$Path) {
  $Map = @{}
  foreach ($Line in Get-Content -LiteralPath $Path) {
    $Trim = ([string]$Line).Trim()
    if (-not $Trim -or $Trim.StartsWith('#')) { continue }
    $Index = $Trim.IndexOf('=')
    if ($Index -le 0) { continue }
    $Map[$Trim.Substring(0, $Index).Trim()] = $Trim.Substring($Index + 1).Trim().Trim('"').Trim("'")
  }
  return $Map
}

function Test-P14Health {
  try {
    $Response = Invoke-RestMethod -UseBasicParsing -Method Get -Uri $CorrectHealthUrl -TimeoutSec 3
    return ($Response.ok -eq $true -and [string]$Response.marker -eq $ExpectedMarker)
  } catch {
    return $false
  }
}

function Wait-P14Health([int]$Seconds = 90) {
  for ($Index = 0; $Index -lt ($Seconds * 2); $Index++) {
    if (Test-P14Health) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Get-P14ListenerPid {
  try {
    $Row = Get-NetTCPConnection -State Listen -LocalPort $ExpectedHttpPort -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Row -and $Row.OwningProcess) { return [int]$Row.OwningProcess }
  } catch {}
  return 0
}

function Get-P14PostgresPid {
  $PidFile = Join-Path $InstallDir 'data\postgres\postmaster.pid'
  if (-not (Test-Path -LiteralPath $PidFile)) { return 0 }
  $FirstLine = Get-Content -LiteralPath $PidFile -TotalCount 1 -ErrorAction SilentlyContinue
  $Parsed = 0
  if ([int]::TryParse(([string]$FirstLine).Trim(), [ref]$Parsed)) { return $Parsed }
  return 0
}

function Get-P14RuntimeProcesses {
  $Matches = @()
  try {
    foreach ($Process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
      try {
        $Executable = [string]$Process.ExecutablePath
        $CommandLine = [string]$Process.CommandLine
        if (-not $Executable -or -not $CommandLine) { continue }
        if (-not [System.IO.Path]::GetFullPath($Executable).Equals($RuntimeNode, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($CommandLine.IndexOf($RuntimeScript, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        $Matches += $Process
      } catch {}
    }
  } catch {}
  return @($Matches)
}

function Stop-P14RuntimeNode {
  foreach ($Process in (Get-P14RuntimeProcesses)) {
    if ($Process.ProcessId -and $Process.ProcessId -ne $PID) {
      Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Patch-WatchdogFile([string]$Path, [string]$BackupName) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Falta watchdog P14: $Path" }
  $Content = [System.IO.File]::ReadAllText($Path)
  if ($Content.Contains($LegacyHealthUrl)) {
    Copy-Item -LiteralPath $Path -Destination (Join-Path $BackupRoot $BackupName) -Force
    $Content = $Content.Replace($LegacyHealthUrl, $CorrectHealthUrl)
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
  } elseif (-not $Content.Contains($CorrectHealthUrl)) {
    throw "El watchdog $Path no contiene la URL heredada ni la URL P14 esperada. No se modificó."
  }

  $Verified = [System.IO.File]::ReadAllText($Path)
  if ($Verified.Contains($LegacyHealthUrl) -or -not $Verified.Contains($CorrectHealthUrl)) {
    throw "No se pudo fijar el watchdog en $CorrectHealthUrl para $Path"
  }

  $Tokens = $null
  $Errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$Tokens, [ref]$Errors) | Out-Null
  if ($Errors.Count) { throw "Watchdog inválido después de reparar ${Path}: $($Errors[0].Message)" }
}

function Add-Report([string]$Text) {
  $Text | Add-Content -LiteralPath $ReportPath -Encoding UTF8
}

if (-not (Test-Administrator)) {
  Write-Host 'Solicitando permisos de administrador...' -ForegroundColor Yellow
  $Arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $PSCommandPath),
    '-InstallDir', ('"{0}"' -f $InstallDir),
    '-RuntimeTaskName', ('"{0}"' -f $RuntimeTaskName),
    '-WatchdogTaskName', ('"{0}"' -f $WatchdogTaskName),
    '-StabilitySeconds', $StabilitySeconds
  )
  if ($NoOpenBrowser) { $Arguments += '-NoOpenBrowser' }
  Start-Process powershell.exe -Verb RunAs -ArgumentList ($Arguments -join ' ')
  exit 0
}

foreach ($Required in @($EnvFile, $OpsWatchdog, $StartScript, $RuntimeNode, $RuntimeScript)) {
  if (-not (Test-Path -LiteralPath $Required)) { throw "Instalación P14 incompleta: falta $Required" }
}

$Environment = Read-DotEnv $EnvFile
if ($Environment['P14_TENANT_SUBDOMAIN'] -ne $ExpectedTenant -or $Environment['P14_INSTALLATION_ID'] -ne $ExpectedInstallation) {
  throw 'La reparación solo admite demo-restaurante / HOME-PILOT-01.'
}
if ([int]$Environment['P14_HTTP_PORT'] -ne $ExpectedHttpPort -or [int]$Environment['P14_POSTGRES_PORT'] -ne $ExpectedPostgresPort) {
  throw "Se esperaba P14 8791/55433. Detectado: $($Environment['P14_HTTP_PORT'])/$($Environment['P14_POSTGRES_PORT'])."
}

New-Item -ItemType Directory -Force -Path $LogDir,$BackupRoot | Out-Null
"VANTIXGC P14 WATCHDOG PORT REPAIR $(Get-Date -Format o)" | Set-Content -LiteralPath $ReportPath -Encoding UTF8
Add-Report "InstallDir=$InstallDir"
Add-Report "LegacyHealthUrl=$LegacyHealthUrl"
Add-Report "CorrectHealthUrl=$CorrectHealthUrl"
Add-Report "HealthBefore=$(Test-P14Health)"
Add-Report "NodePidBefore=$(Get-P14ListenerPid)"
Add-Report "PostgresPidBefore=$(Get-P14PostgresPid)"

try {
  $RuntimeTaskXml = Export-ScheduledTask -TaskName $RuntimeTaskName -ErrorAction Stop
  $RuntimeTaskXml | Set-Content -LiteralPath (Join-Path $BackupRoot 'runtime-task.xml') -Encoding Unicode
} catch {}
try {
  $WatchdogTaskXml = Export-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction Stop
  $WatchdogTaskXml | Set-Content -LiteralPath (Join-Path $BackupRoot 'watchdog-task.xml') -Encoding Unicode
} catch {}
if (Test-Path -LiteralPath $WatchdogLog) {
  Copy-Item -LiteralPath $WatchdogLog -Destination (Join-Path $BackupRoot 'watchdog-before.log') -Force
}

Write-Host 'Deteniendo únicamente el watchdog y el Node local P14...' -ForegroundColor Cyan
try { Stop-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction SilentlyContinue } catch {}
try { Disable-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction SilentlyContinue | Out-Null } catch {}
try { Stop-ScheduledTask -TaskName $RuntimeTaskName -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Milliseconds 700
Stop-P14RuntimeNode

Patch-WatchdogFile $OpsWatchdog 'watchdog-ops-before.ps1'
if (Test-Path -LiteralPath $AppWatchdog) {
  Patch-WatchdogFile $AppWatchdog 'watchdog-app-before.ps1'
}

$WatchdogAction = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $OpsWatchdog + '" -InstallDir "' + $InstallDir + '" -TaskName "' + $RuntimeTaskName + '"') `
  -WorkingDirectory $InstallDir
$WatchdogStartup = New-ScheduledTaskTrigger -AtStartup
$WatchdogRecurring = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$WatchdogSettings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew
Register-ScheduledTask `
  -TaskName $WatchdogTaskName `
  -Action $WatchdogAction `
  -Trigger @($WatchdogStartup, $WatchdogRecurring) `
  -Settings $WatchdogSettings `
  -User 'SYSTEM' `
  -RunLevel Highest `
  -Force | Out-Null
Enable-ScheduledTask -TaskName $WatchdogTaskName | Out-Null

$RuntimeTask = Get-ScheduledTask -TaskName $RuntimeTaskName -ErrorAction SilentlyContinue
if (-not $RuntimeTask) { throw "No existe la tarea principal P14: $RuntimeTaskName" }
Enable-ScheduledTask -TaskName $RuntimeTaskName -ErrorAction SilentlyContinue | Out-Null
Start-ScheduledTask -TaskName $RuntimeTaskName
if (-not (Wait-P14Health 90)) {
  Add-Report 'RESULT=FAILED_RUNTIME_START'
  throw "P14 no respondió en 8791 después de reparar el watchdog. Revisa $InstallDir\logs\runtime.log"
}

$InitialNodePid = Get-P14ListenerPid
$InitialPostgresPid = Get-P14PostgresPid
if ($InitialNodePid -le 0) { throw 'No se identificó Node P14 escuchando en 8791.' }
if ($InitialPostgresPid -le 0) { throw 'No se identificó PostgreSQL P14 mediante postmaster.pid.' }

$WatchdogLineStart = if (Test-Path -LiteralPath $WatchdogLog) { @(Get-Content -LiteralPath $WatchdogLog).Count } else { 0 }
Start-ScheduledTask -TaskName $WatchdogTaskName

Write-Host ''
Write-Host 'Watchdog apuntando ahora al puerto P14 8791.' -ForegroundColor Green
Write-Host 'Se abre Mesas y se valida estabilidad durante 150 segundos.'
if (-not $NoOpenBrowser) { Start-Process 'http://127.0.0.1:8791/app/restaurante-v2/mesas' }

$HealthFailures = 0
$NodeChanges = 0
$PostgresChanges = 0
$Checks = [Math]::Max(1, [int][Math]::Ceiling([Math]::Max(10, $StabilitySeconds) / 5))
for ($Index = 1; $Index -le $Checks; $Index++) {
  Start-Sleep -Seconds 5
  $Healthy = Test-P14Health
  $NodePid = Get-P14ListenerPid
  $PostgresPid = Get-P14PostgresPid
  if (-not $Healthy) { $HealthFailures += 1 }
  if ($NodePid -ne $InitialNodePid) { $NodeChanges += 1 }
  if ($PostgresPid -ne $InitialPostgresPid) { $PostgresChanges += 1 }
  Write-Progress `
    -Activity 'Validando P14 después de corregir el watchdog' `
    -Status "Chequeo $Index/$Checks · salud=$Healthy · Node=$NodePid · PostgreSQL=$PostgresPid" `
    -PercentComplete ([Math]::Min(100, [int](($Index / $Checks) * 100)))
}
Write-Progress -Activity 'Validando P14 después de corregir el watchdog' -Completed

$NewWatchdogLines = @()
if (Test-Path -LiteralPath $WatchdogLog) {
  $AllWatchdogLines = @(Get-Content -LiteralPath $WatchdogLog)
  if ($AllWatchdogLines.Count -gt $WatchdogLineStart) {
    $NewWatchdogLines = @($AllWatchdogLines[$WatchdogLineStart..($AllWatchdogLines.Count - 1)])
  }
}
$HealthyWatchdogChecks = @($NewWatchdogLines | Where-Object { $_ -match 'Runtime P14 saludable' }).Count
$DestructiveWatchdogChecks = @($NewWatchdogLines | Where-Object { $_ -match 'Deteniendo únicamente runtime Node P14' }).Count
$FinalHealthy = Test-P14Health
$FinalNodePid = Get-P14ListenerPid
$FinalPostgresPid = Get-P14PostgresPid

Add-Report "InitialNodePid=$InitialNodePid"
Add-Report "FinalNodePid=$FinalNodePid"
Add-Report "InitialPostgresPid=$InitialPostgresPid"
Add-Report "FinalPostgresPid=$FinalPostgresPid"
Add-Report "HealthFailures=$HealthFailures"
Add-Report "NodeChanges=$NodeChanges"
Add-Report "PostgresChanges=$PostgresChanges"
Add-Report "HealthyWatchdogChecks=$HealthyWatchdogChecks"
Add-Report "DestructiveWatchdogChecks=$DestructiveWatchdogChecks"
Add-Report "FinalHealthy=$FinalHealthy"

if (-not $FinalHealthy -or $HealthFailures -gt 0 -or $NodeChanges -gt 0 -or $PostgresChanges -gt 0 -or $HealthyWatchdogChecks -lt 2 -or $DestructiveWatchdogChecks -gt 0) {
  Add-Report 'RESULT=UNSTABLE'
  Write-Host ''
  Write-Host 'La reparación se aplicó, pero la prueba detectó inestabilidad.' -ForegroundColor Yellow
  Write-Host "Reporte: $ReportPath"
  exit 2
}

Add-Report 'RESULT=STABLE'
Write-Host ''
Write-Host 'P14 ESTABLE: el watchdog verificó 8791 y no volvió a terminar Node.' -ForegroundColor Green
Write-Host 'La mesa y los datos locales se conservaron.'
Write-Host "Reporte: $ReportPath"
Write-Host 'P13 8790, PostgreSQL, Edge 8788, Super Core y el restaurante real no fueron modificados.' -ForegroundColor Cyan
exit 0
