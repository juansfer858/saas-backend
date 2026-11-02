param([string]$InstallDir='C:\ProgramData\VantixGC\Restaurant-P15-Lab')
$ErrorActionPreference='Stop'
$EnvFile=Join-Path $InstallDir 'config\.env'
$Node=Join-Path $InstallDir 'runtime\node.exe'
$Script=Join-Path $InstallDir 'app\lab\restaurant-p15\backup-agent.js'
if(-not(Test-Path $EnvFile)){throw 'No se encontró configuración P15.'}
Get-Content $EnvFile|ForEach-Object{if($_ -match '^([^#][^=]*)=(.*)$'){[Environment]::SetEnvironmentVariable($matches[1].Trim(),$matches[2],'Process')}}
& $Node -e "require(process.argv[1]).createBackup(process.env).then(x=>{console.log(JSON.stringify(x,null,2));process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})" $Script
exit $LASTEXITCODE
