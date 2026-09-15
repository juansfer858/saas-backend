param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P14-Home-Pilot",
  [string]$AdminPassword = "",
  [switch]$EnableLan,
  [string]$LanAddress = "",
  [string]$LanCidr = "",
  [switch]$NoStartupTasks,
  [switch]$NoShortcut,
  [switch]$NoFirewall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'VantixGC Restaurant P14 Home Pilot'
$WatchdogTaskName = 'VantixGC Restaurant P14 Watchdog'
$FirewallRuleName = 'VantixGC Restaurant P14 Home Pilot LAN 8791'
$LegacyFirewallRuleName = 'VantixGC Restaurant P14 Home Pilot LAN 8790'
$ReservedEdgeDir = [System.IO.Path]::GetFullPath('C:\ProgramData\VantixGC\Edge').TrimEnd('\')
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$PackageRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..')).TrimEnd('\')
$EnableLanWasSpecified = $PSBoundParameters.ContainsKey('EnableLan')

function Assert-Administrator {
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
  if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecuta INSTALAR_P14.ps1 como Administrador.'
  }
}

function Test-Truthy([string]$Value) {
  return @('1','true','yes','on') -contains ([string]$Value).Trim().ToLowerInvariant()
}

function New-Secret([int]$Length = 64) {
  $Text = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
  return $Text.Substring(0, [Math]::Min($Length, $Text.Length))
}

function Read-DotEnv([string]$Path) {
  $Map = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $Map }
  foreach ($Line in Get-Content -LiteralPath $Path) {
    $Trim = ([string]$Line).Trim()
    if (-not $Trim -or $Trim.StartsWith('#')) { continue }
    $Index = $Trim.IndexOf('=')
    if ($Index -le 0) { continue }
    $Map[$Trim.Substring(0, $Index).Trim()] = $Trim.Substring($Index + 1).Trim().Trim('"').Trim("'")
  }
  return $Map
}

function Protect-File([string]$Path) {
  $CurrentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $CurrentUserGrant = ('*{0}:(F)' -f $CurrentSid)
  & icacls.exe $Path /inheritance:r | Out-Null
  $global:LASTEXITCODE = 0
  & icacls.exe $Path /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' $CurrentUserGrant | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "No fue posible proteger $Path." }
  $global:LASTEXITCODE = 0
}

function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { throw "Falta payload requerido: $Source" }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Robocopy falló ($LASTEXITCODE) copiando $Source" }
  $global:LASTEXITCODE = 0
}

function Test-PrivateIpv4([string]$Address) {
  [System.Net.IPAddress]$Parsed = $null
  if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$Parsed)) { return $false }
  $Bytes = $Parsed.GetAddressBytes()
  if ($Bytes.Length -ne 4) { return $false }
  if ($Bytes[0] -eq 10) { return $true }
  if ($Bytes[0] -eq 172 -and $Bytes[1] -ge 16 -and $Bytes[1] -le 31) { return $true }
  return ($Bytes[0] -eq 192 -and $Bytes[1] -eq 168)
}

function Get-NetworkCidr([string]$Address, [int]$PrefixLength) {
  if (-not (Test-PrivateIpv4 $Address)) { throw "Dirección LAN privada inválida: $Address" }
  if ($PrefixLength -lt 8 -or $PrefixLength -gt 32) { throw "Prefijo LAN inválido: $PrefixLength" }
  $Octets = $Address.Split('.') | ForEach-Object { [int]$_ }
  $Remaining = $PrefixLength
  $Network = @()
  for ($Index = 0; $Index -lt 4; $Index++) {
    if ($Remaining -ge 8) {
      $Mask = 255
      $Remaining -= 8
    } elseif ($Remaining -gt 0) {
      $Mask = 256 - [int][Math]::Pow(2, 8 - $Remaining)
      $Remaining = 0
    } else {
      $Mask = 0
    }
    $Network += ($Octets[$Index] -band $Mask)
  }
  return (($Network -join '.') + '/' + $PrefixLength)
}

function Test-AddressInCidr([string]$Address, [string]$Cidr) {
  $Match = [regex]::Match(([string]$Cidr).Trim(), '^([^/]+)/(\d{1,2})$')
  if (-not $Match.Success) { return $false }
  $Prefix = [int]$Match.Groups[2].Value
  try {
    return ((Get-NetworkCidr $Address $Prefix) -eq (Get-NetworkCidr ([string]$Match.Groups[1].Value) $Prefix))
  } catch {
    return $false
  }
}

function Resolve-LanConfiguration([hashtable]$Existing) {
  $LanEnabled = if ($script:EnableLanWasSpecified) {
    [bool]$EnableLan
  } elseif ($Existing.ContainsKey('P14_LAN_ENABLED')) {
    Test-Truthy $Existing['P14_LAN_ENABLED']
  } else {
    $false
  }

  if (-not $LanEnabled) {
    return [ordered]@{
      enabled = $false
      bindHost = '127.0.0.1'
      advertiseHost = '127.0.0.1'
      cidr = ''
    }
  }

  $ResolvedAddress = ([string]$LanAddress).Trim()
  $ResolvedCidr = ([string]$LanCidr).Trim()
  if (-not $ResolvedAddress -and $Existing['P14_ADVERTISE_HOST'] -and (Test-PrivateIpv4 $Existing['P14_ADVERTISE_HOST'])) {
    $ResolvedAddress = [string]$Existing['P14_ADVERTISE_HOST']
  }
  if (-not $ResolvedCidr -and $Existing['P14_LAN_CIDR']) {
    $ResolvedCidr = [string]$Existing['P14_LAN_CIDR']
  }

  if (-not $ResolvedAddress) {
    $Candidates = @()
    try {
      $Routes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object RouteMetric, InterfaceMetric)
      foreach ($Route in $Routes) {
        $Addresses = @(Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $Route.InterfaceIndex -AddressState Preferred -ErrorAction SilentlyContinue)
        foreach ($Item in $Addresses) {
          if (Test-PrivateIpv4 ([string]$Item.IPAddress)) {
            $Candidates += [pscustomobject]@{
              Address = [string]$Item.IPAddress
              PrefixLength = [int]$Item.PrefixLength
              InterfaceIndex = [int]$Route.InterfaceIndex
              RouteMetric = [int]$Route.RouteMetric
            }
          }
        }
      }
    } catch {}
    $Candidates = @($Candidates | Sort-Object RouteMetric, InterfaceIndex, Address -Unique)
    if ($Candidates.Count -eq 0) {
      throw 'No se detectó una IPv4 privada con puerta de enlace. Indica -LanAddress y -LanCidr manualmente.'
    }
    $Selected = $Candidates[0]
    $ResolvedAddress = $Selected.Address
    if (-not $ResolvedCidr) { $ResolvedCidr = Get-NetworkCidr $Selected.Address $Selected.PrefixLength }
  }

  if (-not (Test-PrivateIpv4 $ResolvedAddress)) { throw "P14 LAN requiere una IPv4 privada; recibido $ResolvedAddress." }
  if (-not $ResolvedCidr) { throw 'P14 LAN requiere LanCidr.' }
  if (-not (Test-AddressInCidr $ResolvedAddress $ResolvedCidr)) {
    throw "La IP $ResolvedAddress no pertenece a $ResolvedCidr."
  }

  return [ordered]@{
    enabled = $true
    bindHost = '0.0.0.0'
    advertiseHost = $ResolvedAddress
    cidr = $ResolvedCidr
  }
}

function Test-PgReady([string]$PgBin) {
  $PgReady = Join-Path $PgBin 'pg_isready.exe'
  if (-not (Test-Path -LiteralPath $PgReady)) { return $false }
  & $PgReady -h 127.0.0.1 -p 55433 -U vantix_p14 -d postgres -q 2>$null
  $Ready = ($LASTEXITCODE -eq 0)
  $global:LASTEXITCODE = 0
  return $Ready
}

function Get-ListeningProcessIds([int]$Port) {
  try {
    return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      Where-Object { $_ -and [int]$_ -gt 0 })
  } catch {
    return @()
  }
}

function Assert-PortFree([int]$Port, [string]$Purpose) {
  $Owners = @(Get-ListeningProcessIds $Port)
  if ($Owners.Count -eq 0) { return }
  $Details = @()
  foreach ($OwnerPid in $Owners) {
    $Process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $OwnerPid) -ErrorAction SilentlyContinue
    if ($Process) {
      $Details += ("PID={0} NAME={1} PATH={2}" -f $OwnerPid, $Process.Name, $Process.ExecutablePath)
    } else {
      $Details += ("PID={0}" -f $OwnerPid)
    }
  }
  throw ("P14 no puede usar el puerto {0} para {1}; ya está ocupado por {2}. P13 y Edge no serán detenidos." -f $Port, $Purpose, ($Details -join '; '))
}

function Get-P14PostgresProcess([string]$PgData) {
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

function Clear-StalePostmasterPid([string]$PgBin, [string]$PgData) {
  if (Test-PgReady $PgBin) { return }
  $PidFile = Join-Path $PgData 'postmaster.pid'
  if (-not (Test-Path -LiteralPath $PidFile)) { return }
  $OwnedProcess = Get-P14PostgresProcess $PgData
  if ($OwnedProcess) { throw "PostgreSQL P14 sigue activo (PID $($OwnedProcess.ProcessId))." }
  Remove-Item -LiteralPath $PidFile -Force
  Write-Host 'P14: postmaster.pid obsoleto eliminado.' -ForegroundColor Yellow
}

function Set-P14PostgresNetworkConfig([string]$PgData) {
  $ConfigPath = Join-Path $PgData 'postgresql.conf'
  if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "No existe $ConfigPath" }
  $Content = Get-Content -Raw -LiteralPath $ConfigPath
  $Content = [regex]::Replace($Content, '(?m)^\s*listen_addresses\s*=.*(?:\r?\n)?', '')
  $Content = [regex]::Replace($Content, '(?m)^\s*port\s*=\s*(?:55432|55433)\s*(?:#.*)?(?:\r?\n)?', '')
  $Content = $Content.TrimEnd() + "`r`n`r`n# VantixGC Restaurant P14 Home Pilot - canonical isolated ports`r`nlisten_addresses = '127.0.0.1'`r`nport = 55433`r`n"
  Set-Content -LiteralPath $ConfigPath -Value $Content -Encoding ASCII
}

function Repair-PostgresAcl([string]$PgData) {
  if (-not (Test-Path -LiteralPath $PgData)) { return }
  $CurrentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $SystemGrant = '*S-1-5-18:(OI)(CI)(F)'
  $AdminsGrant = '*S-1-5-32-544:(OI)(CI)(F)'
  $UserGrant = ('*{0}:(OI)(CI)(F)' -f $CurrentSid)
  & icacls.exe $PgData /inheritance:e /T /C /Q | Out-Null
  $global:LASTEXITCODE = 0
  & icacls.exe $PgData /grant:r $SystemGrant $AdminsGrant $UserGrant /T /C /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible normalizar los permisos PostgreSQL P14.' }
  $global:LASTEXITCODE = 0
}

function Stop-P14RuntimeProcesses {
  $RuntimeNode = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'runtime\node.exe'))
  $RuntimeScript = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'app\lab\restaurant-p14\runtime.js'))
  try {
    $Processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ExecutablePath -and
      [System.IO.Path]::GetFullPath([string]$_.ExecutablePath).Equals($RuntimeNode, [System.StringComparison]::OrdinalIgnoreCase) -and
      $_.CommandLine -and
      ([string]$_.CommandLine).IndexOf($RuntimeScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    foreach ($Process in $Processes) {
      if ($Process.ProcessId -and $Process.ProcessId -ne $PID) {
        Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
}

function Stop-P14ForUpgrade {
  foreach ($Name in @($WatchdogTaskName, $TaskName)) {
    try { Disable-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue | Out-Null } catch {}
    try { Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue } catch {}
  }
  Stop-P14RuntimeProcesses
  Start-Sleep -Milliseconds 500

  $PgBin = Join-Path $InstallDir 'postgres\bin'
  $PgCtl = Join-Path $PgBin 'pg_ctl.exe'
  $PgData = Join-Path $InstallDir 'data\postgres'
  if (-not (Test-Path -LiteralPath $PgCtl) -or -not (Test-Path -LiteralPath (Join-Path $PgData 'PG_VERSION'))) { return }

  $Ready = Test-PgReady $PgBin
  $OwnedProcess = Get-P14PostgresProcess $PgData
  if ($Ready -and -not $OwnedProcess) {
    throw 'El puerto 55433 está ocupado por un PostgreSQL ajeno a P14. Instalación cancelada.'
  }
  if ($Ready -or $OwnedProcess) {
    & $PgCtl -D $PgData -m fast -w -t 30 stop
    if ($LASTEXITCODE -ne 0) { throw 'No fue posible detener PostgreSQL P14 antes de actualizar.' }
    $global:LASTEXITCODE = 0
  }
  Clear-StalePostmasterPid $PgBin $PgData
}

function Invoke-P14PsqlScalar([string]$PgBin, [string]$Database, [string]$Sql) {
  $SqlFile = Join-Path $env:TEMP ('vantix-p14-' + [guid]::NewGuid().ToString('N') + '.sql')
  try {
    $Sql | Set-Content -LiteralPath $SqlFile -Encoding ASCII
    $Rows = @(& (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p 55433 -U vantix_p14 -d $Database -tA -v ON_ERROR_STOP=1 -f $SqlFile)
    if ($LASTEXITCODE -ne 0) { throw "Consulta PostgreSQL P14 falló para $Database." }
    if ($Rows.Count -eq 0 -or $null -eq $Rows[0]) { throw "Consulta PostgreSQL P14 no devolvió resultado para $Database." }
    return ([string]$Rows[0]).Trim()
  } finally {
    Remove-Item -LiteralPath $SqlFile -Force -ErrorAction SilentlyContinue
  }
}

function Configure-P14Firewall([System.Collections.IDictionary]$Lan) {
  try { Remove-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue | Out-Null } catch {}
  try { Remove-NetFirewallRule -DisplayName $LegacyFirewallRuleName -ErrorAction SilentlyContinue | Out-Null } catch {}
  if (-not $Lan.enabled -or $NoFirewall) { return }
  New-NetFirewallRule `
    -DisplayName $FirewallRuleName `
    -Direction Inbound `
    -Action Allow `
    -Enabled True `
    -Profile Any `
    -Protocol TCP `
    -LocalPort 8791 `
    -RemoteAddress $Lan.cidr `
    -Description 'P14 HOME-PILOT-01: acceso al runtime local únicamente desde la subred privada autorizada.' | Out-Null
}

function Wait-P14Health([int]$Seconds = 60) {
  for ($Index = 0; $Index -lt ($Seconds * 2); $Index++) {
    try {
      $Status = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8791/__p14/status' -TimeoutSec 2
      if ($Status.ok -and [string]$Status.marker -eq 'VANTIX_RESTAURANT_LOCAL_FIRST_P14_HOME_PILOT') { return $true }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  return $false
}

Assert-Administrator
Write-Host 'P14 aislado: runtime 8791 y PostgreSQL 55433. P13 8790/55432 y Edge 8788 permanecen intactos.' -ForegroundColor Cyan
if ($InstallDir.Equals($ReservedEdgeDir, [System.StringComparison]::OrdinalIgnoreCase) -or $InstallDir.StartsWith($ReservedEdgeDir + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'P14 jamás puede instalarse dentro de C:\ProgramData\VantixGC\Edge.'
}
if ($InstallDir -match '(?i)\\Edge(?:\\|$)') { throw 'Ruta de instalación rechazada por protección de Edge.' }

$ManifestPath = Join-Path $PackageRoot 'package-manifest.json'
$PayloadApp = Join-Path $PackageRoot 'payload\app'
$PayloadRuntime = Join-Path $PackageRoot 'payload\runtime'
$PayloadPostgres = Join-Path $PackageRoot 'payload\postgres'
$PayloadOps = Join-Path $PackageRoot 'payload\ops'
if (-not (Test-Path -LiteralPath $ManifestPath)) { throw 'Paquete P14 incompleto: falta package-manifest.json.' }
$Manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
if ([string]$Manifest.product -ne 'VantixGC Restaurant P14 Home Pilot') { throw 'Paquete P14 no reconocido.' }
if ([string]$Manifest.installationId -ne 'HOME-PILOT-01' -or [string]$Manifest.tenant -ne 'demo-restaurante') { throw 'Identidad del paquete P14 inválida.' }
if ([int]$Manifest.httpPort -ne 8791 -or [int]$Manifest.postgresPort -ne 55433 -or [int]$Manifest.productionEdgePort -ne 8788) { throw 'Puertos del paquete P14 inválidos.' }
if ([bool]$Manifest.productionEdgeTouched) { throw 'Paquete P14 inválido: declara modificación de Edge productivo.' }

$EnvFile = Join-Path $InstallDir '.env'
$Existing = Read-DotEnv $EnvFile
$Lan = Resolve-LanConfiguration $Existing

$PackagePrismaSchema = Join-Path $PayloadApp 'prisma\schema.prisma'
if (-not (Test-Path -LiteralPath $PackagePrismaSchema)) { throw 'Paquete P14 incompleto: falta prisma\schema.prisma.' }
$PackagePrismaSchemaHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PackagePrismaSchema).Hash.ToLowerInvariant()
$ExistingPrismaSchema = Join-Path $InstallDir 'app\prisma\schema.prisma'
$ExistingPrismaSchemaHash = $null
if (Test-Path -LiteralPath $ExistingPrismaSchema) {
  $ExistingPrismaSchemaHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ExistingPrismaSchema).Hash.ToLowerInvariant()
  if ($ExistingPrismaSchemaHash -ne $PackagePrismaSchemaHash) {
    throw 'Actualización P14 bloqueada: cambió prisma/schema.prisma. Se requiere una migración preservadora explícita.'
  }
}

foreach ($Directory in @($InstallDir, (Join-Path $InstallDir 'data'), (Join-Path $InstallDir 'logs'), (Join-Path $InstallDir 'backups'), (Join-Path $InstallDir 'secrets'))) {
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
}
Stop-P14ForUpgrade
Assert-PortFree 8791 'runtime HTTP local'
Assert-PortFree 55433 'PostgreSQL local'

foreach ($Name in @('app','runtime','postgres','ops')) {
  $Target = Join-Path $InstallDir $Name
  if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
}

Copy-Tree $PayloadApp (Join-Path $InstallDir 'app')
Copy-Tree $PayloadRuntime (Join-Path $InstallDir 'runtime')
Copy-Tree $PayloadPostgres (Join-Path $InstallDir 'postgres')
Copy-Tree $PayloadOps (Join-Path $InstallDir 'ops')
Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $InstallDir 'package-manifest.json') -Force

$DbPassword = if ($Existing['P14_DB_PASSWORD']) { [string]$Existing['P14_DB_PASSWORD'] } else { New-Secret 48 }
$JwtSecret = if ($Existing['P14_JWT_SECRET']) { [string]$Existing['P14_JWT_SECRET'] } else { New-Secret 64 }
$DatabaseUrl = "postgresql://vantix_p14:$DbPassword@127.0.0.1:55433/vantix_p14_home_pilot"
$EnvLines = @(
  'RESTAURANT_LOCAL_FIRST_P14_ENABLED=true',
  'P14_RUNTIME_ENABLED=true',
  'P14_TENANT_SUBDOMAIN=demo-restaurante',
  'P14_INSTALLATION_ID=HOME-PILOT-01',
  'P14_RELEASE_CHANNEL=PILOT',
  'P14_OPERATIONAL_MODE=LOCAL_FIRST',
  'P14_HTTP_PORT=8791',
  ('P14_LAN_ENABLED=' + ([string]$Lan.enabled).ToLowerInvariant()),
  ('P14_BIND_HOST=' + $Lan.bindHost),
  ('P14_ADVERTISE_HOST=' + $Lan.advertiseHost),
  ('P14_LAN_CIDR=' + $Lan.cidr),
  'P14_CORE_URL=https://core.vantixgc.com',
  'P14_SYNC_ENABLED=false',
  "P14_JWT_SECRET=$JwtSecret",
  "P14_DB_PASSWORD=$DbPassword",
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
$PgBin = Join-Path $InstallDir 'postgres\bin'
$PgData = Join-Path $InstallDir 'data\postgres'
$PgLog = Join-Path $InstallDir 'logs\postgres.log'
foreach ($Required in @($Node, (Join-Path $PgBin 'initdb.exe'), (Join-Path $PgBin 'pg_ctl.exe'), (Join-Path $PgBin 'createdb.exe'), (Join-Path $PgBin 'psql.exe'))) {
  if (-not (Test-Path -LiteralPath $Required)) { throw "Paquete P14 incompleto: falta $Required" }
}

$env:PGPASSWORD = $DbPassword
if (-not (Test-Path -LiteralPath (Join-Path $PgData 'PG_VERSION'))) {
  New-Item -ItemType Directory -Force -Path $PgData | Out-Null
  $PasswordFile = Join-Path $InstallDir 'secrets\pg-init-password.txt'
  $DbPassword | Set-Content -LiteralPath $PasswordFile -Encoding ASCII -NoNewline
  Protect-File $PasswordFile
  try {
    & (Join-Path $PgBin 'initdb.exe') -D $PgData -U vantix_p14 --pwfile=$PasswordFile --auth=scram-sha-256 --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'initdb P14 falló.' }
    $global:LASTEXITCODE = 0
  } finally {
    Remove-Item -LiteralPath $PasswordFile -Force -ErrorAction SilentlyContinue
  }
  @"

# VantixGC Restaurant P14 Home Pilot
listen_addresses = '127.0.0.1'
port = 55433
max_connections = 60
shared_buffers = 128MB
"@ | Add-Content -LiteralPath (Join-Path $PgData 'postgresql.conf') -Encoding ASCII
}

Set-P14PostgresNetworkConfig $PgData
Repair-PostgresAcl $PgData
if (-not (Test-PgReady $PgBin)) {
  Clear-StalePostmasterPid $PgBin $PgData
  & (Join-Path $PgBin 'pg_ctl.exe') -D $PgData -l $PgLog -w -t 30 start
  if ($LASTEXITCODE -ne 0) { throw "No fue posible iniciar PostgreSQL P14. Revisa $PgLog" }
  $global:LASTEXITCODE = 0
}
if (-not (Test-PgReady $PgBin)) { throw 'PostgreSQL P14 no respondió en 127.0.0.1:55433.' }

$DbExistsRaw = @(& (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p 55433 -U vantix_p14 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='vantix_p14_home_pilot'" 2>$null)
$DbExists = if ($DbExistsRaw.Count -gt 0 -and $null -ne $DbExistsRaw[0]) { ([string]$DbExistsRaw[0]).Trim() } else { '' }
if ($DbExists -ne '1') {
  & (Join-Path $PgBin 'createdb.exe') -h 127.0.0.1 -p 55433 -U vantix_p14 vantix_p14_home_pilot
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible crear vantix_p14_home_pilot.' }
  $global:LASTEXITCODE = 0
}

$env:RESTAURANT_LOCAL_FIRST_P14_ENABLED = 'true'
$env:P14_RUNTIME_ENABLED = 'true'
$env:P14_TENANT_SUBDOMAIN = 'demo-restaurante'
$env:P14_INSTALLATION_ID = 'HOME-PILOT-01'
$env:P14_RELEASE_CHANNEL = 'PILOT'
$env:P14_OPERATIONAL_MODE = 'LOCAL_FIRST'
$env:P14_HTTP_PORT = '8791'
$env:P14_LAN_ENABLED = ([string]$Lan.enabled).ToLowerInvariant()
$env:P14_BIND_HOST = $Lan.bindHost
$env:P14_ADVERTISE_HOST = $Lan.advertiseHost
$env:P14_LAN_CIDR = $Lan.cidr
$env:P14_CORE_URL = 'https://core.vantixgc.com'
$env:P14_SYNC_ENABLED = 'false'
$env:P14_JWT_SECRET = $JwtSecret
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
  if (-not (Test-Path -LiteralPath $PrismaCli)) { throw 'El paquete P14 no contiene Prisma CLI.' }

  $TenantTableExists = [int](Invoke-P14PsqlScalar $PgBin 'vantix_p14_home_pilot' 'SELECT CASE WHEN to_regclass(''"Tenant"'') IS NULL THEN 0 ELSE 1 END;')
  if ($TenantTableExists -eq 1 -and -not $ExistingPrismaSchemaHash) {
    throw 'Base P14 existente sin huella de esquema instalada. Actualización cancelada.'
  }

  if ($TenantTableExists -eq 0) {
    & $Node $PrismaCli db push
    if ($LASTEXITCODE -ne 0) { throw 'Prisma db push P14 falló durante la instalación inicial.' }
    $global:LASTEXITCODE = 0
  } else {
    Write-Host 'P14: esquema existente reconocido; db push omitido para preservar la base.' -ForegroundColor Cyan
  }

  $TenantCount = [int](Invoke-P14PsqlScalar $PgBin 'vantix_p14_home_pilot' 'SELECT count(*) FROM "Tenant";')
  if ($TenantCount -eq 0) {
    $FreshBootstrap = $true
    if (-not $AdminPassword) { $AdminPassword = 'P14-' + (New-Secret 20) }
    if ($AdminPassword.Length -lt 12) { throw 'AdminPassword debe tener al menos 12 caracteres.' }
    $env:P14_ADMIN_PASSWORD = $AdminPassword
    & $Node (Join-Path $AppDir 'lab\restaurant-p14\bootstrap-demo.js')
    if ($LASTEXITCODE -ne 0) { throw 'Bootstrap demo P14 falló.' }
    $global:LASTEXITCODE = 0
  } else {
    $WrongTenant = [int](Invoke-P14PsqlScalar $PgBin 'vantix_p14_home_pilot' 'SELECT count(*) FROM "Tenant" WHERE subdomain <> ''demo-restaurante'';')
    if ($WrongTenant -ne 0 -or $TenantCount -ne 1) { throw 'La base local no cumple el aislamiento single-tenant demo-restaurante.' }
  }
} finally {
  Pop-Location
  Remove-Item Env:P14_ADMIN_PASSWORD -ErrorAction SilentlyContinue
}

Configure-P14Firewall $Lan

if (-not $NoStartupTasks) {
  $StartScript = Join-Path $InstallDir 'ops\start-p14-windows.ps1'
  $WatchdogScript = Join-Path $InstallDir 'ops\watchdog-p14-windows.ps1'

  $Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $StartScript + '" -InstallDir "' + $InstallDir + '"') -WorkingDirectory $InstallDir
  $StartTrigger = New-ScheduledTaskTrigger -AtStartup
  $Settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $StartTrigger -Settings $Settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

  $WatchdogAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $WatchdogScript + '" -InstallDir "' + $InstallDir + '" -TaskName "' + $TaskName + '"') -WorkingDirectory $InstallDir
  $WatchdogStartup = New-ScheduledTaskTrigger -AtStartup
  $WatchdogRecurring = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
  $WatchdogSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $WatchdogTaskName -Action $WatchdogAction -Trigger @($WatchdogStartup, $WatchdogRecurring) -Settings $WatchdogSettings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

  Enable-ScheduledTask -TaskName $TaskName | Out-Null
  Enable-ScheduledTask -TaskName $WatchdogTaskName | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  if (-not (Wait-P14Health 90)) {
    throw "P14 se instaló, pero el runtime no respondió. Revisa $(Join-Path $InstallDir 'logs\runtime.log')."
  }
  Start-ScheduledTask -TaskName $WatchdogTaskName
}

if (-not $NoShortcut) {
  try {
    $Desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
    $Shortcut = Join-Path $Desktop 'VantixGC Restaurante P14 Piloto.url'
    @"
[InternetShortcut]
URL=http://$($Lan.advertiseHost):8791/app/centro-de-control-v2
"@ | Set-Content -LiteralPath $Shortcut -Encoding ASCII
  } catch {
    Write-Warning "No se pudo crear el acceso directo: $($_.Exception.Message)"
  }
}

$State = [ordered]@{
  product = 'VantixGC Restaurant P14 Home Pilot'
  packageVersion = [string]$Manifest.packageVersion
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
  installDir = $InstallDir
  tenant = 'demo-restaurante'
  installationId = 'HOME-PILOT-01'
  releaseChannel = 'PILOT'
  operationalMode = 'LOCAL_FIRST'
  localUrl = "http://$($Lan.advertiseHost):8791"
  lanEnabled = [bool]$Lan.enabled
  lanCidr = [string]$Lan.cidr
  httpPort = 8791
  postgresPort = 55433
  prismaSchemaSha256 = $PackagePrismaSchemaHash
  edgeProductionUntouched = $true
  startupTasks = (-not $NoStartupTasks)
  firewallConfigured = ([bool]$Lan.enabled -and -not $NoFirewall)
  syncEnabled = $false
  operationalMutations = 'LOCKED_P14_1B'
}
$StatePath = Join-Path $InstallDir 'install-state.json'
$State | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $StatePath -Encoding UTF8
Protect-File $StatePath

Write-Host ''
Write-Host 'VantixGC Restaurante P14 Home Pilot instalado.' -ForegroundColor Green
Write-Host "URL local: http://$($Lan.advertiseHost):8791/app/centro-de-control-v2"
Write-Host 'Usuario: admin@demo-restaurante.vantixgc.com'
if ($FreshBootstrap) { Write-Host "Clave piloto: $AdminPassword" -ForegroundColor Yellow }
else { Write-Host 'La clave ADMIN local existente se conservó.' }
Write-Host 'PostgreSQL local: 127.0.0.1:55433 / vantix_p14_home_pilot'
if ($Lan.enabled) { Write-Host "LAN autorizada: $($Lan.cidr)" }
else { Write-Host 'LAN desactivada: acceso solamente desde este PC.' }
Write-Host 'Operaciones bloqueadas en P14-1B; QR y sincronización siguen en Super Core.' -ForegroundColor Cyan
Write-Host 'Edge productivo 8788 no fue modificado.' -ForegroundColor Cyan
