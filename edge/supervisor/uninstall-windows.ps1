param([switch]$RemoveData)
$ErrorActionPreference='SilentlyContinue'
$SupervisorTask = 'VantixGC Edge Supervisor'
$WatchdogTask = 'VantixGC Edge Watchdog'
Stop-ScheduledTask -TaskName $WatchdogTask
Unregister-ScheduledTask -TaskName $WatchdogTask -Confirm:$false
Stop-ScheduledTask -TaskName $SupervisorTask
Unregister-ScheduledTask -TaskName $SupervisorTask -Confirm:$false
if($RemoveData){Remove-Item 'C:\ProgramData\VantixGC\Edge' -Recurse -Force}
Write-Host 'VantixGC Edge Supervisor y Watchdog retirados del inicio automático.'
