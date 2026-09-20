param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P14-Home-Pilot",
  [int]$StabilitySeconds = 150
)

$ErrorActionPreference = 'Stop'
$TaskName = 'VantixGC Restaurant P14 Home Pilot'
$LegacyWatchdogTaskName = 'VantixGC Restaurant P14 Watchdog'
$HealthUrl = 'http://127.0.0.1:8791/__p14/status'
$ExpectedMarker = 'VANTIX_RESTAURANT_LOCAL_FIRST_P14_HOME_PILOT'
$SupervisorSource = Join-Path $PSScriptRoot 'supervisor-p14-windows.ps1'
$SupervisorTarget = Join-Path $InstallDir 'ops\supervisor-p14-windows.ps1'
$RuntimeNode = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'runtime\node.exe'))
$RuntimeScript = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'app\lab\restaurant-p14\runtime.js'))
$StartScript = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'ops\start-p14-windows.ps1'))
$LogsDir = Join-Path $InstallDir 'logs'
$BackupsDir = Join-Path $InstallDir 'backups'
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupDir = Join-Path $BackupsDir "p14-supervisor-$Timestamp"
$ReportPath = Join-Path $LogsDir 'P14_STABILITY_RESULT.txt'

function Test-Administrator {
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
  return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-P14Health {
  try {
    $Response = Invoke-RestMethod -UseBasicParsing -Method Get -Uri $HealthUrl -TimeoutSec 3
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
    $Row = Get-NetTCPConnection -State Listen -LocalPort 8791 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Row -and $Row.OwningProcess) { return [int]$Row.OwningProcess }
  } catch {}
  return 0
}

function Get-P14PostgresPid {
  $PidFile = Join-Path $InstallDir 'data\postgres\postmaster.pid'
  if (-not (Test-Path -LiteralPath $PidFile)) { return 0 }
  $Value = Get-Content -LiteralPath $PidFile -TotalCount 1 -ErrorAction SilentlyContinue
  $Parsed = 0
  if ([int]::TryParse(([string]$Value).Trim(), [ref]$Parsed)) { return $Parsed }
  return 0
}

function Get-P14RuntimeProcesses {
  $Rows = @()
  try {
    foreach ($Process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
      try {
        $Executable = [string]$Process.ExecutablePath
        $CommandLine = [string]$Process.CommandLine
        if (-not $Executable -or -not $CommandLine) { continue }
        if (-not [System.IO.Path]::GetFullPath($Executable).Equals($RuntimeNode, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($CommandLine.IndexOf($RuntimeScript, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        $Rows += $Process
      } catch {}
    }
  } catch {}
  return @($Rows)
}

function Get-P14StartWrappers {
  $Rows = @()
  try {
    foreach ($Process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
      try {
        if ($Process.ProcessId -eq $PID) { continue }
        $Name = [string]$Process.Name
        $CommandLine = [string]$Process.CommandLine
        if ($Name -notmatch '^(powershell|pwsh)(\.exe)?$' -or -not $CommandLine) { continue }
        if ($CommandLine.IndexOf($StartScript, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        if ($CommandLine.IndexOf($InstallDir, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        $Rows += $Process
      } catch {}
    }
  } catch {}
  return @($Rows)
}

function Stop-P14NodeAndWrappers {
  foreach ($Process in (Get-P14RuntimeProcesses)) {
    if ($Process.ProcessId -and $Process.ProcessId -ne $PID) {
      Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  foreach ($Process in (Get-P14StartWrappers)) {
    if ($Process.ProcessId -and $Process.ProcessId -ne $PID) {
      Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Save-TaskBackup([string]$Name, [string]$Path) {
  try {
    $Xml = Export-ScheduledTask -TaskName $Name -ErrorAction Stop
    $Xml | Set-Content -LiteralPath $Path -Encoding Unicode
  } catch {}
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
    '-StabilitySeconds', $StabilitySeconds
  ) -join ' '
  Start-Process powershell.exe -Verb RunAs -ArgumentList $Arguments
  exit 0
}

foreach ($Required in @(
  (Join-Path $InstallDir '.env'),
  $RuntimeNode,
  $RuntimeScript,
  $StartScript,
  $SupervisorSource
)) {
  if (-not (Test-Path -LiteralPath $Required)) {
    throw "P14 incompleto: falta $Required"
  }
}

New-Item -ItemType Directory -Force -Path $LogsDir,$BackupsDir,$BackupDir,(Split-Path -Parent $SupervisorTarget) | Out-Null
"VANTIXGC P14 STABILITY REPAIR $Timestamp" | Set-Content -LiteralPath $ReportPath -Encoding UTF8
Add-Report "InstallDir=$InstallDir"
Add-Report "HealthBefore=$(Test-P14Health)"
Add-Report "ListenerPidBefore=$(Get-P14ListenerPid)"
Add-Report "PostgresPidBefore=$(Get-P14PostgresPid)"

Save-TaskBackup $TaskName (Join-Path $BackupDir 'task-runtime.xml')
Save-TaskBackup $LegacyWatchdogTaskName (Join-Path $BackupDir 'task-watchdog.xml')
foreach ($LogName in @('runtime.log','watchdog.log','supervisor.log','postgres.log')) {
  $Source = Join-Path $LogsDir $LogName
  if (Test-Path -LiteralPath $Source) {
    Copy-Item -LiteralPath $Source -Destination (Join-Path $BackupDir $LogName) -Force
  }
}

Write-Host 'Retirando el esquema de dos tareas que presentó la caída de campo...' -ForegroundColor Cyan
foreach ($Name in @($LegacyWatchdogTaskName, $TaskName)) {
  try { Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue } catch {}
  try { Disable-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue | Out-Null } catch {}
  try { Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue } catch {}
}
Stop-P14NodeAndWrappers
Start-Sleep -Seconds 1

Copy-Item -LiteralPath $SupervisorSource -Destination $SupervisorTarget -Force
$Tokens = $null
$Errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($SupervisorTarget, [ref]$Tokens, [ref]$Errors) | Out-Null
if ($Errors.Count) { throw "Supervisor P14 inválido: $($Errors[0].Message)" }

$ActionArguments = @(
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy', 'Bypass',
  '-File', ('"{0}"' -f $SupervisorTarget),
  '-InstallDir', ('"{0}"' -f $InstallDir)
) -join ' '
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $ActionArguments -WorkingDirectory $InstallDir
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -User 'SYSTEM' `
  -RunLevel Highest `
  -Force | Out-Null
Enable-ScheduledTask -TaskName $TaskName | Out-Null
Start-ScheduledTask -TaskName $TaskName

if (-not (Wait-P14Health 90)) {
  Add-Report 'RESULT=FAILED_STARTUP'
  Add-Report 'P14 no respondió después de instalar el supervisor único.'
  throw "P14 no respondió. Revisa $ReportPath y $LogsDir\supervisor.log"
}

$InitialNodePid = Get-P14ListenerPid
$InitialPostgresPid = Get-P14PostgresPid
if ($InitialNodePid -le 0) { throw 'No se identificó el listener Node P14 en 8791.' }
if ($InitialPostgresPid -le 0) { throw 'No se identificó PostgreSQL P14.' }

Add-Report "ListenerPidAfterRepair=$InitialNodePid"
Add-Report "PostgresPidAfterRepair=$InitialPostgresPid"
Add-Report "StabilitySeconds=$StabilitySeconds"

Write-Host ''
Write-Host 'P14 volvió a responder. Se abre Mesas mientras continúa la prueba de estabilidad.' -ForegroundColor Green
Start-Process 'http://127.0.0.1:8791/app/restaurante-v2/mesas'

$HealthFailures = 0
$NodeRestarts = 0
$PostgresRestarts = 0
$LastNodePid = $InitialNodePid
$Checks = [Math]::Max(1, [int][Math]::Ceiling($StabilitySeconds / 5))

for ($Index = 1; $Index -le $Checks; $Index++) {
  Start-Sleep -Seconds 5
  $Healthy = Test-P14Health
  $NodePid = Get-P14ListenerPid
  $PostgresPid = Get-P14PostgresPid

  if (-not $Healthy) { $HealthFailures += 1 }
  if ($NodePid -gt 0 -and $LastNodePid -gt 0 -and $NodePid -ne $LastNodePid) {
    $NodeRestarts += 1
    $LastNodePid = $NodePid
  }
  if ($PostgresPid -gt 0 -and $PostgresPid -ne $InitialPostgresPid) {
    $PostgresRestarts += 1
  }

  Write-Progress `
    -Activity 'Validando estabilidad P14 por encima del umbral observado' `
    -Status "Chequeo $Index de $Checks · salud=$Healthy · Node=$NodePid · PostgreSQL=$PostgresPid" `
    -PercentComplete ([Math]::Min(100, [int](($Index / $Checks) * 100)))
}
Write-Progress -Activity 'Validando estabilidad P14 por encima del umbral observado' -Completed

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$TaskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
$FinalHealthy = Test-P14Health
$FinalNodePid = Get-P14ListenerPid
$FinalPostgresPid = Get-P14PostgresPid

Add-Report "FinalHealthy=$FinalHealthy"
Add-Report "FinalNodePid=$FinalNodePid"
Add-Report "FinalPostgresPid=$FinalPostgresPid"
Add-Report "HealthFailures=$HealthFailures"
Add-Report "NodeRestarts=$NodeRestarts"
Add-Report "PostgresRestarts=$PostgresRestarts"
Add-Report "TaskState=$($Task.State)"
Add-Report "TaskLastResult=$($TaskInfo.LastTaskResult)"
Add-Report "LegacyWatchdogExists=$([bool](Get-ScheduledTask -TaskName $LegacyWatchdogTaskName -ErrorAction SilentlyContinue))"

if (-not $FinalHealthy -or $HealthFailures -gt 0 -or $NodeRestarts -gt 0 -or $PostgresRestarts -gt 0) {
  Add-Report 'RESULT=UNSTABLE'
  Write-Host ''
  Write-Host 'El supervisor recuperó P14, pero la prueba detectó otra caída o reinicio.' -ForegroundColor Yellow
  Write-Host "Reporte: $ReportPath"
  Write-Host 'El supervisor queda activo para mantener el servicio mientras se revisa el registro.'
  exit 2
}

Add-Report 'RESULT=STABLE'
Write-Host ''
Write-Host 'P14 ESTABLE: superó el intervalo de caída observado sin reiniciar Node ni PostgreSQL.' -ForegroundColor Green
Write-Host "Reporte: $ReportPath"
Write-Host 'Ahora prueba LIBRE → OCUPADA → LIBRE desde Mesas.'
Write-Host 'P13, Edge 8788, Super Core y el restaurante real no fueron modificados.' -ForegroundColor Cyan
