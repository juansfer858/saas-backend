param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P14-Home-Pilot",
  [string]$TaskName = "VantixGC Restaurant P14 Home Pilot",
  [switch]$ListManagedRuntimeProcessIds,
  [int]$HealthRetryAttempts = 6,
  [int]$HealthRetryDelaySeconds = 2
)

$ErrorActionPreference = 'Stop'
$HealthUrl = 'http://127.0.0.1:8791/__p14/status'
$ExpectedMarker = 'VANTIX_RESTAURANT_LOCAL_FIRST_P14_HOME_PILOT'
$LogDir = Join-Path $InstallDir 'logs'
$LogFile = Join-Path $LogDir 'watchdog.log'
$LockFile = Join-Path $LogDir 'watchdog.lock'
$RuntimeNode = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'runtime\node.exe'))
$RuntimeScript = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'app\lab\restaurant-p14\runtime.js'))
$StartScript = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'ops\start-p14-windows.ps1'))

function Log([string]$Message) {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  "[$(Get-Date -Format o)] $Message" | Add-Content -LiteralPath $LogFile -Encoding UTF8
}

function Test-Health {
  try {
    $Response = Invoke-RestMethod -UseBasicParsing -Method Get -Uri $HealthUrl -TimeoutSec 4
    return ($Response.ok -eq $true -and [string]$Response.marker -eq $ExpectedMarker)
  } catch {
    return $false
  }
}

function Wait-P14Health {
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

function Get-P14RuntimeProcesses {
  $Matches = @()
  try {
    foreach ($Process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
      try {
        $Executable = [string]$Process.ExecutablePath
        $CommandLine = [string]$Process.CommandLine
        if (-not $Executable -or -not $CommandLine) { continue }
        $ExecutableFull = [System.IO.Path]::GetFullPath($Executable)
        if (-not $ExecutableFull.Equals($RuntimeNode, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($CommandLine.IndexOf($RuntimeScript, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        $Matches += $Process
      } catch {}
    }
  } catch {
    Log "No fue posible enumerar el runtime Node P14: $($_.Exception.Message)"
  }
  return @($Matches)
}

function Start-P14Runtime {
  $Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($Task -and [string]$Task.State -ne 'Disabled') {
    try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
    Start-ScheduledTask -TaskName $TaskName
    Log "Runtime P14 solicitado mediante tarea $TaskName."
    return
  }

  if (-not (Test-Path -LiteralPath $StartScript)) { throw "No existe $StartScript" }
  $Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $StartScript + '" -InstallDir "' + $InstallDir + '"'
  Start-Process -FilePath 'powershell.exe' -ArgumentList $Arguments -WindowStyle Hidden | Out-Null
  Log 'Runtime P14 solicitado mediante arranque directo porque no existe tarea programada.'
}

if ($ListManagedRuntimeProcessIds) {
  $Ids = @((Get-P14RuntimeProcesses) | ForEach-Object { [int]$_.ProcessId })
  ConvertTo-Json -InputObject $Ids -Compress
  exit 0
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Lock = $null
try {
  try {
    $Lock = [System.IO.File]::Open($LockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  } catch {
    Log 'Otro watchdog P14 ya está ejecutándose; esta instancia termina sin intervenir.'
    exit 0
  }

  Log 'Watchdog P14 inició comprobación.'
  if (Test-Health) {
    Log 'Runtime P14 saludable.'
    exit 0
  }

  Log 'Health inicial falló; comienza período de gracia antes de reiniciar Node.'
  if (Wait-P14Health) {
    Log 'Runtime P14 respondió durante el período de gracia; no se reinició ningún proceso.'
    exit 0
  }

  Log 'Health siguió fallando tras la gracia; se reiniciará únicamente Node P14. PostgreSQL se preserva.'
  foreach ($Process in (Get-P14RuntimeProcesses)) {
    if ($Process.ProcessId -and $Process.ProcessId -ne $PID) {
      Log "Deteniendo únicamente runtime Node P14 PID=$($Process.ProcessId)."
      Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }

  Start-P14Runtime
  if (Wait-P14Health -Attempts ([Math]::Max(10, $HealthRetryAttempts)) -DelaySeconds $HealthRetryDelaySeconds) {
    Log 'Runtime P14 recuperado; PostgreSQL local no fue reiniciado por el watchdog.'
    exit 0
  }

  Log 'Runtime P14 continúa sin responder después del reinicio; PostgreSQL permanece intacto.'
  exit 2
} finally {
  if ($Lock) { $Lock.Dispose() }
}
