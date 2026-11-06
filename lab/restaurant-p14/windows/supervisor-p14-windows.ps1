param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P14-Home-Pilot",
  [string]$HealthUrl = "http://127.0.0.1:8791/__p14/status",
  [string]$ExpectedMarker = "VANTIX_RESTAURANT_LOCAL_FIRST_P14_HOME_PILOT",
  [int]$StartupGraceSeconds = 60,
  [int]$HealthIntervalSeconds = 5,
  [int]$UnhealthyThreshold = 6,
  [int]$RestartDelaySeconds = 3
)

$ErrorActionPreference = 'Stop'
$LogDir = Join-Path $InstallDir 'logs'
$LogFile = Join-Path $LogDir 'supervisor.log'
$LockFile = Join-Path $LogDir 'supervisor.lock'
$StartScript = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'ops\start-p14-windows.ps1'))
$RuntimeNode = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'runtime\node.exe'))
$RuntimeScript = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'app\lab\restaurant-p14\runtime.js'))

$StartupGraceSeconds = [Math]::Max(10, $StartupGraceSeconds)
$HealthIntervalSeconds = [Math]::Max(2, $HealthIntervalSeconds)
$UnhealthyThreshold = [Math]::Max(2, $UnhealthyThreshold)
$RestartDelaySeconds = [Math]::Max(1, $RestartDelaySeconds)

function Write-SupervisorLog([string]$Message) {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  "[$(Get-Date -Format o)] $Message" | Add-Content -LiteralPath $LogFile -Encoding UTF8
}

function Test-P14Health {
  try {
    $Response = Invoke-RestMethod -UseBasicParsing -Method Get -Uri $HealthUrl -TimeoutSec 3
    return ($Response.ok -eq $true -and [string]$Response.marker -eq $ExpectedMarker)
  } catch {
    return $false
  }
}

function Wait-P14Health([int]$Seconds = $StartupGraceSeconds) {
  $Checks = [Math]::Max(1, [int][Math]::Ceiling($Seconds / 2))
  for ($Index = 0; $Index -lt $Checks; $Index++) {
    if (Test-P14Health) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
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
  } catch {
    Write-SupervisorLog "No fue posible enumerar Node P14: $($_.Exception.Message)"
  }
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
  } catch {
    Write-SupervisorLog "No fue posible enumerar wrapper P14: $($_.Exception.Message)"
  }
  return @($Rows)
}

function Stop-P14ManagedRuntime([string]$Reason) {
  foreach ($Process in (Get-P14RuntimeProcesses)) {
    if ($Process.ProcessId -and $Process.ProcessId -ne $PID) {
      Write-SupervisorLog "Deteniendo únicamente Node P14 PID=$($Process.ProcessId) reason=$Reason"
      Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  foreach ($Process in (Get-P14StartWrappers)) {
    if ($Process.ProcessId -and $Process.ProcessId -ne $PID) {
      Write-SupervisorLog "Deteniendo wrapper P14 PID=$($Process.ProcessId) reason=$Reason"
      Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Start-P14ManagedChild {
  if (-not (Test-Path -LiteralPath $StartScript)) { throw "No existe $StartScript" }
  $Arguments = @(
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $StartScript),
    '-InstallDir', ('"{0}"' -f $InstallDir)
  ) -join ' '
  $Child = Start-Process -FilePath 'powershell.exe' -ArgumentList $Arguments -PassThru -WindowStyle Hidden
  Write-SupervisorLog "Wrapper P14 iniciado PID=$($Child.Id)"
  return $Child
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Lock = $null
try {
  try {
    $Lock = [System.IO.File]::Open($LockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  } catch {
    Write-SupervisorLog 'Ya existe otro supervisor P14; esta instancia termina sin intervenir.'
    exit 0
  }

  Write-SupervisorLog 'Supervisor P14 iniciado. PostgreSQL queda fuera de su ciclo de reinicio.'

  while ($true) {
    $Child = $null
    try {
      Stop-P14ManagedRuntime 'SUPERVISOR_CYCLE_START'
      Start-Sleep -Milliseconds 600
      $Child = Start-P14ManagedChild

      if (-not (Wait-P14Health $StartupGraceSeconds)) {
        Write-SupervisorLog "P14 no alcanzó salud inicial en ${StartupGraceSeconds}s; se reintentará sin tocar PostgreSQL."
        Stop-P14ManagedRuntime 'STARTUP_HEALTH_TIMEOUT'
        try { if ($Child -and -not $Child.HasExited) { Stop-Process -Id $Child.Id -Force -ErrorAction SilentlyContinue } } catch {}
        Start-Sleep -Seconds $RestartDelaySeconds
        continue
      }

      $Runtime = @(Get-P14RuntimeProcesses | Select-Object -First 1)
      $RuntimePid = if ($Runtime.Count) { [int]$Runtime[0].ProcessId } else { 0 }
      Write-SupervisorLog "P14 saludable runtimePid=$RuntimePid wrapperPid=$($Child.Id)"

      $ConsecutiveFailures = 0
      while ($true) {
        Start-Sleep -Seconds $HealthIntervalSeconds
        try { $Child.Refresh() } catch {}
        if ($Child.HasExited) {
          Write-SupervisorLog "Wrapper P14 terminó exitCode=$($Child.ExitCode); se reiniciará."
          break
        }

        if (Test-P14Health) {
          if ($ConsecutiveFailures -gt 0) {
            Write-SupervisorLog "P14 recuperó salud después de $ConsecutiveFailures fallo(s) transitorio(s)."
          }
          $ConsecutiveFailures = 0
          continue
        }

        $ConsecutiveFailures += 1
        Write-SupervisorLog "Health P14 falló intento=$ConsecutiveFailures/$UnhealthyThreshold"
        if ($ConsecutiveFailures -ge $UnhealthyThreshold) {
          Write-SupervisorLog 'P14 permaneció sin salud; se reiniciará únicamente la capa Node.'
          Stop-P14ManagedRuntime 'HEALTH_THRESHOLD_REACHED'
          try { if (-not $Child.HasExited) { Stop-Process -Id $Child.Id -Force -ErrorAction SilentlyContinue } } catch {}
          break
        }
      }
    } catch {
      Write-SupervisorLog "Ciclo supervisor P14 falló: $($_.Exception.Message)"
      Stop-P14ManagedRuntime 'SUPERVISOR_CYCLE_ERROR'
      try { if ($Child -and -not $Child.HasExited) { Stop-Process -Id $Child.Id -Force -ErrorAction SilentlyContinue } } catch {}
    }

    Start-Sleep -Seconds $RestartDelaySeconds
  }
} finally {
  if ($Lock) { $Lock.Dispose() }
}
