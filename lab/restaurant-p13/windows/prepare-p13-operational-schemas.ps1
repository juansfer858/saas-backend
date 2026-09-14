param(
  [string]$InstallDir = "C:\ProgramData\VantixGC\Restaurant-P13"
)

$ErrorActionPreference = 'Stop'
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$EnvFile = Join-Path $InstallDir '.env'
$AppDir = Join-Path $InstallDir 'app'
$PgBin = Join-Path $InstallDir 'postgres\bin'
$SqlDir = Join-Path $AppDir 'lab\restaurant-p13\sql'
$SecretsDir = Join-Path $InstallDir 'secrets'

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

function Protect-File([string]$Path) {
  try {
    & icacls.exe $Path /inheritance:r | Out-Null
    & icacls.exe $Path /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
    $global:LASTEXITCODE = 0
  } catch {
    Write-Warning "No se pudo endurecer ACL de $Path: $($_.Exception.Message)"
  }
}

function Invoke-P13Scalar([string]$Database, [string]$Sql) {
  $SqlFile = Join-Path $env:TEMP ('vantix-p13-schema-' + [guid]::NewGuid().ToString('N') + '.sql')
  try {
    $Sql | Set-Content -LiteralPath $SqlFile -Encoding ASCII
    $Rows = @(& (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p 55432 -U vantix_p13 -d $Database -tA -q -v ON_ERROR_STOP=1 -f $SqlFile)
    if ($LASTEXITCODE -ne 0) { throw "Consulta PostgreSQL P13 falló para $Database." }
    if ($Rows.Count -eq 0 -or $null -eq $Rows[0]) { throw "Consulta PostgreSQL P13 no devolvió resultado para $Database." }
    $global:LASTEXITCODE = 0
    return ([string]$Rows[0]).Trim()
  } finally {
    Remove-Item -LiteralPath $SqlFile -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-P13SqlFile([string]$Name) {
  $Path = Join-Path $SqlDir $Name
  if (-not (Test-Path -LiteralPath $Path)) { throw "Falta SQL P13 requerido: $Name" }
  & (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p 55432 -U vantix_p13 -d vantix_p13_lab -q -v ON_ERROR_STOP=1 -f $Path
  if ($LASTEXITCODE -ne 0) { throw "No fue posible aplicar SQL P13: $Name" }
  $global:LASTEXITCODE = 0
  Write-Host "P13: SQL operativo aplicado · $Name"
}

function New-P13Fingerprint {
  $Bytes = New-Object byte[] 32
  $Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $Rng.GetBytes($Bytes) } finally { $Rng.Dispose() }
  return -join ($Bytes | ForEach-Object { $_.ToString('x2') })
}

Import-DotEnv $EnvFile
if (-not $env:P13_DB_PASSWORD) { throw 'P13_DB_PASSWORD no está disponible.' }
$env:PGPASSWORD = $env:P13_DB_PASSWORD

foreach ($Required in @(
  (Join-Path $PgBin 'psql.exe'),
  (Join-Path $PgBin 'pg_isready.exe'),
  (Join-Path $SqlDir '001-p13-sync.sql'),
  (Join-Path $SqlDir '007-p13-e5-cash-reprint.sql')
)) {
  if (-not (Test-Path -LiteralPath $Required)) { throw "P13 incompleto: falta $Required" }
}

& (Join-Path $PgBin 'pg_isready.exe') -h 127.0.0.1 -p 55432 -d vantix_p13_lab -q
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL P13 no está listo para preparar el esquema operativo.' }
$global:LASTEXITCODE = 0

$TenantCount = [int](Invoke-P13Scalar 'vantix_p13_lab' 'SELECT count(*) FROM "Tenant";')
$WrongTenant = [int](Invoke-P13Scalar 'vantix_p13_lab' 'SELECT count(*) FROM "Tenant" WHERE subdomain <> ''demo-restaurante'';')
if ($TenantCount -ne 1 -or $WrongTenant -ne 0) { throw 'P13 bloqueado: la base local no es single-tenant demo-restaurante.' }

Invoke-P13SqlFile '001-p13-sync.sql'
Invoke-P13SqlFile '002-p13-recovery.sql'

$TenantId = Invoke-P13Scalar 'vantix_p13_lab' 'SELECT id FROM "Tenant" WHERE subdomain=''demo-restaurante'';'
$SafeTenantId = $TenantId.Replace("'", "''")
$ActiveCount = [int](Invoke-P13Scalar 'vantix_p13_lab' ("SELECT count(*) FROM p13_installation_identity WHERE tenant_id='{0}' AND revoked_at IS NULL;" -f $SafeTenantId))
if ($ActiveCount -gt 1) { throw 'P13 bloqueado: existe más de una identidad de instalación activa.' }

if ($ActiveCount -eq 0) {
  $InstallationId = 'installation-p13-win-' + [guid]::NewGuid().ToString('N')
  $Fingerprint = New-P13Fingerprint
  $Created = Invoke-P13Scalar 'vantix_p13_lab' @"
WITH created AS (
  INSERT INTO p13_installation_identity(installation_id, tenant_id, public_key_sha256, last_seen_at)
  VALUES ('$InstallationId', '$SafeTenantId', '$Fingerprint', NOW())
  RETURNING installation_id
)
SELECT installation_id FROM created;
"@
  if ($Created -ne $InstallationId) { throw 'No fue posible crear la identidad local P13.' }
} else {
  $InstallationId = Invoke-P13Scalar 'vantix_p13_lab' ("SELECT installation_id FROM p13_installation_identity WHERE tenant_id='{0}' AND revoked_at IS NULL LIMIT 1;" -f $SafeTenantId)
  $Fingerprint = Invoke-P13Scalar 'vantix_p13_lab' ("SELECT public_key_sha256 FROM p13_installation_identity WHERE tenant_id='{0}' AND revoked_at IS NULL LIMIT 1;" -f $SafeTenantId)
}

New-Item -ItemType Directory -Force -Path $SecretsDir | Out-Null
$IdentityFile = Join-Path $SecretsDir 'installation-identity.json'
if (-not (Test-Path -LiteralPath $IdentityFile)) {
  [ordered]@{
    installationId = $InstallationId
    tenantId = $TenantId
    tenantSubdomain = 'demo-restaurante'
    publicKeySha256 = $Fingerprint
    pilot = $true
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $IdentityFile -Encoding UTF8
  Protect-File $IdentityFile
}

foreach ($Name in @(
  '003-p13-e1-identity-outbox.sql',
  '004-p13-e2-table-visit-outbox.sql',
  '005-p13-e3-order-person-outbox.sql',
  '006-p13-e4-kds-print-queue.sql',
  '007-p13-e5-cash-reprint.sql'
)) {
  Invoke-P13SqlFile $Name
}

$Ready = Invoke-P13Scalar 'vantix_p13_lab' @'
SELECT CASE WHEN
  to_regclass('public.p13_sync_outbox') IS NOT NULL AND
  to_regclass('public.p13_recovery_history') IS NOT NULL AND
  to_regclass('public.p13_entity_version') IS NOT NULL AND
  to_regclass('public.p13_local_print_queue') IS NOT NULL AND
  to_regclass('public.p13_local_receipt_reprint_queue') IS NOT NULL AND
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='p13_e2_table_update' AND NOT tgisinternal) AND
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='p13_e3_order_insert' AND NOT tgisinternal) AND
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='p13_e4_command_print_queue' AND NOT tgisinternal)
THEN 'READY' ELSE 'MISSING' END;
'@
if ($Ready -ne 'READY') { throw 'P13 operativo incompleto: faltan tablas o triggers 001-007.' }

Write-Host "P13_WINDOWS_OPERATIONAL_SCHEMA_001_007_OK installation=$InstallationId" -ForegroundColor Green
