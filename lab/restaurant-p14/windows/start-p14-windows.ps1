param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P14-Home-Pilot"
)

$ErrorActionPreference = 'Stop'
$EnvFile = Join-Path $InstallDir '.env'
$PgBin = Join-Path $InstallDir 'postgres\bin'
$PgData = Join-Path $InstallDir 'data\postgres'
$LogDir = Join-Path $InstallDir 'logs'
$PgLog = Join-Path $LogDir 'postgres.log'
$RuntimeLog = Join-Path $LogDir 'runtime.log'
$Node = Join-Path $InstallDir 'runtime\node.exe'
$AppDir = Join-Path $InstallDir 'app'
$Runtime = Join-Path $AppDir 'lab\restaurant-p14\runtime.js'

function Import-DotEnv([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "No existe $Path" }
  foreach ($Line in Get-Content -LiteralPath $Path) {
    $Trim = ([string]$Line).Trim()
    if (-not $Trim -or $Trim.StartsWith('#')) { continue }
    $Index = $Trim.IndexOf('=')
    if ($Index -le 0) { continue }
    $Name = $Trim.Substring(0, $Index).Trim()
    $Value = $Trim.Substring($Index + 1).Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
  }
}

function Test-PgReady {
  $PgIsReady = Join-Path $PgBin 'pg_isready.exe'
  if (-not (Test-Path -LiteralPath $PgIsReady)) { return $false }
  & $PgIsReady -h 127.0.0.1 -p 55432 -U vantix_p14 -d vantix_p14_home_pilot -q 2>$null
  $Ready = ($LASTEXITCODE -eq 0)
  $global:LASTEXITCODE = 0
  return $Ready
}

function Get-P14PostgresProcess {
  $PidFile = Join-Path $PgData 'postmaster.pid'
  if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
  $FirstLine = Get-Content -LiteralPath $PidFile -TotalCount 1 -ErrorAction SilentlyContinue
  $PostmasterPid = 0
  if (-not [int]::TryParse(([string]$FirstLine).Trim(), [ref]$PostmasterPid) -or $PostmasterPid -le 0) { return $null }
  $Process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $PostmasterPid) -ErrorAction SilentlyContinue
  if (-not $Process) { return $null }
  $ExpectedRoot = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'postgres')).TrimEnd('\') + '\'
  if ($Process.ExecutablePath -and ([string]$Process.ExecutablePath).StartsWith($ExpectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $Process
  }
  return $null
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Import-DotEnv $EnvFile
$env:P14_ENV_FILE = $EnvFile
$env:P14_WINDOWS_PILOT = 'true'
$env:P14_INSTALL_DIR = $InstallDir

foreach ($Required in @($Node, $Runtime, (Join-Path $PgBin 'pg_ctl.exe'), (Join-Path $PgData 'PG_VERSION'))) {
  if (-not (Test-Path -LiteralPath $Required)) { throw "P14 no puede iniciar: falta $Required" }
}

if (-not (Test-PgReady)) {
  $ExistingProcess = Get-P14PostgresProcess
  if ($ExistingProcess) {
    throw "PostgreSQL P14 existe (PID $($ExistingProcess.ProcessId)) pero no está listo; no se iniciará una segunda instancia."
  }
  $PidFile = Join-Path $PgData 'postmaster.pid'
  if (Test-Path -LiteralPath $PidFile) {
    Remove-Item -LiteralPath $PidFile -Force
    "[$(Get-Date -Format o)] P14 eliminó postmaster.pid obsoleto." | Add-Content -LiteralPath $RuntimeLog -Encoding UTF8
  }
  & (Join-Path $PgBin 'pg_ctl.exe') -D $PgData -l $PgLog -w -t 30 start
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible iniciar PostgreSQL P14.' }
  $global:LASTEXITCODE = 0
}

if (-not (Test-PgReady)) { throw 'PostgreSQL P14 no respondió después del arranque.' }

Push-Location $AppDir
try {
  "[$(Get-Date -Format o)] P14 runtime start" | Add-Content -LiteralPath $RuntimeLog -Encoding UTF8
  & $Node $Runtime >> $RuntimeLog 2>&1
  $ExitCode = $LASTEXITCODE
  "[$(Get-Date -Format o)] P14 runtime exit=$ExitCode" | Add-Content -LiteralPath $RuntimeLog -Encoding UTF8
  exit $ExitCode
} finally {
  Pop-Location
}
