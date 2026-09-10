'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = (p) => fs.readFileSync(p, 'utf8');

const addon = read('src/web/restaurant-v2-kds-printer-hybrid-v24.js');
const html = read('src/web/restaurant-v2-kds.html');
const routes = read('src/modules/restaurant/restaurant-v2-kds.public.routes.js');
const bridge = read('edge/agent/restaurant-print-bridge.js');
const winPrinter = read('edge/print-spooler/windows-printer.js');
const installer = read('edge/supervisor/install-windows.ps1');
const server = read('edge/agent/server.js');
const store = read('edge/agent/store.js');

for (const token of [
  'VANTIX_RESTAURANT_V2_KDS_PRINTER_HYBRID_V24',
  'Detectar impresoras',
  'Probar impresión',
  'WINDOWS_PRINTERS',
  'WINDOWS_TEST',
  '/api/v1/edge/installations',
  "action:'PRINT_QUEUE'",
  '/api/v1/impresion/impresoras',
  "transport:'WINDOWS'",
  'HÍBRIDO · Edge conectado',
  'HÍBRIDO · Edge sin conexión',
  "['IMPRESORA','AMBOS']"
]) assert.ok(addon.includes(token), `Falta contrato V24: ${token}`);

assert.ok(html.includes('/app/restaurant-v2-kds-stations-v23.js?v=v23'));
assert.ok(html.includes('/app/restaurant-v2-kds-printer-hybrid-v24.js?v=v24'));
assert.ok(routes.includes("router.get('/app/restaurant-v2-kds-printer-hybrid-v24.js'"));

for (const token of ['WINDOWS_PRINTERS_OPERATION', 'WINDOWS_TEST_OPERATION', 'listWindowsPrinters', 'handleWindowsRelay']) {
  assert.ok(bridge.includes(token), `Edge no soporta ${token}`);
}
assert.ok(winPrinter.includes('Get-CimInstance Win32_Printer'));
assert.ok(winPrinter.includes('Name,Default,WorkOffline,PrinterStatus,PortName,DriverName'));

// El plano offline debe persistir fuera del navegador y fuera de las releases.
assert.ok(installer.includes('[string]$InstallDir = "C:\\ProgramData\\VantixGC\\Edge"'));
assert.ok(installer.includes('EDGE_DATA_DIR=$InstallDir\\data'));
assert.ok(installer.includes('EDGE_DB_PATH=$InstallDir\\data\\vantixgc-edge.sqlite'));
assert.ok(server.includes("const DATA_DIR = process.env.EDGE_DATA_DIR || path.join(INSTALL_ROOT, 'data')"));
assert.ok(server.includes("const DB_PATH = process.env.EDGE_DB_PATH || path.join(DATA_DIR, 'vantixgc-edge.sqlite')"));
assert.ok(server.includes("mode: runtime.connected && !runtime.revoked ? 'CONNECTED' : 'OFFLINE'"));

for (const table of ['snapshots', 'operations', 'local_sales', 'stock_delta', 'print_jobs', 'remote_orders']) {
  assert.ok(store.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `Falta persistencia offline: ${table}`);
}
assert.ok(store.includes("state TEXT NOT NULL DEFAULT 'PENDING'"));
assert.ok(store.includes("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;"));

new Function(addon);
console.log('RESTAURANT V2 KDS PRINTER HYBRID V24 SMOKE OK');
console.log(JSON.stringify({
  hybridIndicator:true,
  windowsPrinterDiscovery:true,
  windowsPrinterTest:true,
  stationPrinterPersistence:true,
  offlineRoot:'C:\\ProgramData\\VantixGC\\Edge\\data',
  offlineDb:'vantixgc-edge.sqlite',
  cloudAndLocalPlanes:true
}, null, 2));
