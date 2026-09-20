param(
  [string]$InstallDir = 'C:\ProgramData\VantixGC\Restaurant-P15-Lab',
  [string]$AdminPassword = '',
  [switch]$EnableLan,
  [string]$LanAddress = '',
  [string]$LanCidr = '',
  [string]$BackupUploadUrl = '',
  [string]$BackupUploadToken = '',
  [switch]$NoServices,
  [switch]$NoShortcut,
  [switch]$NoFirewall
)

$ErrorActionPreference = 'Stop'
$HttpPort = 8815
$PgPort = 55435
$PrintPort = 18815
$Database = 'vantix_restaurant_p15_lab'
$DbUser = 'vantix_p15'
$Tenant = 'demo-restaurante'
$InstallationId = 'HOME-PILOT-P15'
$PgService = 'VantixGC Restaurant P15 PostgreSQL'
$ServerServiceId = 'VantixRestaurantP15Server'
$PrintServiceId = 'VantixRestaurantP15Print'
$BackupServiceId = 'VantixRestaurantP15Backup'

$PackageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$Payload = Join-Path $PackageRoot 'payload'
$InstallDir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$AppDir = Join-Path $InstallDir 'app'
$RuntimeDir = Join-Path $InstallDir 'runtime'
$PgRoot = Join-Path $InstallDir 'postgres'
$PgBin = Join-Path $PgRoot 'bin'
$PgData = Join-Path $InstallDir 'data\postgres'
$ConfigDir = Join-Path $InstallDir 'config'
$SecretsDir = Join-Path $InstallDir 'secrets'
$LogsDir = Join-Path $InstallDir 'logs'
$BackupDir = Join-Path $InstallDir 'backups'
$ServicesDir = Join-Path $InstallDir 'services'
$FilesDir = Join-Path $InstallDir 'files'
$EnvFile = Join-Path $ConfigDir '.env'
$DbSecretFile = Join-Path $SecretsDir 'db-password.txt'
$JwtFile = Join-Path $SecretsDir 'jwt-secret.txt'
$BackupSecretFile = Join-Path $SecretsDir 'backup-key.txt'
$PrintTokenFile = Join-Path $SecretsDir 'print-token.txt'

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecuta el instalador P15 como Administrador.'
  }
}

function New-Secret([int]$Length = 48) {
  $value = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
  return $value.Substring(0, [Math]::Min($Length, $value.Length))
}

function Protect-Secret([string]$Path) {
  & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
  $global:LASTEXITCODE = 0
}

function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { throw "Falta payload: $Source" }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy.exe $Source $Destination /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Robocopy falló copiando $Source" }
  $global:LASTEXITCODE = 0
}

function Assert-Port([int]$Port) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { return }
  $ownedByP15 = $false
  foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $listener.OwningProcess) -ErrorAction SilentlyContinue
    if ($process -and $process.ExecutablePath -and ([string]$process.ExecutablePath).StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase)) {
      $ownedByP15 = $true
    }
  }
  if (-not $ownedByP15) { throw "Puerto P15 $Port ocupado por otro proceso." }
}

function Resolve-Lan {
  if (-not $EnableLan) {
    return @{ enabled = $false; bind = '127.0.0.1'; address = '127.0.0.1'; cidr = '' }
  }
  $address = $LanAddress
  $cidr = $LanCidr
  if (-not $address) {
    $routes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric, InterfaceMetric)
    foreach ($route in $routes) {
      $candidate = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -AddressState Preferred -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
        Select-Object -First 1
      if ($candidate) {
        $address = [string]$candidate.IPAddress
        if (-not $cidr) {
          $parts = $address.Split('.')
          $cidr = "$($parts[0]).$($parts[1]).$($parts[2]).0/24"
        }
        break
      }
    }
  }
  if (-not $address -or -not $cidr) { throw 'No se pudo detectar LAN privada. Usa -LanAddress y -LanCidr.' }
  return @{ enabled = $true; bind = '0.0.0.0'; address = $address; cidr = $cidr }
}

function Wait-Tcp([int]$Port, [int]$Seconds = 60) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Write-WinSw([string]$Id, [string]$Display, [string]$Description, [string]$Script, [hashtable]$ExtraEnv) {
  $exe = Join-Path $ServicesDir "$Id.exe"
  Copy-Item -LiteralPath (Join-Path $Payload 'winsw\WinSW.exe') -Destination $exe -Force
  $xml = Join-Path $ServicesDir "$Id.xml"
  $envXml = @(
    ('<env name="P15_ENV_FILE" value="{0}" />' -f [Security.SecurityElement]::Escape($EnvFile))
  )
  foreach ($key in $ExtraEnv.Keys) {
    $envXml += ('<env name="{0}" value="{1}" />' -f [Security.SecurityElement]::Escape([string]$key), [Security.SecurityElement]::Escape([string]$ExtraEnv[$key]))
  }
  $node = Join-Path $RuntimeDir 'node.exe'
  $scriptPath = Join-Path $AppDir $Script
  $content = @"
<service>
  <id>$Id</id>
  <name>$Display</name>
  <description>$Description</description>
  <executable>$node</executable>
  <arguments>"$scriptPath"</arguments>
  <workingdirectory>$AppDir</workingdirectory>
  $($envXml -join "`r`n  ")
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <stoptimeout>20sec</stoptimeout>
  <onfailure action="restart" delay="5 sec" />
  <onfailure action="restart" delay="15 sec" />
  <onfailure action="restart" delay="30 sec" />
  <logpath>$LogsDir</logpath>
  <log mode="roll-by-size-time">
    <sizeThreshold>10485760</sizeThreshold>
    <pattern>yyyyMMdd</pattern>
    <autoRollAtTime>00:00:00</autoRollAtTime>
    <zipOlderThanNumDays>7</zipOlderThanNumDays>
  </log>
</service>
"@
  Set-Content -LiteralPath $xml -Value $content -Encoding UTF8
  return $exe
}

Assert-Admin
if ($InstallDir.StartsWith('C:\ProgramData\VantixGC\Edge', [StringComparison]::OrdinalIgnoreCase) -or $InstallDir -match 'Restaurant-P1[34]') {
  throw 'P15 no puede instalarse dentro de Edge/P13/P14.'
}
Assert-Port $HttpPort
Assert-Port $PgPort
Assert-Port $PrintPort
$lan = Resolve-Lan

foreach ($directory in @($InstallDir, $ConfigDir, $SecretsDir, $LogsDir, $BackupDir, $ServicesDir, $FilesDir, (Join-Path $InstallDir 'data'))) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
Copy-Tree (Join-Path $Payload 'app') $AppDir
Copy-Tree (Join-Path $Payload 'runtime') $RuntimeDir
Copy-Tree (Join-Path $Payload 'postgres') $PgRoot
Copy-Tree (Join-Path $Payload 'winsw') (Join-Path $InstallDir 'winsw')

$freshDb = -not (Test-Path -LiteralPath (Join-Path $PgData 'PG_VERSION'))
if (-not (Test-Path -LiteralPath $DbSecretFile)) { New-Secret 48 | Set-Content -LiteralPath $DbSecretFile -NoNewline -Encoding ASCII; Protect-Secret $DbSecretFile }
if (-not (Test-Path -LiteralPath $JwtFile)) { New-Secret 64 | Set-Content -LiteralPath $JwtFile -NoNewline -Encoding ASCII; Protect-Secret $JwtFile }
if (-not (Test-Path -LiteralPath $BackupSecretFile)) { New-Secret 64 | Set-Content -LiteralPath $BackupSecretFile -NoNewline -Encoding ASCII; Protect-Secret $BackupSecretFile }
if (-not (Test-Path -LiteralPath $PrintTokenFile)) { New-Secret 48 | Set-Content -LiteralPath $PrintTokenFile -NoNewline -Encoding ASCII; Protect-Secret $PrintTokenFile }
$dbPass = (Get-Content -LiteralPath $DbSecretFile -Raw).Trim()
$jwt = (Get-Content -LiteralPath $JwtFile -Raw).Trim()
$backupSecret = (Get-Content -LiteralPath $BackupSecretFile -Raw).Trim()
$printToken = (Get-Content -LiteralPath $PrintTokenFile -Raw).Trim()

if ($freshDb) {
  New-Item -ItemType Directory -Force -Path $PgData | Out-Null
  $passwordFile = Join-Path $SecretsDir 'pg-init.txt'
  $dbPass | Set-Content -LiteralPath $passwordFile -NoNewline -Encoding ASCII
  Protect-Secret $passwordFile
  & (Join-Path $PgBin 'initdb.exe') -D $PgData -U $DbUser --pwfile=$passwordFile --auth=scram-sha-256 --encoding=UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw 'initdb P15 falló.' }
  $global:LASTEXITCODE = 0
  Remove-Item -LiteralPath $passwordFile -Force
}

$walDir = Join-Path $BackupDir 'wal'
New-Item -ItemType Directory -Force -Path $walDir | Out-Null
$pgConf = Join-Path $PgData 'postgresql.conf'
$pgText = Get-Content -LiteralPath $pgConf -Raw
$pgText = [regex]::Replace($pgText, '(?m)^\s*listen_addresses\s*=.*(?:\r?\n)?', '')
$pgText = [regex]::Replace($pgText, '(?m)^\s*port\s*=.*(?:\r?\n)?', '')
$walUnix = $walDir.Replace('\', '/')
$pgAppend = @"

# VantixGC Restaurant P15
listen_addresses = '127.0.0.1'
port = $PgPort
max_connections = 100
shared_buffers = 256MB
wal_level = replica
archive_mode = on
archive_command = 'cmd /c if not exist "$walUnix/%f" copy "%p" "$walUnix/%f" >NUL'
"@
Set-Content -LiteralPath $pgConf -Value ($pgText.TrimEnd() + $pgAppend + "`r`n") -Encoding ASCII

if (-not $NoServices) {
  try { Stop-Service -Name $PgService -Force -ErrorAction SilentlyContinue } catch {}
  & (Join-Path $PgBin 'pg_ctl.exe') unregister -N $PgService 2>$null | Out-Null
  $global:LASTEXITCODE = 0
  & (Join-Path $PgBin 'pg_ctl.exe') register -N $PgService -D $PgData -S auto -o "-p $PgPort"
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo registrar PostgreSQL P15 como servicio.' }
  $global:LASTEXITCODE = 0
  Start-Service -Name $PgService
} else {
  & (Join-Path $PgBin 'pg_ctl.exe') -D $PgData -l (Join-Path $LogsDir 'postgres.log') -w start
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar PostgreSQL P15.' }
  $global:LASTEXITCODE = 0
}
if (-not (Wait-Tcp $PgPort 60)) { throw 'PostgreSQL P15 no inició en 55435.' }

$env:PGPASSWORD = $dbPass
$existsRaw = @(& (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p $PgPort -U $DbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$Database'" 2>$null)
$exists = if ($existsRaw.Count -gt 0) { ([string]$existsRaw[0]).Trim() } else { '' }
if ($exists -ne '1') {
  & (Join-Path $PgBin 'createdb.exe') -h 127.0.0.1 -p $PgPort -U $DbUser $Database
  if ($LASTEXITCODE -ne 0) { throw 'createdb P15 falló.' }
  $global:LASTEXITCODE = 0
}

$encodedDbPass = [Uri]::EscapeDataString($dbPass)
$dbUrl = "postgresql://$DbUser`:$encodedDbPass@127.0.0.1`:$PgPort/$Database"
$runtimeCfg = [ordered]@{
  product = 'VantixGC Restaurant P15'
  installationId = $InstallationId
  tenant = $Tenant
  httpPort = $HttpPort
  postgresPort = $PgPort
  database = $Database
  lan = $lan
  printPort = $PrintPort
  authority = 'LOCAL_PRIMARY'
}
$runtimeCfg | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $ConfigDir 'runtime.json') -Encoding UTF8
if (-not (Test-Path -LiteralPath (Join-Path $ConfigDir 'printers.json'))) {
  '{"version":1,"stations":{}}' | Set-Content -LiteralPath (Join-Path $ConfigDir 'printers.json') -Encoding UTF8
}

$envLines = @(
  'P15_ENABLED=true',
  "P15_INSTALLATION_ID=$InstallationId",
  "P15_TENANT_SUBDOMAIN=$Tenant",
  "P15_HTTP_PORT=$HttpPort",
  "P15_BIND_HOST=$($lan.bind)",
  "P15_ADVERTISE_HOST=$($lan.address)",
  "P15_LAN_ENABLED=$($lan.enabled.ToString().ToLowerInvariant())",
  "P15_LAN_CIDR=$($lan.cidr)",
  "P15_PRINT_PORT=$PrintPort",
  "P15_INSTALL_DIR=$InstallDir",
  "P15_PG_BIN=$PgBin",
  "P15_BACKUP_DIR=$BackupDir",
  'P15_BACKUP_ENABLED=true',
  'P15_BACKUP_INTERVAL_MINUTES=15',
  'P15_BACKUP_KEEP=48',
  "P15_BACKUP_UPLOAD_URL=$BackupUploadUrl",
  "P15_BACKUP_UPLOAD_TOKEN=$BackupUploadToken",
  "DATABASE_URL=$dbUrl",
  "P15_JWT_SECRET=$jwt",
  "P15_BACKUP_SECRET=$backupSecret",
  'NODE_ENV=production',
  'DIAN_EMBEDDED_WORKER_ENABLED=false',
  'NOTIFICATION_EMBEDDED_WORKER_ENABLED=false',
  'PUBLIC_TENANT_REGISTRATION_ENABLED=false'
)
$envLines | Set-Content -LiteralPath $EnvFile -Encoding UTF8
Protect-Secret $EnvFile
foreach ($line in (Get-Content -LiteralPath $EnvFile)) {
  if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}

$node = Join-Path $RuntimeDir 'node.exe'
$prismaCli = Join-Path $AppDir 'node_modules\prisma\build\index.js'
Push-Location $AppDir
try {
  & $node $prismaCli db push
  if ($LASTEXITCODE -ne 0) { throw 'Prisma db push P15 falló.' }
  $global:LASTEXITCODE = 0
  if ($freshDb) {
    if (-not $AdminPassword) { $AdminPassword = 'P15-' + (New-Secret 20) }
    $env:P15_ADMIN_PASSWORD = $AdminPassword
    & $node (Join-Path $AppDir 'lab\restaurant-p15\bootstrap-demo.js')
    if ($LASTEXITCODE -ne 0) { throw 'Bootstrap P15 falló.' }
    $global:LASTEXITCODE = 0
    Remove-Item Env:P15_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  }
} finally {
  Pop-Location
}

if (-not $NoServices) {
  foreach ($id in @($ServerServiceId, $PrintServiceId, $BackupServiceId)) {
    $oldExe = Join-Path $ServicesDir "$id.exe"
    if (Test-Path -LiteralPath $oldExe) {
      & $oldExe stop 2>$null | Out-Null
      & $oldExe uninstall 2>$null | Out-Null
      $global:LASTEXITCODE = 0
    }
  }

  $serverExe = Write-WinSw $ServerServiceId 'VantixGC Restaurant P15 Server' 'Servidor local-primary del restaurante.' 'lab\restaurant-p15\runtime.js' @{
    P15_ENV_FILE = $EnvFile
  }
  $printExe = Write-WinSw $PrintServiceId 'VantixGC Restaurant P15 Print' 'Spooler local ESC/POS.' 'edge\print-spooler\server.js' @{
    SPOOLER_HOST = '127.0.0.1'
    SPOOLER_PORT = $PrintPort
    SPOOLER_SHARED_TOKEN = $printToken
  }
  $backupExe = Write-WinSw $BackupServiceId 'VantixGC Restaurant P15 Backup' 'Backup cifrado local y remoto desacoplado.' 'lab\restaurant-p15\backup-agent.js' @{
    P15_INSTALL_DIR = $InstallDir
    P15_INSTALLATION_ID = $InstallationId
    P15_TENANT_SUBDOMAIN = $Tenant
    P15_PG_BIN = $PgBin
    P15_BACKUP_DIR = $BackupDir
    P15_BACKUP_SECRET = $backupSecret
    P15_BACKUP_UPLOAD_URL = $BackupUploadUrl
    P15_BACKUP_UPLOAD_TOKEN = $BackupUploadToken
    DATABASE_URL = $dbUrl
    P15_BACKUP_INTERVAL_MINUTES = '15'
    P15_BACKUP_KEEP = '48'
  }

  foreach ($exe in @($serverExe, $printExe, $backupExe)) {
    & $exe install
    if ($LASTEXITCODE -ne 0) { throw "WinSW install falló: $exe" }
    & $exe start
    if ($LASTEXITCODE -ne 0) { throw "WinSW start falló: $exe" }
    $global:LASTEXITCODE = 0
  }
}

if (-not $NoFirewall -and $lan.enabled) {
  Get-NetFirewallRule -DisplayName 'VantixGC Restaurant P15 LAN 8815' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName 'VantixGC Restaurant P15 LAN 8815' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $HttpPort -RemoteAddress $lan.cidr -Profile Private | Out-Null
}

if (-not $NoServices -and -not (Wait-Tcp $HttpPort 90)) { throw 'Servidor P15 no inició en 8815.' }

if (-not $NoShortcut) {
  $url = "http://$($lan.address):$HttpPort/app/centro-de-control-v2"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'VantixGC Restaurante P15.lnk'))
  $shortcut.TargetPath = "$env:SystemRoot\System32\cmd.exe"
  $shortcut.Arguments = "/c start $url"
  $shortcut.WorkingDirectory = $InstallDir
  $shortcut.Save()
}

Write-Host ''
Write-Host 'P15 INSTALADO' -ForegroundColor Green
Write-Host "URL: http://$($lan.address):$HttpPort/app/centro-de-control-v2"
Write-Host "PostgreSQL: 127.0.0.1:$PgPort/$Database"
Write-Host 'Servicios: PostgreSQL + Server + Print + Backup'
Write-Host "Backup local: $BackupDir"
if ($freshDb) {
  Write-Host ''
  Write-Host 'CREDENCIALES LAB (guardar):' -ForegroundColor Yellow
  Write-Host 'Usuarios: admin/mesero/cocina/barra/postres/cajero @demo-restaurante.vantixgc.com'
  Write-Host "Password: $AdminPassword"
  Write-Host "Recovery key: $backupSecret"
}
