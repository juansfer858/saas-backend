param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [string]$InstallDir='C:\ProgramData\VantixGC\Restaurant-P15-Lab',
  [string]$RecoveryKey=''
)
$ErrorActionPreference='Stop'
$Server='VantixRestaurantP15Server';$Backup='VantixRestaurantP15Backup';$Print='VantixRestaurantP15Print'
$ServicesDir=Join-Path $InstallDir 'services';$EnvFile=Join-Path $InstallDir 'config\.env';$Node=Join-Path $InstallDir 'runtime\node.exe';$Restore=Join-Path $InstallDir 'app\lab\restaurant-p15\restore.js';$KeyFile=Join-Path $InstallDir 'secrets\backup-key.txt'
function Assert-Admin{$id=[Security.Principal.WindowsIdentity]::GetCurrent();$p=New-Object Security.Principal.WindowsPrincipal($id);if(-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Ejecuta la restauración como Administrador.'}}
function Import-Env([string]$Path){Get-Content $Path|ForEach-Object{if($_ -match '^([^#][^=]*)=(.*)$'){[Environment]::SetEnvironmentVariable($matches[1].Trim(),$matches[2],'Process')}}}
Assert-Admin
if(-not(Test-Path $Archive)){throw "No existe el backup: $Archive"};if(-not(Test-Path $EnvFile)){throw 'P15 no está instalado.'};Import-Env $EnvFile
if(-not $RecoveryKey){if(Test-Path $KeyFile){$RecoveryKey=(Get-Content $KeyFile -Raw).Trim()}};if($RecoveryKey.Length -lt 24){throw 'RecoveryKey requerida para descifrar el backup.'}
foreach($id in @($Backup,$Print,$Server)){$exe=Join-Path $ServicesDir "$id.exe";if(Test-Path $exe){& $exe stop 2>$null|Out-Null;$global:LASTEXITCODE=0}}
$env:P15_BACKUP_SECRET=$RecoveryKey
try{& $Node $Restore --archive $Archive --secret $RecoveryKey --installDir $InstallDir;if($LASTEXITCODE){throw 'Restore P15 falló.'}}finally{Remove-Item Env:P15_BACKUP_SECRET -ErrorAction SilentlyContinue}
foreach($id in @($Server,$Print,$Backup)){$exe=Join-Path $ServicesDir "$id.exe";if(Test-Path $exe){& $exe start;if($LASTEXITCODE){throw "No inició $id después del restore."}}}
for($i=0;$i -lt 90;$i++){try{$r=Invoke-RestMethod 'http://127.0.0.1:8815/__p15/status' -TimeoutSec 2;if($r.ok){Write-Host 'P15 RESTAURADO Y OPERATIVO.' -ForegroundColor Green;exit 0}}catch{};Start-Sleep 1}
throw 'Restore completó pero P15 no respondió en 8815.'
