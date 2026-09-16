param()
$ErrorActionPreference='Stop'
$Root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Builder=Join-Path $Root 'scripts\restaurant-p15-build-windows-package.ps1'
if(-not(Test-Path -LiteralPath $Builder)){throw "No existe $Builder"}
$content=Get-Content -LiteralPath $Builder -Raw
$old="foreach (`$directory in @('src', 'prisma', 'scripts', 'lab\restaurant-p15', 'edge\print-spooler')) {"
$new="foreach (`$directory in @('src', 'prisma', 'scripts', 'lab\restaurant-p15', 'edge')) {"
if($content.Contains($old)){$content=$content.Replace($old,$new)}elseif($content -notmatch "'edge'\)\) \{"){throw 'No se pudo ampliar payload Edge P15.'}
Set-Content -LiteralPath $Builder -Value $content -Encoding UTF8
$tokens=$null;$errors=$null
[Management.Automation.Language.Parser]::ParseFile($Builder,[ref]$tokens,[ref]$errors)|Out-Null
if($errors.Count){throw "Builder P15 inválido: $($errors[0].Message)"}
Write-Host 'P15_PACKAGE_SOURCE_PREPARED_OK'
