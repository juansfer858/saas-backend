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
$Installer = Join-Path $PSScriptRoot 'lab\restaurant-p14\windows\install-p14-windows.ps1'
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
  packageVersion = 'p14-win-home-pilot.1'
  builtAt = (Get-Date).ToUniversalTime().ToString('o')
  node = $NodeVersion
  postgres = $PostgresVersion
  installationId = 'HOME-PILOT-01'
  tenant = 'demo-restaurante'
  releaseChannel = 'PILOT'
  operationalMode = 'LOCAL_FIRST'
  httpPort = 8790
  postgresHost = '127.0.0.1'
  postgresPort = 55432
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
3. El instalador detecta la red privada activa y limita el puerto 8790 a esa subred.
4. Instalación: C:\ProgramData\VantixGC\Restaurant-P14-Home-Pilot
5. Usuario local: admin@demo-restaurante.vantixgc.com
6. La contraseña piloto se genera durante la primera instalación y se muestra una sola vez.
7. PostgreSQL permanece solamente en 127.0.0.1:55432.
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
