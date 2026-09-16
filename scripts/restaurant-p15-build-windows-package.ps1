param(
  [string]$OutDir='artifacts\p15-windows'
)
$ErrorActionPreference='Stop'
if(-not $IsWindows){throw 'P15 Windows package debe construirse en Windows.'}
$Root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$OutDir=[IO.Path]::GetFullPath((Join-Path $Root $OutDir))
$Stage=Join-Path $OutDir 'vantixgc-restaurant-p15-standalone-lab'
$Zip=Join-Path $OutDir 'vantixgc-restaurant-p15-standalone-lab.zip'
function Copy-Tree([string]$Source,[string]$Destination){if(-not(Test-Path $Source)){throw "Falta $Source"};New-Item -ItemType Directory -Force -Path $Destination|Out-Null;& robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP|Out-Null;if($LASTEXITCODE -gt 7){throw "Robocopy falló: $Source"};$global:LASTEXITCODE=0}
function Find-PgRoot{if($env:P15_POSTGRES_ROOT -and (Test-Path (Join-Path $env:P15_POSTGRES_ROOT 'bin\postgres.exe'))){return [IO.Path]::GetFullPath($env:P15_POSTGRES_ROOT)};$cmd=Get-Command pg_ctl.exe -ErrorAction SilentlyContinue;if($cmd){$c=Split-Path -Parent (Split-Path -Parent $cmd.Source);if(Test-Path (Join-Path $c 'bin\postgres.exe')){return $c}};$base=Join-Path $env:ProgramFiles 'PostgreSQL';if(Test-Path $base){foreach($d in (Get-ChildItem $base -Directory|Sort-Object Name -Descending)){if(Test-Path (Join-Path $d.FullName 'bin\postgres.exe')){return $d.FullName}}};throw 'No se encontró PostgreSQL Windows.'}
Remove-Item $OutDir -Recurse -Force -ErrorAction SilentlyContinue
foreach($d in @($Stage,(Join-Path $Stage 'payload\app'),(Join-Path $Stage 'payload\runtime'),(Join-Path $Stage 'payload\postgres'),(Join-Path $Stage 'payload\winsw'),(Join-Path $Stage 'lab\restaurant-p15\windows'))){New-Item -ItemType Directory -Force -Path $d|Out-Null}
$App=Join-Path $Stage 'payload\app'
foreach($dir in @('src','prisma','scripts','lab\restaurant-p15','edge\print-spooler')){Copy-Tree (Join-Path $Root $dir) (Join-Path $App $dir)}
foreach($file in @('package.json','package-lock.json','prisma.config.ts')){Copy-Item (Join-Path $Root $file) (Join-Path $App $file) -Force}
Copy-Tree (Join-Path $Root 'node_modules') (Join-Path $App 'node_modules')
$NodeSource=(Get-Command node.exe -ErrorAction Stop).Source;$BundledNode=Join-Path $Stage 'payload\runtime\node.exe';Copy-Item $NodeSource $BundledNode -Force
Push-Location $App;try{& $BundledNode -e "require('./lab/restaurant-p15/runtime-config');require('./lab/restaurant-p15/runtime');require('./lab/restaurant-p15/backup-agent');require('./lab/restaurant-p15/restore');console.log('P15_MODULE_LOAD_OK')";if($LASTEXITCODE){throw 'Carga de módulos P15 falló.'}}finally{Pop-Location}
$PgRoot=Find-PgRoot;foreach($dir in @('bin','lib','share')){Copy-Tree (Join-Path $PgRoot $dir) (Join-Path $Stage "payload\postgres\$dir")}
$WinSw=Join-Path $Stage 'payload\winsw\WinSW.exe';Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe' -OutFile $WinSw;if((Get-Item $WinSw).Length -lt 1000000){throw 'Descarga WinSW inválida.'}
$WindowsSource=Join-Path $Root 'lab\restaurant-p15\windows';foreach($file in @('install-p15-windows.ps1','uninstall-p15-windows.ps1','restore-p15-windows.ps1')){Copy-Item (Join-Path $WindowsSource $file) (Join-Path $Stage "lab\restaurant-p15\windows\$file") -Force}
$wrapper=@'
param(
 [string]$InstallDir='C:\ProgramData\VantixGC\Restaurant-P15-Lab',
 [string]$AdminPassword='',
 [switch]$SoloEstePc,
 [string]$BackupUploadUrl='',
 [string]$BackupUploadToken=''
)
$ErrorActionPreference='Stop'
$installer=Join-Path $PSScriptRoot 'lab\restaurant-p15\windows\install-p15-windows.ps1'
& $installer -InstallDir $InstallDir -AdminPassword $AdminPassword -EnableLan:(-not $SoloEstePc) -BackupUploadUrl $BackupUploadUrl -BackupUploadToken $BackupUploadToken
exit $LASTEXITCODE
'@
$wrapper|Set-Content (Join-Path $Stage 'INSTALAR_P15.ps1') -Encoding UTF8
'@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_P15.ps1"
pause
'|Set-Content (Join-Path $Stage 'INSTALAR_P15_COMO_ADMIN.bat') -Encoding ASCII
'@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_P15.ps1" -SoloEstePc
pause
'|Set-Content (Join-Path $Stage 'INSTALAR_P15_SOLO_ESTE_PC.bat') -Encoding ASCII
$uninstall=@'
param([switch]$PurgeData)
$script='C:\ProgramData\VantixGC\Restaurant-P15-Lab\app\lab\restaurant-p15\windows\uninstall-p15-windows.ps1'
if(-not(Test-Path $script)){throw 'No se encontró P15 instalado.'}
& $script -PurgeData:$PurgeData
'@
$uninstall|Set-Content (Join-Path $Stage 'DESINSTALAR_P15.ps1') -Encoding UTF8
$restore=@'
param([Parameter(Mandatory=$true)][string]$Archive,[string]$RecoveryKey='')
$script='C:\ProgramData\VantixGC\Restaurant-P15-Lab\app\lab\restaurant-p15\windows\restore-p15-windows.ps1'
if(-not(Test-Path $script)){throw 'Instala P15 antes de restaurar.'}
& $script -Archive $Archive -RecoveryKey $RecoveryKey
'@
$restore|Set-Content (Join-Path $Stage 'RESTAURAR_P15.ps1') -Encoding UTF8
$manifest=[ordered]@{product='VantixGC Restaurant P15 Standalone Lab';version='p15-standalone-lab.1';builtAt=(Get-Date).ToUniversalTime().ToString('o');httpPort=8815;postgresPort=55435;database='vantix_restaurant_p15_lab';printPort=18815;installDir='C:\ProgramData\VantixGC\Restaurant-P15-Lab';installationId='HOME-PILOT-P15';tenant='demo-restaurante';authority='LOCAL_PRIMARY';windowsServices=@('VantixGC Restaurant P15 PostgreSQL','VantixRestaurantP15Server','VantixRestaurantP15Print','VantixRestaurantP15Backup');reserved=@{edge=8788;p13Http=8790;p13Pg=55432;p14Http=8791;p14Pg=55433};productionTouched=$false;winsw='v2.12.0';node=(& $NodeSource --version).Trim();postgres=(& (Join-Path $PgRoot 'bin\postgres.exe') --version).Trim()};$manifest|ConvertTo-Json -Depth 8|Set-Content (Join-Path $Stage 'package-manifest.json') -Encoding UTF8
$readme=@'
VANTIXGC RESTAURANTE P15 - STANDALONE LAB
NO INSTALAR TODAVÍA EN RESTAURANTES PRODUCTIVOS.

1. Extraiga completamente el ZIP.
2. Ejecute INSTALAR_P15_COMO_ADMIN.bat como Administrador.
3. P15 instala PostgreSQL + Server + Print + Backup como servicios Windows reales.
4. HTTP: 8815. PostgreSQL: 55435. Print: 18815.
5. P15 no usa Task Scheduler ni watchdog para mantener vivo el servidor.
6. En primera instalación se muestra una contraseña LAB y Recovery key. Guárdelas.
7. Todos los módulos internos funcionan contra la base local. Internet no participa en operaciones.
8. Backup cifrado queda en C:\ProgramData\VantixGC\Restaurant-P15-Lab\backups y puede subir a un endpoint HTTPS si se configura.
9. Edge 8788, P13 8790/55432, P14 8791/55433 y producción no se modifican.
'@;$readme|Set-Content (Join-Path $Stage 'LEEME_PRIMERO.txt') -Encoding UTF8
foreach($script in @((Join-Path $Stage 'INSTALAR_P15.ps1'),(Join-Path $Stage 'DESINSTALAR_P15.ps1'),(Join-Path $Stage 'RESTAURAR_P15.ps1'),(Join-Path $Stage 'lab\restaurant-p15\windows\install-p15-windows.ps1'),(Join-Path $Stage 'lab\restaurant-p15\windows\uninstall-p15-windows.ps1'),(Join-Path $Stage 'lab\restaurant-p15\windows\restore-p15-windows.ps1')){$tokens=$null;$errors=$null;[Management.Automation.Language.Parser]::ParseFile($script,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){throw "PowerShell inválido: $script :: $($errors[0].Message)"}}
if(Test-Path $Zip){Remove-Item $Zip -Force};Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Zip -CompressionLevel Optimal
$hash=(Get-FileHash $Zip -Algorithm SHA256).Hash.ToLowerInvariant();$size=(Get-Item $Zip).Length
Write-Host (ConvertTo-Json ([ordered]@{ok=$true;phase='P15-WINDOWS-PACKAGE';zip=$Zip;sha256=$hash;bytes=$size;productionUntouched=$true}) -Compress)
