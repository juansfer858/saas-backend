'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { listWindowsPrinters, sendWindowsRawPrint, RAW_PRINT_SCRIPT } = require('../edge/print-spooler/windows-printer');
const { buildEscPos } = require('../edge/print-spooler/escpos');
const { runtime, MARKER } = require('../src/modules/restaurant/restaurant-kds-windows-printer.public.routes');
const assetModule = require('../src/modules/restaurant/restaurant-kds-windows-printer-asset.public.routes');

async function main() {
  const calls = [];
  const detectExecutor = async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: JSON.stringify([
      { Name:'POS-80 Cocina', Default:true, WorkOffline:false, PrinterStatus:3, PortName:'USB001', DriverName:'Thermal Printer' },
      { Name:'Caja', Default:false, WorkOffline:false, PrinterStatus:3, PortName:'USB002', DriverName:'Receipt Printer' }
    ]), stderr:'' };
  };
  const printers = await listWindowsPrinters(detectExecutor);
  assert.equal(printers.length, 2);
  assert.equal(printers[0].name, 'POS-80 Cocina');
  assert.equal(printers[0].default, true);
  assert.equal(printers[0].portName, 'USB001');
  assert.equal(calls[0].file, 'powershell.exe');
  assert.ok(calls[0].args.includes('-EncodedCommand'));

  const raw = buildEscPos({ title:'VANTIXGC · PRUEBA', lines:['USB OK'], cut:true });
  let rawBytes = 0;
  const printExecutor = async (_file, _args, options) => {
    assert.equal(options.env.VANTIX_PRINTER_NAME, 'POS-80 Cocina');
    const buffer = fs.readFileSync(options.env.VANTIX_RAW_FILE);
    rawBytes = buffer.length;
    assert.deepEqual(buffer, raw);
    return { stdout:`{"ok":true,"bytes":${buffer.length}}`, stderr:'' };
  };
  const printed = await sendWindowsRawPrint({ printerName:'POS-80 Cocina', buffer:raw, executor:printExecutor });
  assert.equal(printed.ok, true);
  assert.equal(printed.transport, 'WINDOWS');
  assert.equal(printed.printerName, 'POS-80 Cocina');
  assert.equal(printed.bytes, rawBytes);

  assert.match(RAW_PRINT_SCRIPT, /OpenPrinterW/);
  assert.match(RAW_PRINT_SCRIPT, /StartDocPrinterW/);
  assert.match(RAW_PRINT_SCRIPT, /WritePrinter/);
  assert.match(RAW_PRINT_SCRIPT, /pDataType='RAW'/);

  assert.equal(MARKER, 'VANTIX_RESTAURANT_KDS_WINDOWS_PRINTER_V1');
  assert.doesNotThrow(() => new vm.Script(runtime));
  assert.match(runtime, /WINDOWS_PRINTERS/);
  assert.match(runtime, /WINDOWS_TEST/);
  assert.match(runtime, /Detectar impresoras/);
  assert.match(runtime, /Probar impresión/);
  assert.match(runtime, /transport:'WINDOWS'/);

  assert.equal(assetModule.ASSET_PATH, '/app/restaurant-kds-windows-printer.js');
  assert.equal(assetModule.HTML_MARKER, 'VANTIX_RESTAURANT_KDS_WINDOWS_PRINTER_ASSET_V3');
  assert.equal(assetModule.ASSET_VERSION, 'windows-printer-v3-relay-first');
  assert.doesNotThrow(() => new vm.Script(assetModule.browserRuntime));
  assert.match(assetModule.browserRuntime, /installation\?\.relayConnected===true/);
  assert.match(assetModule.browserRuntime, /No hay un Edge activo registrado para este restaurante/);
  assert.doesNotMatch(assetModule.browserRuntime, /El Edge del restaurante no está en línea/);
  assert.match(assetModule.browserRuntime, /edgeAgentId:edge\.agent\.id/);
  assert.match(assetModule.browserRuntime, /action:'PRINT_QUEUE'/);

  const assetSource = fs.readFileSync('src/modules/restaurant/restaurant-kds-windows-printer-asset.public.routes.js','utf8');
  const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js','utf8');
  assert.match(assetSource, /application\/javascript/);
  assert.match(assetSource, /v3-relay-first-js/);
  assert.match(assetSource, /relayConnected/);
  assert.match(assetSource, /src=\\?"\$\{ASSET_PATH\}/);
  assert.match(publicRoutes, /restaurantKdsWindowsPrinterAssetPublicRouter/);
  assert.match(publicRoutes, /installKdsWindowsPrinterAsset/);
  assert.doesNotMatch(publicRoutes, /installKdsWindowsPrinterRuntime/);

  const printingRoutes = fs.readFileSync('src/modules/platform/printing/printing.routes.js','utf8');
  const printingService = fs.readFileSync('src/modules/platform/printing/printing.service.js','utf8');
  const edgeBridge = fs.readFileSync('edge/agent/restaurant-print-bridge.js','utf8');
  const edgeRestaurantEntry = fs.readFileSync('edge/agent/restaurant-entry-v2.js','utf8');
  const commandBridge = fs.readFileSync('src/modules/edge/edge-restaurant-print-bridge.js','utf8');
  assert.match(printingRoutes, /'NAVEGADOR','LAN','WINDOWS'/);
  assert.match(printingService, /transport: \{ in: \['LAN', 'WINDOWS'\] \}/);
  assert.match(printingService, /PRINT_WINDOWS_QUEUE_REQUIRED/);
  assert.match(edgeBridge, /WINDOWS_PRINTERS_OPERATION/);
  assert.match(edgeBridge, /WINDOWS_TEST_OPERATION/);
  assert.match(edgeBridge, /RELAY_POLL_FRAGMENT/);
  assert.match(edgeRestaurantEntry, /require\('\.\/restaurant-print-bridge'\)/);
  assert.ok(edgeRestaurantEntry.indexOf("require('./restaurant-print-bridge')") < edgeRestaurantEntry.indexOf("require('./workspace-entry-v28')"));
  assert.match(commandBridge, /WINDOWS:/);
  assert.match(commandBridge, /queueName/);
  assert.match(commandBridge, /layout: normalizedLayout/);

  const version = require('../edge/version.json');
  assert.equal(version.version, '2.1.9-print-templates.1');
  assert.equal(version.channel, 'PILOT');

  console.log('RESTAURANT WINDOWS USB PRINTER SMOKE OK', JSON.stringify({
    windowsDetection:true,
    rawWritePrinter:true,
    relayDiscovery:true,
    relayTestPrint:true,
    relayBridgeLoadedByRestaurantRuntime:true,
    relayAllowedWhenHeartbeatOffline:true,
    kdsStationUi:true,
    windowsPrinterAssetDirect:true,
    controlCenterLoadsPrinterAsset:true,
    windowsTransportRouting:true,
    configurableCommandLayout:true,
    edgeVersion:version.version
  }));
}

main().catch((error) => { console.error(error); process.exit(1); });