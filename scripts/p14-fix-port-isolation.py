from pathlib import Path

ROOT = Path('.')
OLD_HTTP = '8790'
NEW_HTTP = '8791'
OLD_PG = '55432'
NEW_PG = '55433'

PORT_FILES = [
    '.github/workflows/restaurant-local-first-p14-ci.yml',
    '.github/workflows/restaurant-p14-windows-package.yml',
    'docs/RESTAURANT_LOCAL_FIRST_P14_PILOT.md',
    'lab/restaurant-p14/.env.example',
    'lab/restaurant-p14/README.md',
    'lab/restaurant-p14/runtime-config.js',
    'lab/restaurant-p14/windows/install-p14-windows.ps1',
    'lab/restaurant-p14/windows/start-p14-windows.ps1',
    'lab/restaurant-p14/windows/watchdog-p14-windows.ps1',
    'lab/restaurant-p14/windows/uninstall-p14-windows.ps1',
    'scripts/restaurant-local-first-p14-runtime-config-smoke.js',
    'scripts/restaurant-local-first-p14-runtime-shell-smoke.js',
    'scripts/restaurant-p14-build-windows-package.ps1',
]

for rel in PORT_FILES:
    path = ROOT / rel
    if not path.exists():
        raise SystemExit(f'Missing required file: {rel}')
    text = path.read_text(encoding='utf-8')
    text = text.replace(OLD_HTTP, NEW_HTTP).replace(OLD_PG, NEW_PG)
    path.write_text(text, encoding='utf-8', newline='\n')

# Bump the package contract so a stale artifact is easy to identify.
build_path = ROOT / 'scripts/restaurant-p14-build-windows-package.ps1'
build = build_path.read_text(encoding='utf-8')
build = build.replace("packageVersion = 'p14-win-home-pilot.1'", "packageVersion = 'p14-win-home-pilot.2-port-isolated'")
if "p14-win-home-pilot.2-port-isolated" not in build:
    raise SystemExit('Could not bump P14 package version')
build_path.write_text(build, encoding='utf-8', newline='\n')

installer_path = ROOT / 'lab/restaurant-p14/windows/install-p14-windows.ps1'
installer = installer_path.read_text(encoding='utf-8')

# Remove the stale firewall rule created by the earlier colliding P14 package.
legacy_constant_anchor = "$FirewallRuleName = 'VantixGC Restaurant P14 Home Pilot LAN 8791'\n"
legacy_constant = legacy_constant_anchor + "$LegacyFirewallRuleName = 'VantixGC Restaurant P14 Home Pilot LAN 8790'\n"
if '$LegacyFirewallRuleName' not in installer:
    if legacy_constant_anchor not in installer:
        raise SystemExit('Installer firewall constant anchor missing')
    installer = installer.replace(legacy_constant_anchor, legacy_constant, 1)

legacy_remove_anchor = "function Configure-P14Firewall([System.Collections.IDictionary]$Lan) {\n  try { Remove-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue | Out-Null } catch {}\n"
legacy_remove = legacy_remove_anchor + "  try { Remove-NetFirewallRule -DisplayName $LegacyFirewallRuleName -ErrorAction SilentlyContinue | Out-Null } catch {}\n"
if 'Remove-NetFirewallRule -DisplayName $LegacyFirewallRuleName' not in installer:
    if legacy_remove_anchor not in installer:
        raise SystemExit('Installer firewall cleanup anchor missing')
    installer = installer.replace(legacy_remove_anchor, legacy_remove, 1)

port_guard_anchor = "function Get-P14PostgresProcess([string]$PgData) {"
port_guard = r'''function Get-ListeningProcessIds([int]$Port) {
  try {
    return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      Where-Object { $_ -and [int]$_ -gt 0 })
  } catch {
    return @()
  }
}

function Assert-PortFree([int]$Port, [string]$Purpose) {
  $Owners = @(Get-ListeningProcessIds $Port)
  if ($Owners.Count -eq 0) { return }
  $Details = @()
  foreach ($OwnerPid in $Owners) {
    $Process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $OwnerPid) -ErrorAction SilentlyContinue
    if ($Process) {
      $Details += ("PID={0} NAME={1} PATH={2}" -f $OwnerPid, $Process.Name, $Process.ExecutablePath)
    } else {
      $Details += ("PID={0}" -f $OwnerPid)
    }
  }
  throw ("P14 no puede usar el puerto {0} para {1}; ya está ocupado por {2}. P13 y Edge no serán detenidos." -f $Port, $Purpose, ($Details -join '; '))
}

'''
if 'function Assert-PortFree' not in installer:
    if port_guard_anchor not in installer:
        raise SystemExit('Installer port guard anchor missing')
    installer = installer.replace(port_guard_anchor, port_guard + port_guard_anchor, 1)

config_anchor = "function Repair-PostgresAcl([string]$PgData) {"
config_function = r'''function Set-P14PostgresNetworkConfig([string]$PgData) {
  $ConfigPath = Join-Path $PgData 'postgresql.conf'
  if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "No existe $ConfigPath" }
  $Content = Get-Content -Raw -LiteralPath $ConfigPath
  $Content = [regex]::Replace($Content, '(?m)^\s*listen_addresses\s*=.*(?:\r?\n)?', '')
  $Content = [regex]::Replace($Content, '(?m)^\s*port\s*=\s*(?:55432|55433)\s*(?:#.*)?(?:\r?\n)?', '')
  $Content = $Content.TrimEnd() + "`r`n`r`n# VantixGC Restaurant P14 Home Pilot - canonical isolated ports`r`nlisten_addresses = '127.0.0.1'`r`nport = 55433`r`n"
  Set-Content -LiteralPath $ConfigPath -Value $Content -Encoding ASCII
}

'''
if 'function Set-P14PostgresNetworkConfig' not in installer:
    if config_anchor not in installer:
        raise SystemExit('Installer postgres config anchor missing')
    installer = installer.replace(config_anchor, config_function + config_anchor, 1)

stop_anchor = "Stop-P14ForUpgrade\n\nforeach ($Name in @('app','runtime','postgres','ops')) {"
stop_replacement = "Stop-P14ForUpgrade\nAssert-PortFree 8791 'runtime HTTP local'\nAssert-PortFree 55433 'PostgreSQL local'\n\nforeach ($Name in @('app','runtime','postgres','ops')) {"
if "Assert-PortFree 8791 'runtime HTTP local'" not in installer:
    if stop_anchor not in installer:
        raise SystemExit('Installer stop/port assertion anchor missing')
    installer = installer.replace(stop_anchor, stop_replacement, 1)

config_call_anchor = "}\n\nRepair-PostgresAcl $PgData\n"
config_call_replacement = "}\n\nSet-P14PostgresNetworkConfig $PgData\nRepair-PostgresAcl $PgData\n"
if 'Set-P14PostgresNetworkConfig $PgData' not in installer:
    if config_call_anchor not in installer:
        raise SystemExit('Installer postgres config call anchor missing')
    installer = installer.replace(config_call_anchor, config_call_replacement, 1)

# Make the actual isolated ports visible before any stateful work begins.
status_anchor = "Assert-Administrator\n"
status_line = "Assert-Administrator\nWrite-Host 'P14 aislado: runtime 8791 y PostgreSQL 55433. P13 8790/55432 y Edge 8788 permanecen intactos.' -ForegroundColor Cyan\n"
if 'P14 aislado: runtime 8791' not in installer:
    if status_anchor not in installer:
        raise SystemExit('Installer administrator anchor missing')
    installer = installer.replace(status_anchor, status_line, 1)

installer_path.write_text(installer, encoding='utf-8', newline='\n')

# Add a Windows regression where P13 legacy ports are occupied during P14 install.
workflow_path = ROOT / '.github/workflows/restaurant-p14-windows-package.yml'
workflow = workflow_path.read_text(encoding='utf-8')
setup_anchor = "          $installer = Join-Path $source 'lab/restaurant-p14/windows/install-p14-windows.ps1'\n"
setup_block = r'''          # Reproduce the real home topology: an older P13 already owns 8790/55432.
          # P14 must install and run on 8791/55433 without stopping those listeners.
          $p13Guard = Start-Job -ScriptBlock {
            $listeners = @(
              [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 8790),
              [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 55432)
            )
            foreach ($listener in $listeners) { $listener.Start() }
            try { while ($true) { Start-Sleep -Seconds 30 } }
            finally { foreach ($listener in $listeners) { try { $listener.Stop() } catch {} } }
          }
          Start-Sleep -Seconds 2
          foreach ($legacyPort in @(8790,55432)) {
            if (-not (Get-NetTCPConnection -State Listen -LocalPort $legacyPort -ErrorAction SilentlyContinue)) {
              throw "No se logró reservar el puerto legado P13 $legacyPort para la regresión."
            }
          }

'''
if 'Reproduce the real home topology' not in workflow:
    if setup_anchor not in workflow:
        raise SystemExit('Windows workflow installer anchor missing')
    workflow = workflow.replace(setup_anchor, setup_block + setup_anchor, 1)

finish_anchor = "          Write-Host 'P14_WINDOWS_INSTALL_REINSTALL_LAN_WATCHDOG_OK'\n"
finish_block = r'''          foreach ($legacyPort in @(8790,55432)) {
            if (-not (Get-NetTCPConnection -State Listen -LocalPort $legacyPort -ErrorAction SilentlyContinue)) {
              throw "REGRESIÓN: P14 interrumpió el puerto legado P13 $legacyPort."
            }
          }
          Stop-Job $p13Guard -ErrorAction SilentlyContinue
          Remove-Job $p13Guard -Force -ErrorAction SilentlyContinue
          Write-Host 'P14_P13_PORT_COEXISTENCE_OK'

'''
if 'P14_P13_PORT_COEXISTENCE_OK' not in workflow:
    if finish_anchor not in workflow:
        raise SystemExit('Windows workflow finish anchor missing')
    workflow = workflow.replace(finish_anchor, finish_block + finish_anchor, 1)

# Contract assertions must reject accidental reuse of P13 ports.
contract_anchor = "          Write-Host 'P14_WINDOWS_PACKAGE_CONTRACT_OK'\n"
contract_block = r'''          if ($manifest.httpPort -ne 8791 -or $manifest.postgresPort -ne 55433) {
            throw 'P14 debe permanecer aislado en 8791/55433.'
          }
          if ($installerText -notmatch 'Assert-PortFree 8791' -or $installerText -notmatch 'Assert-PortFree 55433') {
            throw 'El instalador P14 no protege sus puertos aislados.'
          }
          if ($installerText -notmatch 'Set-P14PostgresNetworkConfig') {
            throw 'El instalador P14 no repara clústeres parciales creados con el puerto antiguo.'
          }

'''
if 'P14 debe permanecer aislado en 8791/55433' not in workflow:
    if contract_anchor not in workflow:
        raise SystemExit('Windows workflow contract anchor missing')
    workflow = workflow.replace(contract_anchor, contract_block + contract_anchor, 1)

workflow_path.write_text(workflow, encoding='utf-8', newline='\n')

# Add explicit guardrails to the Linux contract CI as well.
ci_path = ROOT / '.github/workflows/restaurant-local-first-p14-ci.yml'
ci = ci_path.read_text(encoding='utf-8')
ci_anchor = "          grep -Fq \"productionEdgePort: 8788\" lab/restaurant-p14/runtime-config.js\n"
ci_insert = (
    ci_anchor
    + "          grep -Fq \"httpPort: 8791\" lab/restaurant-p14/runtime-config.js\n"
    + "          grep -Fq \"postgresPort: 55433\" lab/restaurant-p14/runtime-config.js\n"
)
if 'grep -Fq "httpPort: 8791"' not in ci:
    if ci_anchor not in ci:
        raise SystemExit('Local-first workflow contract anchor missing')
    ci = ci.replace(ci_anchor, ci_insert, 1)
ci_path.write_text(ci, encoding='utf-8', newline='\n')

# Final fail-closed audit. Operational P14 paths must not reuse P13 ports.
NO_LEGACY_PORT_FILES = [
    '.github/workflows/restaurant-local-first-p14-ci.yml',
    'lab/restaurant-p14/.env.example',
    'lab/restaurant-p14/runtime-config.js',
    'lab/restaurant-p14/windows/start-p14-windows.ps1',
    'lab/restaurant-p14/windows/watchdog-p14-windows.ps1',
    'scripts/restaurant-local-first-p14-runtime-config-smoke.js',
    'scripts/restaurant-local-first-p14-runtime-shell-smoke.js',
    'scripts/restaurant-p14-build-windows-package.ps1',
]
for rel in NO_LEGACY_PORT_FILES:
    text = (ROOT / rel).read_text(encoding='utf-8')
    if OLD_HTTP in text or OLD_PG in text:
        raise SystemExit(f'Old P13 port leaked into operational P14 contract: {rel}')

installer = installer_path.read_text(encoding='utf-8')
for required in [
    "Assert-PortFree 8791 'runtime HTTP local'",
    "Assert-PortFree 55433 'PostgreSQL local'",
    'Set-P14PostgresNetworkConfig $PgData',
    "port = 55433",
    "P14_HTTP_PORT=8791",
]:
    if required not in installer:
        raise SystemExit(f'Missing installer invariant: {required}')

print('P14_PORT_ISOLATION_MIGRATION_OK')
