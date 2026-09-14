param(
  [string]$OutDir = "artifacts\p13-windows"
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Este empaquetador P13 debe ejecutarse en Windows.' }

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$OutDir = [System.IO.Path]::GetFullPath((Join-Path $Root $OutDir))
$Stage = Join-Path $OutDir 'vantixgc-restaurant-p13-windows-pilot'
$Zip = Join-Path $OutDir 'vantixgc-restaurant-p13-windows-pilot.zip'

function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { throw "Falta $Source" }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Robocopy falló ($LASTEXITCODE) copiando $Source" }
}

function Find-PostgresRoot {
  if ($env:P13_POSTGRES_ROOT -and (Test-Path -LiteralPath (Join-Path $env:P13_POSTGRES_ROOT 'bin\postgres.exe'))) {
    return [System.IO.Path]::GetFullPath($env:P13_POSTGRES_ROOT)
  }
  $Cmd = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
  if ($Cmd) {
    $Candidate = Split-Path -Parent (Split-Path -Parent $Cmd.Source)
    if (Test-Path -LiteralPath (Join-Path $Candidate 'share')) { return $Candidate }
  }
  $Base = Join-Path $env:ProgramFiles 'PostgreSQL'
  if (Test-Path -LiteralPath $Base) {
    foreach ($Dir in (Get-ChildItem -LiteralPath $Base -Directory | Sort-Object Name -Descending)) {
      if ((Test-Path -LiteralPath (Join-Path $Dir.FullName 'bin\postgres.exe')) -and (Test-Path -LiteralPath (Join-Path $Dir.FullName 'share'))) {
        return $Dir.FullName
      }
    }
  }
  throw 'No se encontró una distribución PostgreSQL Windows para incluir en el paquete.'
}

Remove-Item -LiteralPath $OutDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'payload\app') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'payload\runtime') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'payload\postgres') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'payload\ops') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'lab\restaurant-p13\windows') | Out-Null

$App = Join-Path $Stage 'payload\app'
foreach ($Dir in @('src','prisma','scripts','lab\restaurant-p13')) {
  Copy-Tree (Join-Path $Root $Dir) (Join-Path $App $Dir)
}
$EdgeRoot = Join-Path $App 'edge'
$EdgePrintSpooler = Join-Path $EdgeRoot 'print-spooler'
New-Item -ItemType Directory -Force -Path $EdgePrintSpooler | Out-Null
$EdgeVersionSource = Join-Path $Root 'edge\version.json'
if (-not (Test-Path -LiteralPath $EdgeVersionSource)) { throw "Falta dependencia P13 de versión Edge: $EdgeVersionSource" }
Copy-Item -LiteralPath $EdgeVersionSource -Destination (Join-Path $EdgeRoot 'version.json') -Force
foreach ($File in @('escpos.js','windows-printer.js')) {
  $Source = Join-Path $Root "edge\print-spooler\$File"
  if (-not (Test-Path -LiteralPath $Source)) { throw "Falta dependencia P13 de impresión: $Source" }
  Copy-Item -LiteralPath $Source -Destination (Join-Path $EdgePrintSpooler $File) -Force
}
foreach ($File in @('package.json','package-lock.json','prisma.config.ts')) {
  Copy-Item -LiteralPath (Join-Path $Root $File) -Destination (Join-Path $App $File) -Force
}
Copy-Tree (Join-Path $Root 'node_modules') (Join-Path $App 'node_modules')

$Node = (Get-Command node.exe -ErrorAction Stop).Source
$BundledNode = Join-Path $Stage 'payload\runtime\node.exe'
Copy-Item -LiteralPath $Node -Destination $BundledNode -Force

Push-Location $App
try {
  & $BundledNode -e "require('./src/app'); require('./lab/restaurant-p13/cash/local-cash.routes'); console.log('P13_WINDOWS_MODULE_LOAD_OK')"
  if ($LASTEXITCODE -ne 0) { throw 'La carga de módulos del runtime P13 empaquetado falló.' }
} finally {
  Pop-Location
}

$PgRoot = Find-PostgresRoot
foreach ($Dir in @('bin','lib','share')) {
  Copy-Tree (Join-Path $PgRoot $Dir) (Join-Path $Stage "payload\postgres\$Dir")
}
foreach ($Optional in @('doc','symbols')) {
  $Source = Join-Path $PgRoot $Optional
  if (Test-Path -LiteralPath $Source) { Copy-Tree $Source (Join-Path $Stage "payload\postgres\$Optional") }
}

$WindowsSource = Join-Path $Root 'lab\restaurant-p13\windows'
foreach ($File in @('start-p13-windows.ps1','watchdog-p13-windows.ps1','uninstall-p13-windows.ps1')) {
  Copy-Item -LiteralPath (Join-Path $WindowsSource $File) -Destination (Join-Path $Stage "payload\ops\$File") -Force
}
Copy-Item -LiteralPath (Join-Path $WindowsSource 'install-p13-windows.ps1') -Destination (Join-Path $Stage 'lab\restaurant-p13\windows\install-p13-windows.ps1') -Force

$Wrapper = @'
param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P13",
  [string]$AdminPassword = ""
)
$ErrorActionPreference = 'Stop'
$Installer = Join-Path $PSScriptRoot 'lab\restaurant-p13\windows\install-p13-windows.ps1'
& $Installer -InstallDir $InstallDir -AdminPassword $AdminPassword
exit $LASTEXITCODE
'@
$Wrapper | Set-Content -LiteralPath (Join-Path $Stage 'INSTALAR_P13.ps1') -Encoding UTF8

$Cmd = @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_P13.ps1"
pause
'@
$Cmd | Set-Content -LiteralPath (Join-Path $Stage 'INSTALAR_P13_COMO_ADMIN.bat') -Encoding ASCII

$UninstallWrapper = @'
param([switch]$PurgeData)
$ErrorActionPreference = 'Stop'
$Script = 'C:\ProgramData\VantixGC\Restaurant-P13\ops\uninstall-p13-windows.ps1'
if (-not (Test-Path -LiteralPath $Script)) { throw 'No se encontró la instalación P13.' }
& $Script -PurgeData:$PurgeData
'@
$UninstallWrapper | Set-Content -LiteralPath (Join-Path $Stage 'DESINSTALAR_P13.ps1') -Encoding UTF8

$NodeVersion = (& $Node --version).Trim()
$PgVersion = (& (Join-Path $PgRoot 'bin\postgres.exe') --version).Trim()
$Manifest = [ordered]@{
  product = 'VantixGC Restaurant P13 Windows Pilot'
  packageVersion = 'p13-win-pilot.1'
  builtAt = (Get-Date).ToUniversalTime().ToString('o')
  node = $NodeVersion
  postgres = $PgVersion
  httpHost = '127.0.0.1'
  httpPort = 8790
  postgresHost = '127.0.0.1'
  postgresPort = 55432
  database = 'vantix_p13_lab'
  tenant = 'demo-restaurante'
  productionEdgePort = 8788
  productionEdgeTouched = $false
  publicQr = 'CORE_CLOUD_ONLY'
  purpose = 'PHYSICAL_ISOLATED_PILOT_ONLY'
}
$Manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Stage 'package-manifest.json') -Encoding UTF8

$Readme = @'
VANTIXGC RESTAURANTE P13 - PILOTO WINDOWS AISLADO

1. Extraiga TODO el ZIP en una carpeta.
2. Clic derecho sobre INSTALAR_P13_COMO_ADMIN.bat -> Ejecutar como administrador.
3. El piloto se instala en C:\ProgramData\VantixGC\Restaurant-P13.
4. URL local: http://127.0.0.1:8790/app/centro-de-control-v2
5. Edge productivo C:\ProgramData\VantixGC\Edge y puerto 8788 no se modifican.
6. PostgreSQL P13 escucha solo en 127.0.0.1:55432.
7. El QR publico sigue en Core/nube; P13 no publica endpoints de cliente.
8. Este paquete es para prueba fisica aislada. No fusiona ni reemplaza produccion.
'@
$Readme | Set-Content -LiteralPath (Join-Path $Stage 'LEEME_PRIMERO.txt') -Encoding UTF8

foreach ($Script in @(
  (Join-Path $Stage 'INSTALAR_P13.ps1'),
  (Join-Path $Stage 'DESINSTALAR_P13.ps1'),
  (Join-Path $Stage 'lab\restaurant-p13\windows\install-p13-windows.ps1'),
  (Join-Path $Stage 'payload\ops\start-p13-windows.ps1'),
  (Join-Path $Stage 'payload\ops\watchdog-p13-windows.ps1'),
  (Join-Path $Stage 'payload\ops\uninstall-p13-windows.ps1')
)) {
  $Tokens = $null; $Errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$Tokens, [ref]$Errors) | Out-Null
  if ($Errors.Count) { throw "PowerShell inválido en $Script : $($Errors[0].Message)" }
}
foreach ($RequiredAppFile in @(
  (Join-Path $App 'edge\version.json'),
  (Join-Path $App 'edge\print-spooler\escpos.js'),
  (Join-Path $App 'edge\print-spooler\windows-printer.js')
)) {
  if (-not (Test-Path -LiteralPath $RequiredAppFile)) { throw "Dependencia P13 faltante en paquete: $RequiredAppFile" }
}

if (Test-Path -LiteralPath $Zip) { Remove-Item -LiteralPath $Zip -Force }
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Zip -CompressionLevel Optimal
$Hash = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
$Size = (Get-Item -LiteralPath $Zip).Length

Write-Host (ConvertTo-Json ([ordered]@{
  ok = $true
  phase = 'P13-WINDOWS-PACKAGE'
  zip = $Zip
  sha256 = $Hash
  bytes = $Size
  node = $NodeVersion
  postgres = $PgVersion
  edgeProductionUntouched = $true
}) -Compress)