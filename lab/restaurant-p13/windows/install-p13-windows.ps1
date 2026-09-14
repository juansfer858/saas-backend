param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P13",
  [string]$AdminPassword = "",
  [switch]$NoStartupTasks,
  [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'
$TaskName = 'VantixGC Restaurant P13 Lab'
$WatchdogTaskName = 'VantixGC Restaurant P13 Watchdog'
$ReservedEdgeDir = [System.IO.Path]::GetFullPath('C:\ProgramData\VantixGC\Edge').TrimEnd('\')
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$PackageRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..')).TrimEnd('\')

function Assert-Administrator {
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
  if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecuta INSTALAR_P13.ps1 como Administrador.'
  }
}

function New-Secret([int]$Length = 64) {
  $Text = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
  return $Text.Substring(0, [Math]::Min($Length, $Text.Length))
}

function Read-DotEnv([string]$Path) {
  $Map = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $Map }
  foreach ($Line in Get-Content -LiteralPath $Path) {
    $Trim = [string]$Line
    $Trim = $Trim.Trim()
    if (-not $Trim -or $Trim.StartsWith('#')) { continue }
    $Idx = $Trim.IndexOf('=')
    if ($Idx -le 0) { continue }
    $Map[$Trim.Substring(0, $Idx).Trim()] = $Trim.Substring($Idx + 1).Trim().Trim('"').Trim("'")
  }
  return $Map
}

function Protect-File([string]$Path) {
  try {
    & icacls.exe $Path /inheritance:r | Out-Null
    & icacls.exe $Path /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
  } catch {
    Write-Warning "No se pudo endurecer ACL de $Path automáticamente: $($_.Exception.Message)"
  }
}

function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { throw "Falta payload requerido: $Source" }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Robocopy falló ($LASTEXITCODE) copiando $Source" }
  $global:LASTEXITCODE = 0
}

function Test-PgReady([string]$PgBin) {
  $PgReady = Join-Path $PgBin 'pg_isready.exe'
  if (-not (Test-Path -LiteralPath $PgReady)) { return $false }
  & $PgReady -h 127.0.0.1 -p 55432 -q 2>$null
  $Ready = ($LASTEXITCODE -eq 0)
  $global:LASTEXITCODE = 0
  return $Ready
}

function Get-P13PostgresProcess([string]$PgData) {
  $PidFile = Join-Path $PgData 'postmaster.pid'
  if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
  $FirstLine = Get-Content -LiteralPath $PidFile -TotalCount 1 -ErrorAction SilentlyContinue
  $PostmasterPid = 0
  if (-not [int]::TryParse(([string]$FirstLine).Trim(), [ref]$PostmasterPid) -or $PostmasterPid -le 0) { return $null }
  $Process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $PostmasterPid) -ErrorAction SilentlyContinue
  if (-not $Process) { return $null }
  $ExpectedRoot = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'postgres')).TrimEnd('\') + '\'
  $Executable = [string]$Process.ExecutablePath
  if ($Executable -and $Executable.StartsWith($ExpectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { return $Process }
  return $null
}

function Clear-StaleP13PostmasterPid([string]$PgBin, [string]$PgData) {
  if (Test-PgReady $PgBin) { return }
  $PidFile = Join-Path $PgData 'postmaster.pid'
  if (-not (Test-Path -LiteralPath $PidFile)) { return }
  $P13Postgres = Get-P13PostgresProcess $PgData
  if ($P13Postgres) {
    throw "PostgreSQL P13 sigue activo (PID $($P13Postgres.ProcessId)); no se eliminará postmaster.pid mientras el proceso exista."
  }
  Remove-Item -LiteralPath $PidFile -Force
  Write-Host 'P13: postmaster.pid obsoleto eliminado de forma segura.' -ForegroundColor Yellow
}

function Repair-P13PostgresAcl([string]$PgData) {
  if (-not (Test-Path -LiteralPath $PgData)) { return }
  $CurrentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $SystemGrant = '*S-1-5-18:(OI)(CI)(F)'
  $AdminsGrant = '*S-1-5-32-544:(OI)(CI)(F)'
  $UserGrant = ('*{0}:(OI)(CI)(F)' -f $CurrentSid)
  Write-Host 'P13: normalizando permisos del clúster PostgreSQL para usuario administrador y SYSTEM...' -ForegroundColor Cyan
  & icacls.exe $PgData /inheritance:e /T /C /Q | Out-Null
  $global:LASTEXITCODE = 0
  & icacls.exe $PgData /grant:r $SystemGrant $AdminsGrant $UserGrant /T /C /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible reparar los permisos del clúster PostgreSQL P13.' }
  $global:LASTEXITCODE = 0
}

function Stop-P13PostgresForUpgrade {
  $ExistingPgBin = Join-Path $InstallDir 'postgres\bin'
  $ExistingPgCtl = Join-Path $ExistingPgBin 'pg_ctl.exe'
  $ExistingPgData = Join-Path $InstallDir 'data\postgres'
  if (-not (Test-Path -LiteralPath $ExistingPgCtl) -or -not (Test-Path -LiteralPath (Join-Path $ExistingPgData 'PG_VERSION'))) { return }

  $Ready = Test-PgReady $ExistingPgBin
  $P13Postgres = Get-P13PostgresProcess $ExistingPgData
  if ($Ready -and -not $P13Postgres) {
    throw 'El puerto 55432 está ocupado por un PostgreSQL que no pudo identificarse como P13. No se modificará ese proceso.'
  }

  if ($Ready -or $P13Postgres) {
    Write-Host 'P13: deteniendo PostgreSQL local limpiamente antes de actualizar...' -ForegroundColor Cyan
    & $ExistingPgCtl -D $ExistingPgData -m fast -w -t 30 stop
    if ($LASTEXITCODE -ne 0) { throw 'No fue posible detener PostgreSQL P13 de forma segura antes de actualizar.' }
    $global:LASTEXITCODE = 0
  }

  for ($i = 0; $i -lt 30; $i++) {
    if (-not (Test-PgReady $ExistingPgBin) -and -not (Get-P13PostgresProcess $ExistingPgData)) { break }
    Start-Sleep -Milliseconds 250
  }
  if (Test-PgReady $ExistingPgBin) { throw 'PostgreSQL P13 continúa respondiendo en 55432; actualización cancelada para proteger la base.' }
  if (Get-P13PostgresProcess $ExistingPgData) { throw 'El proceso PostgreSQL P13 no terminó; actualización cancelada para proteger la base.' }
  Clear-StaleP13PostmasterPid $ExistingPgBin $ExistingPgData
}

function Stop-P13Processes {
  foreach ($Name in @($WatchdogTaskName, $TaskName)) {
    try { Disable-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue | Out-Null } catch {}
    try { Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Milliseconds 500
  Stop-P13PostgresForUpgrade

  try {
    $Processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase)) -or
      ($_.CommandLine -and $_.CommandLine.IndexOf($InstallDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
    }
    foreach ($Process in $Processes) {
      if (-not $Process.ProcessId -or $Process.ProcessId -eq $PID) { continue }
      $Executable = [string]$Process.ExecutablePath
      if ($Executable -and [System.IO.Path]::GetFileName($Executable).Equals('postgres.exe', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Quedó un proceso postgres.exe P13 activo (PID $($Process.ProcessId)); no será terminado a la fuerza."
      }
      try { Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  } catch {
    if ($_.Exception.Message -like 'Quedó un proceso postgres.exe P13 activo*') { throw }
  }
  Start-Sleep -Milliseconds 500
}

function Invoke-P13PsqlScalar([string]$PgBin, [string]$Database, [string]$Sql) {
  $SqlFile = Join-Path $env:TEMP ('vantix-p13-' + [guid]::NewGuid().ToString('N') + '.sql')
  try {
    $Sql | Set-Content -LiteralPath $SqlFile -Encoding ASCII
    $Rows = @(& (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p 55432 -U vantix_p13 -d $Database -tA -v ON_ERROR_STOP=1 -f $SqlFile)
    if ($LASTEXITCODE -ne 0) { throw "Consulta PostgreSQL P13 falló para $Database." }
    if ($Rows.Count -eq 0 -or $null -eq $Rows[0]) { throw "Consulta PostgreSQL P13 no devolvió resultado para $Database." }
    return ([string]$Rows[0]).Trim()
  } finally {
    Remove-Item -LiteralPath $SqlFile -Force -ErrorAction SilentlyContinue
  }
}

Assert-Administrator
if ($InstallDir.Equals($ReservedEdgeDir, [System.StringComparison]::OrdinalIgnoreCase) -or $InstallDir.StartsWith($ReservedEdgeDir + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'P13 jamás puede instalarse dentro de C:\ProgramData\VantixGC\Edge.'
}
if ($InstallDir -match '(?i)\\Edge(?:\\|$)') { throw 'Ruta de instalación rechazada por protección de Edge.' }

$Manifest = Join-Path $PackageRoot 'package-manifest.json'
$PayloadApp = Join-Path $PackageRoot 'payload\app'
$PayloadRuntime = Join-Path $PackageRoot 'payload\runtime'
$PayloadPostgres = Join-Path $PackageRoot 'payload\postgres'
$PayloadOps = Join-Path $PackageRoot 'payload\ops'
if (-not (Test-Path -LiteralPath $Manifest)) { throw 'Paquete P13 incompleto: falta package-manifest.json.' }
$ManifestData = Get-Content -Raw -LiteralPath $Manifest | ConvertFrom-Json
if ([string]$ManifestData.product -ne 'VantixGC Restaurant P13 Windows Pilot') { throw 'Paquete P13 no reconocido.' }
if ([int]$ManifestData.httpPort -ne 8790 -or [int]$ManifestData.postgresPort -ne 55432) { throw 'Puertos del paquete P13 no coinciden con el contrato aislado.' }

$PackagePrismaSchema = Join-Path $PayloadApp 'prisma\schema.prisma'
if (-not (Test-Path -LiteralPath $PackagePrismaSchema)) { throw 'Paquete P13 incompleto: falta prisma\schema.prisma.' }
$PackagePrismaSchemaHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PackagePrismaSchema).Hash.ToLowerInvariant()
$ExistingPrismaSchema = Join-Path $InstallDir 'app\prisma\schema.prisma'
$ExistingPrismaSchemaHash = $null
if (Test-Path -LiteralPath $ExistingPrismaSchema) {
  $ExistingPrismaSchemaHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ExistingPrismaSchema).Hash.ToLowerInvariant()
  if ($ExistingPrismaSchemaHash -ne $PackagePrismaSchemaHash) {
    throw 'Actualización P13 bloqueada: cambió prisma/schema.prisma. Este instalador no ejecutará db push destructivo sobre una base operativa; se requiere una migración explícita y preservadora.'
  }
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'data') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'logs') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'backups') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'secrets') | Out-Null
Stop-P13Processes

Copy-Tree $PayloadApp (Join-Path $InstallDir 'app')
Copy-Tree $PayloadRuntime (Join-Path $InstallDir 'runtime')
Copy-Tree $PayloadPostgres (Join-Path $InstallDir 'postgres')
Copy-Tree $PayloadOps (Join-Path $InstallDir 'ops')
Copy-Item -LiteralPath $Manifest -Destination (Join-Path $InstallDir 'package-manifest.json') -Force

$EnvFile = Join-Path $InstallDir '.env'
$Existing = Read-DotEnv $EnvFile
$DbPassword = if ($Existing['P13_DB_PASSWORD']) { [string]$Existing['P13_DB_PASSWORD'] } else { New-Secret 48 }
$JwtSecret = if ($Existing['P13_JWT_SECRET']) { [string]$Existing['P13_JWT_SECRET'] } else { New-Secret 64 }
if (-not $AdminPassword) { $AdminPassword = 'P13-' + (New-Secret 20) }
if ($AdminPassword.Length -lt 12) { throw 'AdminPassword debe tener al menos 12 caracteres.' }

$DatabaseUrl = "postgresql://vantix_p13:$DbPassword@127.0.0.1:55432/vantix_p13_lab"
$EnvLines = @(
  'VANTIX_P13_LAB_ENABLED=true',
  'P13_HOST=127.0.0.1',
  'P13_PORT=8790',
  'P13_MUTATIONS_ENABLED=false',
  'P13_TENANT_SUBDOMAIN=demo-restaurante',
  "P13_JWT_SECRET=$JwtSecret",
  "P13_DB_PASSWORD=$DbPassword",
  "DATABASE_URL=$DatabaseUrl",
  'NODE_ENV=development',
  'DIAN_EMBEDDED_WORKER_ENABLED=false',
  'NOTIFICATION_EMBEDDED_WORKER_ENABLED=false',
  'DISABLE_RESTAURANT_DEMO_BOOTSTRAP=true',
  'PUBLIC_TENANT_REGISTRATION_ENABLED=false'
)
$EnvLines | Set-Content -LiteralPath $EnvFile -Encoding UTF8
Protect-File $EnvFile

$Node = Join-Path $InstallDir 'runtime\node.exe'
$AppDir = Join-Path $InstallDir 'app'
$PgRoot = Join-Path $InstallDir 'postgres'
$PgBin = Join-Path $PgRoot 'bin'
$PgData = Join-Path $InstallDir 'data\postgres'
$PgLog = Join-Path $InstallDir 'logs\postgres.log'
foreach ($Required in @($Node, (Join-Path $PgBin 'initdb.exe'), (Join-Path $PgBin 'pg_ctl.exe'), (Join-Path $PgBin 'createdb.exe'), (Join-Path $PgBin 'psql.exe'))) {
  if (-not (Test-Path -LiteralPath $Required)) { throw "Paquete incompleto: falta $Required" }
}

$env:PGPASSWORD = $DbPassword
if (-not (Test-Path -LiteralPath (Join-Path $PgData 'PG_VERSION'))) {
  New-Item -ItemType Directory -Force -Path $PgData | Out-Null
  $PwFile = Join-Path $InstallDir 'secrets\pg-init-password.txt'
  $DbPassword | Set-Content -LiteralPath $PwFile -Encoding ASCII -NoNewline
  try {
    & (Join-Path $PgBin 'initdb.exe') -D $PgData -U vantix_p13 --pwfile=$PwFile --auth=scram-sha-256 --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'initdb P13 falló.' }
  } finally {
    Remove-Item -LiteralPath $PwFile -Force -ErrorAction SilentlyContinue
  }
  @"

# VantixGC Restaurant P13 isolated pilot
listen_addresses = '127.0.0.1'
port = 55432
max_connections = 60
shared_buffers = 128MB
"@ | Add-Content -LiteralPath (Join-Path $PgData 'postgresql.conf') -Encoding ASCII
}

Repair-P13PostgresAcl $PgData

if (-not (Test-PgReady $PgBin)) {
  Clear-StaleP13PostmasterPid $PgBin $PgData
  & (Join-Path $PgBin 'pg_ctl.exe') -D $PgData -l $PgLog -w -t 30 start
  if ($LASTEXITCODE -ne 0) { throw "No fue posible iniciar PostgreSQL P13 durante la instalación. Revisa $PgLog" }
  $global:LASTEXITCODE = 0
}
if (-not (Test-PgReady $PgBin)) { throw 'PostgreSQL P13 no respondió en 127.0.0.1:55432.' }

$DbExistsRaw = @(& (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p 55432 -U vantix_p13 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='vantix_p13_lab'" 2>$null)
$DbExists = ''
if ($DbExistsRaw.Count -gt 0 -and $null -ne $DbExistsRaw[0]) { $DbExists = [string]$DbExistsRaw[0] }
$DbExists = $DbExists.Trim()
if ($DbExists -ne '1') {
  & (Join-Path $PgBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U vantix_p13 vantix_p13_lab
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible crear vantix_p13_lab.' }
}

$env:VANTIX_P13_LAB_ENABLED = 'true'
$env:P13_HOST = '127.0.0.1'
$env:P13_PORT = '8790'
$env:P13_MUTATIONS_ENABLED = 'false'
$env:P13_TENANT_SUBDOMAIN = 'demo-restaurante'
$env:P13_JWT_SECRET = $JwtSecret
$env:P13_ADMIN_PASSWORD = $AdminPassword
$env:P13_DB_PASSWORD = $DbPassword
$env:DATABASE_URL = $DatabaseUrl
$env:NODE_ENV = 'development'
$env:DIAN_EMBEDDED_WORKER_ENABLED = 'false'
$env:NOTIFICATION_EMBEDDED_WORKER_ENABLED = 'false'
$env:DISABLE_RESTAURANT_DEMO_BOOTSTRAP = 'true'
$env:PUBLIC_TENANT_REGISTRATION_ENABLED = 'false'

$FreshBootstrap = $false
Push-Location $AppDir
try {
  $PrismaCli = Join-Path $AppDir 'node_modules\prisma\build\index.js'
  if (-not (Test-Path -LiteralPath $PrismaCli)) { throw 'El paquete no contiene Prisma CLI para preparar la base local.' }

  $TenantTableExistsRaw = Invoke-P13PsqlScalar $PgBin 'vantix_p13_lab' 'SELECT CASE WHEN to_regclass(''"Tenant"'') IS NULL THEN 0 ELSE 1 END;'
  $TenantTableExists = [int]$TenantTableExistsRaw
  if ($TenantTableExists -eq 1 -and -not $ExistingPrismaSchemaHash) {
    throw 'Base P13 existente detectada sin huella de esquema instalada. Actualización cancelada antes de ejecutar Prisma para proteger los datos operativos.'
  }

  if ($TenantTableExists -eq 0) {
    & $Node $PrismaCli db push
    if ($LASTEXITCODE -ne 0) { throw 'Prisma db push P13 falló durante la instalación inicial.' }
    $global:LASTEXITCODE = 0
  } else {
    Write-Host 'P13: actualización segura; prisma db push omitido para preservar tablas p13_* y colas locales.' -ForegroundColor Cyan
  }

  $TenantCountRaw = Invoke-P13PsqlScalar $PgBin 'vantix_p13_lab' 'SELECT count(*) FROM "Tenant";'
  $TenantCount = [int]$TenantCountRaw
  if ($TenantCount -eq 0) {
    $FreshBootstrap = $true
    & $Node (Join-Path $AppDir 'lab\restaurant-p13\bootstrap-demo.js')
    if ($LASTEXITCODE -ne 0) { throw 'Bootstrap demo P13 falló.' }
  } else {
    $WrongTenant = Invoke-P13PsqlScalar $PgBin 'vantix_p13_lab' 'SELECT count(*) FROM "Tenant" WHERE subdomain <> ''demo-restaurante'';'
    if ([int]$WrongTenant -ne 0 -or $TenantCount -ne 1) { throw 'La base local no cumple el aislamiento single-tenant demo-restaurante.' }
  }
} finally {
  Pop-Location
  Remove-Item Env:P13_ADMIN_PASSWORD -ErrorAction SilentlyContinue
}

if (-not $NoStartupTasks) {
  $StartScript = Join-Path $InstallDir 'ops\start-p13-windows.ps1'
  $Watchdog = Join-Path $InstallDir 'ops\watchdog-p13-windows.ps1'
  $Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $StartScript + '" -InstallDir "' + $InstallDir + '"') -WorkingDirectory $InstallDir
  $Trigger = New-ScheduledTaskTrigger -AtStartup
  $Settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

  $WatchdogAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Watchdog + '" -InstallDir "' + $InstallDir + '" -TaskName "' + $TaskName + '"') -WorkingDirectory $InstallDir
  $WatchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
  $WatchdogSettings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $WatchdogTaskName -Action $WatchdogAction -Trigger $WatchdogTrigger -Settings $WatchdogSettings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Start-ScheduledTask -TaskName $WatchdogTaskName
}

if (-not $NoShortcut) {
  try {
    $Desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
    @"
[InternetShortcut]
URL=http://127.0.0.1:8790/app/centro-de-control-v2
"@ | Set-Content -LiteralPath (Join-Path $Desktop 'VantixGC Restaurante P13.url') -Encoding ASCII
  } catch { Write-Warning "No se pudo crear el acceso directo: $($_.Exception.Message)" }
}

$State = [ordered]@{
  product = 'VantixGC Restaurant P13 Windows Pilot'
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
  installDir = $InstallDir
  httpPort = 8790
  postgresPort = 55432
  tenant = 'demo-restaurante'
  prismaSchemaSha256 = $PackagePrismaSchemaHash
  edgeProductionUntouched = $true
  startupTasks = (-not $NoStartupTasks)
}
$State | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $InstallDir 'install-state.json') -Encoding UTF8

Write-Host ''
Write-Host 'VantixGC Restaurante P13 instalado en modo AISLADO.' -ForegroundColor Green
Write-Host 'URL local: http://127.0.0.1:8790/app/centro-de-control-v2'
Write-Host 'Usuario: admin@demo-restaurante.vantixgc.com'
if ($FreshBootstrap) { Write-Host "Clave piloto: $AdminPassword" }
else { Write-Host 'Clave del ADMIN local existente conservada; no se modificó.' }
Write-Host 'PostgreSQL local: 127.0.0.1:55432 / vantix_p13_lab'
Write-Host 'Edge productivo 8788 no fue modificado.' -ForegroundColor Cyan