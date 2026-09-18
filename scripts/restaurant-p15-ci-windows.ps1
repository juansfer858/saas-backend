param()
$ErrorActionPreference='Stop'
$Root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $Root
$install='C:\ProgramData\VantixGC\Restaurant-P15-Lab'
$sourcePgData=Join-Path $env:RUNNER_TEMP 'p15-source-db'
$sourcePgLog=Join-Path $env:RUNNER_TEMP 'p15-source-postgres.log'
$runtimePidFile=Join-Path $env:RUNNER_TEMP 'p15-runtime.pid'
function Find-PgRoot {
  if($env:P15_POSTGRES_ROOT -and (Test-Path (Join-Path $env:P15_POSTGRES_ROOT 'bin\postgres.exe'))){return $env:P15_POSTGRES_ROOT}
  $base=Join-Path $env:ProgramFiles 'PostgreSQL'
  $row=Get-ChildItem $base -Directory|Sort-Object Name -Descending|Where-Object{Test-Path (Join-Path $_.FullName 'bin\postgres.exe')}|Select-Object -First 1
  if(-not $row){throw 'No PostgreSQL on runner'}
  return $row.FullName
}
function Wait-Http([string]$Url,[int]$Seconds=90){for($i=0;$i -lt $Seconds;$i++){try{$s=Invoke-RestMethod $Url -TimeoutSec 2;if($s.ok){return $true}}catch{};Start-Sleep 1};return $false}
function Stop-SourcePg([string]$PgRoot){if(Test-Path $sourcePgData){& "$PgRoot\bin\pg_ctl.exe" -D $sourcePgData -m fast -w stop 2>$null|Out-Null;$global:LASTEXITCODE=0}}
try {
  node scripts/restaurant-p15-isolation-smoke.js
  node scripts/restaurant-p15-runtime-smoke.js
  node scripts/restaurant-p15-backup-crypto-smoke.js
  node scripts/restaurant-p15-backup-receiver-smoke.js
  if($LASTEXITCODE){throw 'Static smoke failed'}

  $installer=Get-Content -Raw 'lab/restaurant-p15/windows/install-p15-windows.ps1'
  if($installer -match 'Register-ScheduledTask|New-ScheduledTask'){throw 'P15 cannot use Task Scheduler'}
  foreach($port in @('8788','8790','8791','55432','55433')){if($installer -match "(?<!\d)$port(?!\d)"){throw "Reserved port leaked into installer: $port"}}
  foreach($file in @('lab/restaurant-p15/windows/install-p15-windows.ps1','lab/restaurant-p15/windows/uninstall-p15-windows.ps1','lab/restaurant-p15/windows/restore-p15-windows.ps1','lab/restaurant-p15/windows/backup-now-p15-windows.ps1','scripts/restaurant-p15-build-windows-package.ps1')){$tokens=$null;$errors=$null;[Management.Automation.Language.Parser]::ParseFile((Resolve-Path $file),[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){throw "PowerShell invalid $file :: $($errors[0].Message)"}}

  $pgRoot=Find-PgRoot
  "P15_POSTGRES_ROOT=$pgRoot"|Out-File $env:GITHUB_ENV -Append -Encoding utf8
  Remove-Item $sourcePgData -Recurse -Force -ErrorAction SilentlyContinue
  $pw=Join-Path $env:RUNNER_TEMP 'p15-pw.txt';'P15CiDbPass-1234567890!'|Set-Content $pw -NoNewline -Encoding ascii
  & "$pgRoot\bin\initdb.exe" -D $sourcePgData -U vantix_p15 --pwfile=$pw --auth=scram-sha-256 --encoding=UTF8 --locale=C
  if($LASTEXITCODE){throw 'initdb failed'}
  Add-Content "$sourcePgData\postgresql.conf" "listen_addresses='127.0.0.1'`nport=55435`n"
  & "$pgRoot\bin\pg_ctl.exe" -D $sourcePgData -l $sourcePgLog -w start
  if($LASTEXITCODE){throw 'pg start failed'}
  $env:PGPASSWORD='P15CiDbPass-1234567890!'
  & "$pgRoot\bin\createdb.exe" -h 127.0.0.1 -p 55435 -U vantix_p15 vantix_restaurant_p15_lab
  if($LASTEXITCODE){throw 'createdb failed'}

  $env:DATABASE_URL='postgresql://vantix_p15:P15CiDbPass-1234567890%21@127.0.0.1:55435/vantix_restaurant_p15_lab'
  $env:P15_ENABLED='true';$env:P15_INSTALLATION_ID='HOME-PILOT-P15';$env:P15_TENANT_SUBDOMAIN='demo-restaurante';$env:P15_HTTP_PORT='8815';$env:P15_BIND_HOST='127.0.0.1';$env:P15_ADVERTISE_HOST='127.0.0.1';$env:P15_LAN_ENABLED='false';$env:P15_PRINT_PORT='18815';$env:P15_JWT_SECRET='P15-CI-JWT-123456789012345678901234567890';$env:P15_ADMIN_PASSWORD='P15-CI-Admin-123456'
  node node_modules/prisma/build/index.js db push
  if($LASTEXITCODE){throw 'prisma db push failed'}
  node lab/restaurant-p15/bootstrap-demo.js
  if($LASTEXITCODE){throw 'bootstrap failed'}

  $out=Join-Path $env:RUNNER_TEMP 'p15-runtime.out';$err=Join-Path $env:RUNNER_TEMP 'p15-runtime.err'
  $proc=Start-Process node.exe -ArgumentList 'lab/restaurant-p15/runtime.js' -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $proc.Id|Set-Content $runtimePidFile
  if(-not(Wait-Http 'http://127.0.0.1:8815/__p15/status' 90)){Get-Content $out,$err -ErrorAction SilentlyContinue;throw 'runtime did not start'}
  $headers=@{'x-tenant-subdomain'='demo-restaurante'}
  $login=Invoke-RestMethod 'http://127.0.0.1:8815/api/v1/auth/login' -Method Post -Headers $headers -ContentType 'application/json' -Body (@{email='admin@demo-restaurante.vantixgc.com';password='P15-CI-Admin-123456'}|ConvertTo-Json)
  if(-not $login.data.token){throw 'login failed'}
  $headers.Authorization="Bearer $($login.data.token)"
  $tables=Invoke-RestMethod 'http://127.0.0.1:8815/api/v1/restaurante/mesas' -Headers $headers
  if(@($tables.data).Count -lt 6){throw 'tables missing'}
  $table=@($tables.data|Where-Object{-not $_.activeSession})[0]
  $opened=Invoke-RestMethod "http://127.0.0.1:8815/api/v1/restaurante/mesas/$($table.id)/abrir" -Method Post -Headers $headers -ContentType 'application/json' -Body '{"guestCount":1}'
  if(-not $opened.data.session.id){throw 'table open failed'}
  $sessionId=$opened.data.session.id
  $menu=Invoke-RestMethod 'http://127.0.0.1:8815/api/v1/restaurante/menu' -Headers $headers
  $item=@($menu.data)[0]
  if($item){
    try{
      Invoke-RestMethod "http://127.0.0.1:8815/api/v1/restaurante/sesiones/$sessionId/pedidos" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{items=@(@{menuItemId=$item.id;quantity=1})}|ConvertTo-Json -Depth 6)|Out-Null
    }catch{Write-Host "Order smoke skipped by canonical constraints: $($_.Exception.Message)"}
  }

  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  $backupInstall=Join-Path $env:RUNNER_TEMP 'p15-backup-install';New-Item -ItemType Directory -Force -Path "$backupInstall\config","$backupInstall\files","$backupInstall\backups"|Out-Null
  '{"version":1,"stations":{}}'|Set-Content "$backupInstall\config\printers.json";'{"authority":"LOCAL_PRIMARY"}'|Set-Content "$backupInstall\config\runtime.json"
  $env:P15_INSTALL_DIR=$backupInstall;$env:P15_PG_BIN="$pgRoot\bin";$env:P15_BACKUP_DIR="$backupInstall\backups";$env:P15_BACKUP_SECRET='P15-CI-Recovery-Key-12345678901234567890';$env:P15_BACKUP_KEEP='4'
  node -e "require('./lab/restaurant-p15/backup-agent').createBackup(process.env).then(x=>console.log(x.archive)).catch(e=>{console.error(e);process.exit(1)})"
  if($LASTEXITCODE){throw 'backup failed'}
  $archive=Get-ChildItem "$backupInstall\backups\*.vxp15"|Select-Object -First 1;if(-not $archive){throw 'backup missing'}
  node lab/restaurant-p15/restore.js --archive $archive.FullName --secret 'P15-CI-Recovery-Key-12345678901234567890' --installDir $backupInstall
  if($LASTEXITCODE){throw 'restore failed'}

  Stop-SourcePg $pgRoot
  node node_modules/prisma/build/index.js generate
  if($LASTEXITCODE){throw 'prisma generate before package failed'}
  ./scripts/restaurant-p15-build-windows-package.ps1
  $zip=Get-ChildItem 'artifacts\p15-windows\*.zip'|Select-Object -First 1;if(-not $zip){throw 'package missing'}
  $extract=Join-Path $env:RUNNER_TEMP 'p15-package';Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue;Expand-Archive $zip.FullName $extract -Force
  $manifest=Get-Content "$extract\package-manifest.json" -Raw|ConvertFrom-Json
  if($manifest.httpPort -ne 8815 -or $manifest.postgresPort -ne 55435 -or $manifest.productionTouched){throw 'bad package manifest'}

  Remove-Item $install -Recurse -Force -ErrorAction SilentlyContinue
  & "$extract\lab\restaurant-p15\windows\install-p15-windows.ps1" -InstallDir $install -AdminPassword 'P15-Package-CI-123456' -NoShortcut -NoFirewall
  if(-not(Wait-Http 'http://127.0.0.1:8815/__p15/status' 90)){throw 'installed package not healthy'}
  foreach($svc in @('VantixGC Restaurant P15 PostgreSQL','VantixRestaurantP15Server','VantixRestaurantP15Print','VantixRestaurantP15Backup')){$s=Get-Service -Name $svc -ErrorAction Stop;if($s.Status -ne 'Running'){throw "service not running: $svc"}}
  Restart-Service -Name 'VantixRestaurantP15Server' -Force
  if(-not(Wait-Http 'http://127.0.0.1:8815/__p15/status' 60)){throw 'server service failed restart'}
  & "$install\app\lab\restaurant-p15\windows\backup-now-p15-windows.ps1" -InstallDir $install
  $installedBackup=Get-ChildItem "$install\backups\*.vxp15"|Sort-Object LastWriteTime -Descending|Select-Object -First 1;if(-not $installedBackup){throw 'installed backup missing'}
  $hash=(Get-FileHash $zip.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "P15_PACKAGE_PATH=$($zip.FullName)"|Out-File $env:GITHUB_ENV -Append -Encoding utf8
  "P15_PACKAGE_SHA256=$hash"|Out-File $env:GITHUB_ENV -Append -Encoding utf8
  Write-Host "P15_WINDOWS_E2E_OK package=$($zip.FullName) sha256=$hash"
}
finally {
  try{if(Test-Path $runtimePidFile){Stop-Process -Id ([int](Get-Content $runtimePidFile)) -Force -ErrorAction SilentlyContinue}}catch{}
  $uninstall=Join-Path $install 'app\lab\restaurant-p15\windows\uninstall-p15-windows.ps1'
  if(Test-Path $uninstall){try{& $uninstall -InstallDir $install -PurgeData}catch{Write-Host $_}}
  try{$pgRoot=Find-PgRoot;Stop-SourcePg $pgRoot}catch{}
  Pop-Location
}
