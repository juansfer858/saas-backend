param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Edge",
  [string]$NodePath = "",
  [string]$CoreBaseUrl = "",
  [string]$EdgeAgentId = "",
  [string]$EdgeAgentKey = "",
  [string]$InstallClaimToken = "",
  [string]$LocalEncryptionKey = "",
  [string]$LanKey = "",
  [int]$EdgePort = 8788,
  [switch]$DisableAutoUpdate
)

$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ExistingEnvPath = Join-Path $InstallDir '.env'
$Existing = @{}
$TaskName = 'VantixGC Edge Supervisor'

function Read-DotEnv([string]$Path) {
  $Map = @{}
  if (-not (Test-Path $Path)) { return $Map }
  foreach ($Line in Get-Content -LiteralPath $Path) {
    $Trim = $Line.Trim()
    if (-not $Trim -or $Trim.StartsWith('#')) { continue }
    $Idx = $Trim.IndexOf('=')
    if ($Idx -le 0) { continue }
    $Map[$Trim.Substring(0, $Idx).Trim()] = $Trim.Substring($Idx + 1).Trim().Trim('"').Trim("'")
  }
  return $Map
}

function New-Secret {
  return ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
}

function Stop-ExistingEdge([string]$Root) {
  Write-Host 'Detectando instalación Edge existente...' -ForegroundColor DarkCyan
  try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Milliseconds 800

  $NormalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  try {
    $Processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($NormalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) -or
      ($_.CommandLine -and $_.CommandLine.IndexOf($NormalizedRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
    }
    foreach ($Process in $Processes) {
      if ($Process.ProcessId -and $Process.ProcessId -ne $PID) {
        try { Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  } catch {}

  $RuntimeNode = Join-Path $Root 'runtime\node.exe'
  for ($i = 0; $i -lt 20; $i++) {
    $Locked = $false
    if (Test-Path $RuntimeNode) {
      try {
        $Stream = [System.IO.File]::Open($RuntimeNode, 'Open', 'ReadWrite', 'None')
        $Stream.Close()
      } catch { $Locked = $true }
    }
    if (-not $Locked) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "No fue posible detener completamente la instalación Edge existente en $Root."
}

function Copy-EdgeFiles([string]$From, [string]$To) {
  $Last = $null
  for ($Attempt = 1; $Attempt -le 5; $Attempt++) {
    try {
      Copy-Item -Path (Join-Path $From '*') -Destination $To -Recurse -Force
      return
    } catch {
      $Last = $_
      if ($Attempt -ge 5) { break }
      Start-Sleep -Seconds 1
      Stop-ExistingEdge $To
    }
  }
  throw $Last
}

function Install-RestaurantShortcut([int]$Port) {
  try {
    $Desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
    if (-not $Desktop) { return }
    $Shortcut = Join-Path $Desktop 'VantixGC Restaurantes.url'
    @"
[InternetShortcut]
URL=http://127.0.0.1:$Port/app/centro-de-control
"@ | Set-Content -LiteralPath $Shortcut -Encoding ASCII
  } catch {
    Write-Warning "No se pudo crear el acceso directo VantixGC Restaurantes: $($_.Exception.Message)"
  }
}

if (Test-Path $ExistingEnvPath) { $Existing = Read-DotEnv $ExistingEnvPath }
if (-not $CoreBaseUrl) { $CoreBaseUrl = $Existing['CORE_BASE_URL'] }
if (-not $EdgeAgentId) { $EdgeAgentId = $Existing['EDGE_AGENT_ID'] }
if (-not $EdgeAgentKey) { $EdgeAgentKey = $Existing['EDGE_AGENT_KEY'] }
if (-not $LocalEncryptionKey) { $LocalEncryptionKey = $Existing['EDGE_LOCAL_ENCRYPTION_KEY'] }
if (-not $LanKey) { $LanKey = $Existing['EDGE_LAN_KEY'] }

if (-not $CoreBaseUrl) { throw 'CoreBaseUrl es obligatorio en la primera instalación.' }

if ($InstallClaimToken -and (-not $EdgeAgentId -or -not $EdgeAgentKey)) {
  Write-Host 'Vinculando automáticamente esta sede con VantixGC...' -ForegroundColor Cyan
  $ClaimUri = $CoreBaseUrl.TrimEnd('/') + '/api/public/restaurantes/install-claims/consume'
  $ClaimBody = @{ token = $InstallClaimToken; deviceName = $env:COMPUTERNAME } | ConvertTo-Json -Compress
  try {
    $ClaimResponse = Invoke-RestMethod -UseBasicParsing -Method Post -Uri $ClaimUri -ContentType 'application/json' -Body $ClaimBody -TimeoutSec 30
  } catch {
    throw "No fue posible vincular esta sede con VantixGC. Genera un instalador nuevo desde el onboarding. $($_.Exception.Message)"
  }
  if (-not $ClaimResponse.ok -or -not $ClaimResponse.data.edgeAgentId -or -not $ClaimResponse.data.edgeKey) {
    throw 'VantixGC no devolvió credenciales Edge válidas para esta sede.'
  }
  $EdgeAgentId = [string]$ClaimResponse.data.edgeAgentId
  $EdgeAgentKey = [string]$ClaimResponse.data.edgeKey
  Write-Host ('Sede vinculada: ' + [string]$ClaimResponse.data.pointCode) -ForegroundColor Green
}

if (-not $EdgeAgentId) { throw 'EdgeAgentId es obligatorio en la primera instalación.' }
if (-not $EdgeAgentKey) { throw 'EdgeAgentKey es obligatorio en la primera instalación.' }
if (-not $LocalEncryptionKey) { $LocalEncryptionKey = New-Secret }
if (-not $LanKey) { $LanKey = New-Secret }

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Stop-ExistingEdge $InstallDir
Copy-EdgeFiles $Source $InstallDir

$EmbeddedNode = Join-Path $InstallDir 'runtime\node.exe'
if (-not $NodePath -and (Test-Path $EmbeddedNode)) { $NodePath = $EmbeddedNode }
if (-not $NodePath) { $NodePath = (Get-Command node -ErrorAction Stop).Source }

$EnvFile = Join-Path $InstallDir '.env'
$AutoUpdate = if ($DisableAutoUpdate) { 'false' } else { 'true' }
@"
CORE_BASE_URL=$CoreBaseUrl
EDGE_AGENT_ID=$EdgeAgentId
EDGE_AGENT_KEY=$EdgeAgentKey
EDGE_LOCAL_ENCRYPTION_KEY=$LocalEncryptionKey
EDGE_LAN_KEY=$LanKey
EDGE_HOST=0.0.0.0
EDGE_PORT=$EdgePort
EDGE_AUTO_UPDATE_ENABLED=$AutoUpdate
EDGE_DATA_DIR=$InstallDir\data
EDGE_DB_PATH=$InstallDir\data\vantixgc-edge.sqlite
"@ | Set-Content -LiteralPath $EnvFile -Encoding UTF8

try {
  $System = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
  $Admins = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
  $Acl = New-Object System.Security.AccessControl.FileSecurity
  $Acl.SetAccessRuleProtection($true, $false)
  $Acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($System, 'FullControl', 'Allow')))
  $Acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($Admins, 'FullControl', 'Allow')))
  Set-Acl -LiteralPath $EnvFile -AclObject $Acl
} catch {
  Write-Warning "No se pudo endurecer ACL de .env automáticamente: $($_.Exception.Message)"
}

$Supervisor = Join-Path $InstallDir 'supervisor\supervisor.js'
$Action = New-ScheduledTaskAction -Execute $NodePath -Argument ('"' + $Supervisor + '"') -WorkingDirectory $InstallDir
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Install-RestaurantShortcut $EdgePort

Write-Host "VantixGC Restaurantes instalado en $InstallDir."
Write-Host "Centro de Control local: http://127.0.0.1:$EdgePort/app/centro-de-control"
Write-Host "Se creó el acceso directo 'VantixGC Restaurantes' en el escritorio."
Write-Host "Supervisor configurado para iniciar con Windows."
Write-Host "LAN discovery activo en el puerto UDP 8789; las escrituras LAN requieren clave de emparejamiento."
Write-Host "La clave LAN fue guardada localmente y no se publica en discovery."
