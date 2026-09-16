param()
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Installer = Join-Path $Root 'lab\restaurant-p15\windows\install-p15-windows.ps1'
if (-not (Test-Path -LiteralPath $Installer)) { throw "No existe $Installer" }
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

Set-Content -LiteralPath $Installer -Value $content -Encoding UTF8
$tokens = $null
$errors = $null
[Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) { throw "Instalador P15 inválido después de preparar fuente: $($errors[0].Message)" }
Write-Host 'P15_WINDOWS_SOURCE_PREPARED_OK'
