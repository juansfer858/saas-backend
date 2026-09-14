param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P13",
  [string]$TaskName = "VantixGC Restaurant P13 Lab"
)

$ErrorActionPreference = 'Stop'
$HealthUrl = 'http://127.0.0.1:8790/__p13/status'
$LogDir = Join-Path $InstallDir 'logs'
$LogFile = Join-Path $LogDir 'watchdog.log'

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

if (Test-Health) { exit 0 }

Log 'Health local falló; reiniciando tarea P13.'
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 1

try {
  $Processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase)) -or
    ($_.CommandLine -and $_.CommandLine.IndexOf((Join-Path $InstallDir 'lab\restaurant-p13\runtime.js'), [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
  }
  foreach ($Process in $Processes) {
    if ($Process.ProcessId -and $Process.ProcessId -ne $PID) {
      try { Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
} catch {}

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 7
if (Test-Health) {
  Log 'Runtime P13 recuperado.'
  exit 0
}

Log 'Runtime P13 sigue sin responder después del reinicio.'
exit 2
