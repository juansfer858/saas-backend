param()
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Installer = Join-Path $Root 'lab\restaurant-p15\windows\install-p15-windows.ps1'
$BackupAgent = Join-Path $Root 'lab\restaurant-p15\backup-agent.js'
if (-not (Test-Path -LiteralPath $Installer)) { throw "No existe $Installer" }
if (-not (Test-Path -LiteralPath $BackupAgent)) { throw "No existe $BackupAgent" }
$content = Get-Content -LiteralPath $Installer -Raw

$oldProtect = @'
function Protect-Secret([string]$Path) {
  & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
  $global:LASTEXITCODE = 0
}
'@
$newProtect = @'
function Protect-Secret([string]$Path) {
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $currentGrant = ('*{0}:(F)' -f $currentSid)
  & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' $currentGrant | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "No fue posible proteger $Path" }
  $global:LASTEXITCODE = 0
}
'@
if ($content.Contains($oldProtect)) {
  $content = $content.Replace($oldProtect, $newProtect)
} elseif ($content -notmatch 'currentSid = \[Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)\.User\.Value') {
  throw 'No se encontró Protect-Secret esperado y tampoco está aplicada la corrección de SID.'
}

$oldWrite = @'
  Set-Content -LiteralPath $xml -Value $content -Encoding UTF8
  return $exe
}
'@
$newWrite = @'
  Set-Content -LiteralPath $xml -Value $content -Encoding UTF8
  Protect-Secret $xml
  return $exe
}
'@
if ($content.Contains($oldWrite)) {
  $content = $content.Replace($oldWrite, $newWrite)
} elseif ($content -notmatch 'Protect-Secret \$xml') {
  throw 'No se pudo endurecer ACL del XML WinSW.'
}

$oldPush = @'
Push-Location $AppDir
try {
  & $node $prismaCli db push
'@
$newPush = @'
Push-Location $AppDir
try {
  & $node $prismaCli generate
  if ($LASTEXITCODE -ne 0) { throw 'Prisma generate P15 falló.' }
  $global:LASTEXITCODE = 0
  & $node $prismaCli db push
'@
if ($content.Contains($oldPush)) {
  $content = $content.Replace($oldPush, $newPush)
} elseif ($content -notmatch '\$node \$prismaCli generate') {
  throw 'No se pudo agregar Prisma generate al instalador P15.'
}

$printPortLine = '  "P15_PRINT_PORT=$PrintPort",'
$printTokenLine = '  "P15_PRINT_TOKEN=$printToken",'
if ($content.Contains($printPortLine) -and -not $content.Contains($printTokenLine)) {
  $content = $content.Replace($printPortLine, "$printPortLine`r`n$printTokenLine")
}
if (-not $content.Contains($printTokenLine)) { throw 'No se pudo agregar P15_PRINT_TOKEN al runtime local.' }

$upgradeAnchor = @'
foreach ($directory in @($InstallDir, $ConfigDir, $SecretsDir, $LogsDir, $BackupDir, $ServicesDir, $FilesDir, (Join-Path $InstallDir 'data'))) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
Copy-Tree (Join-Path $Payload 'app') $AppDir
'@
$upgradeReplacement = @'
foreach ($directory in @($InstallDir, $ConfigDir, $SecretsDir, $LogsDir, $BackupDir, $ServicesDir, $FilesDir, (Join-Path $InstallDir 'data'))) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
# Reinstalación/upgrade P15: detener sólo servicios propios antes de reemplazar binarios.
foreach ($serviceId in @($BackupServiceId, $PrintServiceId, $ServerServiceId)) {
  $serviceExe = Join-Path $ServicesDir "$serviceId.exe"
  if (Test-Path -LiteralPath $serviceExe) {
    try { & $serviceExe stop 2>$null | Out-Null } catch {}
    $global:LASTEXITCODE = 0
  }
}
try { Stop-Service -Name $PgService -Force -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Milliseconds 500
Copy-Tree (Join-Path $Payload 'app') $AppDir
'@
if ($content.Contains($upgradeAnchor)) {
  $content = $content.Replace($upgradeAnchor, $upgradeReplacement)
} elseif ($content -notmatch 'Reinstalación/upgrade P15') {
  throw 'No se pudo agregar frontera segura de upgrade P15.'
}

$oldWait = "if (-not `$NoServices -and -not (Wait-Tcp `$HttpPort 90)) { throw 'Servidor P15 no inició en 8815.' }"
$newWait = @'
if (-not $NoServices -and -not (Wait-Tcp $HttpPort 90)) {
  Write-Host '=== P15 SERVER STARTUP DIAGNOSTICS ===' -ForegroundColor Yellow
  try { Get-Service -Name $ServerServiceId -ErrorAction SilentlyContinue | Format-List * | Out-String | Write-Host } catch {}
  try {
    $winService = Get-CimInstance Win32_Service -Filter ("Name='{0}'" -f $ServerServiceId) -ErrorAction SilentlyContinue
    if ($winService) { $winService | Select-Object Name,State,Status,ExitCode,ProcessId,PathName,StartName | Format-List | Out-String | Write-Host }
  } catch {}
  try {
    Get-ChildItem -LiteralPath $LogsDir -File -ErrorAction SilentlyContinue | ForEach-Object {
      Write-Host ("--- LOG {0} ---" -f $_.FullName)
      Get-Content -LiteralPath $_.FullName -Tail 200 -ErrorAction SilentlyContinue | Write-Host
    }
  } catch {}
  try {
    $xmlPath = Join-Path $ServicesDir "$ServerServiceId.xml"
    if (Test-Path -LiteralPath $xmlPath) {
      Write-Host '--- SERVER XML REDACTED ---'
      $xmlText = Get-Content -LiteralPath $xmlPath -Raw
      $xmlText = [regex]::Replace($xmlText, '(?i)(name="(?:P15_JWT_SECRET|DATABASE_URL|P15_BACKUP_SECRET|P15_PRINT_TOKEN)" value=")[^"]+', '$1***')
      Write-Host $xmlText
    }
  } catch {}
  throw 'Servidor P15 no inició en 8815.'
}
'@
if ($content.Contains($oldWait)) {
  $content = $content.Replace($oldWait, $newWait)
} elseif ($content -notmatch 'P15 SERVER STARTUP DIAGNOSTICS') {
  throw 'No se pudo instalar diagnóstico de arranque P15.'
}

Set-Content -LiteralPath $Installer -Value $content -Encoding UTF8
$tokens = $null
$errors = $null
[Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) { throw "Instalador P15 inválido después de preparar fuente: $($errors[0].Message)" }

$backupContent = Get-Content -LiteralPath $BackupAgent -Raw
$oldTimer = "  await runOnce(); const timer=setInterval(runOnce,intervalMs); timer.unref?.(); console.log(``P15_BACKUP_AGENT_READY intervalMs=`${intervalMs}``);`r`n  await new Promise(()=>{});"
$newTimer = "  await runOnce(); setInterval(runOnce,intervalMs); console.log(``P15_BACKUP_AGENT_READY intervalMs=`${intervalMs}``);`r`n  await new Promise(()=>{});"
if ($backupContent.Contains($oldTimer)) {
  $backupContent = $backupContent.Replace($oldTimer, $newTimer)
} elseif ($backupContent -match 'timer\.unref') {
  throw 'No se pudo corregir el temporizador persistente del backup agent.'
}
Set-Content -LiteralPath $BackupAgent -Value $backupContent -Encoding UTF8
& node.exe --check $BackupAgent
if ($LASTEXITCODE -ne 0) { throw 'backup-agent.js quedó inválido después de preparar fuente.' }
$global:LASTEXITCODE = 0

Write-Host 'P15_WINDOWS_SOURCE_PREPARED_OK'
