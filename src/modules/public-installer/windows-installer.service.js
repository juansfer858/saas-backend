'use strict';

const INSTALL_SOURCE_COMMIT = '6e6b3012f39bc21dd1d7324b43ada897279b300a';
const NODE_VERSION = '22.23.2';
const NODE_WIN_X64_SHA256 = '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97';

function safePs(value) {
  return String(value || '').replace(/'/g, "''");
}

function normalizeBaseUrl(value) {
  return String(value || 'https://core.vantixgc.com').trim().replace(/\/$/, '');
}

function bootstrapPowerShell({ coreBaseUrl, claimToken = '', promptCredentials = false } = {}) {
  const core = safePs(normalizeBaseUrl(coreBaseUrl));
  const token = safePs(claimToken);
  const credentialSetup = promptCredentials
    ? `$ExistingEnv = Join-Path $InstallDir '.env'\n$EdgeAgentId = ''\n$EdgeAgentKey = ''\nif (-not (Test-Path $ExistingEnv)) {\n  Write-Host ''\n  $EdgeAgentId = (Read-Host 'Pegue el EDGE_AGENT_ID suministrado por VantixGC').Trim()\n  if (-not $EdgeAgentId) { throw 'EDGE_AGENT_ID es obligatorio en la primera instalacion.' }\n  $Secure = Read-Host 'Pegue el EDGE_AGENT_KEY suministrado por VantixGC (no se mostrara)' -AsSecureString\n  $Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)\n  try { $EdgeAgentKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Ptr) }\n  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Ptr) }\n  if (-not $EdgeAgentKey) { throw 'EDGE_AGENT_KEY es obligatorio en la primera instalacion.' }\n}\n$InstallArgs = @('-InstallDir', $InstallDir, '-CoreBaseUrl', $CoreBaseUrl)\nif ($EdgeAgentId) { $InstallArgs += @('-EdgeAgentId', $EdgeAgentId, '-EdgeAgentKey', $EdgeAgentKey) }`
    : `$InstallArgs = @('-InstallDir', $InstallDir, '-CoreBaseUrl', $CoreBaseUrl, '-InstallClaimToken', $ClaimToken)`;

  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$CoreBaseUrl = '${core}'
$ClaimToken = '${token}'
$Commit = '${INSTALL_SOURCE_COMMIT}'
$NodeVersion = '${NODE_VERSION}'
$NodeSha256 = '${NODE_WIN_X64_SHA256}'
$InstallDir = 'C:\\ProgramData\\VantixGC\\Edge'
$Stage = 'inicio'
$Temp = $null
$InstallerLogDir = Join-Path $env:ProgramData 'VantixGC\\Installer'
$InstallerLog = Join-Path $InstallerLogDir 'last-error.log'

function Test-Administrator {
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
  return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Download([string]$Uri, [string]$OutFile) {
  $Last = $null
  for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile -TimeoutSec 180 -Headers @{ 'User-Agent' = 'VantixGC-Restaurantes-Installer/2.2' }
      if (-not (Test-Path $OutFile) -or (Get-Item -LiteralPath $OutFile).Length -le 0) { throw 'La descarga quedo vacia.' }
      return
    } catch {
      $Last = $_
      if ($Attempt -lt 3) { Start-Sleep -Seconds (2 * $Attempt) }
    }
  }
  throw $Last
}

function Configure-LanFirewall {
  $Rules = @(
    @{ Name = 'VantixGC Edge TCP 8788'; Protocol = 'TCP'; Port = 8788 },
    @{ Name = 'VantixGC Edge Discovery UDP 8789'; Protocol = 'UDP'; Port = 8789 }
  )
  foreach ($Rule in $Rules) {
    Get-NetFirewallRule -DisplayName $Rule.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName $Rule.Name -Direction Inbound -Action Allow -Protocol $Rule.Protocol -LocalPort $Rule.Port -RemoteAddress LocalSubnet -Profile Private,Domain | Out-Null
  }
}

if (-not (Test-Administrator)) {
  Write-Host ''
  Write-Host 'VantixGC necesita permisos de Administrador. Windows mostrara una confirmacion.' -ForegroundColor Cyan
  try {
    $ElevatedArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'))
    $Elevated = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $ElevatedArgs -Wait -PassThru
    exit $Elevated.ExitCode
  } catch {
    Write-Host 'No se concedieron permisos de Administrador. La instalacion no hizo cambios.' -ForegroundColor Yellow
    exit 1
  }
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  New-Item -ItemType Directory -Force -Path $InstallerLogDir | Out-Null
  Remove-Item -LiteralPath $InstallerLog -Force -ErrorAction SilentlyContinue

  $Stage = 'descarga de VantixGC'
  Write-Host ''
  Write-Host '=============================================' -ForegroundColor DarkCyan
  Write-Host ' VantixGC Restaurantes - Instalador Windows' -ForegroundColor Cyan
  Write-Host '=============================================' -ForegroundColor DarkCyan
  Write-Host '[1/7] Descargando VantixGC Edge...' -ForegroundColor Cyan
  $Temp = Join-Path $env:TEMP ('vantixgc-edge-install-' + [guid]::NewGuid().ToString('N'))
  $RepoZip = Join-Path $Temp 'repo.zip'
  $RepoOut = Join-Path $Temp 'repo'
  $NodeZip = Join-Path $Temp 'node.zip'
  $NodeOut = Join-Path $Temp 'node'
  New-Item -ItemType Directory -Force -Path $Temp,$RepoOut,$NodeOut | Out-Null
  Invoke-Download -Uri ("https://github.com/juansfer858/saas-backend/archive/$Commit.zip") -OutFile $RepoZip
  Expand-Archive -LiteralPath $RepoZip -DestinationPath $RepoOut -Force
  $RepoRoot = Get-ChildItem -LiteralPath $RepoOut -Directory | Where-Object { $_.Name -like 'saas-backend-*' } | Select-Object -First 1
  if (-not $RepoRoot) { throw 'No se pudo preparar el paquete VantixGC.' }
  $EdgeSource = Join-Path $RepoRoot.FullName 'edge'
  foreach ($Required in @('agent\\server.js', 'supervisor\\install-windows.ps1', 'supervisor\\supervisor.js')) {
    if (-not (Test-Path (Join-Path $EdgeSource $Required))) { throw "El paquete VantixGC esta incompleto: falta $Required" }
  }

  $Stage = 'runtime local'
  Write-Host '[2/7] Preparando runtime local verificado...' -ForegroundColor Cyan
  Invoke-Download -Uri ("https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip") -OutFile $NodeZip
  $ActualNodeHash = (Get-FileHash -LiteralPath $NodeZip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualNodeHash -ne $NodeSha256) { throw 'La verificacion de integridad de Node.js no coincidio. No se instalara el archivo descargado.' }
  Expand-Archive -LiteralPath $NodeZip -DestinationPath $NodeOut -Force
  $NodeExe = Get-ChildItem -LiteralPath $NodeOut -Filter node.exe -Recurse | Select-Object -First 1
  if (-not $NodeExe) { throw 'No se pudo preparar el runtime local de Node.js.' }
  $RuntimeDir = Join-Path $EdgeSource 'runtime'
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  Copy-Item -LiteralPath $NodeExe.FullName -Destination (Join-Path $RuntimeDir 'node.exe') -Force

  $Stage = 'vinculacion e instalacion local'
  Write-Host '[3/7] Instalando Edge, SQLite y Supervisor...' -ForegroundColor Cyan
  ${credentialSetup}
  $Installer = Join-Path $EdgeSource 'supervisor\\install-windows.ps1'
  & $Installer @InstallArgs

  $Stage = 'red local'
  Write-Host '[4/7] Configurando acceso LAN para tablets, KDS y caja...' -ForegroundColor Cyan
  Configure-LanFirewall
  $PublicProfile = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' -and $_.IPv4Connectivity -ne 'Disconnected' } | Select-Object -First 1
  if ($PublicProfile) {
    Write-Host 'AVISO: la red activa de Windows esta marcada como Publica. Para usar otros equipos por LAN, cambiela a Privada.' -ForegroundColor Yellow
  }

  $Stage = 'inicio del servicio local'
  Write-Host '[5/7] Iniciando servicio local...' -ForegroundColor Cyan
  $Ok = $false
  $Status = $null
  for ($i = 0; $i -lt 35; $i++) {
    Start-Sleep -Seconds 1
    try {
      $Status = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8788/api/status' -TimeoutSec 3
      if ($Status.ok) { $Ok = $true; break }
    } catch {}
  }
  if (-not $Ok) {
    $SupervisorLog = Join-Path $InstallDir 'data\\supervisor.log'
    if (Test-Path $SupervisorLog) { Get-Content -LiteralPath $SupervisorLog -Tail 25 | ForEach-Object { Write-Host $_ } }
    throw 'El servicio local no respondio en http://127.0.0.1:8788.'
  }

  $Stage = 'vinculacion con Super Core'
  Write-Host '[6/7] Verificando identidad y vinculacion...' -ForegroundColor Cyan
  if (-not $Status.installationId) { throw 'No se genero la identidad local de instalacion.' }
  if (-not $Status.provisioned) { throw 'La sede no quedo vinculada al Super Core.' }

  Write-Host '[7/7] Instalacion completada.' -ForegroundColor Green
  Write-Host ''
  Write-Host 'VantixGC Restaurantes quedo listo en este PC.' -ForegroundColor Green
  Write-Host ('Modo: ' + [string]$Status.mode)
  Write-Host ('Conectado al Core: ' + [string]$Status.connected)
  Write-Host ('Identidad local: ' + [string]$Status.installationId)
  Write-Host 'Centro de Control: http://127.0.0.1:8788/app/centro-de-control'
  Start-Process 'http://127.0.0.1:8788/app/centro-de-control'
  exit 0
} catch {
  $Message = $_.Exception.Message
  try {
    New-Item -ItemType Directory -Force -Path $InstallerLogDir | Out-Null
    @(
      ('Fecha: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
      ('Etapa: ' + $Stage),
      ('Detalle: ' + $Message),
      '',
      ($_ | Out-String)
    ) | Set-Content -LiteralPath $InstallerLog -Encoding UTF8
  } catch {}
  Write-Host ''
  Write-Host 'NO SE PUDO COMPLETAR LA INSTALACION' -ForegroundColor Yellow
  Write-Host ('Etapa: ' + $Stage) -ForegroundColor Yellow
  Write-Host ('Detalle: ' + $Message)
  Write-Host ('Registro: ' + $InstallerLog)
  Write-Host 'No se borraron los datos locales existentes.'
  exit 1
} finally {
  $EdgeAgentKey = $null
  if ($Temp) { Remove-Item -LiteralPath $Temp -Recurse -Force -ErrorAction SilentlyContinue }
}
`;
}

function launcherCmd(psUrl) {
  const url = String(psUrl || '').replace(/'/g, "''");
  return `@echo off\r\nsetlocal\r\nset "VANTIX_PS1=%TEMP%\\VantixGC_Restaurantes_Instalar.ps1"\r\necho Preparando instalador VantixGC Restaurantes...\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '${url}' -OutFile '%VANTIX_PS1%' -TimeoutSec 60 } catch { Write-Host $_.Exception.Message; exit 1 }"\r\nif errorlevel 1 goto :error\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%VANTIX_PS1%"\r\nset "VANTIX_EXIT=%ERRORLEVEL%"\r\ndel /q "%VANTIX_PS1%" >nul 2>&1\r\nif not "%VANTIX_EXIT%"=="0" goto :error\r\necho.\r\necho Instalacion VantixGC finalizada.\r\npause\r\nexit /b 0\r\n:error\r\necho.\r\necho La instalacion no pudo completarse. Revise el detalle mostrado arriba.\r\npause\r\nexit /b 1\r\n`;
}

function claimInstallerPowerShell(rawToken, coreBaseUrl) {
  return bootstrapPowerShell({ coreBaseUrl, claimToken: rawToken, promptCredentials: false });
}

function claimInstallerCmd(rawToken, coreBaseUrl) {
  const base = normalizeBaseUrl(coreBaseUrl);
  return launcherCmd(`${base}/api/public/restaurantes/instalador/${encodeURIComponent(rawToken)}.ps1`);
}

function genericInstallerPowerShell(coreBaseUrl) {
  return bootstrapPowerShell({ coreBaseUrl, promptCredentials: true });
}

function genericInstallerCmd(coreBaseUrl) {
  const base = normalizeBaseUrl(coreBaseUrl);
  return launcherCmd(`${base}/instalar/windows.ps1`);
}

module.exports = {
  INSTALL_SOURCE_COMMIT,
  NODE_VERSION,
  NODE_WIN_X64_SHA256,
  claimInstallerPowerShell,
  claimInstallerCmd,
  genericInstallerPowerShell,
  genericInstallerCmd
};