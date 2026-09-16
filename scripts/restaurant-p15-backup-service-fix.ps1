param()
$ErrorActionPreference='Stop'
$Root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$File=Join-Path $Root 'lab\restaurant-p15\backup-agent.js'
$content=Get-Content -LiteralPath $File -Raw
$pattern='(?s)async function main\(\) \{.*?\n\}\nif \(require\.main === module\)'
$replacement=@'
async function main() {
  const intervalMs = Math.max(Number(process.env.P15_BACKUP_INTERVAL_MINUTES || 15), 5) * 60 * 1000;
  console.log(`P15_BACKUP_AGENT_READY intervalMs=${intervalMs}`);
  while (true) {
    try { await createBackup(process.env); }
    catch (error) { console.error(`P15_BACKUP_FAILED: ${error?.stack || error}`); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
if (require.main === module)
'@
$matches=[regex]::Matches($content,$pattern)
if($matches.Count -ne 1){throw "No se encontró main() de backup agent de forma única. Coincidencias=$($matches.Count)"}
$content=[regex]::Replace($content,$pattern,$replacement,1)
Set-Content -LiteralPath $File -Value $content -Encoding UTF8
& node.exe --check $File
if($LASTEXITCODE -ne 0){throw 'backup-agent.js inválido tras fix de servicio.'}
$global:LASTEXITCODE=0
Write-Host 'P15_BACKUP_SERVICE_FIX_OK'
