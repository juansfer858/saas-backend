param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P13",
  [string]$TaskName = "VantixGC Restaurant P13 Lab",
  [switch]$ListManagedRuntimeProcessIds,
  [int]$HealthRetryAttempts = 4,
  [int]$HealthRetryDelaySeconds = 3
)

$ErrorActionPreference = 'Stop'
$HealthUrl = 'http://127.0.0.1:8790/__p13/status'
$LogDir = Join-Path $InstallDir 'logs'
$LogFile = Join-Path $LogDir 'watchdog.log'
$RuntimeNode = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'runtime\node.exe'))
$RuntimeScript = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'app\lab\restaurant-p13\runtime.js'))

function Log([string]$Message) {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  "[$(Get-Date -Format o)] $Message" | Add-Content -LiteralPath $LogFile -Encoding UTF8
}

function Test-Health {
  try {
    $Response = Invoke-RestMethod -UseBasicParsing -Method Get -Uri $HealthUrl -TimeoutSec 4
    return ($Response.ok -eq $true -and [string]$Response.marker -eq 'VANTIX_RESTAURANT_FULL_LOCAL_P13_A')
  } catch { return $false }
}

function Wait-P13HealthGrace {
  param(
    [int]$Attempts = $HealthRetryAttempts,
    [int]$DelaySeconds = $HealthRetryDelaySeconds
  )

  $Attempts = [Math]::Max(1, $Attempts)
  $DelaySeconds = [Math]::Max(1, $DelaySeconds)
  for ($Attempt = 1; $Attempt -le $Attempts; $Attempt++) {
    Start-Sleep -Seconds $DelaySeconds
    if (Test-Health) { return $true }
  }
  return $false
}

function Get-P13RuntimeProcesses {
  try {
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $Executable = [string]$_.ExecutablePath
      $CommandLine = [string]$_.CommandLine
      $Executable -and
      [System.IO.Path]::GetFullPath($Executable).Equals($RuntimeNode, [System.StringComparison]::OrdinalIgnoreCase) -and
      $CommandLine -and
      $CommandLine.IndexOf($RuntimeScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    })
  } catch {
    Log "No fue posible enumerar el runtime Node P13: $($_.Exception.Message)"
    return @()
  }
}

# Diagnostic/read-only probe used by Windows regression and field support. It must
# list only the Node runtime owned by P13. PostgreSQL is deliberately never part
# of the managed runtime process set.
if ($ListManagedRuntimeProcessIds) {
  $Ids = @((Get-P13RuntimeProcesses) | ForEach-Object { [int]$_.ProcessId })
  ConvertTo-Json -InputObject $Ids -Compress
  exit 0
}

if (Test-Health) { exit 0 }

# A scheduled watchdog can overlap the normal startup window while the operational
# SQL preparer is still running. A single failed HTTP probe must never kill a healthy
# boot in progress. Give the local runtime a bounded grace period first.
Log 'Health inicial falló; esperando período de gracia antes de cualquier reinicio de Node.'
if (Wait-P13HealthGrace) {
  Log 'Runtime P13 respondió durante el período de gracia; no se reinicia ningún proceso.'
  exit 0
}

Log 'Health local siguió fallando tras la gracia; reiniciando únicamente el runtime Node P13. PostgreSQL local se preserva.'
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 1

foreach ($Process in (Get-P13RuntimeProcesses)) {
  if ($Process.ProcessId -and $Process.ProcessId -ne $PID) {
    try {
      Log "Deteniendo runtime Node P13 PID=$($Process.ProcessId)."
      Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
    } catch {}
  }
}

# Never terminate postgres.exe here. PostgreSQL is the durable local source of
# truth and may have a transaction in progress when the HTTP health probe flakes.
# The start task will reuse 55432 when it is healthy and only start PostgreSQL if
# pg_isready reports that it is actually down.
Start-ScheduledTask -TaskName $TaskName

# The restarted task also needs time to apply the operational schema before Node
# begins listening. Reuse the same bounded grace instead of assuming seven seconds
# is always enough on every Windows PC.
if (Wait-P13HealthGrace -Attempts ([Math]::Max(5, $HealthRetryAttempts)) -DelaySeconds $HealthRetryDelaySeconds) {
  Log 'Runtime P13 recuperado; PostgreSQL local no fue reiniciado por el watchdog.'
  exit 0
}

Log 'Runtime P13 sigue sin responder después del reinicio de Node; PostgreSQL local permanece separado.'
exit 2
