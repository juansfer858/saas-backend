param(
  [string]$OutDir = 'artifacts\p15-windows'
)

$ErrorActionPreference = 'Stop'

if (-not $IsWindows) {
  throw 'P15 Windows package debe construirse en Windows.'
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$OutDir = [IO.Path]::GetFullPath((Join-Path $Root $OutDir))
$Stage = Join-Path $OutDir 'vantixgc-restaurant-p15-standalone-lab'
$Zip = Join-Path $OutDir 'vantixgc-restaurant-p15-standalone-lab.zip'
$Payload = Join-Path $Stage 'payload'
$App = Join-Path $Payload 'app'
$Runtime = Join-Path $Payload 'runtime'
$Postgres = Join-Path $Payload 'postgres'
$WinSwDir = Join-Path $Payload 'winsw'
$WindowsOut = Join-Path $Stage 'lab\restaurant-p15\windows'

function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Falta payload requerido: $Source"
  }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "Robocopy falló copiando $Source"
  }
  $global:LASTEXITCODE = 0
}

function Find-PostgresRoot {
  if ($env:P15_POSTGRES_ROOT) {
    $candidate = [IO.Path]::GetFullPath($env:P15_POSTGRES_ROOT)
    if (Test-Path -LiteralPath (Join-Path $candidate 'bin\postgres.exe')) {
      return $candidate
    }
  }

  $pgCtl = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
  if ($pgCtl) {
    $candidate = Split-Path -Parent (Split-Path -Parent $pgCtl.Source)
    if (Test-Path -LiteralPath (Join-Path $candidate 'bin\postgres.exe')) {
      return $candidate
    }
  }

  $base = Join-Path $env:ProgramFiles 'PostgreSQL'
  if (Test-Path -LiteralPath $base) {
    $roots = @(Get-ChildItem -LiteralPath $base -Directory | Sort-Object Name -Descending)
    foreach ($root in $roots) {
      if (Test-Path -LiteralPath (Join-Path $root.FullName 'bin\postgres.exe')) {
        return $root.FullName
      }
    }
  }

  throw 'No se encontró PostgreSQL Windows para empaquetar P15.'
}

function Assert-PowerShell([string]$Path) {
  $tokens = $null
  $errors = $null
  [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -gt 0) {
    throw "PowerShell inválido: $Path :: $($errors[0].Message)"
  }
}

Remove-Item -LiteralPath $OutDir -Recurse -Force -ErrorAction SilentlyContinue
foreach ($directory in @($Stage, $App, $Runtime, $Postgres, $WinSwDir, $WindowsOut)) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

foreach ($directory in @('src', 'prisma', 'scripts', 'lab\restaurant-p15', 'edge\print-spooler')) {
  Copy-Tree (Join-Path $Root $directory) (Join-Path $App $directory)
}

foreach ($file in @('package.json', 'package-lock.json', 'prisma.config.ts')) {
  Copy-Item -LiteralPath (Join-Path $Root $file) -Destination (Join-Path $App $file) -Force
}

Copy-Tree (Join-Path $Root 'node_modules') (Join-Path $App 'node_modules')

$NodeSource = (Get-Command node.exe -ErrorAction Stop).Source
$BundledNode = Join-Path $Runtime 'node.exe'
Copy-Item -LiteralPath $NodeSource -Destination $BundledNode -Force

Push-Location $App
try {
  & $BundledNode -e "require('./lab/restaurant-p15/runtime-config');require('./lab/restaurant-p15/runtime');require('./lab/restaurant-p15/backup-agent');require('./lab/restaurant-p15/restore');require('./lab/restaurant-p15/cloud-backup-receiver');console.log('P15_MODULE_LOAD_OK')"
  if ($LASTEXITCODE -ne 0) {
    throw 'Carga de módulos P15 falló dentro del paquete.'
  }
  $global:LASTEXITCODE = 0
} finally {
  Pop-Location
}

$PgRoot = Find-PostgresRoot
foreach ($directory in @('bin', 'lib', 'share')) {
  Copy-Tree (Join-Path $PgRoot $directory) (Join-Path $Postgres $directory)
}

$WinSw = Join-Path $WinSwDir 'WinSW.exe'
Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe' -OutFile $WinSw
if ((Get-Item -LiteralPath $WinSw).Length -lt 1000000) {
  throw 'Descarga WinSW inválida.'
}

$WindowsSource = Join-Path $Root 'lab\restaurant-p15\windows'
foreach ($file in @(
  'install-p15-windows.ps1',
  'uninstall-p15-windows.ps1',
  'restore-p15-windows.ps1',
  'backup-now-p15-windows.ps1'
)) {
  Copy-Item -LiteralPath (Join-Path $WindowsSource $file) -Destination (Join-Path $WindowsOut $file) -Force
}

$InstallWrapper = @'
param(
  [string]$InstallDir = 'C:\ProgramData\VantixGC\Restaurant-P15-Lab',
  [string]$AdminPassword = '',
  [switch]$SoloEstePc,
  [string]$BackupUploadUrl = '',
  [string]$BackupUploadToken = ''
)
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'lab\restaurant-p15\windows\install-p15-windows.ps1'
& $installer `
  -InstallDir $InstallDir `
  -AdminPassword $AdminPassword `
  -EnableLan:(-not $SoloEstePc) `
  -BackupUploadUrl $BackupUploadUrl `
  -BackupUploadToken $BackupUploadToken
exit $LASTEXITCODE
'@
Set-Content -LiteralPath (Join-Path $Stage 'INSTALAR_P15.ps1') -Value $InstallWrapper -Encoding UTF8

$InstallBat = @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_P15.ps1"
pause
'@
Set-Content -LiteralPath (Join-Path $Stage 'INSTALAR_P15_COMO_ADMIN.bat') -Value $InstallBat -Encoding ASCII

$InstallLocalBat = @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_P15.ps1" -SoloEstePc
pause
'@
Set-Content -LiteralPath (Join-Path $Stage 'INSTALAR_P15_SOLO_ESTE_PC.bat') -Value $InstallLocalBat -Encoding ASCII

$UninstallWrapper = @'
param([switch]$PurgeData)
$script = 'C:\ProgramData\VantixGC\Restaurant-P15-Lab\app\lab\restaurant-p15\windows\uninstall-p15-windows.ps1'
if (-not (Test-Path -LiteralPath $script)) {
  throw 'No se encontró P15 instalado.'
}
& $script -PurgeData:$PurgeData
exit $LASTEXITCODE
'@
Set-Content -LiteralPath (Join-Path $Stage 'DESINSTALAR_P15.ps1') -Value $UninstallWrapper -Encoding UTF8

$RestoreWrapper = @'
param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [string]$RecoveryKey = ''
)
$script = 'C:\ProgramData\VantixGC\Restaurant-P15-Lab\app\lab\restaurant-p15\windows\restore-p15-windows.ps1'
if (-not (Test-Path -LiteralPath $script)) {
  throw 'Instala P15 antes de restaurar.'
}
& $script -Archive $Archive -RecoveryKey $RecoveryKey
exit $LASTEXITCODE
'@
Set-Content -LiteralPath (Join-Path $Stage 'RESTAURAR_P15.ps1') -Value $RestoreWrapper -Encoding UTF8

$BackupWrapper = @'
$script = 'C:\ProgramData\VantixGC\Restaurant-P15-Lab\app\lab\restaurant-p15\windows\backup-now-p15-windows.ps1'
if (-not (Test-Path -LiteralPath $script)) {
  throw 'No se encontró P15 instalado.'
}
& $script
exit $LASTEXITCODE
'@
Set-Content -LiteralPath (Join-Path $Stage 'BACKUP_AHORA_P15.ps1') -Value $BackupWrapper -Encoding UTF8

$BackupBat = @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0BACKUP_AHORA_P15.ps1"
pause
'@
Set-Content -LiteralPath (Join-Path $Stage 'BACKUP_AHORA_P15.bat') -Value $BackupBat -Encoding ASCII

$NodeVersion = (& $NodeSource --version).Trim()
$PostgresVersion = (& (Join-Path $PgRoot 'bin\postgres.exe') --version).Trim()
$Manifest = [ordered]@{
  product = 'VantixGC Restaurant P15 Standalone Lab'
  version = 'p15-standalone-lab.2'
  builtAt = (Get-Date).ToUniversalTime().ToString('o')
  httpPort = 8815
  postgresPort = 55435
  database = 'vantix_restaurant_p15_lab'
  printPort = 18815
  installDir = 'C:\ProgramData\VantixGC\Restaurant-P15-Lab'
  installationId = 'HOME-PILOT-P15'
  tenant = 'demo-restaurante'
  authority = 'LOCAL_PRIMARY'
  windowsServices = @(
    'VantixGC Restaurant P15 PostgreSQL',
    'VantixRestaurantP15Server',
    'VantixRestaurantP15Print',
    'VantixRestaurantP15Backup'
  )
  reserved = [ordered]@{
    edgeHttp = 8788
    p13Http = 8790
    p13Pg = 55432
    p14Http = 8791
    p14Pg = 55433
  }
  productionTouched = $false
  supervisor = 'WINDOWS_SERVICES_WINSW'
  winsw = 'v2.12.0'
  node = $NodeVersion
  postgres = $PostgresVersion
}
$Manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Stage 'package-manifest.json') -Encoding UTF8

$Readme = @'
VANTIXGC RESTAURANTE P15 - STANDALONE LAB
NO INSTALAR TODAVÍA EN RESTAURANTES PRODUCTIVOS.

1. Extraiga completamente el ZIP.
2. Ejecute INSTALAR_P15_COMO_ADMIN.bat como Administrador.
3. P15 instala PostgreSQL + Server + Print + Backup como servicios Windows reales.
4. HTTP: 8815. PostgreSQL: 55435. Print: 18815.
5. P15 NO usa Task Scheduler ni watchdog para mantener vivo el servidor.
6. En primera instalación se muestra una contraseña LAB y Recovery key. Guárdelas.
7. La operación interna usa la base local. Internet no participa en ventas, mesas, caja ni inventario.
8. Los backups cifrados quedan en C:\ProgramData\VantixGC\Restaurant-P15-Lab\backups.
9. BACKUP_AHORA_P15.bat permite crear un backup manual.
10. RESTAURAR_P15.ps1 restaura una instalación desde un .vxp15 válido.
11. Edge, P13, P14 y producción permanecen intactos.
'@
Set-Content -LiteralPath (Join-Path $Stage 'LEEME_PRIMERO.txt') -Value $Readme -Encoding UTF8

$ScriptsToValidate = @(
  (Join-Path $Stage 'INSTALAR_P15.ps1'),
  (Join-Path $Stage 'DESINSTALAR_P15.ps1'),
  (Join-Path $Stage 'RESTAURAR_P15.ps1'),
  (Join-Path $Stage 'BACKUP_AHORA_P15.ps1'),
  (Join-Path $WindowsOut 'install-p15-windows.ps1'),
  (Join-Path $WindowsOut 'uninstall-p15-windows.ps1'),
  (Join-Path $WindowsOut 'restore-p15-windows.ps1'),
  (Join-Path $WindowsOut 'backup-now-p15-windows.ps1')
)
foreach ($script in $ScriptsToValidate) {
  Assert-PowerShell $script
}

if (Test-Path -LiteralPath $Zip) {
  Remove-Item -LiteralPath $Zip -Force
}
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Zip -CompressionLevel Optimal

$Hash = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
$Size = (Get-Item -LiteralPath $Zip).Length
$Result = [ordered]@{
  ok = $true
  phase = 'P15-WINDOWS-PACKAGE'
  zip = $Zip
  sha256 = $Hash
  bytes = $Size
  productionUntouched = $true
}
Write-Host ($Result | ConvertTo-Json -Compress)
