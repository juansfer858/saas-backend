param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P13"
)

$ErrorActionPreference = 'Stop'
$EnvFile = Join-Path $InstallDir '.env'
$PgRoot = Join-Path $InstallDir 'postgres'
$PgBin = Join-Path $PgRoot 'bin'
$PgData = Join-Path $InstallDir 'data\postgres'
$LogDir = Join-Path $InstallDir 'logs'
$Node = Join-Path $InstallDir 'runtime\node.exe'
$AppDir = Join-Path $InstallDir 'app'
$Runtime = Join-Path $AppDir 'lab\restaurant-p13\runtime.js'
$SchemaPrep = Join-Path $AppDir 'lab\restaurant-p13\windows\prepare-p13-operational-schemas.js'
$PgLog = Join-Path $LogDir 'postgres.log'
$RuntimeLog = Join-Path $LogDir 'runtime.log'

function Import-DotEnv([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "No existe $Path" }
  foreach ($Line in Get-Content -LiteralPath $Path) {
    $Trim = [string]$Line
    $Trim = $Trim.Trim()
    if (-not $Trim -or $Trim.StartsWith('#')) { continue }
    $Idx = $Trim.IndexOf('=')
    if ($Idx -le 0) { continue }
    $Name = $Trim.Substring(0, $Idx).Trim()
    $Value = $Trim.Substring($Idx + 1).Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
  }
}

function Test-PgReady {
  $PgIsReady = Join-Path $PgBin 'pg_isready.exe'
  if (-not (Test-Path -LiteralPath $PgIsReady)) { return $false }
  & $PgIsReady -h 127.0.0.1 -p 55432 -U vantix_p13 -d vantix_p13_lab -q 2>$null
  $Ready = ($LASTEXITCODE -eq 0)
  $global:LASTEXITCODE = 0
  return $Ready
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Import-DotEnv $EnvFile
$env:P13_WINDOWS_PILOT = 'true'
$env:P13_INSTALL_DIR = $InstallDir

if (-not (Test-Path -LiteralPath $Node)) { throw "Runtime Node ausente: $Node" }
if (-not (Test-Path -LiteralPath $Runtime)) { throw "Runtime P13 ausente: $Runtime" }
if (-not (Test-Path -LiteralPath $SchemaPrep)) { throw "Preparador SQL P13 ausente: $SchemaPrep" }
if (-not (Test-Path -LiteralPath (Join-Path $PgBin 'pg_ctl.exe'))) { throw 'PostgreSQL portátil ausente.' }
if (-not (Test-Path -LiteralPath (Join-Path $PgData 'PG_VERSION'))) { throw 'PostgreSQL P13 no está inicializado.' }

if (-not (Test-PgReady)) {
  $PgCtl = Join-Path $PgBin 'pg_ctl.exe'
  & $PgCtl -D $PgData -l $PgLog -w -t 30 start
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible iniciar PostgreSQL P13.' }
  $global:LASTEXITCODE = 0
}

if (-not (Test-PgReady)) { throw 'PostgreSQL P13 no respondió después del arranque.' }

"[$(Get-Date -Format o)] P13 operational schema prepare start" | Add-Content -LiteralPath $RuntimeLog -Encoding UTF8
Push-Location $AppDir
try {
  & $Node $SchemaPrep >> $RuntimeLog 2>&1
  $PrepExit = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($PrepExit -ne 0) {
  "[$(Get-Date -Format o)] P13 operational schema prepare failed exit=$PrepExit" | Add-Content -LiteralPath $RuntimeLog -Encoding UTF8
  throw "La preparación SQL operativa P13 falló (exit=$PrepExit)."
}
$global:LASTEXITCODE = 0
"[$(Get-Date -Format o)] P13 operational schema prepare ok" | Add-Content -LiteralPath $RuntimeLog -Encoding UTF8

Push-Location $AppDir
try {
  "[$(Get-Date -Format o)] P13 runtime start" | Add-Content -LiteralPath $RuntimeLog -Encoding UTF8
  & $Node $Runtime >> $RuntimeLog 2>&1
  $ExitCode = $LASTEXITCODE
  "[$(Get-Date -Format o)] P13 runtime exit=$ExitCode" | Add-Content -LiteralPath $RuntimeLog -Encoding UTF8
  exit $ExitCode
} finally {
  Pop-Location
}
