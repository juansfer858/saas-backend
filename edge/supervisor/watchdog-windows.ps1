param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Edge",
  [int]$EdgePort = 8788,
  [string]$SupervisorTaskName = 'VantixGC Edge Supervisor',
  [int]$FailureThreshold = 2
)

$ErrorActionPreference = 'SilentlyContinue'
$DataDir = Join-Path $InstallDir 'data'
$LogFile = Join-Path $DataDir 'watchdog.log'
$StateFile = Join-Path $DataDir 'watchdog-state.json'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$Mutex = New-Object System.Threading.Mutex($false, 'Global\VantixGCEdgeWatchdog')
$Acquired = $false
try { $Acquired = $Mutex.WaitOne(0) } catch {}
if (-not $Acquired) { exit 0 }

function Write-WatchdogLog([string]$Message) {
  try { Add-Content -LiteralPath $LogFile -Value ((Get-Date).ToUniversalTime().ToString('o') + ' ' + $Message) -Encoding UTF8 } catch {}
}

function Read-State {
  try {
    if (-not (Test-Path $StateFile)) { return @{ failures = 0 } }
    $Value = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
    return @{ failures = [int]$Value.failures; lastHealthyAt = [string]$Value.lastHealthyAt; lastRecoveryAt = [string]$Value.lastRecoveryAt }
  } catch { return @{ failures = 0 } }
}

function Write-State([int]$Failures, [string]$LastHealthyAt = '', [string]$LastRecoveryAt = '') {
  try {
    @{
      failures = $Failures
      lastHealthyAt = $LastHealthyAt
      lastRecoveryAt = $LastRecoveryAt
      checkedAt = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
  } catch {}
}

function Test-LocalHealth {
  try {
    $Response = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/api/status" -f $EdgePort) -TimeoutSec 4
    return ($Response.StatusCode -ge 200 -and $Response.StatusCode -lt 300)
  } catch { return $false }
}

function Restart-SupervisorTask {
  $Task = Get-ScheduledTask -TaskName $SupervisorTaskName -ErrorAction SilentlyContinue
  if (-not $Task) {
    Write-WatchdogLog "SUPERVISOR_TASK_MISSING"
    return $false
  }
  Write-WatchdogLog ("RECOVERY_START taskState={0}" -f $Task.State)
  try { Stop-ScheduledTask -TaskName $SupervisorTaskName -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Seconds 2
  try { Start-ScheduledTask -TaskName $SupervisorTaskName -ErrorAction Stop } catch {
    Write-WatchdogLog ("RECOVERY_START_FAILED {0}" -f $_.Exception.Message)
    return $false
  }
  return $true
}

try {
  $State = Read-State
  $Now = (Get-Date).ToUniversalTime().ToString('o')

  if (Test-LocalHealth) {
    if ([int]$State.failures -gt 0) { Write-WatchdogLog "HEALTH_RECOVERED without_restart" }
    Write-State 0 $Now ([string]$State.lastRecoveryAt)
    exit 0
  }

  $Failures = [int]$State.failures + 1
  Write-WatchdogLog ("HEALTH_FAIL consecutive={0}" -f $Failures)
  Write-State $Failures ([string]$State.lastHealthyAt) ([string]$State.lastRecoveryAt)

  if ($Failures -lt [Math]::Max(1, $FailureThreshold)) { exit 0 }
  if (-not (Restart-SupervisorTask)) { exit 0 }

  $Recovered = $false
  for ($Attempt = 1; $Attempt -le 10; $Attempt++) {
    Start-Sleep -Seconds 2
    if (Test-LocalHealth) {
      $Recovered = $true
      break
    }
  }

  $RecoveredAt = (Get-Date).ToUniversalTime().ToString('o')
  if ($Recovered) {
    Write-WatchdogLog "RECOVERY_OK"
    Write-State 0 $RecoveredAt $RecoveredAt
  } else {
    Write-WatchdogLog "RECOVERY_PENDING local_health_still_down"
    Write-State $FailureThreshold ([string]$State.lastHealthyAt) ([string]$State.lastRecoveryAt)
  }
} finally {
  try { if ($Acquired) { $Mutex.ReleaseMutex() } } catch {}
  try { $Mutex.Dispose() } catch {}
}
