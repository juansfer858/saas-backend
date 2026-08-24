param([switch]$RemoveData)
$ErrorActionPreference='SilentlyContinue'
Stop-ScheduledTask -TaskName 'VantixGC Edge Supervisor'
Unregister-ScheduledTask -TaskName 'VantixGC Edge Supervisor' -Confirm:$false
if($RemoveData){Remove-Item 'C:\ProgramData\VantixGC\Edge' -Recurse -Force}
Write-Host 'VantixGC Edge Supervisor retirado del inicio automático.'
