param([string]$InstallDir="C:\ProgramData\VantixGC\Edge",[string]$NodePath="")
$ErrorActionPreference='Stop'
$Source=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $Source '*') -Destination $InstallDir -Recurse -Force
if(-not $NodePath){$NodePath=(Get-Command node -ErrorAction Stop).Source}
$Supervisor=Join-Path $InstallDir 'supervisor\supervisor.js'
$Action=New-ScheduledTaskAction -Execute $NodePath -Argument ('"'+$Supervisor+'"') -WorkingDirectory $InstallDir
$Trigger=New-ScheduledTaskTrigger -AtStartup
$Settings=New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'VantixGC Edge Supervisor' -Action $Action -Trigger $Trigger -Settings $Settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'VantixGC Edge Supervisor'
Write-Host "VantixGC Edge instalado en $InstallDir y configurado para iniciar con Windows."
