param(
  [string]$InstallDir='C:\ProgramData\VantixGC\Restaurant-P15-Lab',
  [switch]$PurgeData
)
$ErrorActionPreference='Stop'
$PgService='VantixGC Restaurant P15 PostgreSQL'
$ServiceIds=@('VantixRestaurantP15Backup','VantixRestaurantP15Print','VantixRestaurantP15Server')
$ServicesDir=Join-Path $InstallDir 'services';$PgCtl=Join-Path $InstallDir 'postgres\bin\pg_ctl.exe'
function Assert-Admin{$id=[Security.Principal.WindowsIdentity]::GetCurrent();$p=New-Object Security.Principal.WindowsPrincipal($id);if(-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Ejecuta como Administrador.'}}
Assert-Admin
foreach($id in $ServiceIds){$exe=Join-Path $ServicesDir "$id.exe";if(Test-Path $exe){& $exe stop 2>$null|Out-Null;& $exe uninstall 2>$null|Out-Null;$global:LASTEXITCODE=0}}
try{Stop-Service -Name $PgService -Force -ErrorAction SilentlyContinue}catch{}
if(Test-Path $PgCtl){& $PgCtl unregister -N $PgService 2>$null|Out-Null;$global:LASTEXITCODE=0}
Get-NetFirewallRule -DisplayName 'VantixGC Restaurant P15 LAN 8815' -ErrorAction SilentlyContinue|Remove-NetFirewallRule -ErrorAction SilentlyContinue
if($PurgeData){Remove-Item $InstallDir -Recurse -Force;Write-Host 'P15 eliminado incluyendo datos.' -ForegroundColor Yellow;exit 0}
$preserve=Join-Path (Split-Path $InstallDir -Parent) ('Restaurant-P15-Lab-Preserved-'+(Get-Date -Format 'yyyyMMdd-HHmmss'));New-Item -ItemType Directory -Force -Path $preserve|Out-Null
foreach($name in @('data','backups','config','secrets','files','logs')){$src=Join-Path $InstallDir $name;if(Test-Path $src){Move-Item $src (Join-Path $preserve $name) -Force}}
Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "P15 desinstalado. Datos preservados en: $preserve" -ForegroundColor Green
