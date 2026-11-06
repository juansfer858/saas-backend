param(
  [string]$OutDir = "artifacts\p14-windows"
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Este empaquetador P14 debe ejecutarse en Windows.' }

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$OutDir = [System.IO.Path]::GetFullPath((Join-Path $Root $OutDir))
$Stage = Join-Path $OutDir 'vantixgc-restaurant-p14-home-pilot'
$Zip = Join-Path $OutDir 'vantixgc-restaurant-p14-home-pilot.zip'

function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { throw "Falta $Source" }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Robocopy falló ($LASTEXITCODE) copiando $Source" }
  $global:LASTEXITCODE = 0
}

function Find-PostgresRoot {
  if ($env:P14_POSTGRES_ROOT -and (Test-Path -LiteralPath (Join-Path $env:P14_POSTGRES_ROOT 'bin\postgres.exe'))) {
    return [System.IO.Path]::GetFullPath($env:P14_POSTGRES_ROOT)
  }
  $Command = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
  if ($Command) {
    $Candidate = Split-Path -Parent (Split-Path -Parent $Command.Source)
    if ((Test-Path -LiteralPath (Join-Path $Candidate 'bin\postgres.exe')) -and (Test-Path -LiteralPath (Join-Path $Candidate 'share'))) {
      return $Candidate
    }
  }
  $Base = Join-Path $env:ProgramFiles 'PostgreSQL'
  if (Test-Path -LiteralPath $Base) {
    foreach ($Directory in (Get-ChildItem -LiteralPath $Base -Directory | Sort-Object Name -Descending)) {
      if ((Test-Path -LiteralPath (Join-Path $Directory.FullName 'bin\postgres.exe')) -and (Test-Path -LiteralPath (Join-Path $Directory.FullName 'share'))) {
        return $Directory.FullName
      }
    }
  }
  throw 'No se encontró una distribución PostgreSQL Windows para incluir en P14.'
}

Remove-Item -LiteralPath $OutDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
foreach ($Directory in @('payload\app','payload\runtime','payload\postgres','payload\ops','lab\restaurant-p14\windows')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Stage $Directory) | Out-Null
}

$App = Join-Path $Stage 'payload\app'
foreach ($Directory in @('src','prisma','scripts','lab\restaurant-p14','edge')) {
  Copy-Tree (Join-Path $Root $Directory) (Join-Path $App $Directory)
}
foreach ($File in @('package.json','package-lock.json','prisma.config.ts')) {
  Copy-Item -LiteralPath (Join-Path $Root $File) -Destination (Join-Path $App $File) -Force
}
Copy-Tree (Join-Path $Root 'node_modules') (Join-Path $App 'node_modules')

$NodeSource = (Get-Command node.exe -ErrorAction Stop).Source
$BundledNode = Join-Path $Stage 'payload\runtime\node.exe'
Copy-Item -LiteralPath $NodeSource -Destination $BundledNode -Force

Push-Location $App
try {
  & $BundledNode -e "require('./src/app'); require('./lab/restaurant-p14/runtime'); console.log('P14_WINDOWS_MODULE_LOAD_OK')"
  if ($LASTEXITCODE -ne 0) { throw 'La carga del runtime P14 empaquetado falló.' }
} finally {
  Pop-Location
}

$PostgresRoot = Find-PostgresRoot
foreach ($Directory in @('bin','lib','share')) {
  Copy-Tree (Join-Path $PostgresRoot $Directory) (Join-Path $Stage "payload\postgres\$Directory")
}
foreach ($Optional in @('doc','symbols')) {
  $Source = Join-Path $PostgresRoot $Optional
  if (Test-Path -LiteralPath $Source) {
    Copy-Tree $Source (Join-Path $Stage "payload\postgres\$Optional")
  }
}

$WindowsSource = Join-Path $Root 'lab\restaurant-p14\windows'
foreach ($File in @('start-p14-windows.ps1','watchdog-p14-windows.ps1','uninstall-p14-windows.ps1')) {
  Copy-Item -LiteralPath (Join-Path $WindowsSource $File) -Destination (Join-Path $Stage "payload\ops\$File") -Force
}
Copy-Item -LiteralPath (Join-Path $WindowsSource 'install-p14-windows.ps1') -Destination (Join-Path $Stage 'lab\restaurant-p14\windows\install-p14-windows.ps1') -Force

$Wrapper = @'
param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P14-Home-Pilot",
  [string]$AdminPassword = "",
  [bool]$EnableLan = $true,
  [string]$LanAddress = "",
  [string]$LanCidr = ""
)
$ErrorActionPreference = 'Stop'
$DefaultHttpPort = 8791
$DefaultPostgresPort = 55433
$PhysicalHttpPort = 8791
$PhysicalPostgresPort = 55433
$Installer = Join-Path $PSScriptRoot 'lab\restaurant-p14\windows\install-p14-windows.ps1'

function Stop-ExistingP14Installation {
  foreach ($TaskName in @('VantixGC Restaurant P14 Watchdog','VantixGC Restaurant P14 Home Pilot')) {
    try { Disable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null } catch {}
    try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
  }

  try {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ProcessId -ne $PID -and
      (($_.ExecutablePath -and ([string]$_.ExecutablePath).StartsWith($InstallDir,[System.StringComparison]::OrdinalIgnoreCase)) -or
       ($_.CommandLine -and ([string]$_.CommandLine).IndexOf($InstallDir,[System.StringComparison]::OrdinalIgnoreCase) -ge 0))
    } | Where-Object { ([string]$_.Name) -ieq 'node.exe' } | ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  } catch {}

  $PgCtl = Join-Path $InstallDir 'postgres\bin\pg_ctl.exe'
  $PgData = Join-Path $InstallDir 'data\postgres'
  if ((Test-Path -LiteralPath $PgCtl) -and (Test-Path -LiteralPath (Join-Path $PgData 'postmaster.pid'))) {
    & $PgCtl -D $PgData -m fast -w -t 30 stop | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw 'No fue posible detener el PostgreSQL P14 anterior antes de cambiar los puertos.'
    }
    $global:LASTEXITCODE = 0
  }
}

function Assert-LocalPortFree([int]$Port,[string]$Purpose) {
  $Listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($Listeners.Count -eq 0) { return }
  $Owners = @()
  foreach ($Listener in $Listeners) {
    $Process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $Listener.OwningProcess) -ErrorAction SilentlyContinue
    $Owners += if ($Process) { "PID=$($Process.ProcessId) $($Process.Name) $($Process.ExecutablePath)" } else { "PID=$($Listener.OwningProcess)" }
  }
  throw "No se puede instalar P14: el puerto $Port reservado para $Purpose ya está ocupado. $($Owners -join '; ')"
}

function Replace-PackageLiteral([string]$Path,[string]$Old,[string]$New) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Paquete P14 incompleto: falta $Path" }
  $Text = [System.IO.File]::ReadAllText($Path)
  if ($Text.Contains($Old)) {
    $Text = $Text.Replace($Old,$New)
    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path,$Text,$Utf8NoBom)
  }
}

function Prepare-P14PhysicalPorts {
  Stop-ExistingP14Installation
  Assert-LocalPortFree $PhysicalHttpPort 'el runtime HTTP P14'
  Assert-LocalPortFree $PhysicalPostgresPort 'PostgreSQL P14'

  $Files = @(
    (Join-Path $PSScriptRoot 'lab\restaurant-p14\windows\install-p14-windows.ps1'),
    (Join-Path $PSScriptRoot 'payload\app\lab\restaurant-p14\runtime-config.js'),
    (Join-Path $PSScriptRoot 'payload\app\lab\restaurant-p14\.env.example'),
    (Join-Path $PSScriptRoot 'payload\app\lab\restaurant-p14\README.md'),
    (Join-Path $PSScriptRoot 'payload\app\lab\restaurant-p14\windows\install-p14-windows.ps1'),
    (Join-Path $PSScriptRoot 'payload\ops\start-p14-windows.ps1'),
    (Join-Path $PSScriptRoot 'payload\ops\watchdog-p14-windows.ps1'),
    (Join-Path $PSScriptRoot 'payload\ops\uninstall-p14-windows.ps1'),
    (Join-Path $PSScriptRoot 'package-manifest.json'),
    (Join-Path $PSScriptRoot 'LEEME_PRIMERO.txt')
  )
  foreach ($File in $Files) {
    Replace-PackageLiteral $File ([string]$DefaultHttpPort) ([string]$PhysicalHttpPort)
    Replace-PackageLiteral $File ([string]$DefaultPostgresPort) ([string]$PhysicalPostgresPort)
  }

  $ExistingPostgresConfig = Join-Path $InstallDir 'data\postgres\postgresql.conf'
  if (Test-Path -LiteralPath $ExistingPostgresConfig) {
    Replace-PackageLiteral $ExistingPostgresConfig ([string]$DefaultPostgresPort) ([string]$PhysicalPostgresPort)
  }

  Write-Host "P14 usará HTTP $PhysicalHttpPort y PostgreSQL $PhysicalPostgresPort para no chocar con el laboratorio P13." -ForegroundColor Cyan
}

Prepare-P14PhysicalPorts
& $Installer -InstallDir $InstallDir -AdminPassword $AdminPassword -EnableLan:$EnableLan -LanAddress $LanAddress -LanCidr $LanCidr
exit $LASTEXITCODE
'@
$Wrapper | Set-Content -LiteralPath (Join-Path $Stage 'INSTALAR_P14.ps1') -Encoding UTF8

$InstallCmd = @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_P14.ps1"
pause
'@
$InstallCmd | Set-Content -LiteralPath (Join-Path $Stage 'INSTALAR_P14_COMO_ADMIN.bat') -Encoding ASCII

$LoopbackCmd = @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_P14.ps1" -EnableLan:$false
pause
'@
$LoopbackCmd | Set-Content -LiteralPath (Join-Path $Stage 'INSTALAR_P14_SOLO_ESTE_PC.bat') -Encoding ASCII

$UninstallWrapper = @'
param([switch]$PurgeData)
$ErrorActionPreference = 'Stop'
$Script = 'C:\ProgramData\VantixGC\Restaurant-P14-Home-Pilot\ops\uninstall-p14-windows.ps1'
if (-not (Test-Path -LiteralPath $Script)) { throw 'No se encontró la instalación P14 Home Pilot.' }
& $Script -PurgeData:$PurgeData
'@
$UninstallWrapper | Set-Content -LiteralPath (Join-Path $Stage 'DESINSTALAR_P14.ps1') -Encoding UTF8

$NodeVersion = (& $NodeSource --version).Trim()
$PostgresVersion = (& (Join-Path $PostgresRoot 'bin\postgres.exe') --version).Trim()
$Manifest = [ordered]@{
  product = 'VantixGC Restaurant P14 Home Pilot'
  packageVersion = 'p14-win-home-pilot.2-port-isolated'
  builtAt = (Get-Date).ToUniversalTime().ToString('o')
  node = $NodeVersion
  postgres = $PostgresVersion
  installationId = 'HOME-PILOT-01'
  tenant = 'demo-restaurante'
  releaseChannel = 'PILOT'
  operationalMode = 'LOCAL_FIRST'
  httpPort = 8791
  postgresHost = '127.0.0.1'
  postgresPort = 55433
  database = 'vantix_p14_home_pilot'
  productionEdgePort = 8788
  productionEdgeTouched = $false
  publicQr = 'CORE_CLOUD_ONLY'
  syncEnabled = $false
  operationalMutations = 'LOCKED_P14_1B'
  purpose = 'HOME_PHYSICAL_PILOT_ONLY'
}
$Manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Stage 'package-manifest.json') -Encoding UTF8

$Readme = @'
VANTIXGC RESTAURANTE P14 - PILOTO LOCAL-FIRST EN CASA

NO INSTALAR EN EL RESTAURANTE REAL.

1. Extraiga TODO el ZIP.
2. Clic derecho sobre INSTALAR_P14_COMO_ADMIN.bat y elija Ejecutar como administrador.
3. El instalador detecta la red privada activa y limita el puerto 8791 a esa subred.
4. Instalación: C:\ProgramData\VantixGC\Restaurant-P14-Home-Pilot
5. Usuario local: admin@demo-restaurante.vantixgc.com
6. La contraseña piloto se genera durante la primera instalación y se muestra una sola vez.
7. PostgreSQL permanece solamente en 127.0.0.1:55433.
8. Edge productivo 8788 y C:\ProgramData\VantixGC\Edge no se modifican.
9. QR y Super Core permanecen en Internet.
10. En P14-1B las operaciones siguen bloqueadas; esta fase valida Windows y LAN.
'@
$Readme | Set-Content -LiteralPath (Join-Path $Stage 'LEEME_PRIMERO.txt') -Encoding UTF8

foreach ($Script in @(
  (Join-Path $Stage 'INSTALAR_P14.ps1'),
  (Join-Path $Stage 'DESINSTALAR_P14.ps1'),
  (Join-Path $Stage 'lab\restaurant-p14\windows\install-p14-windows.ps1'),
  (Join-Path $Stage 'payload\ops\start-p14-windows.ps1'),
  (Join-Path $Stage 'payload\ops\watchdog-p14-windows.ps1'),
  (Join-Path $Stage 'payload\ops\uninstall-p14-windows.ps1')
)) {
  $Tokens = $null
  $Errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$Tokens, [ref]$Errors) | Out-Null
  if ($Errors.Count) { throw "PowerShell inválido en $Script : $($Errors[0].Message)" }
}

if (Test-Path -LiteralPath $Zip) { Remove-Item -LiteralPath $Zip -Force }
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Zip -CompressionLevel Optimal
$Hash = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
$Size = (Get-Item -LiteralPath $Zip).Length

Write-Host (ConvertTo-Json ([ordered]@{
  ok = $true
  phase = 'P14-1B-WINDOWS-PACKAGE'
  zip = $Zip
  sha256 = $Hash
  bytes = $Size
  node = $NodeVersion
  postgres = $PostgresVersion
  edgeProductionUntouched = $true
}) -Compress)
